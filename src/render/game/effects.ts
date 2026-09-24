/**
 * Feedback of harvesting in the game view (MASTERPROMPT §14 "Feedback: Partikel je Material,
 * materialspezifische Treffersounds, fliegende Drops mit Magnet, Fortschrittsanzeige bei großen
 * Objekten", §13.2 "Zu hart + Funken", §2.7; M3-11 … M3-15): the presentation side of the gathering
 * events (the sounds are the audio kernel's, `GATHERING_SFX`).
 *
 * - **Particles per material** (M3-11 art, group `effekte`): every hit throws a few tumbling pieces –
 *   splinters from wood, stone chips from rock and ore (ore chips in the colour of their ore), leaves from
 *   plants, clods from dug ground (sand and snow tinted) – with gravity, landing and a short fade; a too
 *   weak tool strikes glowing sparks (`partikel_funken`) and "Zu hart" rises over the target.
 * - **The falling tree** (§14 "Der Baum fällt vom Spieler weg"): the standing tree tips over its foot
 *   towards the fall direction (sideways: rotated; north and south: it sinks away) over the fall time of
 *   the simulation, then lies as its trunk (`baum_stamm_<art>[_nord|_sued]`, clip `liegen`), crumbles
 *   (`zerfallen`) and is gone; the landing raises a dust cloud (`staubwolke`) and a burst of leaves.
 * - **Messages in the world**: "Zu hart", "Taschen voll" over a drop the bags cannot take, "Etwas
 *   vergraben!" over a dig spot – rising and fading like damage numbers (world UI).
 * - **Tool work** (M3-15): a tool hit on an object strikes at the side facing the player at hand height
 *   and sprays its pieces away from the player; the hit that finishes a many-hit object (a tree, a rock)
 *   bursts twice as many. A tool in the hand that breaks says "Kaputt!" over the player and scatters
 *   splinters and chips.
 * - **Using and crafting** (M3-15, M3-16): a poured bucket splashes water over the player, a bandage
 *   sheds a few fibres, every finished craft puffs pieces of the product's material at the player's hands.
 * Randomness comes from a generator seeded by the event, so a frozen frame (screenshots) is always the
 * same. Pools are fixed: nothing is allocated per frame.
 */
