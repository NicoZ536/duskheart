/**
 * Projectiles and thrown weapons in flight (M6-07, M6-08 presentation; MASTERPROMPT §19.2, §6.2; docs/SPIEL.md §10
 * "Projektile", §13 "Projektile im Flug, geworfene Stücke"): every row of the combat system's projectile store on the
 * drawn layer, read only.
 *
 * - **Look**: the flying item's clip in one of the projectile sprites (`geschoss_*`, assets-src/sprites/kampf/
 *   geschosse.ts, clip = item id: `pfeil_feuer`, `wurfmesser_bronze` …); an item without its own clip flies as its class
 *   (arrow, bolt, stone, knife); a thrown spear as its hand sprite, laid flat (`ausruestung_<id>`, the eastward pose); a
 *   creature's shot (M6-15b, `geschoss_<name>`, no item) as the sprite of its id, clip `flug`.
 * - **Flight**: position interpolated with the frame's alpha along the last tick's velocity; flat shots fly at the
 *   simulation's flight height, rotated freely in the low-res buffer to their direction on screen (pixel for pixel);
 *   a throw follows its parabola (`throwArcHeight`, height between ticks from the flight's share), its rotation the
 *   direction of the arc on screen – thrown knives and flasks tumble end over end instead. A shadow on the ground under
 *   everything above it (`drop_schatten`, dithered).
 * - **Rest**: an arrow, bolt or knife that stuck without leaving an item to pick up stays where it hit for a while, at
 *   the angle it came in, then fades; one that sank in deep water kicks the waves (`combatFeedback.splash`); a creature's
 *   shot bursts where it stopped (its clip `aufprall`, once).
 * - **In a body** (M6-05c, `projectileStuck` with `wo: 'ziel'`): the arrow stays in the creature it hit – the target named
 *   by the flight's `projectileHit` –, at the angle it came in, tip in: drawn back from where its line of flight enters
 *   the body as an arrow in the ground is from its hit point, so its tip reaches just into the body and the shaft stands
 *   out towards the shooter (a fast arrow is caught deep inside or past the centre – from the hit point its tip would poke
 *   out of the far side –, the hit test reaches a few pixels beyond the body). The body is its footprint at the arrow's
 *   height: across, as wide as its drawing there (the columns of its standing pose that reach that high, `CreaturePoses`),
 *   in depth its `radius` – a drawing is wider than the circle the simulation hits, and an arrow seated on the circle would
 *   lie across the body instead of sticking in its side. It
 *   moves with the body (the creature's interpolated position plus that offset) and rides its pose (`CreaturePoses` of
 *   creatures.ts: where the drawn pose lies lower than the standing one at the column the arrow enters – the stagger pose of
 *   a stun, a flinch, a lowered head – it sinks by as much; the stun's sway moves it along), until the creature dies or
 *   leaves (despawns, its chunk freezes); at most `IN_BODY.perBody` arrows per body (a new one pushes out the oldest),
 *   `IN_BODY.capacity` in all.
 *
 * Nothing is allocated per frame: looks are resolved once per atlas and item.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { CREATURE_SHOT_PREFIX } from '../../content/creatures/schema';
import { itemLayerSpriteId } from '../../content/items/index';
import { throwArcHeight } from '../../game/combat/formulas';
import type { CombatEventMap } from '../../game/combat/events';
import { FLIGHT_ARC } from '../../game/combat/state';
import type { CombatSystem } from '../../game/combat/system';
import type { CreatureSystem } from '../../game/creatures/system';
import { creaturePosesOf, type CreaturePoses } from './creatures';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { Layer } from '../../world/model/coords';
import { clipDuration, clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import type { CombatFeedback } from './combatFeedback';

/** The projectile sprites, searched in this order for a clip named after the flying item. */
export const PROJECTILE_SPRITES = ['geschoss_pfeil', 'geschoss_brandpfeil', 'geschoss_leuchtpfeil', 'geschoss_bolzen', 'geschoss_stein', 'geschoss_messer', 'geschoss_flasche'] as const;
/** The sprite an item without its own clip flies as, by what it is. */
const CLASS_SPRITE = { bogen: 'geschoss_pfeil', armbrust: 'geschoss_bolzen', schleuder: 'geschoss_stein', wurf: 'geschoss_messer' } as const;
/** Ground shadow of flying things (its small frame). */
const SHADOW_SPRITE = 'drop_schatten';
const SHADOW_FRAME = 1;
/** Shadow dither: half faded under a throw, fainter under a flat shot. */
const SHADOW_FADE = { arc: 0.4, flat: 0.65 } as const;
/** Frame of a hand sprite that lies east (the head forwards; `WAFFEN_FRAME.o` of the weapon generator). */
const HAND_EAST_FRAME = 1;
/** Tumbling of thrown weapons [rad/s]: a knife turns fast, a flask slower. */
const SPIN = { messer: 18, flasche: 9 } as const;
/** How long a stuck projectile stays where it hit [ticks], the last share fading; how many at once. */
const STUCK = { ticks: 20 * BALANCE.time.tickHz, fadeFrom: 0.8, capacity: 24 } as const;
/** A stuck projectile sits this share of its length into the ground or wall (drawn back from the hit point). */
const STUCK_SINK_PX = 3;
/** Flights remembered for their last direction (the stuck arrow's angle). */
const FLIGHTS = 32;
/**
 * Arrows stuck in bodies (M6-05c): at most this many in one body (a boar full of arrows stays readable, the oldest makes
 * room) and in all; they sit this far in front of their body in the y-sort [px] (the body's own sprite first).
 */
