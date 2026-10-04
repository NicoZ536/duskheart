/**
 * M6-16 Bench `sim:pfad-200` (Akzeptanz „Bench 200 Anfragen/s im Budget“, §30 Simulation ≤ 3 ms je Tick): der
 * Pfaddienst auf einer generierten Welt (Klein, Seed 30) – 200 Anfragen je Sekunde (60 Ticks) zwischen begehbaren
 * Kacheln der aktiven Zone (7 × 7 Chunks um einen Ort landeinwärts vom Startstrand), gemischt kurz (≤ 24 Kacheln,
 * 60 %), mittel (24–60, 25 %) und weit (≥ 60, 15 %), Landtiere, Amphibien und Flieger, jede zehnte Anfrage mit Türen.
 *
 * Mit Lichtmaske (M6-16b): in der Zone brennen Lagerfeuer und Fackeln (eine Vollmondnacht, das hellste Umgebungslicht
 * der Nacht), und jede vierte Anfrage kommt von Schattenbrut, die Licht über `avoidLightAbove` meidet. Ihre Kacheln
 * markiert der Abtaster des Spiels (`lightListSampler` über eine `GameplayLightMap` mit Verdeckung durch die Kollision),
 * und die Karte beginnt wie im Spiel jeden Tick einen neuen Stempel – die Lichtwerte werden je Tick neu berechnet. Die
 * Dienstzeit enthält diese Auswertung der Lichtkarte. Die Allokationsmessung liest dieselben Werte aus einer Tabelle, die
 * der erste Durchlauf füllte (Lichter, Umgebungslicht und Verdeckung ändern sich im Bench nicht, die Marken sind
 * dieselben): sie misst den Pfaddienst mit seinem Abtaster; was die Lichtkarte je Auswertung anlegt, gehört dem
 * Lichtsystem.
 *
 * Gemessen wird der schlechteste Fall: ohne Worker rechnet die Simulation jeden Pfad selbst an seinem Bereit-Tick
 * (`PathService` ohne Job-Queue) – im Browser erledigt das der Worker, dem Hauptthread bleiben Schnappschuss und
 * Übernahme. Je Tick zählt die ganze Arbeit des Dienstes: Aufnahme, Schnappschüsse, Suchen, Auslieferung. Dazu die
 * Wartezeit bis zum Bereit-Tick (das Tick-Budget muss 200/s ohne Rückstau tragen) und die Allokation je Anfrage im
 * eingeschwungenen Zustand: dieselbe Anfragefolge ein zweites Mal, wenn Pools und Caches warm sind.
 */
import { BALANCE } from '../../src/content/balance';
import { Rng } from '../../src/engine/rng';
import { LIGHT_FULL_CIRCLE } from '../../src/engine/lightFalloff';
import { worldFor } from '../../src/game/worldCache';
import { BLOCK_ALL, CollisionGrid } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import { GameplayLightMap, type MapLight } from '../../src/world/lightmap/lightmap';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SHIFT, CHUNK_SIZE, TILE_PX, packChunkId, type Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';
import { lightListSampler, type TileLightLevels } from '../../src/world/path/light';
import { PathService } from '../../src/world/path/service';
import { createPathJobs } from '../../src/world/path/worker';
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
/** Anteil der Anfragen von Schattenbrut (Landtiere, die Licht über `BALANCE.creatures.shadowBrood.avoidLightAbove` meiden). */
const LIGHT_SHARE = 0.25;
/** Lichter in der Zone: ein Lager und ein Weiler – Lagerfeuer und Fackeln auf Ständern (§12.2). */
const CAMPFIRES = 4;
const TORCHES = 12;
/** Umgebungslicht der Nacht: Vollmond, das hellste der Nacht (§12.1 „Nacht 0,05–0,12“) – Schranke und Wert jeder Kachel. */
const NIGHT_AMBIENT = BALANCE.calendar.nightAmbientMax;
/** Salz der Zufallsfolgen von Lichtern und Lichtanfragen: die Anfragefolge selbst bleibt die ohne Licht. */
const LIGHT_SALT = 0x6c69;

