/**
 * M6-16 Bench `sim:pfad-200` (Akzeptanz „Bench 200 Anfragen/s im Budget“, §30 Simulation ≤ 3 ms je Tick): der
 * Pfaddienst auf einer generierten Welt (Klein, Seed 30) – 200 Anfragen je Sekunde (60 Ticks) zwischen begehbaren
 * Kacheln der aktiven Zone (7 × 7 Chunks um einen Ort landeinwärts vom Startstrand), gemischt kurz (≤ 24 Kacheln,
 * 60 %), mittel (24–60, 25 %) und weit (≥ 60, 15 %), Landtiere, Amphibien und Flieger, jede zehnte Anfrage mit Türen.
 *
 * Gemessen wird der schlechteste Fall: ohne Worker rechnet die Simulation jeden Pfad selbst an seinem Bereit-Tick
 * (`PathService` ohne Job-Queue) – im Browser erledigt das der Worker, dem Hauptthread bleiben Schnappschuss und
 * Übernahme. Je Tick zählt die ganze Arbeit des Dienstes: Aufnahme, Schnappschüsse, Suchen, Auslieferung. Dazu die
 * Wartezeit bis zum Bereit-Tick (das Tick-Budget muss 200/s ohne Rückstau tragen) und die Allokation je Anfrage im
 * eingeschwungenen Zustand: dieselbe Anfragefolge ein zweites Mal, wenn Pools und Caches warm sind.
 */
import { BALANCE } from '../../src/content/balance';
import { Rng } from '../../src/engine/rng';
import { worldFor } from '../../src/game/worldCache';
import { BLOCK_ALL, CollisionGrid } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SHIFT, CHUNK_SIZE, layerIndex, packChunkId, type Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';
import { PathService } from '../../src/world/path/service';
import type { MoverClass, PathRequest, PathTicket } from '../../src/world/path/types';
import type { Measurement } from './thresholds';
import { percentile } from './stats';

/** Name des Szenarios. */
export const PATH_BENCH = 'sim:pfad-200';
/** Anfragen je Sekunde (Akzeptanz M6-16). */
export const PATH_BENCH_RATE = 200;
/** Weltseed des Benchs. */
const WORLD_SEED = 30;
/** Seed der Anfragefolge. */
const REQUEST_SEED = 7;
/** Kantenlänge der aktiven Zone mit Hysterese [Chunks] (`BALANCE.ai.path.maxWindowChunks`). */
const ZONE_CHUNKS = BALANCE.ai.path.maxWindowChunks;
/** Versatz des Zonenmittelpunkts vom Startstrand landeinwärts [Kacheln]: die Zone soll Wald, Wiese und Ufer haben, nicht Meer. */
const INLAND_TILES = 96;
/** Entfernungsklassen [Kacheln] und ihre Anteile. */
const SHORT_MAX = 24;
const LONG_MIN = 60;
const SHORT_SHARE = 0.6;
const MEDIUM_SHARE = 0.85;
/** Knotengrenzen je Klasse [Knoten]: so viel, wie eine Kreatur für ihre Strecke verlangen würde. */
const NODES_SHORT = 512;
const NODES_MEDIUM = 2048;
const NODES_LONG = BALANCE.ai.path.maxNodesPerRequest;
/** Anteil der Anfragen von Kreaturen, die Türen öffnen. */
const DOOR_SHARE = 0.1;
/** Besitzer, die sich abwechseln (eine Kreaturenschar). */
const OWNERS = 64;
/** Versuche, ein Ziel der gewünschten Klasse zu finden. */
const TRIES = 64;
/** Fortbewegungen, gewichtet: vor allem Landtiere. */
const MOVERS: readonly MoverClass[] = ['land', 'land', 'land', 'land', 'land', 'land', 'land', 'land', 'amphibie', 'flieger'];

/** Laufparameter des Szenarios: 600 Ticks Aufwärmen, drei Messfenster zu 1 200 Ticks, 1 200 Ticks Allokationsmessung. */
export const PATH_BENCH_OPTIONS: PathBenchOptions = { warmupTicks: 600, windows: 3, windowTicks: 1200, allocTicks: 1200, seed: REQUEST_SEED };

