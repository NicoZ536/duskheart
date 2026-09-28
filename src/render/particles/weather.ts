/**
 * Weather particles and lightning (M5-12), the pure part: which weather particles a weather sample of the simulation
 * shows, the wind they drift with, the box of sky around the camera they fill, how many of the pool fall, their
 * starting distribution after a reset (the steady state of falling and landing, so a frozen screenshot shows a full
 * sky), and the brightness of a thunderstorm's lightning at a moment.
 *
 * The GPU keeps them falling (`particle_update.vert`): a particle falls from up to `hoehe` px above a ground point in
 * the box, lands (splash, lying snow on the ground layer), and starts over above a new point – or waits (idle) while
 * the weather needs fewer. Positions live in layer space: a particle of a layer with parallax `d` is drawn at
 * `camera + wrap(p − camera · d)`, so the near layer scrolls faster than the ground and the far one slower.
 */
import { LIGHTNING, PARTICLE_WORLD, type Lightning, type WeatherParticleId, type WeatherParticles } from '../../content/particles';
import { fmix32, hash2, hash3, hashToUnit } from '../../engine/rng';
import type { WeatherStateId } from '../../content/weather';
import { KIND_ROWS, type KindTable } from './kinds';
import { P, PARTICLE_FLOATS } from './layout';

/** Margin of the box beyond the view on every side [px] (a streak or puff crossing the edge is drawn whole). */
export const WEATHER_BOX_MARGIN = 24;
/** States of a weather particle (`meta.z = cycle · 4 + state`). */
export const WEATHER_STATE = { falling: 0, landed: 1, idle: 2 } as const;
export const WEATHER_STATE_SLOTS = 4;
/** Idle wait before a particle checks again whether the weather needs it [s]. */
export const WEATHER_IDLE_S = { min: 0.25, max: 1 } as const;
/** Life of a falling particle (it ends by landing, not by age) [s]. */
export const WEATHER_FALL_LIFE = 1e4;
/** Lowest start of a new particle as a share of the weather's `hoehe` (spreads the starts so no sheets fall). */
export const WEATHER_START_SPREAD = 0.2;

/** The box of sky around the camera the pool fills, in layer space relative to `camera · parallax` [px]. */
export interface WeatherBox {
  halfWidth: number;
  top: number;
  bottom: number;
}

export function createWeatherBox(): WeatherBox {
  return { halfWidth: 0, top: 0, bottom: 0 };
}

/** Box of a `viewW` × `viewH` view for particles falling from up to `fallTop` px: a landing point low enough that its drop is still in view counts. */
export function weatherBox(viewW: number, viewH: number, fallTop: number, out: WeatherBox): WeatherBox {
  out.halfWidth = viewW / 2 + WEATHER_BOX_MARGIN;
  out.top = -viewH / 2 - WEATHER_BOX_MARGIN;
  out.bottom = viewH / 2 + fallTop + WEATHER_BOX_MARGIN;
  return out;
}

/** Particles of the pool that fall for `config` at `amount` 0…1 in `box`, scaled by `quality` (0…1), at most `capacity`. */
export function weatherCount(config: WeatherParticles, amount: number, box: WeatherBox, quality: number, capacity: number): number {
  const area = 2 * box.halfWidth * (box.bottom - box.top);
  const AREA_UNIT = 10_000;
  return Math.max(0, Math.min(capacity, Math.round(((config.dichte * area) / AREA_UNIT) * Math.max(0, Math.min(1, amount)) * quality)));
}

/** What a weather sample needs to show for the particles (the fields of `WeatherSample`, src/world/climate/weather.ts). */
export interface WeatherLike {
  readonly state: WeatherStateId;
  readonly previous: WeatherStateId;
  readonly blend: number;
  readonly precipitation: number;
  readonly precipitationKind: 'keiner' | 'regen' | 'schnee' | 'asche';
  readonly wind: number;
}

/** The weather particles of a weather sample (`id` null: none), their amount 0…1 and the thunderstorm's strength 0…1. */
export interface WeatherChoice {
  id: WeatherParticleId | null;
  amount: number;
  storm: number;
}

export function createWeatherChoice(): WeatherChoice {
  return { id: null, amount: 0, storm: 0 };
}

