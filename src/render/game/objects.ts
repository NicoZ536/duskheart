/**
 * Gathering in the game view (M3-10 … M3-15; MASTERPROMPT §4.6 "Interagierbares unter Cursor oder in
 * Reichweite: 1-px-Outline in Akzentfarbe (Shader)", §11.4 "Sammeln (halten, Fortschrittsring)", §26
 * "Interaktionshinweis „[E] Aufheben: Feuerstein ×3"", §14 "Feedback"): `GatheringView` puts together
 * what the player sees of the interaction –
 * - the outline (the renderer's outline pass, sprite flag `outline`) on the target in focus and on the
 *   interactable object under the cursor (in reach or not), through the object layer's highlight slots
 *   (world objects) or the drop sprites (drops);
 * - the aim: the world point under the cursor goes to the simulation as `player.aim` whenever its tile
 *   changes (the focus prefers the aimed tile);
 * - the interaction marker over the target (key cap and hint, `hintText`, world UI); while E is held
 *   the progress ring (`hinweis_ring`, M3-10 art: 9 steps clockwise from 12 o'clock) in its place, and
 *   over a tile target – ground has no sprite to outline – the bobbing arrow `hinweis_pfeil`;
 * - the drops (`DropSprites`, drops.ts) and the effects of harvesting (`GatherEffects`, effects.ts).
 * Reads the simulation, writes nothing but commands.
 */
import type { GameSession } from '../../game/session';
import { bindingLabel } from '../../engine/input/bindings';
import type { DropSystem } from '../../game/drops/system';
import type { GatheringSystem } from '../../game/gathering/system';
import { createObjectHit } from '../../game/gathering/system';
import { hintText, interactionHint } from '../../game/interaction/hint';
import { copyFocus, createInteractionFocus, type InteractionFocus, type InteractionSystem } from '../../game/interaction/system';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, packChunkId, type Layer } from '../../world/model/coords';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import { clipFrameAt } from '../anim/animation';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { Translate } from '../errorOverlay';
import type { RenderScene } from '../scene';
import type { ViewportLayout } from '../viewport';
import type { WorldUiBox } from '../worldUi/worldUi';
import type { WorldObjectLayer } from '../world/objects';
import type { WorldRenderTables } from '../world/tables';
import { DropSprites, type DarkQuery } from './drops';
import { LightSystem } from '../../game/light/system';
import { lightStageIndex } from '../../world/lightmap/stages';
import { GatherEffects } from './effects';

/** Highlight slot of the target in focus and of the object under the cursor (`WorldObjectLayer.setHighlight`). */
const SLOT_FOCUS = 0;
const SLOT_HOVER = 1;
/** The progress ring (M3-10 art) and the arrow over tile targets. */
export const RING_SPRITE = 'hinweis_ring';
export const ARROW_SPRITE = 'hinweis_pfeil';
/** Half the ring's size [px]: its centre sits this far above the point it marks. */
const RING_HALF_PX = 8;
/** Gap between the target's top and the marker [px]. */
const MARKER_GAP_PX = 3;
/** Height of a drop or tile target above its anchor used to place the marker [px]. */
const FLAT_TARGET_TOP_PX = 10;
/**
 * Highest point of a target the ring sits above [px]: over small targets (plants, rocks) it floats above
 * them – clear of the player's head in front –, on a tree it sits on the upper trunk instead of the crown.
 */
const RING_MAX_LIFT_PX = 28;
/** Depth offset that sorts the ring in front of the target and the player next to it [px]. */
const RING_DEPTH_PX = TILE_PX * 4;
/** Half a tile [px]: the arrow floats over the middle of a tile target. */
const HALF_TILE_PX = TILE_PX / 2;

/** What the gathering view reads of the session (the game view's binding). */
export type GatheringSession = Pick<GameSession, 'sim' | 'onEvent' | 'command' | 'input' | 'reader'>;

/** The view of the game scene the gathering view needs this frame. */
export interface GatheringFrame {
  readonly layer: Layer;
  /** Camera centre [world px] and internal view size [px]. */
  readonly cameraX: number;
  readonly cameraY: number;
  readonly viewW: number;
  readonly viewH: number;
  /** Language of content names in the hint. */
  readonly lang: 'de' | 'en';
  /** The HUD shows the interaction hint: the marker over the target is only the key cap (no text twice). */
  readonly hudHint: boolean;
  /**
   * The player's figure as drawn [world px], or null without one: the marker floats above it instead of
   * covering it when the player stands in front of the target (§4.6).
   */
  readonly figure: WorldUiBox | null;
}