/** Eine Welt für den Bench: geladene Chunks und die Zone, in der Pfade liegen dürfen. */
export interface PathBenchWorld {
  readonly chunks: ReadonlyMap<number, ChunkData>;
  readonly worldTiles: number;
  /** Erster Zonenchunk und Kantenlänge [Chunks]. */
  readonly zoneCx0: number;
  readonly zoneCy0: number;
  readonly zoneChunks: number;
}

/** Laufparameter. */
export interface PathBenchOptions {
  readonly warmupTicks: number;
  readonly windows: number;
  readonly windowTicks: number;
  /** Ticks der Allokationsmessung (0 = keine): die Anfragefolge der ersten Ticks noch einmal. */
  readonly allocTicks: number;
  readonly seed: number;
}

/** Ergebnis eines Laufs. */
export interface PathBenchResult {
  /** Dienstzeit je Tick [ms] (Aufwärmen und Messfenster). */
  readonly tickMs: Float64Array;
  readonly requested: number;
  readonly delivered: number;
  readonly found: number;
  readonly partial: number;
  readonly none: number;
  /** Suchen über die Hierarchie. */
  readonly hierarchical: number;
  /** Wartezeit Anfrage → Bereit-Tick, 95. Perzentil [Ticks]. */
  readonly waitP95: number;
  /** Mittlere expandierte Knoten je Anfrage. */
  readonly expandedMean: number;
  /** Heap-Zuwachs je Anfrage in der Allokationsmessung [B] (NaN ohne Messung). */
  readonly allocPerRequest: number;
}

/** Die generierte Welt des Benchs: Klein, Zone landeinwärts vom Startstrand, dazu ein Ring Nachbarchunks. */
export function generatedPathWorld(seed: number = WORLD_SEED): PathBenchWorld {
  const world = worldFor(seed, 'small');
  const tiles = worldDimensions('small').tiles;
  const centre = tiles / 2;
  const dx = centre - world.spawn.x;
  const dy = centre - world.spawn.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const zx = Math.round(world.spawn.x + (dx / len) * INLAND_TILES);
  const zy = Math.round(world.spawn.y + (dy / len) * INLAND_TILES);
  const worldChunks = tiles >> CHUNK_SHIFT;
  const half = ZONE_CHUNKS >> 1;
  const zoneCx0 = Math.max(1, Math.min(worldChunks - ZONE_CHUNKS - 1, (zx >> CHUNK_SHIFT) - half));
  const zoneCy0 = Math.max(1, Math.min(worldChunks - ZONE_CHUNKS - 1, (zy >> CHUNK_SHIFT) - half));
  const chunks = new Map<number, ChunkData>();
  for (let cy = zoneCy0 - 1; cy <= zoneCy0 + ZONE_CHUNKS; cy++) {
    for (let cx = zoneCx0 - 1; cx <= zoneCx0 + ZONE_CHUNKS; cx++) chunks.set(packChunkId(0, cx, cy), generateChunk(world, 0, cx, cy));
  }
  return { chunks, worldTiles: tiles, zoneCx0, zoneCy0, zoneChunks: ZONE_CHUNKS };
}

/** Bits per chunk coordinate in the bench's chunk keys (a small world has 32 chunks per edge). */
const KEY_BITS = 8;
/** Small-integer key of a chunk of the bench world. */
function benchKey(layer: Layer, cx: number, cy: number): number {
  return (layerIndex(layer) << (2 * KEY_BITS)) | ((cy & ((1 << KEY_BITS) - 1)) << KEY_BITS) | (cx & ((1 << KEY_BITS) - 1));
}

/** The tiles of the zone a land creature may stand on (x, y pairs). */
function walkableTiles(grid: CollisionGrid, w: PathBenchWorld): Int32Array {
  const out: number[] = [];
  const x0 = w.zoneCx0 << CHUNK_SHIFT;
  const y0 = w.zoneCy0 << CHUNK_SHIFT;
  const n = w.zoneChunks * CHUNK_SIZE;
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) if ((grid.tileInfo(0, x, y) & BLOCK_ALL) === 0) out.push(x, y);
  return Int32Array.from(out);
}

/** A drawn request sequence. */
interface RequestPlan {
  readonly fromTx: Int32Array;
  readonly fromTy: Int32Array;
  readonly toTx: Int32Array;
  readonly toTy: Int32Array;
  readonly mover: Uint8Array;
  readonly doors: Uint8Array;
  readonly maxNodes: Int32Array;
}