/** The worker route's queue in this thread has no frame budget to keep: every frame runs what is queued. */
const NO_CLOCK = (): number => 0;

/** Laufparameter des Szenarios: 600 Ticks Aufwärmen, drei Messfenster zu 1 200 Ticks, 1 200 Ticks Allokationsmessung. */
export const PATH_BENCH_OPTIONS: PathBenchOptions = { warmupTicks: 600, windows: 3, windowTicks: 1200, allocTicks: 1200, seed: REQUEST_SEED };
/**
 * Laufparameter des Worker-Wegs (M6-Review perf:path-worker-message-alloc): dieselbe Anfragefolge mit der Job-Queue des
 * Pfad-Workers; gemessen werden nur der neue Pufferspeicher je Anfrage und die Nachrichten des Dienstes (die Dienstzeit
 * misst der Lauf ohne Worker).
 */
export const PATH_WORKER_BENCH_OPTIONS: PathBenchOptions = { warmupTicks: 600, windows: 1, windowTicks: 600, allocTicks: 1200, seed: REQUEST_SEED, route: 'worker' };

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
  /**
   * Der Weg der Pfade: `simulation` (ohne Job-Queue, der schlechteste Fall der Dienstzeit) oder `worker` – der Weg des
   * Browsers mit der Job-Queue des Pfad-Workers, hier mit ihrem Ausführer im selben Thread (`createPathJobs` ohne
   * `spawn`, das Protokoll des Workers: Nachrichten als strukturierte Klone, ihre Puffer verschoben). `PathService.frame()`
   * läuft nach jedem Tick wie im Bild. Vorgabe `simulation`.
   */
  readonly route?: 'simulation' | 'worker';
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
  /**
   * Neuer Pufferspeicher (ArrayBuffer-Inhalte, `process.memoryUsage().arrayBuffers`) je Anfrage in der Allokationsmessung
   * [B]: je Tick der Zuwachs, Ticks mit Speicherbereinigung zählen nicht (NaN ohne Messung). Ein kopierter Schnappschuss
   * wären Kilobytes.
   */
  readonly buffersPerRequest: number;
  /** Ergebnisse, die der Worker vor dem Bereit-Tick lieferte, und Nachrichten, die der Dienst dafür anlegte. */
  readonly byWorker: number;
  readonly jobMessages: number;
  /** Anfragen mit Lichtmaske (Schattenbrut). */
  readonly lightRequests: number;
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
  /** 1 = the request avoids light (shadow brood, a land mover without doors). */
  readonly light: Uint8Array;
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
    light: new Uint8Array(count),
  };
  const lightRng = new Rng(seed ^ LIGHT_SALT);
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
    plan.light[i] = lightRng.next() < LIGHT_SHARE ? 1 : 0;
  }
  return plan;
}

/** A light standing on tile (tx, ty) of the surface (a torch on its stake or a camp fire), steady. */
function placedLight(id: number, tx: number, ty: number, fire: boolean): MapLight {
  const L = BALANCE.light;
  const radiusTiles = fire ? L.campfire.radiusTiles : L.torch.radiusTiles;
  return {
    id,
    layer: 0,
    windowTiles: radiusTiles,
    x: (tx + 0.5) * TILE_PX,
    y: (ty + 0.5) * TILE_PX,
    height: fire ? L.campfire.flameHeightPx : L.torch.flameHeightPx.stand,
    radius: radiusTiles * TILE_PX,
    intensity: fire ? L.campfire.intensity : L.torch.intensity,
    flicker: 0,
    seed: id,
    coneDirection: 0,
    coneAngle: LIGHT_FULL_CIRCLE,
  };
}