import { BALANCE } from '../../content/balance';
import { Rng, hash3 } from '../../engine/rng';
import { CONTENT } from '../../content/index';
import { treeTrunkSpriteId } from '../../content/worldObjects';
import type { GameSession } from '../../game/session';
import type { PlayerSystem } from '../../game/player/system';
import type { SimEventMap } from '../../game/sim';
import type { FallDirection } from '../../game/gathering/formulas';
import type { GatheringSystem } from '../../game/gathering/system';
import type { HarvestMaterial } from '../../game/gathering/rules';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { clipDuration, clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { Translate } from '../errorOverlay';
import type { RenderScene } from '../scene';
import { objectAnchor } from '../world/objects';
import { DAMAGE_LIFETIME } from '../worldUi/worldUi';
import type { WorldRenderTables } from '../world/tables';

/** Particle sprites (M3-11 art) by kind. */
export const PARTICLE_SPRITES = {
  splitter: 'partikel_splitter',
  stein: 'partikel_steinsplitter',
  blatt: 'partikel_blatt',
  erde: 'partikel_erde',
  funken: 'partikel_funken',
} as const;
type ParticleKind = keyof typeof PARTICLE_SPRITES;
const PARTICLE_KINDS = Object.keys(PARTICLE_SPRITES) as ParticleKind[];

/** Dust of a landing tree and of digging. */
export const DUST_SPRITE = 'staubwolke';

/** The particle of each hit material, with a tint for materials that share a sprite (0 = none). */
export const MATERIAL_PARTICLES: Readonly<Record<HarvestMaterial, { readonly kind: ParticleKind; readonly tint: number; readonly count: number }>> = {
  holz: { kind: 'splitter', tint: 0, count: 5 },
  stein: { kind: 'stein', tint: 0, count: 5 },
  erz: { kind: 'stein', tint: 0, count: 6 },
  kristall: { kind: 'stein', tint: 0x9fd8e8, count: 6 },
  pflanze: { kind: 'blatt', tint: 0, count: 4 },
  erde: { kind: 'erde', tint: 0, count: 5 },
  sand: { kind: 'erde', tint: 0xe0c888, count: 5 },
  schnee: { kind: 'erde', tint: 0xf0f4ff, count: 5 },
};

/**
 * Tints of ore chips by ore (§14 "Partikel je Material"): a copper node sheds copper-red chips, tin grey,
 * saltpetre white. The ore is the suffix of the node `erz_<erz>` or the vein `ader_<erz>` (docs/WORLD.md §7).
 */
export const ORE_TINTS: Readonly<Record<string, number>> = { kupfer: 0xc8703c, zinn: 0xb4bcc4, salpeter: 0xece6d6 };

/** Tint of the chips of a hit on `target` (world object or terrain id) of `material`, or 0 for the material's own. */
export function chipTint(target: string, material: HarvestMaterial): number {
  if (material === 'erz') {
    const ore = target.startsWith('erz_') ? target.slice('erz_'.length) : target.startsWith('ader_') ? target.slice('ader_'.length) : '';
    const tint = ORE_TINTS[ore];
    if (tint !== undefined) return tint;
  }
  return MATERIAL_PARTICLES[material].tint;
}

/** Particles of a product's material by its handling sound (`sounds.aufheben`, src/content/items/define.ts). */
export const HANDLING_MATERIAL: Readonly<Record<string, HarvestMaterial>> = {
  sfx_item_holz: 'holz',
  sfx_item_werkzeug: 'holz',
  sfx_item_stein: 'stein',
  sfx_item_erz: 'erz',
  sfx_item_erde: 'erde',
  sfx_item_pflanze: 'pflanze',
  sfx_item_frucht: 'pflanze',
  sfx_item_pilz: 'pflanze',
  sfx_item_muschel: 'stein',
};

/** Tints of the using effects: poured water, the pale fibres of a bandage. */
export const USE_TINTS = { wasser: 0x4a90d0, verband: 0xf0ead8 } as const;

/** Tool work, using and crafting [px, pieces] (presentation only). */
const WORK = {
  /** A tool strikes this far from the target's centre towards the player [px]. */
  contactPx: 5,
  /** Height of the blow above the ground [px]: the hands of the figure. */
  handHeightPx: 8,
  /** Extra speed of the pieces away from the player [px/s]. */
  spraySpeed: 30,
  /** The finishing hit on a target of several hits bursts this many times the pieces. */
  finalBurst: 2,
  /** Pieces of a broken tool: splinters of the haft and chips of the head. */
  brokenPieces: 4,
  /** Drops of a poured bucket, from above the head. */
  splashDrops: 12,
  splashHeightPx: 20,
  /** Fibres of a bandage, at the chest. */
  bandagePieces: 5,
  chestHeightPx: 10,
  /** Pieces of a finished craft, at the hands. */
  craftPieces: 3,
} as const;

/** Particle motion [px, s]: launch speeds, gravity, life, bounce (presentation only). */
const P = {
  capacity: 256,
  upMin: 40,
  upMax: 80,
  sideMax: 36,
  gravity: 260,
  life: 0.7,
  sparkLife: 0.25,
  sparks: 6,
  fadeFrom: 0.6,
  /** Pieces start scattered this far around the hit point [px] (they break off the whole object, not one pixel). */
  spread: 5,
  tintStrength: 0.55,
  leavesOnLanding: 8,
  clodsOnDig: 6,
} as const;

/** The falling tree: it lies this long before crumbling [s]; sinking trees fade out [share of the fall]. */
const TRUNK_LIE_SECONDS = 0.6;
/** Largest angle of a tree tipping sideways [rad]: flat on the ground. */
const FALL_ANGLE = Math.PI / 2;
/** Messages in the world: capacity and height above the target [px]. */
const MESSAGES = 8;
const MESSAGE_LIFT_PX = 18;
/** Trees falling at once at most (a clearing felled in a row). */
const MAX_FALLS = 8;
/** Salt of the effect seeds. */
const EFFECT_SALT = 0x3f1a_2b77;

const FALL_SECONDS = BALANCE.harvest.tree.fallSeconds;
const BYTE = 255;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

/** Easing of the fall: slow at the tipping point, fast before the impact. */
export function fallEase(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k;
}

/** Sprite id of the lying trunk of tree `object` falling in `direction` and whether it is mirrored (`treeTrunkSpriteId`). */
export function trunkSprite(object: string, direction: FallDirection): { id: string; mirror: boolean } {
  if (direction === 'nord' || direction === 'sued') return { id: treeTrunkSpriteId(object, direction), mirror: false };
  return { id: treeTrunkSpriteId(object, 'seite'), mirror: direction === 'links' };
}

interface Fall {
  runtimeId: number;
  object: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  layer: Layer;
  direction: FallDirection;
  start: number;
}

interface Message {
  key: string;
  text: string;
  x: number;
  y: number;
  start: number;
}

/** Events waiting for the next drawn frame (their presentation time is that frame's). */
type Pending =
  | { kind: 'hit'; e: SimEventMap['harvestHit']; at: PlayerPoint | null }
  | { kind: 'felled'; e: SimEventMap['treeFelled'] }
  | { kind: 'landed'; e: SimEventMap['treeLanded'] }
  | { kind: 'dug'; e: SimEventMap['tileDug'] }
  | { kind: 'spot'; e: SimEventMap['digSpotFound'] }
  | { kind: 'blocked'; x: number; y: number; layer: Layer }
  | { kind: 'broken'; item: string; tick: number; at: PlayerPoint | null }
  | { kind: 'used'; e: SimEventMap['itemUsed'] }
  | { kind: 'crafted'; item: string; tick: number; at: PlayerPoint | null };

/** Where the player stood when an event came (captured with the event: the frame draws it later). */
interface PlayerPoint {
  readonly x: number;
  readonly y: number;
  readonly layer: Layer;
}

export class GatherEffects {
  /** Particle pool (struct of arrays). */
  private readonly px = new Float32Array(P.capacity);
  private readonly py = new Float32Array(P.capacity);
  private readonly pz = new Float32Array(P.capacity);
  private readonly vx = new Float32Array(P.capacity);
  private readonly vy = new Float32Array(P.capacity);
  private readonly vz = new Float32Array(P.capacity);
  private readonly age = new Float32Array(P.capacity);
  private readonly life = new Float32Array(P.capacity);
  private readonly kind = new Uint8Array(P.capacity);
  private readonly tint = new Uint32Array(P.capacity);
  private readonly layerOf = new Int8Array(P.capacity);
  /** Runtime id of the tree whose crown a leaf came from (its season palette row colours the leaf); 0 = none. */
  private readonly leafOf = new Uint16Array(P.capacity);
  private count = 0;
  private readonly dust: { x: number; y: number; start: number; layer: Layer }[] = [];
  private readonly falls: Fall[] = [];
  private readonly messages: Message[] = [];
  private readonly pending: Pending[] = [];
  private readonly rng = new Rng(1);
  private readonly anchor = { x: 0, y: 0 };
  private manifest: AtlasManifest | null = null;
  private readonly sprites: (AtlasSprite | null)[] = [];
  /** The tumbling (or glowing) clip of each particle sprite. */
  private readonly clips: (AnimationClip | null)[] = [];
  private dustSprite: AtlasSprite | null = null;
  private lastTime = Number.NaN;
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void)[] = [];
  /** The session's simulation (where the player stands when an event comes), if the session has one. */
  private sim: GameSession['sim'] | null = null;
  private playerSystem: PlayerSystem | null = null;
  private readonly playerPos = { x: 0, y: 0 };

  /** Live particles (tests, debug). */
  get particles(): number {
    return this.count;
  }

  /** Trees in their fall animation (tests, debug). */
  get fallingTrees(): number {
    return this.falls.length;
  }

  /**
   * Listens to the gathering, tool and crafting events of `session` (re-subscribes when the view gets
   * another session). With the session's simulation the effects also know where the player stands.
   */
  follow(session: Pick<GameSession, 'onEvent'> & Partial<Pick<GameSession, 'sim'>>): void {
    if (this.subscribed === session) return;
    this.dispose();
    this.subscribed = session;
    this.sim = session.sim ?? null;
    this.playerSystem = null;
    this.unsubscribe = [
      session.onEvent('harvestHit', (e) => this.pending.push({ kind: 'hit', e, at: this.playerPoint() })),
      session.onEvent('itemBroken', (e) => {
        // Only the tool in the hand breaks in the world; worn armour cracks in the inventory.
        if (e.at.bereich === 'schnellleiste') this.pending.push({ kind: 'broken', item: e.item, tick: e.tick, at: this.playerPoint() });
      }),
      session.onEvent('itemUsed', (e) => this.pending.push({ kind: 'used', e })),
      session.onEvent('craftCompleted', (e) => this.pending.push({ kind: 'crafted', item: e.item, tick: e.tick, at: this.playerPoint() })),
      session.onEvent('treeFelled', (e) => this.pending.push({ kind: 'felled', e })),
      session.onEvent('treeLanded', (e) => this.pending.push({ kind: 'landed', e })),
      session.onEvent('tileDug', (e) => this.pending.push({ kind: 'dug', e })),
      session.onEvent('digSpotFound', (e) => this.pending.push({ kind: 'spot', e })),
      session.onEvent('dropBlocked', (e) => this.pending.push({ kind: 'blocked', ...this.dropPoint(e.entity) })),
    ];
  }

  /** Where a drop lies (filled by the view before the frame; the event carries only the entity). */
  private dropAt: ((entity: number) => { x: number; y: number; layer: Layer } | null) | null = null;

  /** Lets the effects look up drop positions (the drop system of the session). */
  setDropLookup(lookup: (entity: number) => { x: number; y: number; layer: Layer } | null): void {
    this.dropAt = lookup;
  }

  private dropPoint(entity: number): { x: number; y: number; layer: Layer } {
    return this.dropAt?.(entity) ?? { x: 0, y: 0, layer: 0 };
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.subscribed = null;
    this.sim = null;
    this.playerSystem = null;
  }

  /** Where the player stands now (events are delivered right after their tick), or null without one. */
  private playerPoint(): PlayerPoint | null {
    const sim = this.sim;
    if (sim === null) return null;
    this.playerSystem ??= (sim.systems.find((s) => s.id === 'player') as PlayerSystem | undefined) ?? null;
    const player = this.playerSystem;
    const body = player?.body(sim);
    if (player === null || body === undefined || !player.position(sim, this.playerPos)) return null;
    return { x: this.playerPos.x, y: this.playerPos.y, layer: body.layer };
  }

  /** Advances and draws the effects of `layer` at presentation time `time`. */
  draw(scene: RenderScene, atlas: AtlasData, tables: WorldRenderTables, layer: Layer, time: number, season: number, gathering: GatheringSystem, t: Translate | null): void {
    this.bind(atlas.manifest);
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    for (const p of this.pending) this.start(p, time, tables, gathering, t);
    this.pending.length = 0;
    this.stepParticles(dt);
    this.drawFalls(scene, tables, layer, time, season);
    this.drawParticles(scene, layer, tables, season);
    this.drawDust(scene, layer, time);
    this.drawMessages(scene, time);
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  private start(p: Pending, time: number, tables: WorldRenderTables, gathering: GatheringSystem, t: Translate | null): void {
    switch (p.kind) {
      case 'hit': {
        const e = p.e;
        this.seed(e.tick, e.tx, e.ty);
        // A tool on an object strikes its side facing the player at hand height; ground is struck where it lies.
        const onObject = p.at !== null && p.at.layer === e.layer && tables.ids.objects.find(e.target) !== undefined;
        const blow = onObject && p.at !== null ? this.blow(e.x, e.y, p.at) : null;
        const x = blow?.x ?? e.x;
        const y = blow?.y ?? e.y;
        const z = blow === null ? 0 : WORK.handHeightPx;
        const sx = blow?.ux ?? 0;
        const sy = blow?.uy ?? 0;
        if (e.tooHard) {
          for (let k = 0; k < P.sparks; k++) this.spawn('funken', x, y, 0, P.sparkLife, e.layer, z, sx, sy);
          this.say('ui.interaction.tooHardShort', e.x, e.y, time, t);
          return;
        }
        const m = MATERIAL_PARTICLES[e.material];
        const tint = chipTint(e.target, e.material);
        const count = e.hitsNeeded > 1 && e.hits >= e.hitsNeeded ? m.count * WORK.finalBurst : m.count;
        for (let k = 0; k < count; k++) this.spawn(m.kind, x, y, tint, P.life, e.layer, z, sx, sy);
        return;
      }
      case 'broken': {
        if (p.at === null) return;
        this.seed(p.tick, Math.floor(p.at.x), Math.floor(p.at.y));
        for (let k = 0; k < WORK.brokenPieces; k++) {
          this.spawn('splitter', p.at.x, p.at.y, 0, P.life, p.at.layer, WORK.handHeightPx);
          this.spawn('stein', p.at.x, p.at.y, 0, P.life, p.at.layer, WORK.handHeightPx);
        }
        this.say('ui.tools.brokenShort', p.at.x, p.at.y, time, t);
        return;
      }
      case 'used': {
        const e = p.e;
        this.seed(e.tick, Math.floor(e.x), Math.floor(e.y));
        if (e.use === 'ausgiessen') for (let k = 0; k < WORK.splashDrops; k++) this.spawn('erde', e.x, e.y, USE_TINTS.wasser, P.life, e.layer, WORK.splashHeightPx);
        else for (let k = 0; k < WORK.bandagePieces; k++) this.spawn('blatt', e.x, e.y, USE_TINTS.verband, P.life, e.layer, WORK.chestHeightPx);
        return;
      }
      case 'crafted': {
        if (p.at === null) return;
        const material = HANDLING_MATERIAL[CONTENT.collection('items').find(p.item)?.sounds.aufheben ?? ''] ?? 'holz';
        const m = MATERIAL_PARTICLES[material];
        this.seed(p.tick, Math.floor(p.at.x), Math.floor(p.at.y));
        for (let k = 0; k < WORK.craftPieces; k++) this.spawn(m.kind, p.at.x, p.at.y, m.tint, P.life, p.at.layer, WORK.handHeightPx);
        return;
      }
      case 'felled': {
        const e = p.e;
        const runtimeId = tables.ids.objects.find(e.object) ?? 0;
        const def = tables.objects[runtimeId] ?? null;
        if (def === null) return;
        objectAnchor(def, e.tx, e.ty, this.anchor);
        if (this.falls.length >= MAX_FALLS) this.falls.shift();
        this.falls.push({ runtimeId, object: e.object, tx: e.tx, ty: e.ty, x: this.anchor.x, y: this.anchor.y, layer: e.layer, direction: e.direction, start: time });
        return;
      }
      case 'landed': {
        const e = p.e;
        const fall = this.falls.find((f) => f.tx === e.tx && f.ty === e.ty && f.layer === e.layer);
        const x = fall?.x ?? e.tx * TILE_PX;
        const y = fall?.y ?? e.ty * TILE_PX;
        const dir = e.direction === 'rechts' ? 1 : e.direction === 'links' ? -1 : 0;
        const vert = e.direction === 'sued' ? 1 : e.direction === 'nord' ? -1 : 0;
        const len = BALANCE.harvest.tree.fallLengthTiles * TILE_PX;
        const mx = x + (dir * len) / 2;
        const my = y + (vert * len) / 2;
        this.dust.push({ x: mx, y: my, start: time, layer: e.layer });
        this.seed(e.tick, e.tx, e.ty);
        const ids = contentWorldIdTables().objects;
        const tree = ids.has(e.object) ? ids.runtimeId(e.object) : 0;
        for (let k = 0; k < P.leavesOnLanding; k++) {
          const i = this.spawn('blatt', mx + dir * this.rng.float(-len / 2, len / 2), my + vert * this.rng.float(-len / 2, len / 2), 0, P.life, e.layer);
          this.leafOf[i] = tree;
        }
        return;
      }
      case 'dug': {
        const e = p.e;
        const x = e.tx * TILE_PX + TILE_PX / 2;
        const y = e.ty * TILE_PX + TILE_PX / 2;
        this.seed(e.tick, e.tx, e.ty);
        const tile = gathering.rules.tiles[tables.ids.terrain.find(e.from) ?? 0];
        const m = MATERIAL_PARTICLES[tile?.material ?? 'erde'];
        for (let k = 0; k < P.clodsOnDig; k++) this.spawn(m.kind, x, y, m.tint, P.life, e.layer);
        this.dust.push({ x, y, start: time, layer: e.layer });
        return;
      }
      case 'spot':
        this.say('ui.interaction.digSpot', p.e.tx * TILE_PX + TILE_PX / 2, p.e.ty * TILE_PX, time, t);
        return;
      case 'blocked':
        this.say('ui.interaction.bagsFullShort', p.x, p.y, time, t);
        return;
    }
  }

  /** The point a tool strikes an object whose centre is (x, y) from the player at `at`, and the unit vector away from the player. */
  private blow(x: number, y: number, at: PlayerPoint): { x: number; y: number; ux: number; uy: number } {
    const dx = x - at.x;
    const dy = y - at.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x, y, ux: 0, uy: 0 };
    const ux = dx / len;
    const uy = dy / len;
    return { x: x - ux * WORK.contactPx, y: y - uy * WORK.contactPx, ux, uy };
  }

  private seed(tick: number, tx: number, ty: number): void {
    this.rng.seed(hash3(tick, tx, ty, EFFECT_SALT));
  }

  private say(key: string, x: number, y: number, time: number, t: Translate | null): void {
    if (t === null) return;
    if (this.messages.length >= MESSAGES) this.messages.shift();
    this.messages.push({ key, text: t(key), x, y: y - MESSAGE_LIFT_PX, start: time });
  }

  // -------------------------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------------------------

  /**
   * One particle around (x, y) at `height` px above the ground (plus a little scatter), thrown up and to a
   * random side; (`awayX`, `awayY`) adds a push in that direction (unit vector, away from a tool's blow).
   */
  private spawn(kind: ParticleKind, x: number, y: number, tint: number, life: number, layer: Layer, height = 0, awayX = 0, awayY = 0): number {
    const i = this.count < P.capacity ? this.count++ : this.rng.int(0, P.capacity);
    const r = this.rng;
    this.px[i] = x + r.float(-P.spread, P.spread);
    this.py[i] = y + r.float(-P.spread, P.spread) / 2;
    this.pz[i] = height + r.float(2, 8);
    this.vx[i] = r.float(-P.sideMax, P.sideMax) + awayX * WORK.spraySpeed;
    this.vy[i] = (r.float(-P.sideMax, P.sideMax) + awayY * WORK.spraySpeed) / 2;
    this.vz[i] = r.float(P.upMin, P.upMax);
    this.age[i] = 0;
    this.life[i] = life * r.float(0.8, 1.2);
    this.kind[i] = PARTICLE_KINDS.indexOf(kind);
    this.tint[i] = tint;
    this.layerOf[i] = layer;
    this.leafOf[i] = 0;
    return i;
  }

  private stepParticles(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      this.age[i] = (this.age[i] as number) + dt;
      if ((this.age[i] as number) >= (this.life[i] as number)) {
        this.removeParticle(i);
        continue;
      }
      if ((this.pz[i] as number) > 0 || (this.vz[i] as number) > 0) {
        this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
        this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
        this.vz[i] = (this.vz[i] as number) - P.gravity * dt;
        this.pz[i] = Math.max(0, (this.pz[i] as number) + (this.vz[i] as number) * dt);
        if (this.pz[i] === 0) this.vz[i] = 0;
      }
      i++;
    }
  }

  private removeParticle(i: number): void {
    const last = --this.count;
    this.px[i] = this.px[last] as number;
    this.py[i] = this.py[last] as number;
    this.pz[i] = this.pz[last] as number;
    this.vx[i] = this.vx[last] as number;
    this.vy[i] = this.vy[last] as number;
    this.vz[i] = this.vz[last] as number;
    this.age[i] = this.age[last] as number;
    this.life[i] = this.life[last] as number;
    this.kind[i] = this.kind[last] as number;
    this.tint[i] = this.tint[last] as number;
    this.layerOf[i] = this.layerOf[last] as number;
    this.leafOf[i] = this.leafOf[last] as number;
  }

  private drawParticles(scene: RenderScene, layer: Layer, tables: WorldRenderTables, season: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.layerOf[i] !== layer) continue;
      const sprite = this.sprites[this.kind[i] as number] ?? null;
      if (sprite === null) continue;
      const age = this.age[i] as number;
      const life = this.life[i] as number;
      const clip = this.clips[this.kind[i] as number] ?? null;
      const frame = clip === null ? 0 : clip.loop ? clipFrameAt(clip, age) : clipFrameAt(clip, (age / life) * clipDuration(clip));
      const d = scene.sprite.reset();
      d.frame = (sprite.frames[frame] ?? sprite.frames[0]) as SpriteFrameRef;
      const z = this.pz[i] as number;
      d.x = Math.round(this.px[i] as number);
      d.y = Math.round((this.py[i] as number) - z);
      d.depth = this.py[i] as number;
      d.heightBase = z;
      const share = age / life;
      d.fade = share > P.fadeFrom ? (share - P.fadeFrom) / (1 - P.fadeFrom) : 0;
      const tint = this.tint[i] as number;
      if (tint !== 0) {
        d.tintR = (tint >> RED_SHIFT) & BYTE;
        d.tintG = (tint >> GREEN_SHIFT) & BYTE;
        d.tintB = tint & BYTE;
        d.tintStrength = P.tintStrength;
      }
      // Leaves of a felled crown wear the tree's season (autumn gold, spring green).
      const tree = this.leafOf[i] as number;
      const treeDef = tree === 0 ? null : (tables.objects[tree] ?? null);
      if (treeDef !== null) d.paletteRow = tables.objectRow(treeDef, season, 0);
      scene.sprites.push(d);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Falling trees, dust, messages
  // -------------------------------------------------------------------------------------------

  private drawFalls(scene: RenderScene, tables: WorldRenderTables, layer: Layer, time: number, season: number): void {
    let k = 0;
    while (k < this.falls.length) {
      const f = this.falls[k] as Fall;
      const def = tables.objects[f.runtimeId] ?? null;
      const age = time - f.start;
      if (def === null || age < 0) {
        k++;
        continue;
      }
      if (age < FALL_SECONDS) {
        if (f.layer === layer) this.drawTipping(scene, tables, f, def, age / FALL_SECONDS, season);
        k++;
        continue;
      }
      const trunk = trunkSprite(f.object, f.direction);
      const sprite = this.manifest?.sprites[trunk.id] ?? null;
      const lying = age - FALL_SECONDS;
      const crumble = sprite?.clips.zerfallen;
      const crumbleTime = crumble === undefined ? 0 : clipDuration(crumble);
      if (sprite === null || lying > TRUNK_LIE_SECONDS + crumbleTime) {
        this.falls.splice(k, 1);
        continue;
      }
      if (f.layer === layer) {
        const frame = lying < TRUNK_LIE_SECONDS || crumble === undefined ? (sprite.clips.liegen?.frames[0] ?? 0) : clipFrameAt(crumble, lying - TRUNK_LIE_SECONDS);
        const d = scene.sprite.reset();
        d.frame = (sprite.frames[frame] ?? sprite.frames[0]) as SpriteFrameRef;
        d.x = f.x;
        d.y = f.y;
        d.mirror = trunk.mirror;
        d.paletteRow = tables.objectRow(def, season, 0);
        scene.sprites.push(d);
      }
      k++;
    }
  }

  /** The standing tree tipping over its foot: rotated sideways, sinking away north or south. */
  private drawTipping(scene: RenderScene, tables: WorldRenderTables, f: Fall, def: NonNullable<WorldRenderTables['objects'][number]>, t: number, season: number): void {
    const eased = fallEase(t);
    const d = scene.sprite.reset();
    d.frame = def.sprite.frames[def.seasonFrames[season] ?? 0] as SpriteFrameRef;
    d.x = f.x;
    d.y = f.y;
    d.paletteRow = tables.objectRow(def, season, 0);
    if (f.direction === 'rechts') d.rotation = FALL_ANGLE * eased;
    else if (f.direction === 'links') d.rotation = -FALL_ANGLE * eased;
    else d.fade = eased;
    // A tree falling south lies in front of the stump; one falling north behind it.
    d.depth = f.direction === 'sued' ? f.y + TILE_PX * eased : f.y;
    scene.sprites.push(d);
  }

  private drawDust(scene: RenderScene, layer: Layer, time: number): void {
    const sprite = this.dustSprite;
    const clip = sprite?.clips.aufwirbeln;
    let k = 0;
    while (k < this.dust.length) {
      const c = this.dust[k] as { x: number; y: number; start: number; layer: Layer };
      const age = time - c.start;
      if (sprite === null || clip === undefined || age > clipDuration(clip)) {
        this.dust.splice(k, 1);
        continue;
      }
      if (c.layer === layer && age >= 0) {
        const d = scene.sprite.reset();
        d.frame = (sprite.frames[clipFrameAt(clip, age)] ?? sprite.frames[0]) as SpriteFrameRef;
        d.x = c.x;
        d.y = c.y;
        scene.sprites.push(d);
      }
      k++;
    }
  }

  private drawMessages(scene: RenderScene, time: number): void {
    let k = 0;
    while (k < this.messages.length) {
      const m = this.messages[k] as Message;
      const age = time - m.start;
      if (age > DAMAGE_LIFETIME) {
        this.messages.splice(k, 1);
        continue;
      }
      scene.worldUi.damage(Math.round(m.x), Math.round(m.y), m.text, Math.max(0, age), 'kritisch');
      k++;
    }
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.sprites.length = 0;
    this.clips.length = 0;
    for (const k of PARTICLE_KINDS) {
      const sprite = manifest.sprites[PARTICLE_SPRITES[k]] ?? null;
      this.sprites.push(sprite);
      this.clips.push(sprite === null ? null : (Object.values(sprite.clips)[0] ?? null));
    }
    this.dustSprite = manifest.sprites[DUST_SPRITE] ?? null;
  }
}