/** Draws `count` requests between walkable tiles: distance classes, movers, doors and node limits as in the module comment. */
function planRequests(seed: number, count: number, walkable: Int32Array): RequestPlan {
  const rng = new Rng(seed);
  const spots = walkable.length >> 1;
  const plan: RequestPlan = {
    fromTx: new Int32Array(count),
    fromTy: new Int32Array(count),
    toTx: new Int32Array(count),
    toTy: new Int32Array(count),
    mover: new Uint8Array(count),
    doors: new Uint8Array(count),
    maxNodes: new Int32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const s = rng.int(0, spots);
    const fx = walkable[2 * s] as number;
    const fy = walkable[2 * s + 1] as number;
    const r = rng.next();
    const wantMin = r < SHORT_SHARE ? 1 : r < MEDIUM_SHARE ? SHORT_MAX : LONG_MIN;
    const wantMax = r < SHORT_SHARE ? SHORT_MAX : r < MEDIUM_SHARE ? LONG_MIN : Number.POSITIVE_INFINITY;
    let tx = fx;
    let ty = fy;
    for (let k = 0; k < TRIES; k++) {
      const g = rng.int(0, spots);
      tx = walkable[2 * g] as number;
      ty = walkable[2 * g + 1] as number;
      const d = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
      if (d >= wantMin && d <= wantMax) break;
    }
    plan.fromTx[i] = fx;
    plan.fromTy[i] = fy;
    plan.toTx[i] = tx;
    plan.toTy[i] = ty;
    plan.maxNodes[i] = r < SHORT_SHARE ? NODES_SHORT : r < MEDIUM_SHARE ? NODES_MEDIUM : NODES_LONG;
    plan.mover[i] = rng.int(0, MOVERS.length);
    plan.doors[i] = rng.next() < DOOR_SHARE ? 1 : 0;
  }
  return plan;
}

