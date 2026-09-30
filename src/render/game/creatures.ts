/**
 * Creatures, carcasses and traps in the game view (M6-13 … M6-32; MASTERPROMPT §4.5 "Idle, Bewegung, Angriff mit
 * Ausholphase, Treffer, Tod", §6.2 "2-Frame-Trefferblitz", §19.4 Telegraphs, docs/ART.md §15, docs/SPIEL.md §11):
 *
 * - Every creature of the creature system on the drawn layer is its sprite `kreatur_<id>` (assets-src/lib/creature.ts)
 *   with the clip `<aktion>_<richtung>` of what it does: `idle` standing (resting, grazing, sleeping), `move` walking or
 *   running, `flug` while a ground bird flutters (else `move`), `attack_<name>` while it winds up and recovers, `hit`
 *   after a hit, `death` as it falls. `left` mirrors `right` (the sprites are built symmetric). Its facing (radians)
 *   picks the direction, the dominant axis wins.
 * - The attack clip is timed to the simulation: the wind-up positions stretch over the wind-up ticks (difficulty and
 *   run-up included), so the clip's `schlag` event lands on the tick the blow lands; the recovery plays at the clip's rate.
 * - Positions are interpolated with the frame's alpha (the movement of the last tick, `vx`/`vy`); sprites y-sort at
 *   their feet and stand on the height level of their tile (16 px per level in the G-buffer, like drops and stations).
 * - A hit flashes white for two frames at 60 Hz (the frame of the hit and the next); shadow brood burning in glaring
 *   light glows warm; fading shadow brood (sunrise, the Nachtmahr's pursuit over) dissolves over `fadeSeconds`.
 * - Eyes of night hunters (`augen`) are emissive pixels of the sprite; in the dark they glow brighter (`emissiveBoost`).
 * - Variants draw with their palette row (`varianten[].palette`).
 * - A creature that dies without a carcass (shadow brood, bodies nothing is carved from) plays its death clip where it
 *   fell and dissolves (`creatureDied` events, a fixed ring of slots). A carcass plays the death clip from the tick it
 *   was left and then lies on its last frame until it is carved or rots (the last seconds dissolving); the one the
 *   interaction offers (E, use target on its tile) carries the outline (§4.6).
 * - A trap is its item's icon on its tile; a caught creature sits in it.
 *
 * Reads the simulation's state only; allocates nothing per frame (looks are resolved once per atlas and creature).
 */
import { ATTACK_STRIKE_EVENT, attackClipAction, creatureSpriteId } from '../../content/creatures/schema';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import type { CreatureCatalog } from '../../game/creatures/catalog';
import type { CreatureEventMap } from '../../game/creatures/events';
import type { Carcass, CreatureState } from '../../game/creatures/state';
import { CREATURES_SYSTEM_ID, CreatureSystem } from '../../game/creatures/system';
import { TRAPS_SYSTEM_ID, TrapSystem } from '../../game/creatures/traps';
import type { GameSession } from '../../game/session';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { DIRECTIONS, clipDuration, clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { iconSprite } from './drops';

/** Direction indices in `DIRECTIONS` order (down, left, up, right). */
const DIR_DOWN = 0;
const DIR_LEFT = 1;
const DIR_UP = 2;
const DIR_RIGHT = 3;
/** Clip actions every creature sprite has (docs/ART.md §15; `CREATURE_BASE_ACTIONS`) and the flutter of ground birds. */
const ACTION_IDLE = 'idle';
const ACTION_MOVE = 'move';
const ACTION_HIT = 'hit';
const ACTION_DEATH = 'death';
const ACTION_FLIGHT = 'flug';
/** Movement below this per tick counts as standing [px] (the walk clip needs a step). */
const STILL_PX = 0.05;
/** Loop phase offset per creature serial [s]: a herd does not breathe or step in unison. */
const PHASE_STEP = 0.37;
/** Hit flash [ticks]: the frame of the hit and the next at 60 Hz (§6.2 "2-Frame-Trefferblitz"). */
const FLASH_TICKS = 2;
/** A fluttering ground bird rises this far above its ground point [px] (its shadow stays with its feet). */
const FLIGHT_LIFT_PX = 6;
/**
 * Burning shadow brood (glaring light, §12.4): a warm overlay for this long after each burn tick [ticks] – the burn
 * repeats once a second, the glow lasts half of it – in the colour of embers at a third of its strength.
 */
const BURN_GLOW = { ticks: BALANCE.time.tickHz / 2, r: 255, g: 150, b: 70, strength: 0.35 } as const;
/**
 * Eyes of night hunters in the dark: below this ambient intensity the emissive pixels glow brighter, up to `boost`
 * (of `emissiveBoost`'s 0…1, ×4 at 1) in full darkness.
 */
const EYE_GLOW = { below: 0.5, boost: 0.6 } as const;
/** Fade of shadow brood [ticks] (the simulation removes it after the same span, `shadowBrood.fadeSeconds`). */
const FADE_TICKS = Math.max(1, Math.round(BALANCE.creatures.shadowBrood.fadeSeconds * BALANCE.time.tickHz));
/** A body without a carcass dissolves over this long after its death clip [s]. */
const DISSOLVE_SECONDS = 0.6;
/** A carcass dissolves over its last seconds before it rots away [s]. */
const ROT_FADE_SECONDS = 2;
/** Deaths without a carcass shown at once (a ring: the oldest gives way). */
const DYING_SLOTS = 32;
/** Margin around the pushed rectangle in which creatures still draw [px]: the largest creature cell (64 px). */
const MARGIN_PX = 64;
/** The caught creature sits this far behind its trap's icon in the y-sort [px]. */
const CATCH_DEPTH_BIAS = -0.1;

/** What the creature view needs of the game view's frame. */
export interface CreatureFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s] (the loops of idle and walk). */
  time: number;
  /** Interpolation of the frame between the last two ticks (`GameSession.renderAlpha`). */
  alpha: number;
  /** Ambient intensity at the camera, 0…1 (night hunters' eyes glow below `EYE_GLOW.below`). */
  ambient: number;
  /** Tile of the interaction's use target on `layer` (−1 none): the carcass or trap on it carries the outline. */
  focusTx: number;
  focusTy: number;
  /** Height level of a tile (16 px per level in the G-buffer). */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createCreatureFrame(): CreatureFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, alpha: 1, ambient: 1, focusTx: -1, focusTy: -1, levelAt: () => 0 };
}