export const IN_BODY = { perBody: 4, capacity: 24, depthBias: 0.1 } as const;
/** Projectile hits remembered for the body they struck (the arrow stuck in it comes to rest in the same tick). */
const HITS = 32;
/** A creature shot's clips: in flight, and the burst where it stopped; bursts shown at once. */
const SHOT_CLIPS = { flight: 'flug', impact: 'aufprall' } as const;
const IMPACTS = 16;
/** The view's quiet marks before anything happened: a small integer below every frame's moment. */
const QUIET_SINCE = -(2 ** 30);

/** How an item flies. */
interface ProjectileLook {
  readonly sprite: AtlasSprite;
  readonly clip: AnimationClip | null;
  /** Sprite frame when there is no clip (a hand sprite's eastward pose). */
  readonly frame: number;
  /** Tumbling speed [rad/s] (0: it points where it flies). */
  readonly spin: number;
  /** It stays stuck where it hit (arrows, bolts, knives), else it drops or bursts. */
  readonly sticks: boolean;
  /** Played once where it stopped (a creature shot's splat), or null. */
  readonly impact: AnimationClip | null;
}

/** Counters of the last frame (debug info, tests). */
export interface ProjectileStats {
  flying: number;
  shadows: number;
  stuck: number;
  impacts: number;
  /** Arrows drawn in bodies. */
  inBodies: number;
}

/** What the view reads of the bodies arrows stick in (the creature system: its states and positions). */
export type ProjectileBodies = Pick<CreatureSystem, 'store' | 'positionOf'>;