/** Share of `state` in the blend of `w` (1 settled in it, 0 not involved). */
function shareOf(w: WeatherLike, state: WeatherStateId): number {
  const b = Math.max(0, Math.min(1, w.blend));
  return (w.state === state ? b : 0) + (w.previous === state ? 1 - b : 0);
}

/**
 * Weather particles of `w`: rain and drizzle `regen`, snow and blizzard `schnee`, ashfall `asche` with the blended
 * precipitation as amount; a sandstorm `sand` with its share of the blend (it has no precipitation, its grains are the
 * wind's). The thunderstorm's share is the lightning's strength.
 */
export function weatherChoice(w: WeatherLike, out: WeatherChoice): WeatherChoice {
  out.storm = shareOf(w, 'gewitter');
  if (w.precipitationKind !== 'keiner' && w.precipitation > 0) {
    out.id = w.precipitationKind === 'regen' ? 'regen' : w.precipitationKind === 'schnee' ? 'schnee' : 'asche';
    out.amount = Math.min(1, w.precipitation);
    return out;
  }
  const sand = shareOf(w, 'sandsturm');
  out.id = sand > 0 ? 'sand' : null;
  out.amount = sand;
  return out;
}

/** Ground offsets of the eight wind directions (0 north … 7 north-west, `windDirection` of src/game/fire/formulas.ts). */
const DIR_X: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_Y: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Wind [px/s] blowing towards `direction` (0 north … 7 north-west) with weather wind `wind` 0…1. */
export function windVelocity(direction: number, wind: number, out: { x: number; y: number }): { x: number; y: number } {
  const d = ((Math.floor(direction) % DIR_X.length) + DIR_X.length) % DIR_X.length;
  const dx = DIR_X[d] as number;
  const dy = DIR_Y[d] as number;
  const len = Math.sqrt(dx * dx + dy * dy);
  const speed = Math.max(0, wind) * PARTICLE_WORLD.windPxPerS;
  out.x = (dx / len) * speed;
  out.y = (dy / len) * speed;
  return out;
}

/** Index of the entry of `shares` (cumulative, ascending, last = 1) that `u` 0…1 falls into. */
export function pickShare(u: number, shares: ArrayLike<number>, count: number): number {
  for (let i = 0; i < count - 1; i++) if (u < (shares[i] as number)) return i;
  return count - 1;
}

/**
 * Starting state of the whole pool after a reset (`capacity` records into `out` from `offset`): the first `count`
 * particles in the steady state of the weather – a ground point anywhere in the box, a height anywhere on the fall, on
 * the ground layer some just landed (splash, lying snow) in the share of the time a particle spends there – the rest
 * idle. `camera` is the view centre [world px]; `seed` varies the pattern (the weather's region and period).
 */