/**
 * CSS px of the pointer on the canvas → internal render px (the input state's mouse mapper): the canvas
 * shows the internal image scaled into `viewport.out*` (device px, letterboxed); `cssToDevice` is the
 * canvas's device px per CSS px. Writes into `out`.
 */
export function cursorToInternal(cssX: number, cssY: number, cssToDevice: number, viewport: Readonly<ViewportLayout>, out: { x: number; y: number }): { x: number; y: number } {
  const dx = cssX * cssToDevice - viewport.outX;
  const dy = cssY * cssToDevice - viewport.outY;
  out.x = (dx * viewport.internalWidth) / Math.max(1, viewport.outWidth);
  out.y = (dy * viewport.internalHeight) / Math.max(1, viewport.outHeight);
  return out;
}

/** Internal render px → world px for a camera centred on (cameraX, cameraY) and a view of viewW × viewH. */
export function internalToWorld(x: number, y: number, cameraX: number, cameraY: number, viewW: number, viewH: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = cameraX - viewW / 2 + x;
  out.y = cameraY - viewH / 2 + y;
  return out;
}

/** Brightest light stage in which a lying drop still glints (M3-39): dark and dim (`LIGHT_STAGES`). */
const GLINT_UP_TO_STAGE = lightStageIndex('daemmrig');

/** Outline, aim, marker and ring of the interaction; owner of the drop sprites and the harvest effects. */
export class GatheringView {
  readonly drops = new DropSprites();
  readonly effects = new GatherEffects();
  private readonly focus: InteractionFocus = createInteractionFocus();
  private readonly hover = createObjectHit();
  private readonly world = { x: 0, y: 0 };
  /** Aimed tile sent last (NaN = none). */
  private aimTx = Number.NaN;
  private aimTy = Number.NaN;
  private hint = '';
  private hintLine = '';
  private hintKey = '';
  private hintFor = '';
  private manifest: AtlasManifest | null = null;
  private ring: AtlasSprite | null = null;
  private arrow: AtlasSprite | null = null;
  private systems: { interaction: InteractionSystem; drops: DropSystem; gathering: GatheringSystem; dark: DarkQuery | null } | null = null;
  private sessionOf: GatheringSession | null = null;

  constructor(private readonly t: Translate | null) {}

  /** The focus drawn last (debug, E2E). */
  get lastFocus(): Readonly<InteractionFocus> {
    return this.focus;
  }

  /** The hint text drawn last ('' without focus). */
  get lastHint(): string {
    return this.hint;
  }

  /** The drops of the session (debug view, E2E; allocates). */
  dropList(): { item: string; count: number; x: number; y: number; flying: boolean }[] {
    const store = this.systems?.drops.store;
    if (store === undefined) return [];
    const out: { item: string; count: number; x: number; y: number; flying: boolean }[] = [];
    for (let i = 0; i < store.size; i++) {
      const d = store.valueAt(i);
      out.push({ item: d.stack.item, count: d.stack.count, x: d.x, y: d.y, flying: d.flightTicks < d.flightTotal });
    }
    return out;
  }

  /** Aimed tile sent last, or null. */
  get aimedTile(): { tx: number; ty: number } | null {
    return Number.isNaN(this.aimTx) ? null : { tx: this.aimTx, ty: this.aimTy };
  }

  /**
   * Before the object layer emits: aim, focus, outlines. Returns false while the session has no
   * interaction (then nothing is drawn).
   */
  prepare(session: GatheringSession, frame: GatheringFrame, objects: WorldObjectLayer): boolean {
    const sys = this.systemsOf(session);
    objects.setHighlight(SLOT_FOCUS, -1, -1);
    objects.setHighlight(SLOT_HOVER, -1, -1);
    if (sys === null) return false;
    this.effects.follow(session);
    copyFocus(sys.interaction.focus, this.focus);
    this.sendAim(session, frame);
    const f = this.focus;
    // The target in reach carries the outline – also a use target standing on an object's tile (a stump to sit on).
    if ((f.kind === 'object' || f.kind === 'use') && f.layer === frame.layer) objects.setHighlight(SLOT_FOCUS, packChunkId(f.layer, f.tx >> CHUNK_SHIFT, f.ty >> CHUNK_SHIFT), ((f.ty & CHUNK_MASK) << CHUNK_SHIFT) | (f.tx & CHUNK_MASK));
    const hovered = this.hoveredObject(sys.gathering, frame.layer);
    if (hovered !== null) objects.setHighlight(SLOT_HOVER, hovered.chunkId, hovered.index);
    return true;
  }