/** The lights of the zone on walkable tiles, drawn from the request seed. */
function placeLights(seed: number, walkable: Int32Array): MapLight[] {
  const rng = new Rng(seed ^ (LIGHT_SALT << 1));
  const spots = walkable.length >> 1;
  const lights: MapLight[] = [];
  for (let i = 0; i < CAMPFIRES + TORCHES; i++) {
    const s = rng.int(0, spots);
    lights.push(placedLight(i + 1, walkable[2 * s] as number, walkable[2 * s + 1] as number, i < CAMPFIRES));
  }
  return lights;
}

/**
 * The light levels of the bench's surface: the light map's, each kept per tile as it is asked (NaN = not asked yet);
 * with `replay` the kept ones are read back (see module comment). One object for both, so the sampler's call of
 * `tileLevel` has one target, as with the light map in the game.
 */
class KeptLightLevels implements TileLightLevels {
  replay = false;
  private readonly kept: Float64Array;

  constructor(
    private readonly map: TileLightLevels,
    private readonly worldTiles: number,
  ) {
    this.kept = new Float64Array(worldTiles * worldTiles).fill(Number.NaN);
  }

  tileLevel(layer: Layer, tx: number, ty: number): number {
    if (layer !== 0 || tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) throw new RangeError(`Bench pfad: Licht der Kachel ${layer}:${tx}:${ty} außerhalb der Welt`);
    const i = ty * this.worldTiles + tx;
    if (this.replay) {
      const kept = this.kept[i] as number;
      if (Number.isNaN(kept)) throw new Error(`Bench pfad: Licht der Kachel ${layer}:${tx}:${ty} fehlt in der Tabelle des ersten Durchlaufs`);
      return kept;
    }
    const level = this.map.tileLevel(layer, tx, ty);
    this.kept[i] = level;
    return level;
  }
}