export function initWeatherPool(
  out: Float32Array,
  offset: number,
  capacity: number,
  config: WeatherParticles,
  kinds: KindTable,
  count: number,
  box: WeatherBox,
  cameraX: number,
  cameraY: number,
  seed: number,
): void {
  const kindIdx = config.arten.map((a) => kinds.index(a.art));
  const kindShares = cumulative(config.arten.map((a) => a.anteil));
  const layerShares = cumulative(config.schichten.map((l) => l.anteil));
  const fallMean = (config.fall.min + config.fall.max) / 2;
  const fallTime = fallMean > 0 ? config.hoehe / fallMean : 0;
  for (let i = 0; i < capacity; i++) {
    const o = offset + i * PARTICLE_FLOATS;
    let h = hash3(i, 0x57e1, seed);
    const u = (): number => {
      h = fmix32((h + 0x9e3779b9) | 0);
      return hashToUnit(h);
    };
    const layerIdx = pickShare(u(), layerShares, config.schichten.length);
    const layer = config.schichten[layerIdx] as WeatherParticles['schichten'][number];
    const kind = kindIdx[pickShare(u(), kindShares, kindIdx.length)] as number;
    const r5 = kind * KIND_ROWS * 4 + 5 * 4;
    const ground = kinds.data[r5 + 1] as number;
    const splash = kinds.data[r5 + 2] as number;
    const landKind = splash >= 0 ? splash : kind;
    const landLife = (kinds.lifeMin(landKind) + kinds.lifeMax(landKind)) / 2;
    const lands = layer.parallaxe === 1 && (ground === 1 || ground === 3);
    const qx = (u() * 2 - 1) * box.halfWidth;
    const qy = box.top + u() * (box.bottom - box.top);
    out[o + P.x] = qx + cameraX * layer.parallaxe;
    out[o + P.y] = qy + cameraY * layer.parallaxe;
    out[o + P.seed] = u();
    out[o + P.layer] = layerIdx + 1;
    const fall = config.fall.min + u() * (config.fall.max - config.fall.min);
    const inLanding = lands && u() < landLife / (fallTime + landLife);
    const cycle = hash2(i, seed) & 0xff;
    if (i >= count) {
      out[o + P.z] = config.hoehe;
      out[o + P.age] = 0;
      out[o + P.vx] = 0;
      out[o + P.vy] = 0;
      out[o + P.vz] = -fall;
      out[o + P.life] = WEATHER_IDLE_S.min + u() * (WEATHER_IDLE_S.max - WEATHER_IDLE_S.min);
      out[o + P.kind] = kind;
      out[o + P.phase] = cycle * WEATHER_STATE_SLOTS + WEATHER_STATE.idle;
    } else if (inLanding) {
      const life = kinds.lifeMin(landKind) + u() * (kinds.lifeMax(landKind) - kinds.lifeMin(landKind));
      out[o + P.z] = 0;
      out[o + P.age] = u() * life;
      out[o + P.vx] = 0;
      out[o + P.vy] = 0;
      out[o + P.vz] = 0;
      out[o + P.life] = life;
      out[o + P.kind] = landKind;
      out[o + P.phase] = cycle * WEATHER_STATE_SLOTS + WEATHER_STATE.landed;
    } else {
      out[o + P.z] = u() * config.hoehe;
      out[o + P.age] = 0;
      out[o + P.vx] = 0;
      out[o + P.vy] = 0;
      out[o + P.vz] = -fall;
      out[o + P.life] = WEATHER_FALL_LIFE;
      out[o + P.kind] = kind;
      out[o + P.phase] = cycle * WEATHER_STATE_SLOTS + WEATHER_STATE.falling;
    }
  }
}

function cumulative(shares: readonly number[]): number[] {
  let s = 0;
  return shares.map((v, i) => (i === shares.length - 1 ? 1 : (s += v)));
}

/** Cumulative shares of `config`'s kinds and layers (uniforms of the update shader). */
export function weatherShares(config: WeatherParticles): { kinds: number[]; layers: number[] } {
  return { kinds: cumulative(config.arten.map((a) => a.anteil)), layers: cumulative(config.schichten.map((l) => l.anteil)) };
}

/** Salt of the lightning sequence. */
const LIGHTNING_SALT = 0x6c16;

/**
 * Brightness 0…1 of the lightning at `time` [s] of a thunderstorm of strength `storm` 0…1 with stable number `seed`.
 * Time is cut into slots of `abstand.min` seconds; a slot holds a strike with the probability that gives the mean of
 * `abstand` between strikes, at a random moment that leaves the whole flash inside the slot. A strike is the flash, a
 * dark gap and a decaying after-flash, its strength drawn between 0,6 and 1. With `reduced` (flash reduction, §29) a
 * strike is one soft rise and fall of at most `reduziert` – no strobing.
 */
export function lightningFlash(time: number, seed: number, storm: number, reduced: boolean, data: Lightning = LIGHTNING): number {
  if (!(storm > 0)) return 0;
  const slot = data.abstand.min;
  const k = Math.floor(time / slot);
  const h = hash3(k, seed | 0, LIGHTNING_SALT);
  const mean = (data.abstand.min + data.abstand.max) / 2;
  if (hashToUnit(h) >= slot / mean) return 0;
  const length = reduced ? data.reduziertDauer : data.blitz + data.pause + data.nachblitz;
  const room = Math.max(0, slot - length);
  const at = k * slot + hashToUnit(fmix32(h ^ 0x51ed)) * room;
  const tau = time - at;
  if (tau < 0 || tau >= length) return 0;
  const STRIKE_MIN = 0.6;
  const strength = storm * (STRIKE_MIN + (1 - STRIKE_MIN) * hashToUnit(fmix32(h ^ 0x2b17)));
  if (reduced) {
    const x = tau / length;
    return strength * data.reduziert * Math.sin(Math.PI * x);
  }
  if (tau < data.blitz) return strength;
  if (tau < data.blitz + data.pause) return 0;
  const after = (tau - data.blitz - data.pause) / data.nachblitz;
  return strength * data.nachblitzStaerke * (1 - after);
}
