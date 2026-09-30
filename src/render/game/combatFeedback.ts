/**
 * Feedback of the fight in the game view (M6-05; MASTERPROMPT §6.2 "Kampf: 2-Frame-Trefferblitz, Hitstop (2–6 Frames je
 * Wucht), Knockback, skalierter Screenshake (abschaltbar), Waffen-Smears, Einschlagpartikel je Material, Auflösen
 * besiegter Gegner", §19.1, §2.8 "Effekte verdecken nie Gegner, Telegraphs oder Interaktionsziele"; docs/SPIEL.md §13):
 * the pools `combat.ts` fills from the fight's events and draws every frame.
 *
 * - **Smears**: a blow draws its swing where the simulation hits – an arc of the weapon's reach and swing around the
 *   striker at hand height (a thrust: a streak along the aim), pixel for pixel on the midpoint circle (`kampf_punkt`), bright
 *   at the blow and dimming over a few ticks from the side the swing began; the heavy spin is a full ring.
 * - **Impact particles per material** (`hitLanded.material`): blood drops from flesh, tufts from fur, chips from shells
 *   (with a spark), splinters from wood, stone chips and sparks from stone, ink wisps with violet sparks from shadow
 *   brood – sprayed away from the attacker at the target's middle, more for heavier blows and crits; a block strikes
 *   sparks, a parry a glint and sparks; shadow brood that falls bursts into sparks and wisps (§6.2 "Zerfall in Funken").
 * - **Bursts** of thrown weapons (`projectileHit.wirkung`): the fire flask throws flames, sparks and glass and flashes
 *   warm; the blast pot raises dust, sends a shock wave and shakes; frost scatters ice, the blinding bomb flashes white.
 * - **Glints** (`kampf_glint`), **light flashes** (point lights of a few ticks) and **shock waves** (`post.distortion`).
 * - **Screenshake**: hits on the player, the player's heavy or critical blows and blasts nearby shake the camera by whole
 *   pixels, decaying over `SHAKE.ticks`, scaled by the setting `accessibility.screenshake` (0 = none, §29).
 * - **Water**: a projectile sinking in deep water kicks the wave field (`scene.water.impulse`) and splashes.
 *
 * Everything is timed in simulation ticks (the fight is the simulation's): a frozen picture whose simulation stepped on
 * shows the effects that far along, and a paused game holds them. Random spreads come from a generator seeded by the
 * event. Fixed pools; nothing is allocated per frame.
 */