export class ProjectileView {
  private manifest: AtlasManifest | null = null;
  private readonly looks = new Map<string, ProjectileLook | null>();
  private shadow: AtlasSprite | null = null;
  // Stuck projectiles.
  private readonly stuckTick = new Float64Array(STUCK.capacity).fill(Number.NEGATIVE_INFINITY);
  private readonly stuckX = new Float32Array(STUCK.capacity);
  private readonly stuckY = new Float32Array(STUCK.capacity);
  private readonly stuckAngle = new Float32Array(STUCK.capacity);
  private readonly stuckLayer = new Int8Array(STUCK.capacity);
  private readonly stuckItem: string[] = Array.from({ length: STUCK.capacity }, () => '');
  private nextStuck = 0;
  // The last direction of recent flights.
  private readonly flightEntity = new Float64Array(FLIGHTS).fill(-1);
  private readonly flightAngle = new Float32Array(FLIGHTS);
  private nextFlight = 0;
  // Bursts of creature shots where they stopped.
  private readonly impactTick = new Float64Array(IMPACTS).fill(Number.NEGATIVE_INFINITY);
  private readonly impactX = new Float32Array(IMPACTS);
  private readonly impactY = new Float32Array(IMPACTS);
  private readonly impactAngle = new Float32Array(IMPACTS);
  private readonly impactLayer = new Int8Array(IMPACTS);
  private readonly impactItem: string[] = Array.from({ length: IMPACTS }, () => '');
  private nextImpact = 0;
  /** Ticks until which a stuck projectile or a burst is shown: a frame after them skips their pools. */
  private stuckUntil = Number.NEGATIVE_INFINITY;
  private impactUntil = Number.NEGATIVE_INFINITY;
  /**
   * The same as whole ticks past them (`QUIET_SINCE` before anything stuck or burst): a frame after them – almost every
   * frame – asks with a small integer and reads no float (§30, ADR-0142).
   */
  private stuckOver = QUIET_SINCE;
  private impactOver = QUIET_SINCE;
  // The body each recent projectile hit (`projectileHit`).
  private readonly hitEntity = new Float64Array(HITS).fill(-1);
  private readonly hitTarget = new Float64Array(HITS).fill(-1);
  private nextHit = 0;
  // Arrows in bodies: the body (−1 = free slot), when it stuck (the oldest makes room), where it hit, its offset from the
  // body (NaN until the first frame reads the body's position) and the column it enters the body at (the pose it rides
  // there, `CreaturePoses.dropAt`), angle, layer and item.
  private readonly bodyTarget = new Float64Array(IN_BODY.capacity).fill(-1);
  private readonly bodyTick = new Float64Array(IN_BODY.capacity);
  private readonly bodyHitX = new Float32Array(IN_BODY.capacity);
  private readonly bodyHitY = new Float32Array(IN_BODY.capacity);
  private readonly bodyDX = new Float32Array(IN_BODY.capacity).fill(Number.NaN);
  private readonly bodyDY = new Float32Array(IN_BODY.capacity).fill(Number.NaN);
  private readonly bodyColumn = new Int32Array(IN_BODY.capacity);
  private readonly bodyAngle = new Float32Array(IN_BODY.capacity);
  private readonly bodyItem: string[] = Array.from({ length: IN_BODY.capacity }, () => '');
  /** Slots of `bodyTarget` holding an arrow (a whole number: none means no body is looked at, `restingAt`). */
  private bodiesHeld = 0;
  /** The bodies of the last `draw` (an arrow that sticks asks the creature view for its body's pose from the next frame). */
  private bodiesSeen: ProjectileBodies | null = null;
  private readonly bodyAt = { x: 0, y: 0 };
  /** The body's drawn span at the arrow's height while an arrow is seated (`CreaturePoses.standingSpanInto`). */
  private readonly span = new Float64Array(2);
  readonly stats: ProjectileStats = { flying: 0, shadows: 0, stuck: 0, impacts: 0, inBodies: 0 };

  clear(): void {
    this.stuckTick.fill(Number.NEGATIVE_INFINITY);
    this.impactTick.fill(Number.NEGATIVE_INFINITY);
    this.stuckUntil = Number.NEGATIVE_INFINITY;
    this.impactUntil = Number.NEGATIVE_INFINITY;
    this.stuckOver = QUIET_SINCE;
    this.impactOver = QUIET_SINCE;
    this.flightEntity.fill(-1);
    this.hitEntity.fill(-1);
    this.bodyTarget.fill(-1);
    this.bodiesHeld = 0;
  }