  /** After the object layer: drops, effects, marker and ring. */
  draw(scene: RenderScene, atlas: AtlasData, tables: WorldRenderTables, session: GatheringSession, frame: GatheringFrame, time: number, season: number): void {
    const sys = this.systemsOf(session);
    if (sys === null) return;
    const focusedDrop: Entity = this.focus.kind === 'drop' ? this.focus.entity : NULL_ENTITY;
    this.drops.draw(scene, atlas, sys.drops, frame.layer, time, focusedDrop, this.hoveredDrop(sys.drops, frame.layer), sys.dark);
    this.effects.draw(scene, atlas, tables, frame.layer, time, season, sys.gathering, this.t);
    if (this.manifest !== atlas.manifest) {
      this.manifest = atlas.manifest;
      this.ring = atlas.manifest.sprites[RING_SPRITE] ?? null;
      this.arrow = atlas.manifest.sprites[ARROW_SPRITE] ?? null;
    }
    this.marker(scene, tables, session, frame, time);
  }

  /** Forgets the session (scene switched away). */
  dispose(): void {
    this.effects.dispose();
    this.systems = null;
    this.sessionOf = null;
  }

  private systemsOf(session: GatheringSession): { interaction: InteractionSystem; drops: DropSystem; gathering: GatheringSystem; dark: DarkQuery | null } | null {
    if (this.sessionOf === session && this.systems !== null) return this.systems;
    const list = session.sim.systems;
    const interaction = list.find((s) => s.id === 'interaction') as InteractionSystem | undefined;
    const drops = list.find((s) => s.id === 'drops') as DropSystem | undefined;
    const gathering = list.find((s) => s.id === 'gathering') as GatheringSystem | undefined;
    if (interaction === undefined || drops === undefined || gathering === undefined) return null;
    this.sessionOf = session;
    // Drops lying where the gameplay light map is dark or dim glint (M3-39); without light system nothing glints.
    const light = list.find((s) => s.id === 'light');
    const sim = session.sim;
    const dark: DarkQuery | null = light instanceof LightSystem ? (layer, x, y) => lightStageIndex(light.stageAt(sim, layer, x, y)) <= GLINT_UP_TO_STAGE : null;
    this.systems = { interaction, drops, gathering, dark };
    this.effects.setDropLookup((entity) => {
      const d = drops.get(entity);
      return d === undefined ? null : { x: d.x, y: d.y, layer: d.layer };
    });
    return this.systems;
  }

  /** The world point under the cursor, or false when the pointer is not over the view. */
  private cursorWorld(session: GatheringSession, frame: GatheringFrame): boolean {
    const m = session.input.mouse;
    if (!m.inside) return false;
    internalToWorld(m.x, m.y, frame.cameraX, frame.cameraY, frame.viewW, frame.viewH, this.world);
    return true;
  }

  /** Sends `player.aim` when the tile under the cursor changed (or the cursor left the view). */
  private sendAim(session: GatheringSession, frame: GatheringFrame): void {
    if (!this.cursorWorld(session, frame)) {
      if (!Number.isNaN(this.aimTx)) {
        this.aimTx = Number.NaN;
        this.aimTy = Number.NaN;
        session.command({ type: 'player.aim' });
      }
      return;
    }
    const tx = Math.floor(this.world.x / TILE_PX);
    const ty = Math.floor(this.world.y / TILE_PX);
    if (tx === this.aimTx && ty === this.aimTy) return;
    this.aimTx = tx;
    this.aimTy = ty;
    session.command({ type: 'player.aim', x: this.world.x, y: this.world.y });
  }

