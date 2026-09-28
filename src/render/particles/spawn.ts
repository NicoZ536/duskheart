/**
 * Births of emitted particles (M5-11), on the CPU and deterministic: a source of rate `r` (particles per second, its
 * table rate × strength × quality) has emitted `⌊r · t + φ⌋` particles by time `t`, `φ` a stable phase of the source;
 * the particles born in a step `(t0, t1]` are the ordinals in between, each born at `tₖ = (k − φ) / r` with its random
 * values drawn from a hash of (source, emitter, k). The record starts with age `t0 − tₖ` ≤ 0, so the GPU step moves a
 * newborn only for its share of the step – the stream stays smooth at any frame rate, and the state at time `t` is the
 * same whichever steps led there.
 *
 * The records go into a ring (`ParticleRing`): slots are handed out in order and overwrite the oldest particles, whose
 * death times the ring remembers for the statistics (particles alive).
 */
import { E, EMITTER_FLOATS, type EmitterTable } from './kinds';
import { MAX_SPAWNS_PER_STEP, P, PARTICLE_FLOATS } from './layout';
import type { EmitterList } from './sceneParticles';

/** Salt of the source phase. */
const PHASE_SALT = 0x1f3d;
/** Salt of the per-particle draws. */
const DRAW_SALT = 0x7a21;
const GOLDEN = 0x9e3779b9;

/** Slots of the emitter ring: which slot the next birth takes, and when each slot's particle dies. */
export class ParticleRing {
  /** Next slot. */
  head = 0;
  /** Slots written since the last reset (up to the capacity: after the first lap every slot may be alive). */
  used = 0;
  /** Death time of each slot's particle [s] (written by `spawnStep`). */
  readonly deathAt: Float64Array;

  constructor(readonly capacity: number) {
    this.deathAt = new Float64Array(capacity);
  }

  reset(): void {
    this.head = 0;
    this.used = 0;
    this.deathAt.fill(0);
  }

  /** Takes the next slot for a particle dying at `deathAt`; returns the slot. */
  take(deathAt: number): number {
    const s = this.head;
    this.deathAt[s] = deathAt;
    this.head = s + 1 === this.capacity ? 0 : s + 1;
    if (this.used < this.capacity) this.used++;
    return s;
  }

  /** Particles alive at `time` (born and not yet at the end of their life). */
  alive(time: number): number {
    let n = 0;
    const d = this.deathAt;
    for (let i = 0; i < this.used; i++) if ((d[i] as number) > time) n++;
    return n;
  }

  /** The latest death of any particle in the ring (0 when empty). */
  lastDeath(): number {
    let m = 0;
    const d = this.deathAt;
    for (let i = 0; i < this.used; i++) if ((d[i] as number) > m) m = d[i] as number;
    return m;
  }
}

/** Births of one step, collected in ring order for the upload (records `0 … count − 1` go to slots `first … first + count − 1` mod capacity). */
export class SpawnBatch {
  readonly records: Float32Array;
  count = 0;
  /** Ring slot of the first record. */
  first = 0;

  constructor(readonly capacity: number) {
    this.records = new Float32Array(capacity * PARTICLE_FLOATS);
  }
}

/** Particles a source of `rate` with phase `phase` has emitted by `time` (for tests; the spawner computes it inline). */
export function emittedBy(rate: number, phase: number, time: number): number {
  return Math.floor(rate * time + phase);
}

/** Stable phase 0…1 of a source (its number and emitter), as the spawner draws it. */
export function sourcePhase(id: number, preset: number): number {
  return (mix(Math.imul(id | 0, SOURCE_MUL) ^ Math.imul(preset | 0, PRESET_MUL) ^ PHASE_SALT) >>> 0) * INV_U32;
}

/** Murmur3 finaliser on an int32 (small, inlined by the JIT). */
function mix(v: number): number {
  let x = v | 0;
  x ^= x >>> 16;
  x = Math.imul(x, MIX_A);
  x ^= x >>> 13;
  x = Math.imul(x, MIX_B);
  x ^= x >>> 16;
  return x | 0;
}

const SOURCE_MUL = 0x9e3779b1;
const PRESET_MUL = 0x85ebca77;
const ORDINAL_MUL = 0xc2b2ae3d;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const INV_U32 = 1 / 4294967296;
/** Random draws per birth (patch x, patch y, speed, direction, height, rise, life, seed). */
const DRAW_COUNT = 8;
/** Scratch of the draws of one birth (reused; no allocation per birth). */
const DRAWS = new Float64Array(DRAW_COUNT);