  /** A projectile met a body (`projectileHit` with a target): an arrow that stays in it comes to rest in the same tick. */
  hit(e: CombatEventMap['projectileHit']): void {
    if (e.target === NULL_ENTITY) return;
    const i = this.nextHit;
    this.nextHit = (i + 1) % HITS;
    this.hitEntity[i] = e.entity;
    this.hitTarget[i] = e.target;
  }

  /** How many arrows stick in body `target` (tests, debug). */
  arrowsIn(target: Entity): number {
    let n = 0;
    for (let i = 0; i < IN_BODY.capacity; i++) if (this.bodyTarget[i] === target) n++;
    return n;
  }

  /** Keeps the arrow of projectile `e` in the body it hit (see the module comment); false when the body is unknown. */
  private stickInBody(e: CombatEventMap['projectileStuck'], angle: number): boolean {
    let target = -1;
    for (let k = 0; k < HITS; k++) if (this.hitEntity[k] === e.entity) target = this.hitTarget[k] as number;
    if (target < 0) return false;
    // The slot: the oldest arrow of this body once it is full, else a free one, else the oldest of all.
    let inBody = 0;
    let oldestOwn = -1;
    let free = -1;
    let oldest = 0;
    for (let i = 0; i < IN_BODY.capacity; i++) {
      const t = this.bodyTarget[i] as number;
      if (t === target) {
        inBody++;
        if (oldestOwn < 0 || (this.bodyTick[i] as number) < (this.bodyTick[oldestOwn] as number)) oldestOwn = i;
      } else if (t < 0 && free < 0) free = i;
      if (t >= 0 && (this.bodyTick[i] as number) < (this.bodyTick[oldest] as number)) oldest = i;
    }
    const slot = inBody >= IN_BODY.perBody ? oldestOwn : free >= 0 ? free : oldest;
    if ((this.bodyTarget[slot] as number) < 0) this.bodiesHeld++;
    this.bodyTarget[slot] = target;
    this.bodyTick[slot] = e.tick;
    this.bodyHitX[slot] = e.x;
    this.bodyHitY[slot] = e.y;
    // The creature view draws its pose for the arrow from the next frame on (`CreaturePoses`).
    const seen = this.bodiesSeen;
    const body = seen === null ? undefined : seen.store.get(target);
    if (seen !== null && body !== undefined) creaturePosesOf(seen).want(body.serial);
    this.bodyDX[slot] = Number.NaN;
    this.bodyDY[slot] = Number.NaN;
    this.bodyAngle[slot] = angle;
    this.bodyItem[slot] = e.item;
    return true;
  }

  /** A projectile left (`projectileFired`): its direction is remembered for where it comes to rest. */
  fired(e: CombatEventMap['projectileFired']): void {
    const i = this.nextFlight;
    this.nextFlight = (i + 1) % FLIGHTS;
    this.flightEntity[i] = e.entity;
    this.flightAngle[i] = Math.atan2(e.vy, e.vx);
  }