/** Runs the path service under 200 requests/s (see module comment). */
export function runPathBench(w: PathBenchWorld, o: PathBenchOptions): PathBenchResult {
  let tick = 0;
  // Chunks by packed id: the bench's chunks lie on the surface, whose ids are small integers (no lookup allocates).
  const source = { get: (layer: Layer, cx: number, cy: number) => w.chunks.get(packChunkId(layer, cx, cy)) };
  const grid = new CollisionGrid({ chunks: source, worldTiles: w.worldTiles, memo: true, epoch: () => tick });
  const inZone = (_layer: Layer, cx: number, cy: number): boolean => cx >= w.zoneCx0 && cy >= w.zoneCy0 && cx < w.zoneCx0 + w.zoneChunks && cy < w.zoneCy0 + w.zoneChunks;
  const walkable = walkableTiles(grid, w);
  const spots = walkable.length >> 1;
  if (spots < 2) throw new Error('Bench pfad: keine begehbaren Kacheln in der Zone');
  // The night's light as the game's light system gives it to the path service (`lightSystemCreatureLight`).
  const lights = placeLights(o.seed, walkable);
  const lightMap = new GameplayLightMap(
    {
      lights: () => lights,
      ambient: (_layer, _tx, _ty, out, i) => {
        out[i] = NIGHT_AMBIENT;
      },
      occluders: { beginQuery: () => grid.beginQuery(), info: (layer, tx, ty) => grid.info(layer, tx, ty) },
    },
    BALANCE.light.map.movingCacheEntries,
  );
  const levels = new KeptLightLevels(lightMap, w.worldTiles);
  const light = lightListSampler({ lights: () => lights, levels: () => levels, ambientBound: (layer) => (layer === 0 ? NIGHT_AMBIENT : BALANCE.light.map.caveAmbient) });
  const jobs = o.route === 'worker' ? createPathJobs({ now: NO_CLOCK }).jobs : null;
  const service = new PathService({ grid, chunkAllowed: inZone, light, jobs });
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
  let lit = 0;
  const avoidLight = BALANCE.creatures.shadowBrood.avoidLightAbove;
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
    if (plan.light[i] === 1) {
      req.mover = 'land';
      req.opensDoors = false;
      req.avoidLightAbove = avoidLight;
      lit++;
    } else req.avoidLightAbove = null;
  };
  /** One tick of the service: admission, delivery of what is ready, this tick's requests (`due` of them). */
  const step = (due: number): void => {
    lightMap.setStamp(tick);
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
    // The frame after the tick: the worker's queue sends the snapshots and delivers its answers.
    if (jobs !== null) service.frame();
  };
  const tickMs = new Float64Array(timed);
  for (let k = 0; k < timed; k++, tick++) {
    const t0 = performance.now();
    step(dueAt(k));
    tickMs[k] = performance.now() - t0;
  }
  let allocPerRequest = Number.NaN;
  let buffersPerRequest = Number.NaN;
  if (o.allocTicks > 0) {
    // The same request sequence once more – pools, tile words, portals and legs are warm now, the code optimized, every
    // light level the sequence needs is in the table – and measured the time after.
    next = 0;
    for (let k = 0; k < o.allocTicks; k++, tick++) step(dueAt(k));
    next = 0;
    levels.replay = true;
    for (let k = 0; k < o.allocTicks; k++, tick++) step(dueAt(k));
    next = 0;
    const gc = (globalThis as { gc?: () => void }).gc;
    if (gc === undefined) throw new Error('bench: Allokationsmessung braucht `node --expose-gc` (npm run bench startet so)');
    gc();
    // Per tick: the heap growth of the step minus that of an empty pair of readings just before it (the result object
    // of `memoryUsage`). A tick a garbage collection fell into does not count: the heap shrinks across it. A single
    // reading across the whole sequence would miss everything a scavenge collected in between (with the light map's
    // evaluation in the path that was 16 B instead of 4 100 B per request).
    let allocated = 0;
    let measured = 0;
    let buffers = 0;
    let bufferRequests = 0;
    for (let k = 0; k < o.allocTicks; k++, tick++) {
      const firstRequest = requested;
      const emptyBefore = process.memoryUsage().heapUsed;
      const emptyAfter = process.memoryUsage().heapUsed;
      const memory = process.memoryUsage();
      const before = memory.heapUsed;
      const buffersBefore = memory.arrayBuffers;
      step(dueAt(k));
      const after = process.memoryUsage();
      // Buffers a collection freed in between would hide new ones: such ticks do not count (as for the heap).
      if (after.arrayBuffers >= buffersBefore && after.heapUsed >= before) {
        buffers += after.arrayBuffers - buffersBefore;
        bufferRequests += requested - firstRequest;
      }
      if (after.heapUsed < before || emptyAfter < emptyBefore) continue;
      allocated += after.heapUsed - before - (emptyAfter - emptyBefore);
      measured += requested - firstRequest;
    }
    allocPerRequest = Math.max(0, allocated) / Math.max(1, measured);
    buffersPerRequest = buffers / Math.max(1, bufferRequests);
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
    buffersPerRequest,
    byWorker: service.stats.byWorker,
    jobMessages: service.stats.jobMessages,
    lightRequests: lit,
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

/**
 * Die Messwerte des Worker-Wegs: neuer Pufferspeicher je Anfrage – die Nachrichten des Dienstes gehen mit ihren Puffern
 * zum Worker und kommen mit der Antwort zurück, kein Schnappschuss wird je Anfrage kopiert – und die Nachrichten, die der
 * Dienst dafür anlegte (sein Pool wächst mit den gleichzeitig wartenden Aufträgen, nicht mit den Anfragen).
 */
export function pathWorkerMeasurements(r: PathBenchResult): Measurement[] {
  if (r.byWorker < r.delivered) throw new Error(`Bench pfad: auf dem Worker-Weg kamen nur ${r.byWorker} von ${r.delivered} Ergebnissen vom Worker`);
  return [
    { scenario: PATH_BENCH, metric: 'Worker-Weg: Pufferspeicher je Anfrage', value: r.buffersPerRequest, unit: 'B' },
    { scenario: PATH_BENCH, metric: 'Worker-Weg: Nachrichten', value: r.jobMessages, unit: 'Nachrichten' },
  ];
}