/** What the creature view drew in the last frame. */
export interface CreatureViewStats {
  creatures: number;
  carcasses: number;
  traps: number;
  /** Deaths without a carcass still playing. */
  dying: number;
  /** Creatures whose sprite the atlas lacks (drawn as nothing). */
  missing: number;
}

/** One action's clips per direction (`DIRECTIONS` order) and whether each is the mirrored opposite side. */
interface ActionClips {
  readonly clips: readonly (AnimationClip | null)[];
  readonly mirror: readonly boolean[];
  /** Clip time [s] of the strike event of an attack clip (0 for other actions). */
  readonly strikeSeconds: number;
}

/** A creature's sprite and clips, resolved once per atlas. */
interface CreatureLook {
  readonly sprite: AtlasSprite;
  readonly idle: ActionClips;
  readonly move: ActionClips;
  readonly hit: ActionClips;
  readonly death: ActionClips;
  readonly flight: ActionClips;
  /** Per attack index of the creature. */
  readonly attacks: readonly ActionClips[];
  /** Night hunter with glowing eyes. */
  readonly eyes: boolean;
  /** Palette row per variant index. */
  readonly variantRows: readonly number[];
}

/** A death without a carcass being shown. */
interface DyingSlot {
  active: boolean;
  creature: string;
  layer: Layer;
  x: number;
  y: number;
  facing: number;
  variant: number;
  tick: number;
}

/** Direction index of a facing [rad, 0 = east, y down]: the dominant axis wins. */
export function directionOfFacing(facing: number): number {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  if ((c < 0 ? -c : c) >= (s < 0 ? -s : s)) return c >= 0 ? DIR_RIGHT : DIR_LEFT;
  return s > 0 ? DIR_DOWN : DIR_UP;
}

/**
 * Clip time [s] of an attack clip `ticksIn` ticks into its phase: the wind-up stretches the clip's positions before
 * its strike over `windupTicks`, the recovery plays on from the strike at the clip's rate.
 */
export function attackClipSeconds(phase: CreatureState['attackPhase'], ticksIn: number, windupTicks: number, strikeSeconds: number, tickHz: number): number {
  const t = ticksIn < 0 ? 0 : ticksIn;
  if (phase === 'ausholen') return strikeSeconds * Math.min(1, t / Math.max(1, windupTicks));
  return strikeSeconds + t / tickHz;
}

/** Clip time [s] of the strike event of `clip` (its position over its rate), or the clip's end without one. */
function strikeSecondsOf(clip: AnimationClip | null): number {
  if (clip === null) return 0;
  const e = clip.events?.find((x) => x.name === ATTACK_STRIKE_EVENT);
  return e === undefined ? clipDuration(clip) : e.frame / clip.fps;
}