  /**
   * A projectile came to rest (`projectileStuck`): in deep water it sinks with a splash; in the ground, a wall or a body
   * it stays stuck a while unless it left an item to pick up (the drop shows it) – or it is a thing that does not stick.
   */
  stuck(e: CombatEventMap['projectileStuck'], manifest: AtlasManifest | null, feedback: CombatFeedback): void {
    const look = manifest === null ? null : this.look(e.item, manifest);
    if (e.wo === 'wasser') {
      feedback.splash(e.x, e.y, e.layer, look === null || !look.sticks || look.spin > 0, e.tick);
      return;
    }
    let angle = 0;
    for (let k = 0; k < FLIGHTS; k++) if (this.flightEntity[k] === e.entity) angle = this.flightAngle[k] as number;
    if (look !== null && look.impact !== null) {
      const j = this.nextImpact;
      this.nextImpact = (j + 1) % IMPACTS;
      this.impactTick[j] = e.tick;
      this.impactX[j] = e.x;
      this.impactY[j] = e.y;
      this.impactAngle[j] = angle;
      this.impactLayer[j] = e.layer;
      this.impactItem[j] = e.item;
      const until = e.tick + clipDuration(look.impact) * BALANCE.time.tickHz;
      if (until > this.impactUntil) {
        this.impactUntil = until;
        this.impactOver = Math.ceil(until) + 1;
      }
      return;
    }
    if (e.drop || look === null || !look.sticks) return;
    if (e.wo === 'ziel') {
      this.stickInBody(e, angle);
      return;
    }
    const i = this.nextStuck;
    this.nextStuck = (i + 1) % STUCK.capacity;
    this.stuckTick[i] = e.tick;
    this.stuckX[i] = e.x - Math.cos(angle) * STUCK_SINK_PX;
    this.stuckY[i] = e.y - Math.sin(angle) * STUCK_SINK_PX;
    this.stuckAngle[i] = angle;
    this.stuckLayer[i] = e.layer;
    this.stuckItem[i] = e.item;
    if (e.tick + STUCK.ticks > this.stuckUntil) {
      this.stuckUntil = e.tick + STUCK.ticks;
      this.stuckOver = Math.ceil(this.stuckUntil) + 1;
    }
  }

  /**
   * Whether `draw` shows nothing at any moment of the frame before whole tick `tick` (the moment lies in [tick − 1, tick],
   * `GameSession.renderAlpha` ∈ [0, 1]): no projectile of `combat` flies, no stuck one or burst is left, no arrow sits in a
   * body – whole numbers only, so a frame at rest forms no moment (§30, ADR-0142); `draw` then only resets the counters,
   * whatever moment it gets.
   */
  restingAt(tick: number, combat: CombatSystem | null): boolean {
    return (combat === null || combat.projectiles.size === 0) && this.bodiesHeld === 0 && tick - 1 >= this.stuckOver && tick - 1 >= this.impactOver;
  }

  /**
   * Draws the projectiles of `combat` on `layer` at simulation time `now` [ticks, fractional; `alpha` of the way from the
   * last tick], each on height level `levelOf` of its flight; the arrows in `bodies` (the creatures) with them.
   */
  draw(scene: RenderScene, manifest: AtlasManifest, combat: CombatSystem | null, layer: Layer, now: number, alpha: number, tickHz: number, bodies: ProjectileBodies | null = null): void {
    this.bind(manifest);
    const st = this.stats;
    st.flying = 0;
    st.shadows = 0;
    st.stuck = 0;
    st.impacts = 0;
    st.inBodies = 0;
    if (combat !== null && combat.projectiles.size > 0) this.drawFlying(scene, manifest, combat, layer, alpha, tickHz);
    // The whole-tick marks first: past them the float marks are not read (§30).
    if (now < this.stuckOver && now < this.stuckUntil) this.drawStuck(scene, manifest, layer, now);
    if (now < this.impactOver && now < this.impactUntil) this.drawImpacts(scene, manifest, layer, now, tickHz);
    if (bodies !== null) this.bodiesSeen = bodies;
    if (bodies !== null && this.bodiesHeld > 0) this.drawInBodies(scene, manifest, bodies, layer, alpha);
  }