  /** The interactable world object under the cursor (in reach or not, §4.6), or null. */
  private hoveredObject(gathering: GatheringSystem, layer: Layer): { chunkId: number; index: number } | null {
    if (Number.isNaN(this.aimTx)) return null;
    const hit = this.hover;
    if (!gathering.objectAt(layer, this.aimTx, this.aimTy, hit) || hit.rule === null) return null;
    const r = hit.rule;
    if (r.standing === null && r.stump === null && r.fruit === null) return null;
    return { chunkId: packChunkId(layer, hit.tx >> CHUNK_SHIFT, hit.ty >> CHUNK_SHIFT), index: hit.i };
  }

  /** The drop lying on the tile under the cursor, or `NULL_ENTITY`. */
  private hoveredDrop(drops: DropSystem, layer: Layer): Entity {
    if (Number.isNaN(this.aimTx)) return NULL_ENTITY;
    const store = drops.store;
    for (let i = 0; i < store.size; i++) {
      const d = store.valueAt(i);
      if (d.layer === layer && Math.floor(d.x / TILE_PX) === this.aimTx && Math.floor(d.y / TILE_PX) === this.aimTy) return store.entityAt(i);
    }
    return NULL_ENTITY;
  }

  /** Marker (key cap + hint) above the focus; while working the progress ring; the arrow over tile targets. */
  private marker(scene: RenderScene, tables: WorldRenderTables, session: GatheringSession, frame: GatheringFrame, time: number): void {
    const f = this.focus;
    this.hint = '';
    if (f.kind === 'none' || f.layer !== frame.layer) return;
    const t = this.t;
    const hint = interactionHint(f);
    if (hint === null || t === null) return;
    // The text is built only when what it says changes (no string per frame).
    const key = `${f.kind}|${f.subject}|${f.count}|${f.action}|${f.block ?? ''}|${f.needs ?? ''}|${f.tooWeak ? 1 : 0}|${f.dig ?? ''}|${frame.lang}`;
    if (key !== this.hintFor) {
      this.hintFor = key;
      this.hintLine = hintText(hint, frame.lang, t);
      this.hintKey = this.keyLabel(session, t);
    }
    this.hint = this.hintLine;
    let top = FLAT_TARGET_TOP_PX;
    let ringLift = 0;
    const hit = this.hover;
    if (f.kind === 'object' && this.systems?.gathering.objectAt(f.layer, f.tx, f.ty, hit) === true && hit.rule !== null) {
      const def = tables.objects[hit.rule.runtimeId] ?? null;
      if (def !== null) {
        top = def.top;
        ringLift = Math.min(RING_MAX_LIFT_PX, def.top);
      }
    }
    const baseY = f.kind === 'object' ? (f.ty + 1) * TILE_PX - 1 : f.y;
    const x = Math.round(f.x);
    if (f.kind === 'tile' && this.arrow !== null) {
      const clip = this.arrow.clips.wippen;
      const d = scene.sprite.reset();
      d.frame = (this.arrow.frames[clip === undefined ? 0 : clipFrameAt(clip, time)] ?? this.arrow.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = Math.round(f.y - HALF_TILE_PX);
      d.depth = f.y + TILE_PX;
      scene.sprites.push(d);
    }
    if (!f.working || this.ring === null) {
      scene.worldUi.marker(x, Math.round(baseY - top - MARKER_GAP_PX), this.hintKey, frame.hudHint ? '' : this.hint, frame.figure);
      return;
    }
    const steps = this.ring.frames.length - 1;
    const d = scene.sprite.reset();
    d.frame = this.ring.frames[Math.min(steps, Math.round(f.progress * steps))] as SpriteFrameRef;
    d.x = x;
    d.y = Math.round(baseY - Math.max(ringLift, FLAT_TARGET_TOP_PX) - RING_HALF_PX - MARKER_GAP_PX);
    d.depth = baseY + RING_DEPTH_PX;
    scene.sprites.push(d);
  }

  /** Label of the key bound to `interact` (the key cap of the marker). */
  private keyLabel(session: GatheringSession, t: Translate): string {
    const binding = session.reader.promptBinding('interact');
    if (binding === undefined) return '?';
    return bindingLabel(binding)
      .map((p) => ('text' in p ? p.text : t(p.i18n, p.params)))
      .join('+');
  }
}