/** The clips of `action` of `sprite` per direction: its own, else the mirrored opposite side, else the `down` clip. */
function actionClips(sprite: AtlasSprite, action: string): ActionClips {
  const clips: (AnimationClip | null)[] = [];
  const mirror: boolean[] = [];
  for (const d of DIRECTIONS) {
    const own = sprite.clips[`${action}_${d}`];
    const opposite = d === 'left' ? 'right' : d === 'right' ? 'left' : null;
    const other = opposite === null ? undefined : sprite.clips[`${action}_${opposite}`];
    if (own !== undefined) {
      clips.push(own);
      mirror.push(false);
    } else if (other !== undefined) {
      clips.push(other);
      mirror.push(true);
    } else {
      clips.push(sprite.clips[`${action}_down`] ?? null);
      mirror.push(false);
    }
  }
  let strikeSeconds = 0;
  if (action.startsWith('attack_')) strikeSeconds = strikeSecondsOf(clips[DIR_RIGHT] ?? clips[DIR_DOWN] ?? null);
  return { clips, mirror, strikeSeconds };
}

/** Whether `a` has a clip in any direction. */
function hasClips(a: ActionClips): boolean {
  return a.clips.some((c) => c !== null);
}

export class CreatureSprites {
  private manifest: AtlasManifest | null = null;
  private readonly looks = new Map<string, CreatureLook | null>();
  private systems: { readonly sim: Simulation; readonly creatures: CreatureSystem | null; readonly traps: TrapSystem | null } | null = null;
  private readonly dying: DyingSlot[] = Array.from({ length: DYING_SLOTS }, () => ({ active: false, creature: '', layer: 0, x: 0, y: 0, facing: 0, variant: -1, tick: 0 }));
  private nextSlot = 0;
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly at = { x: 0, y: 0 };
  readonly stats: CreatureViewStats = { creatures: 0, carcasses: 0, traps: 0, dying: 0, missing: 0 };