  /** The arrows in bodies: with their body while it lives, gone once it died or left (see the module comment). */
  private drawInBodies(scene: RenderScene, manifest: AtlasManifest, bodies: ProjectileBodies, layer: Layer, alpha: number): void {
    const at = this.bodyAt;
    const z = BALANCE.combat.projectile.flightHeightPx;
    const poses = creaturePosesOf(bodies);
    for (let i = 0; i < IN_BODY.capacity; i++) {
      const target = this.bodyTarget[i] as number;
      if (target < 0) continue;
      const s = bodies.store.get(target);
      if (s === undefined || s.health <= 0 || !bodies.positionOf(target, at)) {
        this.bodyTarget[i] = -1;
        this.bodiesHeld--;
        continue;
      }
      poses.want(s.serial);
      const look = this.look(this.bodyItem[i] as string, manifest);
      const frame = look === null ? undefined : look.clip === null ? look.sprite.frames[look.frame] : (look.sprite.frames[look.clip.frames[0] ?? 0] ?? look.sprite.frames[0]);
      const slot = poses.slotOf(s.serial);
      // Where it sits on the body, taken once at the body's position of the tick it stuck in (its own method: §30).
      if (Number.isNaN(this.bodyDX[i] as number)) this.seat(i, s.creature, poses, slot);
      if (s.layer !== layer || frame === undefined) continue;
      // Interpolated like the body's sprite: the last tick's movement, `1 − alpha` of it still ahead.
      const x = at.x - s.vx * (1 - alpha);
      const y = at.y - s.vy * (1 - alpha);
      // On the body's drawn pose: lowered as far as the pose lies below its standing one at the arrow's column, moved with
      // its sway (`CreaturePoses`; standing without one).
      const lowered = slot < 0 ? z : z - poses.dropAt(slot, this.bodyColumn[i] as number);
      const height = lowered > 0 ? lowered : 0;
      const d = scene.sprite.reset();
      d.frame = frame;
      d.x = x + (this.bodyDX[i] as number) + (slot < 0 ? 0 : (poses.shiftX[slot] as number));
      d.y = y + (this.bodyDY[i] as number) - height + (slot < 0 ? 0 : (poses.shiftY[slot] as number));
      d.depth = y + IN_BODY.depthBias;
      d.heightBase = s.level * WAND_PX_JE_STUFE + height;
      d.rotation = this.bodyAngle[i] as number;
      scene.sprites.push(d);
      this.stats.inBodies++;
    }
  }

  /**
   * Seats arrow `i` in its body, a `creature` whose position is in `bodyAt` and whose pose the creature view drew in `slot`
   * of `poses` (−1 none): tip in, where its line of flight enters the body's footprint on the shooter's side – an ellipse
   * as wide as the body's drawing at the arrow's height (`CreaturePoses.standingSpanInto`; its circle without a drawn
   * pose) and as deep as its `radius` –, back from a hit point caught inside, on from one the hit test took outside (a line
   * that passes the footprint enters at its point nearest to the line), drawn back from there by `STUCK_SINK_PX` like an
   * arrow in the ground: the tip just in the body, the shaft out towards the shooter. A body of unknown size keeps the hit
   * point. The column of the body's drawing it enters at is the one whose pose it rides.
   */
  private seat(i: number, creature: string, poses: CreaturePoses, slot: number): void {
    const at = this.bodyAt;
    const angle = this.bodyAngle[i] as number;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const hx = (this.bodyHitX[i] as number) - at.x;
    const hy = (this.bodyHitY[i] as number) - at.y;
    const r = CONTENT.collection('creatures').find(creature)?.radius ?? 0;
    let ex = hx;
    let ey = hy;
    if (r > 0) {
      // The footprint: centre `mid` across, half-axes `a` (across) and `r` (in depth).
      const span = this.span;
      const drawn = slot >= 0 && poses.standingSpanInto(slot, BALANCE.combat.projectile.flightHeightPx, span);
      const mid = drawn ? ((span[0] as number) + (span[1] as number)) / 2 : 0;
      const a = drawn ? ((span[1] as number) - (span[0] as number)) / 2 : r;
      // In the footprint's unit circle: |p − d·t| = 1 with p = the hit point, d = the flight's direction (both scaled); the
      // larger t is the entry on the shooter's side.
      const px = (hx - mid) / a;
      const py = hy / r;
      const dx = c / a;
      const dy = sn / r;
      const dd = dx * dx + dy * dy;
      const along = (px * dx + py * dy) / dd;
      const disc = along * along - (px * px + py * py - 1) / dd;
      if (disc > 0) {
        const t = along + Math.sqrt(disc);
        ex = hx - c * t;
        ey = hy - sn * t;
      } else {
        const fx = px - dx * along;
        const fy = py - dy * along;
        const k = 1 / Math.sqrt(fx * fx + fy * fy);
        ex = mid + fx * k * a;
        ey = fy * k * r;
      }
    }
    this.bodyDX[i] = ex - c * STUCK_SINK_PX;
    this.bodyDY[i] = ey - sn * STUCK_SINK_PX;
    // The first column of the body's drawing the arrow enters (half a pixel on along its flight from the edge).
    this.bodyColumn[i] = Math.floor(ex + c * 0.5);
  }