/**
 * Writes the births of step `(t0, t1]` of every source in `list` into `batch` (and takes their ring slots), `rateScale`
 * scaling every rate (quality). Stops when the batch is full; a source never bears more than `MAX_SPAWNS_PER_STEP` in
 * one step (after a long pause its backlog is dropped, not burst). Returns the births written.
 *
 * One function without calls that pass numbers (V8 would box every float argument and every hash beyond the small
 * integers): the frame path allocates nothing per birth.
 */
export function spawnStep(list: EmitterList, table: EmitterTable, t0: number, t1: number, rateScale: number, ring: ParticleRing, batch: SpawnBatch): number {
  batch.count = 0;
  batch.first = ring.head;
  if (!(t1 > t0)) return 0;
  const cap = Math.min(batch.capacity, ring.capacity);
  const e = table.data;
  const out = batch.records;
  const deaths = ring.deathAt;
  const draws = DRAWS;
  let n = 0;
  let head = ring.head;
  let used = ring.used;
  for (let i = 0; i < list.count; i++) {
    const preset = list.preset[i] as number;
    if (!(preset >= 0 && preset < table.count)) continue;
    const eo = preset * EMITTER_FLOATS;
    const rate = (e[eo + E.rate] as number) * (list.strength[i] as number) * rateScale;
    if (!(rate > 0)) continue;
    const idBits = Math.imul((list.id[i] as number) | 0, SOURCE_MUL) ^ Math.imul(preset | 0, PRESET_MUL);
    const phase = (mix(idBits ^ PHASE_SALT) >>> 0) * INV_U32;
    const k1 = Math.floor(rate * t1 + phase);
    let k = Math.max(Math.floor(rate * t0 + phase), k1 - MAX_SPAWNS_PER_STEP);
    const x = list.x[i] as number;
    const y = list.y[i] as number;
    const z = list.z[i] as number;
    const w = e[eo + E.width] as number;
    const d = e[eo + E.depth] as number;
    const round = (e[eo + E.round] as number) > 0;
    const align = e[eo + E.alignment] as number;
    while (k < k1 && n < cap) {
      k++;
      let s = mix(idBits ^ Math.imul(k | 0, ORDINAL_MUL) ^ DRAW_SALT);
      for (let j = 0; j < DRAW_COUNT; j++) {
        s = (s + GOLDEN) | 0;
        draws[j] = (mix(s) >>> 0) * INV_U32;
      }
      let ox: number;
      let oy: number;
      if (round) {
        const r = Math.sqrt(draws[0] as number);
        const a = (draws[1] as number) * Math.PI * 2;
        ox = Math.cos(a) * r * (w / 2);
        oy = Math.sin(a) * r * (d / 2);
      } else {
        ox = ((draws[0] as number) - 0.5) * w;
        oy = ((draws[1] as number) - 0.5) * d;
      }
      const speed = (e[eo + E.speedMin] as number) + ((e[eo + E.speedMax] as number) - (e[eo + E.speedMin] as number)) * (draws[2] as number);
      // Radial: outward through the birth point; tangential: a quarter turn clockwise from that (in the patch's own proportions).
      const base = align === 0 || (ox === 0 && oy === 0) ? 0 : Math.atan2(oy / Math.max(1, d), ox / Math.max(1, w)) + (align === 2 ? Math.PI / 2 : 0);
      const dir = base + (e[eo + E.direction] as number) + ((draws[3] as number) - 0.5) * (e[eo + E.spread] as number);
      const born = (k - phase) / rate;
      const life = (e[eo + E.lifeMin] as number) + ((e[eo + E.lifeMax] as number) - (e[eo + E.lifeMin] as number)) * (draws[6] as number);
      const o = n * PARTICLE_FLOATS;
      out[o + P.x] = x + ox;
      out[o + P.y] = y + oy;
      out[o + P.z] = z + (e[eo + E.zMin] as number) + ((e[eo + E.zMax] as number) - (e[eo + E.zMin] as number)) * (draws[4] as number);
      out[o + P.age] = Math.min(0, t0 - born);
      out[o + P.vx] = Math.cos(dir) * speed;
      out[o + P.vy] = Math.sin(dir) * speed;
      out[o + P.vz] = (e[eo + E.riseMin] as number) + ((e[eo + E.riseMax] as number) - (e[eo + E.riseMin] as number)) * (draws[5] as number);
      out[o + P.life] = life;
      out[o + P.kind] = e[eo + E.kind] as number;
      out[o + P.seed] = draws[7] as number;
      out[o + P.phase] = 0;
      out[o + P.layer] = 0;
      deaths[head] = born + life;
      head = head + 1 === ring.capacity ? 0 : head + 1;
      if (used < ring.capacity) used++;
      n++;
    }
  }
  ring.head = head;
  ring.used = used;
  batch.count = n;
  return n;
}
