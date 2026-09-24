/**
 * Streaming and active zone parameters (docs/WORLD.md §5, docs/ARCHITEKTUR.md "Aktive Zone").
 *
 * All distances are Chebyshev distances in chunks between a chunk and the focus chunk (camera for
 * streaming, player for the active zone), so a radius r covers a (2r + 1)² square of chunks.
 * `resolveStreamConfig` checks the relations the design depends on: the active zone lies inside
 * the load square of every layer (activation never waits for a worker), and unloading/deactivation
 * happen only one hysteresis ring further out than loading/activation.
 */
import { BALANCE } from '../../content/balance';
import { LAYER_COUNT } from '../model/coords';

/** Streaming balance values (docs/WORLD.md §5 "Radius konfigurierbar in balance"). */
const STREAM = BALANCE.stream;

/** Tuning of chunk streaming and the active zone. */
export interface StreamConfig {
  /** Load radius around the camera chunk per layer index (0 surface … 3 Glutadern) [chunks]. */
  readonly loadRadius: readonly number[];
  /** Extra ring per layer index that stays resident before a chunk is unloaded (hysteresis) [chunks]. */
  readonly unloadHysteresis: readonly number[];
  /** Radius of the active zone around the player chunk [chunks]. */
  readonly activeRadius: number;
  /** Extra ring before an active chunk is frozen again (hysteresis) [chunks]. */
  readonly activeHysteresis: number;
  /** Layers besides the camera layer whose chunks stay resident, most recently visited first [layers]. */
  readonly retainedLayers: number;
  /** Main-thread time per frame for integrating loaded chunks and in-thread jobs [ms]. */
  readonly jobFrameBudgetMs: number;
  /** Load jobs a worker holds at once [jobs]. */
  readonly maxJobsInFlight: number;
}

/** Default streaming configuration (values and reasons: `BALANCE.stream`). */
export const STREAM_DEFAULTS: StreamConfig = Object.freeze({
  loadRadius: Object.freeze([STREAM.surfaceLoadRadiusChunks, STREAM.undergroundLoadRadiusChunks, STREAM.undergroundLoadRadiusChunks, STREAM.undergroundLoadRadiusChunks]),
  unloadHysteresis: Object.freeze([STREAM.hysteresisChunks, STREAM.hysteresisChunks, STREAM.hysteresisChunks, STREAM.hysteresisChunks]),
  activeRadius: STREAM.activeRadiusChunks,
  activeHysteresis: STREAM.hysteresisChunks,
  retainedLayers: STREAM.retainedLayers,
  jobFrameBudgetMs: STREAM.jobFrameBudgetMs,
  maxJobsInFlight: STREAM.maxJobsInFlight,
});

function nonNegativeInt(name: string, v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new RangeError(`Stream config: ${name} must be an integer ≥ 0, got ${String(v)}`);
  return v as number;
}

function perLayer(name: string, v: readonly number[]): readonly number[] {
  if (v.length !== LAYER_COUNT) throw new RangeError(`Stream config: ${name} needs one value per layer (${LAYER_COUNT}), got ${v.length}`);
  return Object.freeze(v.map((x, i) => nonNegativeInt(`${name}[${i}]`, x)));
}

/**
 * Defaults with `overrides` applied, validated. Throws `RangeError` when a value is out of range or
 * the active zone does not fit into the load square of a layer (radius ≥ active radius + 1, so the
 * chunks entering the zone are loaded one ring ahead).
 */
export function resolveStreamConfig(overrides: Partial<StreamConfig> = {}): StreamConfig {
  const c = { ...STREAM_DEFAULTS, ...overrides };
  const loadRadius = perLayer('loadRadius', c.loadRadius);
  const unloadHysteresis = perLayer('unloadHysteresis', c.unloadHysteresis);
  const activeRadius = nonNegativeInt('activeRadius', c.activeRadius);
  const activeHysteresis = nonNegativeInt('activeHysteresis', c.activeHysteresis);
  const retainedLayers = nonNegativeInt('retainedLayers', c.retainedLayers);
  if (retainedLayers >= LAYER_COUNT) throw new RangeError(`Stream config: retainedLayers must be below ${LAYER_COUNT}, got ${retainedLayers}`);
  loadRadius.forEach((r, i) => {
    if (r < activeRadius + 1) throw new RangeError(`Stream config: loadRadius[${i}] = ${r} must be at least activeRadius + 1 = ${activeRadius + 1}`);
  });
  if (!(c.jobFrameBudgetMs >= 0) || !Number.isFinite(c.jobFrameBudgetMs)) throw new RangeError(`Stream config: jobFrameBudgetMs must be a finite number ≥ 0, got ${String(c.jobFrameBudgetMs)}`);
  const maxJobsInFlight = nonNegativeInt('maxJobsInFlight', c.maxJobsInFlight);
  if (maxJobsInFlight < 1) throw new RangeError('Stream config: maxJobsInFlight must be at least 1');
  return Object.freeze({ loadRadius, unloadHysteresis, activeRadius, activeHysteresis, retainedLayers, jobFrameBudgetMs: c.jobFrameBudgetMs, maxJobsInFlight });
}

/** Chebyshev distance between two chunk coordinates [chunks]. */
export function chunkDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