  private drawFlying(scene: RenderScene, manifest: AtlasManifest, combat: CombatSystem, layer: Layer, alpha: number, tickHz: number): void {
    const store = combat.projectiles;
    const c = store.columns;
    const back = 1 - alpha;
    for (let row = 0; row < store.size; row++) {
      if (c.layer[row] !== layer) continue;
      const look = this.look(combat.projectileItem(row), manifest);
      if (look === null) continue;
      const vx = c.vx[row] as number;
      const vy = c.vy[row] as number;
      const x = (c.x[row] as number) - (vx / tickHz) * back;
      const y = (c.y[row] as number) - (vy / tickHz) * back;
      const base = (c.level[row] as number) * WAND_PX_JE_STUFE;
      const ticks = c.ticks[row] as number;
      const arc = c.flight[row] === FLIGHT_ARC;
      let z: number;
      let screenVy = vy;
      if (arc) {
        const total = Math.max(1, c.total[row] as number);
        const peak = c.peak[row] as number;
        const p = (ticks - back) / total;
        z = throwArcHeight(p, peak);
        // The arc's rise on screen: dz/dt = 4·peak·(1 − 2p) per flight, the flight lasting `total` ticks.
        screenVy = vy - 4 * peak * (1 - 2 * (p < 0 ? 0 : p > 1 ? 1 : p)) * (tickHz / total);
      } else z = BALANCE.combat.projectile.flightHeightPx;
      const flightSeconds = (ticks - back) / tickHz;
      const d = scene.sprite.reset();
      d.frame = (look.clip === null ? look.sprite.frames[look.frame] : (look.sprite.frames[clipFrameAt(look.clip, flightSeconds)] ?? look.sprite.frames[0])) as SpriteFrameRef;
      d.x = x;
      d.y = y - z;
      d.depth = y;
      d.heightBase = base + z;
      d.rotation = look.spin > 0 ? look.spin * flightSeconds : Math.atan2(screenVy, vx);
      scene.sprites.push(d);
      this.stats.flying++;
      const shadow = this.shadow;
      if (shadow === null) continue;
      const s = scene.sprite.reset();
      s.frame = shadow.frames[SHADOW_FRAME] as SpriteFrameRef;
      s.x = x;
      s.y = y;
      s.layer = 'ground';
      s.heightBase = base;
      s.fade = arc ? SHADOW_FADE.arc : SHADOW_FADE.flat;
      scene.sprites.push(s);
      this.stats.shadows++;
    }
  }

  private drawStuck(scene: RenderScene, manifest: AtlasManifest, layer: Layer, now: number): void {
    for (let i = 0; i < STUCK.capacity; i++) {
      const age = now - (this.stuckTick[i] as number);
      if (!(age >= 0) || age >= STUCK.ticks) continue;
      if (this.stuckLayer[i] !== layer) continue;
      const look = this.look(this.stuckItem[i] as string, manifest);
      if (look === null) continue;
      const y = this.stuckY[i] as number;
      const d = scene.sprite.reset();
      d.frame = (look.clip === null ? look.sprite.frames[look.frame] : (look.sprite.frames[look.clip.frames[0] ?? 0] ?? look.sprite.frames[0])) as SpriteFrameRef;
      d.x = this.stuckX[i] as number;
      d.y = y;
      d.rotation = this.stuckAngle[i] as number;
      const f = age / STUCK.ticks;
      if (f > STUCK.fadeFrom) d.fade = (f - STUCK.fadeFrom) / (1 - STUCK.fadeFrom);
      scene.sprites.push(d);
      this.stats.stuck++;
    }
  }

