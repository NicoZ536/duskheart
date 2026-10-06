/**
 * The world events in the game view (MASTERPROMPT §10 "Ankündigung (Himmel, Grading, Klang, HUD)", "Lumenregen
 * (Sternschnuppen: glühende Scherben schlagen ein, selten ein Meteorit …)", "Blitze"; docs/SPIEL.md §18; M7-38 … M7-40):
 *
 * - **Sky and grading** (`addWorldEventGrading`, called by `fillAtmosphere` before the grade eases): every announced or
 *   running event with a sky preset (`ankuendigung.himmel` of the register) pulls the grade towards its own
 *   (`EVENT_GRADING`) – over the announcement's lead up to `ANNOUNCE_SHARE`, after the start in `RAMP_MINUTES` to the full
 *   preset, and back to none in the last `RAMP_MINUTES` of the run. The eclipse's darkness itself is the calendar's daylight
 *   (the light map, the sky, fear and the shadow brood read it); its preset tells it from a night: violet shadows, copper light.
 * - **Lightning** (`lightningStruck`): the bolt (`fx_blitz`, one of three shapes by the strike's point) stands for
 *   `BOLT_SECONDS` over the struck point and lights it (`BOLT_LIGHT`), fading.
 * - **The Lumen rain** while it runs: shooting stars cross the sky of the view (`fx_sternschnuppe`, `SKY_STREAKS` per second
 *   drawn from the presentation time's slots – the same picture for the same moment), each shard that falls
 *   (`lumenShardFell`) streaks down onto its point and flashes there (`fx_einschlag`, a cold light); the meteorite
 *   (`meteorImpact`) comes down burning (`fx_meteor`) and leaves an orange glow and dust.
 * - The forest fire's flames are the fire simulation's (`fire.ts`); its preset adds the smoke-orange of the burning summer,
 *   and its dry storm shows ash instead of the storm's rain (the simulation's fire sees no rain either).
 *
 * Reads the simulation's events and the session's sample of the world events, never writes them. Fixed pools: nothing is
 * allocated per frame.
 */