/** Runs the path service under 200 requests/s (see module comment). */
export function runPathBench(w: PathBenchWorld, o: PathBenchOptions): PathBenchResult {
  let tick = 0;
  // Chunks by a small-integer key: the bench measures the path service, not the lookups of a chunk store (the
  // `ChunkManager` keys by packed ids beyond the small-integer range, so each of its lookups allocates a number).
  const byKey = new Map<number, ChunkData>();
  for (const c of w.chunks.values()) byKey.set(benchKey(c.layer, c.cx, c.cy), c);
  const source = { get: (layer: Layer, cx: number, cy: number) => byKey.get(benchKey(layer, cx, cy)) };
  const grid = new CollisionGrid({ chunks: source, worldTiles: w.worldTiles, memo: true, epoch: () => tick });
  const inZone = (_layer: Layer, cx: number, cy: number): boolean => cx >= w.zoneCx0 && cy >= w.zoneCy0 && cx < w.zoneCx0 + w.zoneChunks && cy < w.zoneCy0 + w.zoneChunks;
  const service = new PathService({ grid, chunkAllowed: inZone });
  const walkable = walkableTiles(grid, w);
  const spots = walkable.length >> 1;
  if (spots < 2) throw new Error('Bench pfad: keine begehbaren Kacheln in der Zone');
  const dueAt = (t: number): number => Math.floor(((t + 1) * PATH_BENCH_RATE) / BALANCE.time.tickHz) - Math.floor((t * PATH_BENCH_RATE) / BALANCE.time.tickHz);
  const timed = o.warmupTicks + o.windows * o.windowTicks;
  // The request sequence, drawn before any measurement (the random stream itself allocates numbers).
  const count = Math.floor((timed * PATH_BENCH_RATE) / BALANCE.time.tickHz) + 1;
  const plan = planRequests(o.seed, count, walkable);
  const req: { -readonly [K in keyof PathRequest]: PathRequest[K] } = { owner: 1, layer: 0, fromTx: 0, fromTy: 0, toTx: 0, toTy: 0, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: NODES_SHORT };
  // Pending tickets with a count (an array that pops and pushes would reallocate its store – inside the measurement).
  const pending: PathTicket[] = [];
  let pendingCount = 0;
  const waits = new Int32Array(count);
  let waitCount = 0;
  let next = 0;
  let requested = 0;
  let delivered = 0;
  let found = 0;
  let partial = 0;
  let none = 0;
  let expanded = 0;
  const pick = (): void => {
    const i = next++ % count;
    req.fromTx = plan.fromTx[i] as number;
    req.fromTy = plan.fromTy[i] as number;
    req.toTx = plan.toTx[i] as number;
    req.toTy = plan.toTy[i] as number;
    req.mover = MOVERS[plan.mover[i] as number] as MoverClass;
    req.opensDoors = plan.doors[i] === 1;
    req.maxNodes = plan.maxNodes[i] as number;
    req.owner = 1 + (requested % OWNERS);
  };
  /** One tick of the service: admission, delivery of what is ready, this tick's requests (`due` of them). */
  const step = (due: number): void => {
    service.update(tick);
    for (let i = 0; i < pendingCount; ) {
      const r = service.poll(pending[i] as PathTicket, tick);
      if (r === null) {
        i++;
        continue;
      }
      delivered++;
      expanded += r.expanded;
      if (r.status === 'found') found++;
      else if (r.status === 'partial') partial++;
      else none++;
      // Swap-remove: the order of polling changes no result.
      pending[i] = pending[--pendingCount] as PathTicket;
    }
    for (let k = 0; k < due; k++) {
      pick();
      const t = service.request(req, tick);
      requested++;
      if (waitCount < waits.length && tick < timed) waits[waitCount++] = t.readyTick - tick;
      if (pendingCount < pending.length) pending[pendingCount] = t;
      else pending.push(t);
      pendingCount++;
    }
  };
  const tickMs = new Float64Array(timed);
  for (let k = 0; k < timed; k++, tick++) {
    const t0 = performance.now();
    step(dueAt(k));
    tickMs[k] = performance.now() - t0;
  }
  let allocPerRequest = Number.NaN;
  if (o.allocTicks > 0) {
    // The same request sequence once more – pools, tile words, portals and legs are warm now, the code optimized –
    // and measured the time after.
    next = 0;
    for (let k = 0; k < o.allocTicks; k++, tick++) step(dueAt(k));
    next = 0;
    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc === undefined) throw new Error('bench: Allokationsmessung braucht `node --expose-gc` (npm run bench startet so)');
    gc();
    const before = process.memoryUsage().heapUsed;
    const firstRequest = requested;
    for (let k = 0; k < o.allocTicks; k++, tick++) step(dueAt(k));
    allocPerRequest = Math.max(0, process.memoryUsage().heapUsed - before) / Math.max(1, requested - firstRequest);
  }
  return {
    tickMs,
    requested,
    delivered,
    found,
    partial,
    none,
    hierarchical: service.context.hierarchical,
    waitP95: percentile(Array.from(waits.subarray(0, waitCount)), 95),
    expandedMean: expanded / Math.max(1, delivered),
    allocPerRequest,
  };
}

/** p95 je Messfenster nach dem Aufwärmen, davon der Median: ein Lastschub fremder Prozesse in einem Fenster entscheidet nicht (wie `windowedMedian`). */
export function windowedP95(samples: Float64Array, warmup: number, windows: number): number {
  const size = Math.floor((samples.length - warmup) / windows);
  if (windows < 1 || size < 1) throw new RangeError(`${samples.length - warmup} Messwerte für ${windows} Fenster`);
  const p95s: number[] = [];
  for (let k = 0; k < windows; k++) p95s.push(percentile(Array.from(samples.subarray(warmup + k * size, warmup + (k + 1) * size)), 95));
  return percentile(p95s, 50);
}

/** Die Messwerte eines Laufs. */
export function pathBenchMeasurements(r: PathBenchResult, o: PathBenchOptions): Measurement[] {
  const medians: number[] = [];
  for (let k = 0; k < o.windows; k++) medians.push(percentile(Array.from(r.tickMs.subarray(o.warmupTicks + k * o.windowTicks, o.warmupTicks + (k + 1) * o.windowTicks)), 50));
  return [
    { scenario: PATH_BENCH, metric: 'tick median', value: percentile(medians, 50), unit: 'ms' },
    { scenario: PATH_BENCH, metric: 'tick p95', value: windowedP95(r.tickMs, o.warmupTicks, o.windows), unit: 'ms' },
    { scenario: PATH_BENCH, metric: 'Wartezeit p95', value: r.waitP95, unit: 'Ticks' },
    { scenario: PATH_BENCH, metric: 'Allokation je Anfrage', value: r.allocPerRequest, unit: 'B' },
  ];
}