  private drawImpacts(scene: RenderScene, manifest: AtlasManifest, layer: Layer, now: number, tickHz: number): void {
    for (let i = 0; i < IMPACTS; i++) {
      const age = (now - (this.impactTick[i] as number)) / tickHz;
      if (!(age >= 0) || this.impactLayer[i] !== layer) continue;
      const look = this.look(this.impactItem[i] as string, manifest);
      const clip = look === null ? null : look.impact;
      if (look === null || clip === null || age >= clipDuration(clip)) {
        this.impactTick[i] = Number.NEGATIVE_INFINITY;
        continue;
      }
      const sprite = look.sprite;
      const d = scene.sprite.reset();
      d.frame = (sprite.frames[clipFrameAt(clip, age)] ?? sprite.frames[0]) as SpriteFrameRef;
      d.x = this.impactX[i] as number;
      d.y = this.impactY[i] as number;
      d.rotation = this.impactAngle[i] as number;
      scene.sprites.push(d);
      this.stats.impacts++;
    }
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.looks.clear();
    this.shadow = manifest.sprites[SHADOW_SPRITE] ?? null;
  }

  /** How `item` flies (resolved once per atlas), or null without a sprite for it. */
  private look(item: string, manifest: AtlasManifest): ProjectileLook | null {
    if (this.manifest !== manifest) this.bind(manifest);
    const known = this.looks.get(item);
    if (known !== undefined) return known;
    const look = resolveLook(item, manifest);
    this.looks.set(item, look);
    return look;
  }
}

/** How `item` flies with the sprites of `manifest` (see the module comment), or null. */
export function resolveLook(item: string, manifest: AtlasManifest): ProjectileLook | null {
  if (item.startsWith(CREATURE_SHOT_PREFIX)) {
    // A creature's shot: no item, the sprite of its id.
    const sprite = manifest.sprites[item];
    if (sprite === undefined) return null;
    const flight = sprite.clips[SHOT_CLIPS.flight] ?? Object.values(sprite.clips)[0] ?? null;
    return { sprite, clip: flight, frame: 0, spin: 0, sticks: false, impact: sprite.clips[SHOT_CLIPS.impact] ?? null };
  }
  const def = CONTENT.collection('items').find(item);
  const thrown = def?.waffe?.klasse === 'wurf';
  for (const id of PROJECTILE_SPRITES) {
    const sprite = manifest.sprites[id];
    const clip = sprite?.clips[item];
    if (sprite === undefined || clip === undefined) continue;
    const spin = id === 'geschoss_flasche' ? SPIN.flasche : id === 'geschoss_messer' || thrown ? SPIN.messer : 0;
    return { sprite, clip, frame: 0, spin, sticks: id !== 'geschoss_stein' && id !== 'geschoss_flasche', impact: null };
  }
  const ammo = def?.munition?.fuer;
  const byClass = ammo !== undefined ? CLASS_SPRITE[ammo] : thrown ? CLASS_SPRITE.wurf : null;
  if (byClass !== null) {
    const sprite = manifest.sprites[byClass];
    const first = sprite === undefined ? undefined : Object.values(sprite.clips)[0];
    if (sprite !== undefined) return { sprite, clip: first ?? null, frame: 0, spin: thrown ? SPIN.messer : 0, sticks: byClass !== CLASS_SPRITE.schleuder, impact: null };
  }
  // A thrown weapon of its own (the spear's heavy throw): its hand sprite, head forwards.
  const hand = manifest.sprites[itemLayerSpriteId(item)];
  if (hand !== undefined && hand.frames.length > HAND_EAST_FRAME) return { sprite: hand, clip: null, frame: HAND_EAST_FRAME, spin: 0, sticks: false, impact: null };
  return null;
}