  /** Listens to the deaths of `session`'s simulation (again only when the session changes). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed === session) return;
    this.dispose();
    this.subscribed = session;
    this.unsubscribe = session.onEvent('creatureDied', (e) => this.died(e));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribed = null;
    for (const s of this.dying) s.active = false;
  }

  /** Draws the creatures, carcasses, traps and deaths of `frame.layer`. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, frame: CreatureFrame): void {
    this.bind(atlas.manifest);
    const st = this.stats;
    st.creatures = 0;
    st.carcasses = 0;
    st.traps = 0;
    st.dying = 0;
    st.missing = 0;
    const sys = this.systemsOf(sim);
    const tickHz = sim.clock.tickHz;
    // The rendered moment in ticks: the state after the last completed tick, `alpha` of the way to the next.
    const now = sim.tick - 1 + frame.alpha;
    const creatures = sys.creatures;
    if (creatures !== null) {
      this.drawCreatures(scene, creatures, frame, now, tickHz);
      this.drawCarcasses(scene, creatures.carcasses.size, creatures, frame, now, tickHz, sim.clock.ticksPerGameHour);
    }
    if (sys.traps !== null) this.drawTraps(scene, sys.traps, frame);
    this.drawDying(scene, frame, now, tickHz);
  }

  private drawCreatures(scene: RenderScene, creatures: CreatureSystem, frame: CreatureFrame, now: number, tickHz: number): void {
    const store = creatures.store;
    const catalog = creatures.catalog;
    const at = this.at;
    const alpha = frame.alpha;
    const eyeGlow = frame.ambient >= EYE_GLOW.below ? 0 : EYE_GLOW.boost * (1 - frame.ambient / EYE_GLOW.below);
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      if (s.layer !== frame.layer) continue;
      const e = store.entityAt(i);
      if (!creatures.positionOf(e, at)) continue;
      // Interpolated: the last tick's movement, `1 − alpha` of it still ahead.
      const x = at.x - s.vx * (1 - alpha);
      const y = at.y - s.vy * (1 - alpha);
      if (x < frame.left - MARGIN_PX || x > frame.right + MARGIN_PX || y < frame.top - MARGIN_PX || y > frame.bottom + MARGIN_PX) continue;
      const look = this.look(s.creature, catalog);
      if (look === null) {
        this.stats.missing++;
        continue;
      }
      const dir = directionOfFacing(s.facing);
      let clips = look.idle;
      let t = frame.time + s.serial * PHASE_STEP;
      const moving = s.vx * s.vx + s.vy * s.vy > STILL_PX * STILL_PX;
      const flying = s.flyUntilTick >= 0 && now <= s.flyUntilTick;
      const sinceHurt = s.hurtTick < 0 ? Number.POSITIVE_INFINITY : now - s.hurtTick;
      const attack = s.attack >= 0 ? look.attacks[s.attack] : undefined;
      if (s.fadeTick < 0 && s.attackPhase !== 'keine' && attack !== undefined && hasClips(attack)) {
        clips = attack;
        const windup = s.attackPhase === 'ausholen' ? s.attackEndTick - s.attackTick : 0;
        t = attackClipSeconds(s.attackPhase, now - s.attackTick, windup, attack.strikeSeconds, tickHz);
      } else if (s.fadeTick < 0 && sinceHurt >= 0 && sinceHurt * (1 / tickHz) < this.clipSeconds(look.hit, dir)) {
        clips = look.hit;
        t = sinceHurt / tickHz;
      } else if (flying && hasClips(look.flight)) {
        clips = look.flight;
      } else if (moving || flying) {
        clips = look.move;
      }
      const clip = clips.clips[dir] ?? look.idle.clips[dir] ?? null;
      if (clip === null) {
        this.stats.missing++;
        continue;
      }
      const lift = flying ? FLIGHT_LIFT_PX : 0;
      const d = scene.sprite.reset();
      d.frame = (look.sprite.frames[clipFrameAt(clip, t)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = y - lift;
      d.depth = y;
      d.mirror = clips.mirror[dir] === true;
      d.heightBase = s.level * WAND_PX_JE_STUFE + lift;
      d.paletteRow = s.variant >= 0 ? (look.variantRows[s.variant] ?? 0) : 0;
      d.flash = sinceHurt >= 0 && sinceHurt < FLASH_TICKS;
      if (look.eyes) d.emissiveBoost = eyeGlow;
      if (s.fadeTick >= 0) d.fade = Math.min(1, Math.max(0, (now - s.fadeTick) / FADE_TICKS));
      if (s.burnTick >= 0 && now - s.burnTick < BURN_GLOW.ticks) {
        d.tintR = BURN_GLOW.r;
        d.tintG = BURN_GLOW.g;
        d.tintB = BURN_GLOW.b;
        d.tintStrength = BURN_GLOW.strength;
      }
      scene.sprites.push(d);
      this.stats.creatures++;
    }
  }

  private drawCarcasses(scene: RenderScene, count: number, creatures: CreatureSystem, frame: CreatureFrame, now: number, tickHz: number, ticksPerGameHour: number): void {
    const store = creatures.carcasses;
    const lifeTicks = Math.round(BALANCE.creatures.hunting.carcassGameHours * ticksPerGameHour);
    const rotFadeTicks = ROT_FADE_SECONDS * tickHz;
    for (let i = 0; i < count; i++) {
      const c: Carcass = store.valueAt(i);
      if (c.layer !== frame.layer) continue;
      if (c.x < frame.left - MARGIN_PX || c.x > frame.right + MARGIN_PX || c.y < frame.top - MARGIN_PX || c.y > frame.bottom + MARGIN_PX) continue;
      const look = this.look(c.creature, creatures.catalog);
      if (look === null) continue;
      const dir = directionOfFacing(c.facing);
      const clip = look.death.clips[dir] ?? null;
      if (clip === null) continue;
      const since = now - (c.untilTick - lifeTicks);
      const tx = Math.floor(c.x / TILE_PX);
      const ty = Math.floor(c.y / TILE_PX);
      const d = scene.sprite.reset();
      d.frame = (look.sprite.frames[clipFrameAt(clip, since / tickHz)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      d.x = c.x;
      d.y = c.y;
      d.mirror = look.death.mirror[dir] === true;
      d.heightBase = frame.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      d.outline = tx === frame.focusTx && ty === frame.focusTy;
      const left = c.untilTick - now;
      if (left < rotFadeTicks) d.fade = Math.min(1, Math.max(0, 1 - left / rotFadeTicks));
      scene.sprites.push(d);
      this.stats.carcasses++;
    }
  }

  private drawTraps(scene: RenderScene, traps: TrapSystem, frame: CreatureFrame): void {
    const list = traps.traps;
    const m = this.manifest;
    if (m === null) return;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === undefined || t.layer !== frame.layer) continue;
      const x = (t.tx + 0.5) * TILE_PX;
      const y = (t.ty + 0.5) * TILE_PX;
      if (x < frame.left - MARGIN_PX || x > frame.right + MARGIN_PX || y < frame.top - MARGIN_PX || y > frame.bottom + MARGIN_PX) continue;
      const icon = m.sprites[iconSprite(t.item)];
      if (icon === undefined) continue;
      const base = frame.levelAt(t.tx, t.ty) * WAND_PX_JE_STUFE;
      const d = scene.sprite.reset();
      d.frame = icon.frames[0] as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.heightBase = base;
      d.outline = t.tx === frame.focusTx && t.ty === frame.focusTy;
      scene.sprites.push(d);
      this.stats.traps++;
      if (t.caught === null) continue;
      const look = this.look(t.caught, null);
      const clip = look?.idle.clips[DIR_DOWN] ?? null;
      if (look === null || clip === null) continue;
      const c = scene.sprite.reset();
      c.frame = (look.sprite.frames[clipFrameAt(clip, frame.time + t.id * PHASE_STEP)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      c.x = x;
      c.y = y;
      c.depth = y + CATCH_DEPTH_BIAS;
      c.heightBase = base;
      scene.sprites.push(c);
    }
  }

  private drawDying(scene: RenderScene, frame: CreatureFrame, now: number, tickHz: number): void {
    for (const s of this.dying) {
      if (!s.active) continue;
      const look = this.look(s.creature, null);
      const dir = directionOfFacing(s.facing);
      const clip = look?.death.clips[dir] ?? null;
      if (look === null || clip === null) {
        s.active = false;
        continue;
      }
      const seconds = (now - s.tick) / tickHz;
      const dissolve = (seconds - clipDuration(clip)) / DISSOLVE_SECONDS;
      if (dissolve >= 1) {
        s.active = false;
        continue;
      }
      if (s.layer !== frame.layer) continue;
      const tx = Math.floor(s.x / TILE_PX);
      const ty = Math.floor(s.y / TILE_PX);
      const d = scene.sprite.reset();
      d.frame = (look.sprite.frames[clipFrameAt(clip, seconds)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      d.x = s.x;
      d.y = s.y;
      d.mirror = look.death.mirror[dir] === true;
      d.heightBase = frame.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      d.paletteRow = s.variant >= 0 ? (look.variantRows[s.variant] ?? 0) : 0;
      d.fade = dissolve > 0 ? dissolve : 0;
      scene.sprites.push(d);
      this.stats.dying++;
    }
  }

  /** A death: bodies without a carcass play their death clip in a ring slot (the carcass shows the others). */
  private died(e: CreatureEventMap['creatureDied']): void {
    if (e.carcass !== NULL_ENTITY) return;
    const s = this.dying[this.nextSlot] as DyingSlot;
    this.nextSlot = (this.nextSlot + 1) % DYING_SLOTS;
    s.active = true;
    s.creature = e.creature;
    s.layer = e.layer;
    s.x = e.x;
    s.y = e.y;
    s.facing = e.facing;
    s.variant = e.variant;
    s.tick = e.tick;
  }