import { BALANCE } from '../../content/balance';
import { Rng, hash3, hashToUnit } from '../../engine/rng';
import type { HitMaterial } from '../../game/combat/targets';
import type { ThrowEffect } from '../../content/balance/combat';
import type { Layer } from '../../world/model/coords';
import { clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { FIRE, paletteLight, type Rgb } from '../light/lightColors';
import { shockwaveAt } from '../post/distortion';
import type { RenderScene } from '../scene';
import type { WaterImpulseKind } from '../water/params';

/** The one-pixel sprite the arcs and rings are set with, and its frames (assets-src/sprites/kampf/effekte.ts). */
export const DOT_SPRITE = 'kampf_punkt';
export const PUNKT = { warn: 0, warnHell: 1, warnFuell: 2, schmier: 3, schmierMitte: 4, schmierDunkel: 5, schatten: 6 } as const;
/** The glint of telegraphs and a charged heavy blow. */
export const GLINT_SPRITE = 'kampf_glint';
const GLINT_CLIP = 'blitz';

/** Particle kinds: sprite, clip and tint (0 = the sprite's own colours). */
export const PARTICLES = {
  blut: { sprite: 'partikel_blutstropfen', clip: 'fallen', tint: 0 },
  fell: { sprite: 'partikel_fell', clip: 'flug', tint: 0 },
  panzer: { sprite: 'partikel_steinsplitter', clip: 'flug', tint: 0xcf7a37 },
  holz: { sprite: 'partikel_splitter', clip: 'flug', tint: 0 },
  stein: { sprite: 'partikel_steinsplitter', clip: 'flug', tint: 0 },
  schatten: { sprite: 'partikel_schatten', clip: 'zerfasern', tint: 0 },
  funken: { sprite: 'partikel_funken', clip: 'verglimmen', tint: 0 },
  flamme: { sprite: 'partikel_flamme', clip: 'flackern', tint: 0 },
  glas: { sprite: 'partikel_steinsplitter', clip: 'flug', tint: 0xa8c9e2 },
  eis: { sprite: 'partikel_steinsplitter', clip: 'flug', tint: 0xf4fbff },
  staub: { sprite: 'staubwolke', clip: 'aufwirbeln', tint: 0 },
  tropfen: { sprite: 'partikel_tropfen', clip: 'fallen', tint: 0 },
} as const;
export type ParticleKind = keyof typeof PARTICLES;
const PARTICLE_KINDS = Object.keys(PARTICLES) as ParticleKind[];
const KIND_INDEX: Readonly<Record<ParticleKind, number>> = Object.fromEntries(PARTICLE_KINDS.map((k, i) => [k, i])) as Record<ParticleKind, number>;

/** What each hit material sheds (§6.2 "Einschlagpartikel je Material"): the main piece and an accent. */
export const MATERIAL_IMPACT: Readonly<Record<HitMaterial, { readonly main: ParticleKind; readonly accent: ParticleKind | null }>> = {
  fleisch: { main: 'blut', accent: null },
  fell: { main: 'fell', accent: 'blut' },
  panzer: { main: 'panzer', accent: 'funken' },
  holz: { main: 'holz', accent: null },
  stein: { main: 'stein', accent: 'funken' },
  schatten: { main: 'schatten', accent: 'funken' },
};

/** Particle motion [px, s] (presentation only). */
const P = {
  capacity: 192,
  /** Pieces of a blow: base plus one per impact class; a crit adds. */
  base: 2,
  critExtra: 3,
  /** Speeds: along the blow, sideways, upwards [px/s]. */
  along: 46,
  side: 34,
  upMin: 30,
  upMax: 70,
  gravity: 240,
  life: 0.6,
  sparkLife: 0.3,
  wispLife: 0.5,
  fadeFrom: 0.6,
  /** Pieces start scattered this far around the hit point [px]. */
  spread: 3,
  tintStrength: 0.6,
  /** Violet tint of the sparks of shadow brood. */
  shadowSparkTint: 0xc96bd6,
} as const;

/** Swing trails [ticks, px]. */
const SMEAR = {
  capacity: 8,
  /** Ticks the trail shows: bright, middle, dim thirds. */
  ticks: 9,
  /** The trail runs at the reach from the striker (the weapon's head, where the simulation hits). */
  reachShare: 1,
  /** Hand height of the swing above the feet [px]. */
  handPx: 8,
  /** A swing narrower than this is a thrust: a streak along the aim [°]. */
  thrustBelowDeg: 45,
  /** A thrust's streak starts this share of the reach out. */
  thrustFrom: 0.35,
} as const;

/** Glints [ticks]. */
const GLINT = { capacity: 16, ticks: 12 } as const;
/** Light flashes of bursts, parries and crits. */
const FLASH = { capacity: 8 } as const;
/** Shock waves of blasts [px, s]. */
const WAVE = { capacity: 4, speed: 190, life: 0.6, width: 18, strength: 6 } as const;
/** Simulation rate [Hz] (lifetimes given in seconds, counted in ticks). */
const TICK_HZ = BALANCE.time.tickHz;
/** Screenshake: ticks until it has decayed; amplitudes [px] come from the caller (`combat.ts`). */
export const SHAKE = { ticks: 12 } as const;
/** Water impulses waiting for the next frame (the wave field takes a frame's list). */
const SPLASHES = 16;
/** Salt of the particle seeds. */
const SALT = 0x6b2f_91c3;

/** Colours of light flashes. */
const COLD: Rgb = paletteLight('eis.3');
const WHITE: Rgb = paletteLight('eis.4');
const VIOLET: Rgb = paletteLight('verderb.4');

/** The bursts of thrown weapons (`ThrowEffect`): pieces, flash and shake. */
const BURSTS: Readonly<Record<ThrowEffect, { readonly pieces: readonly (readonly [ParticleKind, number])[]; readonly light: Rgb | null; readonly lightTicks: number; readonly intensity: number; readonly wave: boolean; readonly shakePx: number }>> = {
  einzel: { pieces: [['stein', 4]], light: null, lightTicks: 0, intensity: 0, wave: false, shakePx: 0 },
  explosion: {
    pieces: [
      ['staub', 3],
      ['funken', 10],
      ['stein', 6],
    ],
    light: FIRE,
    lightTicks: 12,
    intensity: 3,
    wave: true,
    shakePx: 3,
  },
  brand: {
    pieces: [
      ['flamme', 10],
      ['funken', 8],
      ['glas', 6],
    ],
    light: FIRE,
    lightTicks: 24,
    intensity: 2.6,
    wave: false,
    shakePx: 1,
  },
  frost: {
    pieces: [
      ['eis', 10],
      ['glas', 4],
    ],
    light: COLD,
    lightTicks: 14,
    intensity: 2,
    wave: false,
    shakePx: 1,
  },
  blendung: { pieces: [['funken', 12]], light: WHITE, lightTicks: 10, intensity: 5, wave: false, shakePx: 1 },
};

/** Sprite and clip of a particle kind, resolved per atlas. */
interface KindLook {
  readonly sprite: AtlasSprite;
  readonly clip: AnimationClip | null;
}

/** One point of the midpoint circle of radius `r` (whole px) as an angle in [0, 2π) and offsets. */
interface CirclePoint {
  readonly dx: number;
  readonly dy: number;
  readonly angle: number;
}

/** Whole-pixel points of the circle of radius `r` around (0, 0), in angle order (midpoint algorithm, no duplicates). */
export function circlePoints(r: number): CirclePoint[] {
  const out: CirclePoint[] = [];
  if (r <= 0) return [{ dx: 0, dy: 0, angle: 0 }];
  const seen = new Set<number>();
  const add = (dx: number, dy: number): void => {
    const key = (dx + 1024) * 4096 + (dy + 1024);
    if (seen.has(key)) return;
    seen.add(key);
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI * 2;
    out.push({ dx, dy, angle: a });
  };
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    add(x, y);
    add(y, x);
    add(-y, x);
    add(-x, y);
    add(-x, -y);
    add(-y, -x);
    add(y, -x);
    add(x, -y);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  out.sort((a, b) => a.angle - b.angle);
  return out;
}

/** Circle points by whole radius (built on first use, kept). */
export class CircleCache {
  private readonly byRadius: (CirclePoint[] | undefined)[] = [];

  of(r: number): readonly CirclePoint[] {
    const k = Math.max(0, Math.round(r));
    let c = this.byRadius[k];
    if (c === undefined) {
      c = circlePoints(k);
      this.byRadius[k] = c;
    }
    return c;
  }
}

/** Smallest signed difference a − b of two angles [rad], in (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  else if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/** Counters of the last frame (debug info, tests). */
export interface CombatFeedbackStats {
  particles: number;
  smears: number;
  smearPixels: number;
  glints: number;
  flashes: number;
  waves: number;
  splashes: number;
}

export class CombatFeedback {
  // Particle pool (struct of arrays).
  private readonly kind = new Uint8Array(P.capacity);
  private readonly tick0 = new Float64Array(P.capacity);
  private readonly x0 = new Float32Array(P.capacity);
  private readonly y0 = new Float32Array(P.capacity);
  private readonly z0 = new Float32Array(P.capacity);
  private readonly vx = new Float32Array(P.capacity);
  private readonly vy = new Float32Array(P.capacity);
  private readonly vz = new Float32Array(P.capacity);
  private readonly life = new Float32Array(P.capacity);
  private readonly tint = new Uint32Array(P.capacity);
  private readonly layerOf = new Int8Array(P.capacity);
  /** Height of the ground the piece flies over above level 0 [px] (its tile's height level × 16). */
  private readonly baseOf = new Float32Array(P.capacity);
  private readonly alive = new Uint8Array(P.capacity);
  /** Ground height of the pieces the next `spray` calls throw [px] (set by the adding methods). */
  private sprayBase = 0;
  private nextParticle = 0;
  // Swing trails.
  private readonly smearTick = new Float64Array(SMEAR.capacity).fill(Number.NEGATIVE_INFINITY);
  private readonly smearX = new Float32Array(SMEAR.capacity);
  private readonly smearY = new Float32Array(SMEAR.capacity);
  private readonly smearLayer = new Int8Array(SMEAR.capacity);
  private readonly smearAngle = new Float32Array(SMEAR.capacity);
  private readonly smearReach = new Float32Array(SMEAR.capacity);
  private readonly smearArc = new Float32Array(SMEAR.capacity);
  /** +1: the swing runs with the angle (clockwise on screen), −1 against it (the second blow of a combo). */
  private readonly smearSense = new Int8Array(SMEAR.capacity);
  private readonly smearDot = new Uint8Array(SMEAR.capacity);
  private nextSmear = 0;
  // Glints.
  private readonly glintTick = new Float64Array(GLINT.capacity).fill(Number.NEGATIVE_INFINITY);
  private readonly glintX = new Float32Array(GLINT.capacity);
  private readonly glintY = new Float32Array(GLINT.capacity);
  private readonly glintZ = new Float32Array(GLINT.capacity);
  private readonly glintLayer = new Int8Array(GLINT.capacity);
  private readonly glintBase = new Float32Array(GLINT.capacity);
  private nextGlint = 0;
  // Light flashes.
  private readonly flashTick = new Float64Array(FLASH.capacity).fill(Number.NEGATIVE_INFINITY);
  private readonly flashTicks = new Float32Array(FLASH.capacity);
  private readonly flashX = new Float32Array(FLASH.capacity);
  private readonly flashY = new Float32Array(FLASH.capacity);
  private readonly flashLayer = new Int8Array(FLASH.capacity);
  private readonly flashRadius = new Float32Array(FLASH.capacity);
  private readonly flashIntensity = new Float32Array(FLASH.capacity);
  private readonly flashRgb = new Float32Array(FLASH.capacity * 3);
  private nextFlash = 0;
  // Shock waves.
  private readonly waveTick = new Float64Array(WAVE.capacity).fill(Number.NEGATIVE_INFINITY);
  private readonly waveX = new Float32Array(WAVE.capacity);
  private readonly waveY = new Float32Array(WAVE.capacity);
  private readonly waveLayer = new Int8Array(WAVE.capacity);
  private nextWave = 0;
  private readonly wave = { radius: 0, strength: 0 };
  // Water impulses of the next frame.
  private readonly splashX = new Float32Array(SPLASHES);
  private readonly splashY = new Float32Array(SPLASHES);
  private readonly splashLayer = new Int8Array(SPLASHES);
  private readonly splashHeavy = new Uint8Array(SPLASHES);
  private splashes = 0;
  // Screenshake: the strongest shake still running and when it began.
  private shakeTick = Number.NEGATIVE_INFINITY;
  private shakeAmp = 0;
  /** Tick until which a trail, glint, flash or wave lives [ticks]. */
  private busyUntil = Number.NEGATIVE_INFINITY;
  private readonly rng = new Rng(1);
  private readonly circles = new CircleCache();
  private manifest: AtlasManifest | null = null;
  private readonly looks: (KindLook | null)[] = [];
  private dot: AtlasSprite | null = null;
  private glintSprite: AtlasSprite | null = null;
  private glintClip: AnimationClip | null = null;
  readonly stats: CombatFeedbackStats = { particles: 0, smears: 0, smearPixels: 0, glints: 0, flashes: 0, waves: 0, splashes: 0 };

  /** Forgets every effect (another session, another view). */
  clear(): void {
    this.busyUntil = Number.NEGATIVE_INFINITY;
    this.alive.fill(0);
    this.smearTick.fill(Number.NEGATIVE_INFINITY);
    this.glintTick.fill(Number.NEGATIVE_INFINITY);
    this.flashTick.fill(Number.NEGATIVE_INFINITY);
    this.waveTick.fill(Number.NEGATIVE_INFINITY);
    this.splashes = 0;
    this.shakeTick = Number.NEGATIVE_INFINITY;
    this.shakeAmp = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Adding effects (from events)
  // -------------------------------------------------------------------------------------------

  /**
   * A blow or shot hit a body of `material` at (x, y) on `layer`, `z` px above its feet, coming along (dirX, dirY)
   * (unit, or 0 0 for no direction): pieces sprayed away from the attacker, more for impact class `wucht` and a crit.
   */
  impact(material: HitMaterial, x: number, y: number, z: number, dirX: number, dirY: number, wucht: number, crit: boolean, tick: number, layer: Layer, seed: number, base = 0): void {
    const m = MATERIAL_IMPACT[material];
    this.sprayBase = base;
    this.rng.seed(hash3(tick, Math.floor(x), Math.floor(y), SALT ^ seed));
    const count = P.base + Math.max(1, Math.round(wucht)) + (crit ? P.critExtra : 0);
    for (let k = 0; k < count; k++) this.spray(m.main, x, y, z, dirX, dirY, tick, layer, material === 'schatten' ? P.wispLife : P.life, 0);
    if (m.accent !== null) {
      const accents = Math.max(1, Math.round(count / 2));
      const tint = material === 'schatten' && m.accent === 'funken' ? P.shadowSparkTint : 0;
      for (let k = 0; k < accents; k++) this.spray(m.accent, x, y, z, dirX, dirY, tick, layer, m.accent === 'funken' ? P.sparkLife : P.life, tint);
    }
  }

  /** Sparks where a block met a blow (towards the attacker: along −dir). */
  sparks(x: number, y: number, z: number, dirX: number, dirY: number, count: number, tick: number, layer: Layer, tint: number, base = 0): void {
    this.sprayBase = base;
    this.rng.seed(hash3(tick, Math.floor(x), Math.floor(y), SALT + count));
    for (let k = 0; k < count; k++) this.spray('funken', x, y, z, -dirX, -dirY, tick, layer, P.sparkLife, tint);
  }

  /** Shadow brood falls apart: wisps and violet sparks rising from its body. */
  dissolve(x: number, y: number, z: number, size: number, tick: number, layer: Layer, base = 0): void {
    this.sprayBase = base;
    this.rng.seed(hash3(tick, Math.floor(x), Math.floor(y), SALT + 7));
    const n = Math.max(4, Math.round(size / 4));
    for (let k = 0; k < n; k++) this.spray('schatten', x + this.rng.float(-size / 4, size / 4), y, z + this.rng.float(0, size / 2), 0, 0, tick, layer, P.wispLife, 0);
    for (let k = 0; k < n; k++) this.spray('funken', x, y, z, 0, 0, tick, layer, P.sparkLife * 2, P.shadowSparkTint);
  }

  /** A thrown weapon bursts with `effect` at (x, y) in `radius` [px]: its pieces, flash, wave; returns its shake [px]. */
  burst(effect: ThrowEffect, x: number, y: number, radius: number, tick: number, layer: Layer, base = 0): number {
    const b = BURSTS[effect];
    this.sprayBase = base;
    this.rng.seed(hash3(tick, Math.floor(x), Math.floor(y), SALT + 11));
    const reach = Math.max(8, radius);
    for (let i = 0; i < b.pieces.length; i++) {
      const piece = b.pieces[i] as readonly [ParticleKind, number];
      const kind = piece[0];
      for (let k = 0; k < piece[1]; k++) {
        const a = this.rng.float(0, Math.PI * 2);
        const d = this.rng.float(0, reach * 0.6);
        const life = kind === 'funken' ? P.sparkLife * 2 : kind === 'flamme' ? P.life * 1.5 : P.life;
        this.spray(kind, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 2, Math.cos(a), Math.sin(a), tick, layer, life, 0);
      }
    }
    if (b.light !== null) this.light(x, y, layer, b.light, b.intensity, reach * 3, tick, b.lightTicks);
    if (b.wave) this.shockwave(x, y, layer, tick);
    if (effect === 'blendung') this.glint(x, y, 6, layer, tick, base);
    return b.shakePx;
  }

  /** A swing trail of a blow at (x, y) towards `angle` [rad] with `reach` [px] and `arc` [°]; `sense` ±1 its direction. */
  smear(x: number, y: number, layer: Layer, angle: number, reach: number, arc: number, sense: number, shadow: boolean, tick: number): void {
    const i = this.nextSmear;
    this.nextSmear = (i + 1) % SMEAR.capacity;
    this.smearTick[i] = tick;
    this.smearX[i] = x;
    this.smearY[i] = y;
    this.smearLayer[i] = layer;
    this.smearAngle[i] = angle;
    this.smearReach[i] = reach;
    this.smearArc[i] = arc;
    this.smearSense[i] = sense < 0 ? -1 : 1;
    this.smearDot[i] = shadow ? PUNKT.schatten : PUNKT.schmier;
    this.busy(tick + SMEAR.ticks);
  }

  /** A glint at (x, y), `z` px above the ground whose height is `base` px (its level × 16). */
  glint(x: number, y: number, z: number, layer: Layer, tick: number, base = 0): void {
    const i = this.nextGlint;
    this.nextGlint = (i + 1) % GLINT.capacity;
    this.glintTick[i] = tick;
    this.glintX[i] = x;
    this.glintY[i] = y;
    this.glintZ[i] = z;
    this.glintLayer[i] = layer;
    this.glintBase[i] = base;
    this.busy(tick + GLINT.ticks);
  }

  /** A light flash of colour `rgb` for `ticks` ticks (a point light, fading). */
  light(x: number, y: number, layer: Layer, rgb: Rgb, intensity: number, radius: number, tick: number, ticks: number): void {
    const i = this.nextFlash;
    this.nextFlash = (i + 1) % FLASH.capacity;
    this.flashTick[i] = tick;
    this.flashTicks[i] = ticks;
    this.flashX[i] = x;
    this.flashY[i] = y;
    this.flashLayer[i] = layer;
    this.flashRadius[i] = radius;
    this.flashIntensity[i] = intensity;
    this.flashRgb[i * 3] = rgb[0];
    this.flashRgb[i * 3 + 1] = rgb[1];
    this.flashRgb[i * 3 + 2] = rgb[2];
    this.busy(tick + ticks);
  }

  /** A shock wave from (x, y). */
  shockwave(x: number, y: number, layer: Layer, tick: number): void {
    const i = this.nextWave;
    this.nextWave = (i + 1) % WAVE.capacity;
    this.waveTick[i] = tick;
    this.waveX[i] = x;
    this.waveY[i] = y;
    this.waveLayer[i] = layer;
    this.busy(tick + WAVE.life * TICK_HZ);
  }

  /** Something sank in deep water at (x, y): a wave impulse in the next frame (`heavy`: a stone, a flask, a spear). */
  splash(x: number, y: number, layer: Layer, heavy: boolean, tick: number): void {
    this.sprayBase = 0;
    if (this.splashes < SPLASHES) {
      const i = this.splashes++;
      this.splashX[i] = x;
      this.splashY[i] = y;
      this.splashLayer[i] = layer;
      this.splashHeavy[i] = heavy ? 1 : 0;
    }
    this.rng.seed(hash3(tick, Math.floor(x), Math.floor(y), SALT + 3));
    for (let k = 0; k < (heavy ? 6 : 3); k++) this.spray('tropfen', x, y, 0, 0, 0, tick, layer, P.life * 0.6, 0);
  }

  /** A shake of `amp` px from tick `tick` (the stronger of it and what is left of the running one wins). */
  shake(amp: number, tick: number): void {
    if (!(amp > 0)) return;
    const left = this.shakeLeft(tick);
    if (amp >= left) {
      this.shakeAmp = amp;
      this.shakeTick = tick;
    }
  }

  /** Amplitude of the running shake at tick `now` [px, before the setting's scale]. */
  shakeLeft(now: number): number {
    const age = now - this.shakeTick;
    if (!(age >= 0) || age >= SHAKE.ticks) return 0;
    return this.shakeAmp * (1 - age / SHAKE.ticks);
  }

  /**
   * The camera's shake offset at tick `now` scaled by `scale` (the setting, 0–1), in whole pixels, into `out`: a new
   * direction every tick from a hash of the tick, the size decaying with the shake.
   */
  shakeOffset(now: number, scale: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = 0;
    out.y = 0;
    const amp = this.shakeLeft(now) * (scale > 0 ? (scale < 1 ? scale : 1) : 0);
    if (amp < 0.5) return out;
    const t = Math.floor(now);
    out.x = Math.round(amp * (hashToUnit(hash3(t, 1, 0, SALT)) * 2 - 1));
    out.y = Math.round(amp * (hashToUnit(hash3(t, 2, 0, SALT)) * 2 - 1));
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  /**
   * Draws the effects of `layer` at simulation time `now` [ticks, fractional] into `scene`: particles, trails, glints,
   * lights, shock waves and the frame's water impulses.
   */
  draw(scene: RenderScene, manifest: AtlasManifest, layer: Layer, now: number, tickHz: number): void {
    this.bind(manifest);
    const st = this.stats;
    st.particles = 0;
    st.smears = 0;
    st.smearPixels = 0;
    st.glints = 0;
    st.flashes = 0;
    st.waves = 0;
    st.splashes = 0;
    this.drawParticles(scene, layer, now, tickHz);
    // Trails, glints, flashes and waves only while one of them lives (a quiet frame computes nothing per slot).
    if (now < this.busyUntil) {
      this.drawSmears(scene, layer, now);
      this.drawGlints(scene, layer, now, tickHz);
      this.drawLights(scene, layer, now);
      this.drawWaves(scene, layer, now, tickHz);
    }
    for (let i = 0; i < this.splashes; i++) {
      if (this.splashLayer[i] !== layer) continue;
      const kind: WaterImpulseKind = this.splashHeavy[i] === 1 ? 'splash' : 'arrow';
      scene.water.impulse(kind, this.splashX[i] as number, this.splashY[i] as number);
      st.splashes++;
    }
    this.splashes = 0;
  }

  private drawParticles(scene: RenderScene, layer: Layer, now: number, tickHz: number): void {
    const g = P.gravity;
    for (let i = 0; i < P.capacity; i++) {
      if (this.alive[i] === 0) continue;
      const s = (now - (this.tick0[i] as number)) / tickHz;
      const life = this.life[i] as number;
      if (s >= life) {
        this.alive[i] = 0;
        continue;
      }
      if (s < 0 || this.layerOf[i] !== layer) continue;
      const look = this.looks[this.kind[i] as number] ?? null;
      if (look === null) continue;
      const z0 = this.z0[i] as number;
      const vz = this.vz[i] as number;
      // Until it lands: a throw with gravity; then it lies where it fell (flames and wisps rise instead: no gravity).
      const kind = PARTICLE_KINDS[this.kind[i] as number];
      const floats = kind === 'flamme' || kind === 'schatten' || kind === 'staub';
      const land = floats ? life : (vz + Math.sqrt(vz * vz + 2 * g * z0)) / g;
      const t = s < land ? s : land;
      const z = floats ? z0 + vz * t : Math.max(0, z0 + vz * t - (g * t * t) / 2);
      const x = (this.x0[i] as number) + (this.vx[i] as number) * t;
      const y = (this.y0[i] as number) + (this.vy[i] as number) * t;
      const d = scene.sprite.reset();
      d.frame = (look.clip === null ? look.sprite.frames[0] : (look.sprite.frames[clipFrameAt(look.clip, s)] ?? look.sprite.frames[0])) as SpriteFrameRef;
      d.x = x;
      d.y = y - z;
      d.depth = y;
      d.heightBase = (this.baseOf[i] as number) + z;
      const tint = this.tint[i] as number;
      if (tint !== 0) {
        d.tintR = (tint >> 16) & 0xff;
        d.tintG = (tint >> 8) & 0xff;
        d.tintB = tint & 0xff;
        d.tintStrength = P.tintStrength;
      }
      const f = s / life;
      if (f > P.fadeFrom) d.fade = (f - P.fadeFrom) / (1 - P.fadeFrom);
      scene.sprites.push(d);
      this.stats.particles++;
    }
  }

  private drawSmears(scene: RenderScene, layer: Layer, now: number): void {
    const dot = this.dot;
    if (dot === null) return;
    for (let i = 0; i < SMEAR.capacity; i++) {
      const age = now - (this.smearTick[i] as number);
      if (!(age >= 0) || age >= SMEAR.ticks || this.smearLayer[i] !== layer) continue;
      this.stats.smears++;
      const x = this.smearX[i] as number;
      const y = this.smearY[i] as number;
      const reach = (this.smearReach[i] as number) * SMEAR.reachShare;
      const angle = this.smearAngle[i] as number;
      const arc = this.smearArc[i] as number;
      const base = this.smearDot[i] as number;
      const cx = Math.round(x);
      const cy = Math.round(y - SMEAR.handPx);
      if (arc < SMEAR.thrustBelowDeg) {
        // A thrust: a streak from near the hand to the reach along the aim.
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        const from = Math.round(reach * SMEAR.thrustFrom);
        const to = Math.round(reach);
        let lastX = Number.NaN;
        let lastY = Number.NaN;
        for (let r = from; r <= to; r++) {
          const px = cx + Math.round(c * r);
          const py = cy + Math.round(sn * r);
          if (px === lastX && py === lastY) continue;
          lastX = px;
          lastY = py;
          // The streak dims from its root outwards.
          const u = (r - from) / Math.max(1, to - from);
          this.dotAt(scene, dot, px, py, y, base, age - (1 - u) * 2);
        }
        continue;
      }
      const half = (arc * Math.PI) / 360;
      const sense = this.smearSense[i] as number;
      const full = arc >= 359;
      // A band two pixels wide: the inner ring bright, the outer one a step dimmer (the motion's blur fades outwards).
      for (let ring = 0; ring < 2; ring++) {
        const points = this.circles.of(reach - ring);
        for (let k = 0; k < points.length; k++) {
          const p = points[k] as CirclePoint;
          const d = angleDiff(p.angle, angle);
          if (!full && (d < -half || d > half)) continue;
          // Where along the swing this pixel lies (0 = where it began): the start dims first.
          const u = full ? (d + Math.PI) / (Math.PI * 2) : (sense > 0 ? d + half : half - d) / (2 * half);
          this.dotAt(scene, dot, cx + p.dx, cy + p.dy, y, base, age - u * 3 + (ring === 0 ? SMEAR.ticks / 3 : 0));
        }
      }
    }
  }

  /** One trail pixel at (px, py) [the striker's feet at `footY`], dimmed by its own age [ticks]. */
  private dotAt(scene: RenderScene, dot: AtlasSprite, px: number, py: number, footY: number, base: number, age: number): void {
    const third = SMEAR.ticks / 3;
    let frame: number;
    if (age < third) frame = base;
    else if (age < 2 * third) frame = base === PUNKT.schatten ? base : PUNKT.schmierMitte;
    else if (age < SMEAR.ticks) frame = base === PUNKT.schatten ? base : PUNKT.schmierDunkel;
    else return;
    const d = scene.sprite.reset();
    d.frame = dot.frames[frame] as SpriteFrameRef;
    d.x = px;
    d.y = py;
    // In front of the striker (its feet), lifted to hand height in the G-buffer.
    d.depth = footY + 1;
    d.heightBase = SMEAR.handPx;
    scene.sprites.push(d);
    this.stats.smearPixels++;
  }

  private drawGlints(scene: RenderScene, layer: Layer, now: number, tickHz: number): void {
    const sprite = this.glintSprite;
    const clip = this.glintClip;
    if (sprite === null || clip === null) return;
    for (let i = 0; i < GLINT.capacity; i++) {
      const age = now - (this.glintTick[i] as number);
      if (!(age >= 0) || age >= GLINT.ticks || this.glintLayer[i] !== layer) continue;
      const z = this.glintZ[i] as number;
      const y = this.glintY[i] as number;
      const d = scene.sprite.reset();
      d.frame = (sprite.frames[clipFrameAt(clip, age / tickHz)] ?? sprite.frames[0]) as SpriteFrameRef;
      d.x = this.glintX[i] as number;
      d.y = y - z;
      d.depth = y + 1;
      d.heightBase = (this.glintBase[i] as number) + z;
      d.emissiveBoost = 1;
      scene.sprites.push(d);
      this.stats.glints++;
    }
  }

  private drawLights(scene: RenderScene, layer: Layer, now: number): void {
    for (let i = 0; i < FLASH.capacity; i++) {
      const ticks = this.flashTicks[i] as number;
      const age = now - (this.flashTick[i] as number);
      if (!(age >= 0) || age >= ticks || this.flashLayer[i] !== layer) continue;
      const k = 1 - age / ticks;
      const l = scene.light.reset();
      l.x = this.flashX[i] as number;
      l.y = this.flashY[i] as number;
      l.height = 8;
      l.radius = this.flashRadius[i] as number;
      l.r = this.flashRgb[i * 3] as number;
      l.g = this.flashRgb[i * 3 + 1] as number;
      l.b = this.flashRgb[i * 3 + 2] as number;
      l.intensity = (this.flashIntensity[i] as number) * k * k;
      scene.lights.push(l);
      this.stats.flashes++;
    }
  }

  private drawWaves(scene: RenderScene, layer: Layer, now: number, tickHz: number): void {
    for (let i = 0; i < WAVE.capacity; i++) {
      const age = (now - (this.waveTick[i] as number)) / tickHz;
      if (!(age >= 0) || age >= WAVE.life || this.waveLayer[i] !== layer) continue;
      shockwaveAt(age, WAVE.speed, WAVE.life, WAVE.strength, this.wave);
      if (this.wave.strength <= 0) continue;
      scene.post.distortion.shockwave(this.waveX[i] as number, this.waveY[i] as number, this.wave.radius, WAVE.width, this.wave.strength);
      this.stats.waves++;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pools
  // -------------------------------------------------------------------------------------------

  /** Trails, glints, flashes or waves live until tick `until` at least. */
  private busy(until: number): void {
    if (until > this.busyUntil) this.busyUntil = until;
  }

  /** One piece of `kind` from (x, y, z) sprayed along (dirX, dirY) (no direction: all around) with `life` [s]. */
  private spray(kind: ParticleKind, x: number, y: number, z: number, dirX: number, dirY: number, tick: number, layer: Layer, life: number, tint: number): void {
    const i = this.nextParticle;
    this.nextParticle = (i + 1) % P.capacity;
    const rng = this.rng;
    let ax = dirX;
    let ay = dirY;
    if (ax === 0 && ay === 0) {
      const a = rng.float(0, Math.PI * 2);
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    const along = rng.float(0.3, 1) * P.along;
    const side = rng.float(-1, 1) * P.side;
    this.kind[i] = KIND_INDEX[kind];
    this.tick0[i] = tick;
    this.x0[i] = x + rng.float(-P.spread, P.spread);
    this.y0[i] = y + rng.float(-P.spread, P.spread) * 0.5;
    this.z0[i] = z;
    this.vx[i] = ax * along - ay * side;
    // Seen from the 3/4 view the ground plane is foreshortened: sideways speeds on y count half.
    this.vy[i] = (ay * along + ax * side) * 0.5;
    this.vz[i] = kind === 'flamme' || kind === 'schatten' ? rng.float(8, 20) : kind === 'staub' ? 2 : rng.float(P.upMin, P.upMax);
    this.life[i] = life * rng.float(0.8, 1.2);
    this.tint[i] = tint !== 0 ? tint : PARTICLES[kind].tint;
    this.layerOf[i] = layer;
    this.baseOf[i] = this.sprayBase;
    this.alive[i] = 1;
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.looks.length = 0;
    for (const k of PARTICLE_KINDS) {
      const def = PARTICLES[k];
      const sprite = manifest.sprites[def.sprite];
      this.looks.push(sprite === undefined ? null : { sprite, clip: sprite.clips[def.clip] ?? null });
    }
    this.dot = manifest.sprites[DOT_SPRITE] ?? null;
    this.glintSprite = manifest.sprites[GLINT_SPRITE] ?? null;
    this.glintClip = this.glintSprite?.clips[GLINT_CLIP] ?? null;
  }
}

/** Light colour of a shadow brood's end (the violet of its sparks). */
export const DISSOLVE_LIGHT = VIOLET;