import { hash3 } from '../../engine/rng';
import type { GameSession } from '../../game/session';
import { createWorldEventSample, type WorldEventLine, type WorldEventSample } from '../../game/samples/orte';
import type { Layer } from '../../world/model/coords';
import { clipDuration, clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { addGradingDelta, type GradingPartial } from '../post/grading';
import { paletteColor } from '../post/atmosphereTable';
import type { RenderScene } from '../scene';

/** Share of a preset the grade reaches over the announcement's lead (the sky warns before the event comes). */
export const ANNOUNCE_SHARE = 0.35;
/** Game minutes over which a running event's preset rises to full after the start and falls to none before the end. */
export const RAMP_MINUTES = 5;
/** Steps of the preset's strength (a change below one step does not move the grade's target: no LUT churn per tick). */
const STRENGTH_STEPS = 32;

function shadows(ref: string, amount: number): GradingPartial {
  const [r, g, b] = paletteColor(ref);
  return { shadowR: r * amount, shadowG: g * amount, shadowB: b * amount, shadowAmount: amount };
}

function highlights(ref: string, amount: number): GradingPartial {
  const [r, g, b] = paletteColor(ref);
  return { highlightR: r * amount, highlightG: g * amount, highlightB: b * amount, highlightAmount: amount };
}

/**
 * The sky presets of the register (`ankuendigung.himmel`, docs/ART.md §5 "Weltereignisse"): what each adds to the grade at
 * full strength. Every preset the register names has an entry (tests/unit/render/weltereignisse.test.ts).
 */
export const EVENT_GRADING: Readonly<Record<string, GradingPartial>> = {
  // The new moon's night: colder, the shadows sink into violet, the edges close in.
  finstermond: { temperature: -0.25, saturation: 0.85, ...shadows('nacht.2', 0.35), vignette: 0.3, exposure: -0.15 },
  // Shooting stars: a clear, cold night lit in sea-glass blue and the Lumen's pale gold.
  lumenregen: { temperature: -0.2, tint: 0.15, saturation: 1.1, ...shadows('wasser.1', 0.3), ...highlights('wasser.5', 0.25), vignette: 0.12 },
  // The sun gone black: not a night – the day's light gone, yet the world stays readable in a deep violet dusk (the darks
  // lifted towards violet, a brighter exposure than a moonless night: the corona's twilight), what light there is (torches,
  // the rim of the sky) turns copper like a sunset all around the horizon, the edges close in.
  sonnenfinsternis: { temperature: -0.1, tint: 0.12, saturation: 0.85, contrast: 0.92, exposure: 0.35, liftR: 0.035, liftG: 0.015, liftB: 0.06, ...shadows('verderb.1', 0.35), ...highlights('laub.3', 0.35), vignette: 0.3 },
  // The burning summer: smoke-orange haze, low contrast, the shadows warm.
  waldbrand: { temperature: 0.55, tint: 0.1, contrast: 0.92, saturation: 0.95, ...shadows('feuer.0', 0.3), ...highlights('feuer.4', 0.3), vignette: 0.15 },
  // Later events (their tasks bring them; the presets stand ready): the shadow flood, the mists, the avalanche, the flood,
  // the earthquake.
  schattenflut: { temperature: -0.2, saturation: 0.7, ...shadows('verderb.1', 0.45), vignette: 0.4, exposure: -0.2 },
  nebelnacht: { saturation: 0.7, contrast: 0.85, ...shadows('wasser.1', 0.25), ...highlights('eis.2', 0.2) },
  lawine: { temperature: -0.3, saturation: 0.8, ...highlights('eis.4', 0.3) },
  flut: { temperature: -0.2, saturation: 0.85, ...shadows('wasser.0', 0.35) },
  erdbeben: { contrast: 1.06, saturation: 0.85, ...shadows('erde.0', 0.3), vignette: 0.2 },
};

/** The strength 0…1 of an event line's preset at `tick` (quantized to `STRENGTH_STEPS`). */
export function presetStrength(line: Readonly<WorldEventLine>, tick: number, ticksPerMinute: number): number {
  let s: number;
  if (line.phase === 'angekuendigt') {
    const lead = line.startTick - line.announceTick;
    s = lead > 0 ? ANNOUNCE_SHARE * Math.max(0, Math.min(1, (tick - line.announceTick) / lead)) : ANNOUNCE_SHARE;
  } else {
    const ramp = RAMP_MINUTES * ticksPerMinute;
    const rise = Math.max(0, Math.min(1, (tick - line.startTick) / ramp));
    const fall = Math.max(0, Math.min(1, (line.endTick - tick) / ramp));
    s = Math.min(ANNOUNCE_SHARE + (1 - ANNOUNCE_SHARE) * rise, fall);
  }
  return Math.round(s * STRENGTH_STEPS) / STRENGTH_STEPS;
}

/** The session's sample of the world events (optional: menus and tests have none). */
export type WorldEventSession = Partial<Pick<GameSession, 'sampleWorldEvents'>>;

const gradingSample = createWorldEventSample();

/**
 * Pulls `target` (the grade's packed target) towards the sky preset of every announced or running world event; returns a key
 * of what it added (0: nothing) – the atmosphere eases again when the key changes.
 */
export function addWorldEventGrading(target: Float32Array, session: WorldEventSession, tick: number, ticksPerMinute: number): number {
  if (session.sampleWorldEvents === undefined) return 0;
  const sample = session.sampleWorldEvents(gradingSample);
  let key = 0;
  for (let i = 0; i < sample.count; i++) {
    const line = sample.lines[i] as WorldEventLine;
    const preset = EVENT_GRADING[line.himmel];
    if (preset === undefined) continue;
    const s = presetStrength(line, tick, ticksPerMinute);
    if (s === 0) continue;
    addGradingDelta(target, preset, s);
    key = key * 33 + Math.round(s * STRENGTH_STEPS) + (i + 1) * 1024;
  }
  return key;
}

// ---------------------------------------------------------------------------------------------
// Lightning, shards, the meteorite
// ---------------------------------------------------------------------------------------------

/** How long a bolt stands [s] and its light (radius [px], intensity, cold white). */
export const BOLT_SECONDS = 0.35;
const BOLT_LIGHT = { radius: 140, intensity: 3.2, height: 40 } as const;
/** A falling shard's streak [s] and its fall (from up-left [px]). */
const SHARD_FALL_SECONDS = 0.45;
const SHARD_FALL = { dx: -64, dy: -128 } as const;
/** A shard's cold glow after it landed [s] and its light. */
const SHARD_GLOW_SECONDS = 1.4;
const SHARD_LIGHT = { radius: 36, intensity: 1.4, height: 6 } as const;
/** The meteorite's fall [s], its path, and its glow after the impact. */
const METEOR_FALL_SECONDS = 0.9;
const METEOR_FALL = { dx: -180, dy: -240 } as const;
const METEOR_GLOW_SECONDS = 4;
const METEOR_LIGHT = { radius: 160, intensity: 2.6, height: 12 } as const;
/** Shooting stars over the view while the rain runs [per s], how long each crosses [s] and how far [px]. */
export const SKY_STREAKS = 3;
const SKY_STREAK_SECONDS = 0.8;
const SKY_STREAK_PATH = { dx: 150, dy: 75 } as const;
/** The shooting stars' sky: the upper part of the view they start in (share of its height). */
const SKY_SHARE = 0.6;
/** Ash drifting in the forest fire's dry storm instead of its rain (share of the weather particles' full density). */
const DRY_STORM_ASH = 0.35;
/** Draw order above everything of the view. */
const ON_TOP = 1e7;

const LIGHT_COLD = paletteColor('eis.4');
const LIGHT_LUMEN = paletteColor('wasser.5');
const LIGHT_FIRE = paletteColor('feuer.4');

/** Capacity of each effect pool (older entries are replaced). */
const POOL = 16;

/** A pool of effects: point, layer, start [presentation s], variant. */
class EffectPool {
  readonly x = new Float64Array(POOL);
  readonly y = new Float64Array(POOL);
  readonly layer = new Int8Array(POOL);
  readonly start = new Float64Array(POOL).fill(Number.NEGATIVE_INFINITY);
  readonly variant = new Int32Array(POOL);
  /** Simulation tick of the event. */
  readonly tick = new Float64Array(POOL);
  private next = 0;

  add(x: number, y: number, layer: number, start: number, variant: number, tick: number): void {
    const i = this.next;
    this.next = (i + 1) % POOL;
    this.x[i] = x;
    this.y[i] = y;
    this.layer[i] = layer;
    this.start[i] = start;
    this.variant[i] = variant;
    this.tick[i] = tick;
  }

  /**
   * Age of entry `i` [s]: the presentation time since it was drawn first – and no less than the simulation time since its
   * tick (a frozen picture whose simulation ran on lets old strikes go; a pause holds the simulation and lets them fade).
   */
  age(i: number, time: number, simTick: number, tickHz: number): number {
    return Math.max(time - (this.start[i] as number), (simTick - (this.tick[i] as number)) / tickHz);
  }

  clear(): void {
    this.start.fill(Number.NEGATIVE_INFINITY);
  }
}

/** What the view counts (render info, tests). */
export interface WorldEventViewStats {
  bolts: number;
  streaks: number;
  shards: number;
  meteors: number;
}

/** The world events' effects of the game view. */
export class WorldEventView {
  readonly stats: WorldEventViewStats = { bolts: 0, streaks: 0, shards: 0, meteors: 0 };
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: Array<() => void> = [];
  private readonly bolts = new EffectPool();
  private readonly shards = new EffectPool();
  private readonly meteors = new EffectPool();
  /** Events of the last ticks, stamped with the presentation time of the next draw. */
  private readonly pendingBolts = new EffectPool();
  private readonly pendingShards = new EffectPool();
  private readonly pendingMeteors = new EffectPool();
  private pending = 0;
  private readonly sample: WorldEventSample = createWorldEventSample();
  private simTick = 0;
  private tickHz = 1;

  /** Listens to the strikes, shards and meteorites of `session` (again only when the session changed). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed === session) return;
    for (const u of this.unsubscribe) u();
    this.subscribed = session;
    this.bolts.clear();
    this.shards.clear();
    this.meteors.clear();
    this.unsubscribe = [
      session.onEvent('lightningStruck', (e) => {
        this.pendingBolts.add(e.x, e.y, e.layer, 0, hash3(e.x | 0, e.y | 0, 0x5b17) & 0x7fffffff, e.tick);
        this.pending++;
      }),
      session.onEvent('lumenShardFell', (e) => {
        this.pendingShards.add(e.x, e.y, e.layer, 0, 0, e.tick);
        this.pending++;
      }),
      session.onEvent('meteorImpact', (e) => {
        this.pendingMeteors.add(e.x, e.y, e.layer, 0, 0, e.tick);
        this.pending++;
      }),
    ];
  }

  /**
   * Draws the effects of `layer` into `scene` at presentation time `time` [s] and simulation tick `simTick` (`tickHz` per
   * second); the shooting stars cross the view (`left`, `top`, `width`, `height` [world px]) while the Lumen rain runs
   * (`session`'s sample).
   */
  draw(scene: RenderScene, atlas: AtlasData, session: WorldEventSession, layer: Layer, time: number, simTick: number, tickHz: number, left: number, top: number, width: number, height: number): void {
    this.simTick = simTick;
    this.tickHz = tickHz;
    const st = this.stats;
    st.bolts = 0;
    st.streaks = 0;
    st.shards = 0;
    st.meteors = 0;
    if (this.pending > 0) this.takePending(time);
    const sprites = atlas.manifest.sprites;
    const bolt = sprites.fx_blitz;
    const streak = sprites.fx_sternschnuppe;
    const meteor = sprites.fx_meteor;
    const ring = sprites.fx_einschlag;
    if (bolt !== undefined) this.drawBolts(scene, bolt, layer, time);
    if (streak !== undefined && ring !== undefined) this.drawShards(scene, streak, ring, layer, time);
    if (meteor !== undefined) this.drawMeteors(scene, meteor, layer, time);
    if (layer === 0 && session.sampleWorldEvents !== undefined) {
      const sample = session.sampleWorldEvents(this.sample);
      for (let i = 0; i < sample.count; i++) {
        const line = sample.lines[i] as WorldEventLine;
        if (line.phase !== 'aktiv') continue;
        if (line.event === 'lumenregen' && streak !== undefined) this.drawSky(scene, streak, time, left, top, width, height);
        // The forest fire's dry storm (src/game/worldevents/fire.ts): its rain never reaches the ground – ash drifts instead,
        // the lightning stays.
        if (line.event === 'waldbrand' && scene.particles.weather.id === 'regen') scene.particles.weather.set('asche', Math.min(DRY_STORM_ASH, scene.particles.weather.amount));
      }
    }
  }

  private takePending(time: number): void {
    move(this.pendingBolts, this.bolts, time);
    move(this.pendingShards, this.shards, time);
    move(this.pendingMeteors, this.meteors, time);
    this.pending = 0;
  }

  private drawBolts(scene: RenderScene, sprite: AtlasSprite, layer: Layer, time: number): void {
    const p = this.bolts;
    for (let i = 0; i < POOL; i++) {
      const age = p.age(i, time, this.simTick, this.tickHz);
      if (!(age >= 0 && age < BOLT_SECONDS) || p.layer[i] !== layer) continue;
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      const d = scene.sprite.reset();
      d.frame = sprite.frames[(p.variant[i] as number) % sprite.frames.length] as SpriteFrameRef;
      d.x = Math.round(x);
      d.y = Math.round(y);
      d.layer = 'canopy';
      d.depth = ON_TOP;
      // The channel flickers: full, a dark gap, an after-flash.
      const k = age / BOLT_SECONDS;
      d.fade = k < 0.3 ? 0 : k < 0.45 ? 0.85 : (k - 0.45) / 0.55;
      scene.sprites.push(d);
      light(scene, x, y, BOLT_LIGHT, LIGHT_COLD, 1 - k);
      this.stats.bolts++;
    }
  }

  private drawShards(scene: RenderScene, streak: AtlasSprite, ring: AtlasSprite, layer: Layer, time: number): void {
    const p = this.shards;
    const ringClip = ring.clips.aufschlag;
    const ringSeconds = ringClip === undefined ? 0 : clipDuration(ringClip);
    for (let i = 0; i < POOL; i++) {
      const age = p.age(i, time, this.simTick, this.tickHz);
      if (!(age >= 0 && age < SHARD_FALL_SECONDS + SHARD_GLOW_SECONDS) || p.layer[i] !== layer) continue;
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      if (age < SHARD_FALL_SECONDS) {
        const k = 1 - age / SHARD_FALL_SECONDS;
        drawStreak(scene, streak, x + SHARD_FALL.dx * k, y + SHARD_FALL.dy * k, time);
        this.stats.shards++;
        continue;
      }
      const since = age - SHARD_FALL_SECONDS;
      if (ringClip !== undefined && since < ringSeconds) {
        const d = scene.sprite.reset();
        d.frame = (ring.frames[clipFrameAt(ringClip, since)] ?? ring.frames[0]) as SpriteFrameRef;
        d.x = Math.round(x);
        d.y = Math.round(y);
        d.layer = 'ground';
        scene.sprites.push(d);
      }
      light(scene, x, y, SHARD_LIGHT, LIGHT_LUMEN, 1 - since / SHARD_GLOW_SECONDS);
      this.stats.shards++;
    }
  }

  private drawMeteors(scene: RenderScene, sprite: AtlasSprite, layer: Layer, time: number): void {
    const p = this.meteors;
    const clip = sprite.clips.flug;
    for (let i = 0; i < POOL; i++) {
      const age = p.age(i, time, this.simTick, this.tickHz);
      if (!(age >= 0 && age < METEOR_FALL_SECONDS + METEOR_GLOW_SECONDS) || p.layer[i] !== layer) continue;
      const x = p.x[i] as number;
      const y = p.y[i] as number;
      if (age < METEOR_FALL_SECONDS) {
        const k = 1 - age / METEOR_FALL_SECONDS;
        const d = scene.sprite.reset();
        d.frame = (clip === undefined ? sprite.frames[0] : (sprite.frames[clipFrameAt(clip, time)] ?? sprite.frames[0])) as SpriteFrameRef;
        d.x = Math.round(x + METEOR_FALL.dx * k);
        d.y = Math.round(y + METEOR_FALL.dy * k);
        d.layer = 'canopy';
        d.depth = ON_TOP;
        scene.sprites.push(d);
        light(scene, d.x, d.y, METEOR_LIGHT, LIGHT_FIRE, 0.6);
      } else light(scene, x, y, METEOR_LIGHT, LIGHT_FIRE, 1 - (age - METEOR_FALL_SECONDS) / METEOR_GLOW_SECONDS);
      this.stats.meteors++;
    }
  }

  /** The shooting stars of the Lumen rain over the view: `SKY_STREAKS` per second, each from its time slot's hash. */
  private drawSky(scene: RenderScene, sprite: AtlasSprite, time: number, left: number, top: number, width: number, height: number): void {
    const slotSeconds = 1 / SKY_STREAKS;
    const first = Math.floor((time - SKY_STREAK_SECONDS) / slotSeconds);
    const last = Math.floor(time / slotSeconds);
    for (let slot = first; slot <= last; slot++) {
      const born = slot * slotSeconds;
      const age = time - born;
      if (age < 0 || age >= SKY_STREAK_SECONDS) continue;
      const h = hash3(slot, 0x1c3, 0x7a);
      const sx = left + ((h & 0xffff) / 0x10000) * width - SKY_STREAK_PATH.dx * 0.5;
      const sy = top + (((h >>> 16) & 0xffff) / 0x10000) * height * SKY_SHARE;
      const k = age / SKY_STREAK_SECONDS;
      drawStreak(scene, sprite, sx + SKY_STREAK_PATH.dx * k, sy + SKY_STREAK_PATH.dy * k, time, k > 0.7 ? (k - 0.7) / 0.3 : 0);
      this.stats.streaks++;
    }
  }
}

/** Moves the events of `from` into `to`, stamped with `time`; empties `from`. */
function move(from: EffectPool, to: EffectPool, time: number): void {
  for (let i = 0; i < POOL; i++) {
    if (from.start[i] !== 0) continue;
    to.add(from.x[i] as number, from.y[i] as number, from.layer[i] as number, time, from.variant[i] as number, from.tick[i] as number);
  }
  from.clear();
}

function drawStreak(scene: RenderScene, sprite: AtlasSprite, x: number, y: number, time: number, fade = 0): void {
  const clip = sprite.clips.flug;
  const d = scene.sprite.reset();
  d.frame = (clip === undefined ? sprite.frames[0] : (sprite.frames[clipFrameAt(clip, time)] ?? sprite.frames[0])) as SpriteFrameRef;
  d.x = Math.round(x);
  d.y = Math.round(y);
  d.layer = 'canopy';
  d.depth = ON_TOP;
  d.fade = fade;
  scene.sprites.push(d);
}

function light(scene: RenderScene, x: number, y: number, l: { readonly radius: number; readonly intensity: number; readonly height: number }, rgb: readonly [number, number, number], share: number): void {
  if (!(share > 0)) return;
  const d = scene.light.reset();
  d.x = x;
  d.y = y;
  d.height = l.height;
  d.radius = l.radius;
  d.r = rgb[0];
  d.g = rgb[1];
  d.b = rgb[2];
  d.intensity = l.intensity * share * share;
  scene.lights.push(d);
}