  /** Duration [s] of the clip of `a` in direction `dir` (0 without one). */
  private clipSeconds(a: ActionClips, dir: number): number {
    const c = a.clips[dir];
    return c === null || c === undefined ? 0 : clipDuration(c);
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.looks.clear();
  }

  private systemsOf(sim: Simulation): { readonly creatures: CreatureSystem | null; readonly traps: TrapSystem | null } {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const c = sim.systems.find((x) => x.id === CREATURES_SYSTEM_ID);
      const t = sim.systems.find((x) => x.id === TRAPS_SYSTEM_ID);
      s = { sim, creatures: c instanceof CreatureSystem ? c : null, traps: t instanceof TrapSystem ? t : null };
      this.systems = s;
    }
    return s;
  }

  /** The look of `creature` (resolved on first use per atlas), or null without its sprite. */
  private look(creature: string, catalog: CreatureCatalog | null): CreatureLook | null {
    const known = this.looks.get(creature);
    if (known !== undefined) return known;
    const m = this.manifest;
    const sprite = m?.sprites[creatureSpriteId(creature)];
    const cat = catalog ?? this.systems?.creatures?.catalog ?? null;
    if (m === null || sprite === undefined || cat === null || !cat.has(creature)) {
      this.looks.set(creature, null);
      return null;
    }
    const def = cat.get(creature).def;
    const look: CreatureLook = {
      sprite,
      idle: actionClips(sprite, ACTION_IDLE),
      move: actionClips(sprite, ACTION_MOVE),
      hit: actionClips(sprite, ACTION_HIT),
      death: actionClips(sprite, ACTION_DEATH),
      flight: actionClips(sprite, ACTION_FLIGHT),
      attacks: def.angriffe.map((a) => actionClips(sprite, attackClipAction(a.name))),
      eyes: def.augen !== null,
      variantRows: (def.varianten ?? []).map((v) => Math.max(0, m.paletteRows.findIndex((r) => r.name === v.palette))),
    };
    this.looks.set(creature, look);
    return look;
  }
}
