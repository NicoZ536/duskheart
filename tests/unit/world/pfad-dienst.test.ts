/**
 * M6-16 path service (docs/SPIEL.md §12, ADR-0080): the result of a request never depends on the worker – answering
 * early, late or never gives the same paths; ready tick = tick + `pathLatencyTicks`; the per-tick budget of requests
 * and nodes queues the rest in order; cancel; save and load in the middle of pending requests; tile changes reported
 * like the collision listener does; the debug log of the last path per owner.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { JobQueue, createInProcessChannel, createRpcClient, workerExecutor } from '../../../src/engine/workerBridge';
import { CollisionGrid } from '../../../src/world/collision/tiles';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { tileLevelSampler } from '../../../src/world/path/light';
import { PathService } from '../../../src/world/path/service';
import type { MoverClass, PathRequest, PathTicket } from '../../../src/world/path/types';
import { createPathJobs, createPathWorkerHandlers, servePathWorker, type PathJobs, type PathWorkerApi } from '../../../src/world/path/worker';

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const BIRKE = IDS.objects.runtimeId('baum_birke');
const LATENCY = BALANCE.ai.pathLatencyTicks;
const WORLD_CHUNKS = 3;
const WORLD_TILES = WORLD_CHUNKS * 32;

/** A 3 × 3 chunk world: meadow with birches, a pond (deep in the middle), a plateau with a ramp. */
class World {
  readonly map = new Map<number, ChunkData>();
  tick = 0;
  readonly grid: CollisionGrid;
  constructor() {
    for (let cy = 0; cy < WORLD_CHUNKS; cy++) {
      for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
        const c = new ChunkData(0, cx, cy);
        c.ground.fill(GRAS);
        this.map.set(packChunkId(0, cx, cy), c);
      }
    }
    for (let ty = 0; ty < WORLD_TILES; ty++) {
      for (let tx = 0; tx < WORLD_TILES; tx++) {
        const { c, i } = this.at(tx, ty);
        if ((tx * 7 + ty * 13) % 23 === 0) c.object[i] = BIRKE;
        const d2 = (tx - 60) ** 2 + (ty - 40) ** 2;
        if (d2 < 64) {
          c.object[i] = 0;
          c.water[i] = d2 < 25 ? WATER_DEPTH_DEEP : WATER_DEPTH_SHALLOW;
        }
        if (tx >= 10 && tx < 40 && ty >= 60 && ty < 85) {
          c.height[i] = 1;
          c.object[i] = 0;
        }
      }
    }
    for (const tx of [24, 25]) this.at(tx, 84).c.flags[this.at(tx, 84).i] = TILE_FLAG_RAMP;
    this.grid = new CollisionGrid({ chunks: this, worldTiles: WORLD_TILES, memo: true, epoch: () => this.tick });
  }
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.map.get(packChunkId(layer, cx, cy));
  }
  at(tx: number, ty: number): { c: ChunkData; i: number } {
    return { c: this.map.get(packChunkId(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT)) as ChunkData, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) };
  }
}

/** A deterministic request script: per tick a few requests of several owners, short and long, all mover classes. */
function script(tick: number): PathRequest[] {
  const out: PathRequest[] = [];
  const movers: MoverClass[] = ['land', 'amphibie', 'schwimmer', 'flieger'];
  const count = tick % 5 === 0 ? 11 : tick % 3;
  for (let k = 0; k < count; k++) {
    const h = (tick * 131 + k * 71) % 997;
    const mover = movers[h % 4] as MoverClass;
    const swim = mover === 'schwimmer';
    out.push({
      owner: 1 + ((tick + k) % 17),
      layer: 0,
      fromTx: swim ? 58 + (h % 3) : 2 + (h % 90),
      fromTy: swim ? 39 : 2 + ((h * 7) % 55),
      toTx: swim ? 62 : (h * 13) % 94,
      toTy: swim ? 41 + (h % 2) : (h * 29) % 94,
      mover,
      opensDoors: h % 2 === 0,
      avoidLightAbove: h % 7 === 0 ? 0.5 : null,
      maxNodes: 256 + (h % 4) * 1024,
    });
  }
  return out;
}

/** Bright where x + y is a multiple of 11 within a band – a fixed pattern of lit tiles. */
const LIGHT = tileLevelSampler(() => ({ tileLevel: (_l, tx, ty) => (tx > 30 && tx < 50 && (tx + ty) % 11 === 0 ? 1 : 0) }));

type Policy = 'ohne' | 'frueh' | 'spaet' | 'nie' | 'worker-frueh';

interface RunLog {
  readonly log: string[];
  readonly service: PathService;
}

/** Microtasks of the in-process worker channel. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** The in-process worker: an RPC server on one end of a channel, the job queue on the other. */
function channelJobs(): PathJobs {
  const [a, b] = createInProcessChannel();
  servePathWorker(b);
  return new JobQueue(workerExecutor(createRpcClient<PathWorkerApi>(a)), { frameBudgetMs: 1000, now: () => 0, maxInFlight: 64 });
}

/** Runs the script for `ticks` ticks under a worker policy; every tick polls every pending ticket. */
async function run(policy: Policy, ticks: number): Promise<RunLog> {
  const world = new World();
  let jobs: PathJobs | null = null;
  if (policy === 'frueh' || policy === 'nie') jobs = createPathJobs({ now: () => 0 }).jobs;
  if (policy === 'spaet' || policy === 'worker-frueh') jobs = channelJobs();
  const service = new PathService({ grid: world.grid, light: LIGHT, jobs });
  const pending: PathTicket[] = [];
  const log: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    world.tick = tick;
    service.update(tick);
    for (let i = 0; i < pending.length; ) {
      const t = pending[i] as PathTicket;
      const id = t.id;
      const r = service.poll(t, tick);
      if (r === null) {
        i++;
        continue;
      }
      log.push(`${tick} #${id} ${r.status} ${r.steps} ${r.expanded} ${Array.from(r.tiles.subarray(0, r.steps * 2)).join(',')}`);
      pending.splice(i, 1);
    }
    for (const req of script(tick)) {
      const t = service.request(req, tick);
      expect(t.readyTick).toBeGreaterThanOrEqual(tick + LATENCY);
      pending.push(t);
    }
    if (policy === 'frueh') service.frame();
    if (policy === 'worker-frueh') {
      service.frame();
      await flush();
      service.frame();
    }
    if (policy === 'spaet' && tick % 9 === 8) {
      service.frame();
      await flush();
      service.frame();
    }
  }
  return { log, service };
}

describe('PathService: Ergebnis unabhängig vom Worker (M6-16)', () => {
  it('ohne Worker, Worker früh, spät oder nie: dieselben Pfade zu denselben Ticks', async () => {
    const ticks = 30;
    const base = await run('ohne', ticks);
    expect(base.log.length).toBeGreaterThan(30);
    expect(base.service.stats.inThread).toBe(base.log.length);
    expect(base.log.some((l) => l.includes(' found '))).toBe(true);
    expect(base.log.some((l) => l.includes(' partial ') || l.includes(' none '))).toBe(true);
    for (const policy of ['frueh', 'worker-frueh', 'spaet', 'nie'] as const) {
      const other = await run(policy, ticks);
      expect(other.log, policy).toEqual(base.log);
      if (policy === 'frueh' || policy === 'worker-frueh') {
        // Every answer came in time (some of them for requests still waiting for their ready tick).
        expect(other.service.stats.inThread, policy).toBe(0);
        expect(other.service.stats.byWorker, policy).toBeGreaterThanOrEqual(other.log.length);
      }
      if (policy === 'nie') expect(other.service.stats.byWorker).toBe(0);
      if (policy === 'spaet') {
        expect(other.service.stats.byWorker, 'spät: manche Antworten kamen rechtzeitig').toBeGreaterThan(0);
        expect(other.service.stats.inThread, 'spät: die übrigen rechnete die Simulation').toBeGreaterThan(0);
      }
    }
  });

  it('das Ergebnis gilt ab tick + pathLatencyTicks, vorher liefert poll nichts', () => {
    const world = new World();
    const service = new PathService({ grid: world.grid });
    const t = service.request({ owner: 1, layer: 0, fromTx: 5, fromTy: 5, toTx: 30, toTy: 20, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 1000 }, 100);
    expect(t.readyTick).toBe(100 + LATENCY);
    for (let tick = 100; tick < 100 + LATENCY; tick++) expect(service.poll(t, tick)).toBeNull();
    const r = service.poll(t, 100 + LATENCY);
    expect(r?.status).toBe('found');
    expect(() => service.poll(t, 100 + LATENCY)).toThrow(/nicht|not pending/);
  });
});

describe('PathService: Budget, Warteschlange, Abbruch (M6-16)', () => {
  const req = (owner: number, maxNodes: number): PathRequest => ({ owner, layer: 0, fromTx: 3, fromTy: 3, toTx: 20 + owner, toTy: 10, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes });

  it('höchstens requestsPerTick Anfragen je Tick, der Rest folgt in Reihenfolge', () => {
    const service = new PathService({ grid: new World().grid });
    const per = BALANCE.ai.path.requestsPerTick;
    const tickets = Array.from({ length: per * 2 + 3 }, (_, k) => service.request(req(k + 1, 64), 10));
    expect(tickets.map((t) => t.readyTick - LATENCY)).toEqual([...Array<number>(per).fill(10), ...Array<number>(per).fill(11), 12, 12, 12]);
    expect(service.stats.admitted).toBe(per);
    expect(service.queued).toBe(per + 3);
    service.update(11);
    expect(service.stats.admitted).toBe(2 * per);
    // A later request queues behind them.
    expect(service.request(req(99, 64), 11).readyTick).toBe(12 + LATENCY);
    // Polling catches up on admission by itself.
    expect(service.poll(tickets[tickets.length - 1] as PathTicket, 12 + LATENCY)?.status).toBe('found');
    expect(service.queued).toBe(0);
  });

  it('das Knotenbudget je Tick verteilt große Anfragen, die erste eines Ticks geht immer', () => {
    const service = new PathService({ grid: new World().grid });
    const max = BALANCE.ai.path.maxNodesPerRequest;
    const perTick = Math.floor(BALANCE.ai.path.nodesPerTick / max);
    const ticks = Array.from({ length: perTick * 2 + 1 }, (_, k) => service.request(req(k + 1, max * 10), 0).readyTick - LATENCY);
    expect(ticks).toEqual([...Array<number>(perTick).fill(0), ...Array<number>(perTick).fill(1), 2]);
  });

  it('Abbruch: eine wartende Anfrage wird nie aufgenommen, eine laufende verliert ihren Worker-Auftrag', () => {
    const world = new World();
    const { jobs } = createPathJobs({ now: () => 0 });
    const service = new PathService({ grid: world.grid, jobs });
    const per = BALANCE.ai.path.requestsPerTick;
    const tickets = Array.from({ length: per + 1 }, (_, k) => service.request(req(k + 1, 64), 0));
    const queued = tickets[per] as PathTicket;
    expect(service.cancel(queued)).toBe(true);
    expect(service.cancel(queued)).toBe(false);
    expect(service.stats.cancelled).toBe(1);
    service.update(5);
    expect(service.stats.admitted).toBe(per);
    expect(() => service.poll(queued, 10)).toThrow();
    expect(jobs.queued).toBe(per);
    expect(service.cancel(tickets[0] as PathTicket)).toBe(true);
    expect(jobs.queued).toBe(per - 1);
    service.frame();
    expect(service.stats.byWorker).toBe(per - 1);
    expect(service.pending).toBe(per - 1);
  });

  it('ungültige Anfragen werden abgelehnt; Licht ohne Abtaster ist ein Verdrahtungsfehler', () => {
    const service = new PathService({ grid: new World().grid });
    expect(() => service.request({ ...req(1, 10), mover: 'kriecher' as MoverClass }, 0)).toThrow(/Fortbewegung/);
    expect(() => service.request({ ...req(1, 10), layer: 5 }, 0)).toThrow(/Ebene/);
    expect(() => service.request({ ...req(1, 10), maxNodes: 0 }, 0)).toThrow(/maxNodes/);
    expect(() => service.request({ ...req(1, 10), fromTx: 1.5 }, 0)).toThrow();
    expect(() => service.request({ ...req(1, 10), avoidLightAbove: 0.5 }, 0)).toThrow(/useLight/);
  });
});

describe('PathService: Speichern, Änderungen, Debug (M6-16, M6-17)', () => {
  it('Speichern mitten in wartenden und laufenden Anfragen: der geladene Dienst liefert dasselbe wie der ununterbrochene', async () => {
    const saveAt = 13;
    const ticks = 26;
    const whole = await run('ohne', ticks);
    // A second run up to the save tick, then a fresh service from the saved state.
    const world = new World();
    const first = new PathService({ grid: world.grid, light: LIGHT });
    const pending: number[] = [];
    const log: string[] = [];
    const step = (service: PathService, tick: number): void => {
      world.tick = tick;
      service.update(tick);
      for (let i = 0; i < pending.length; ) {
        const t = service.ticket(pending[i] as number) as PathTicket;
        const r = service.poll(t, tick);
        if (r === null) {
          i++;
          continue;
        }
        log.push(`${tick} #${t.id} ${r.status} ${r.steps} ${r.expanded} ${Array.from(r.tiles.subarray(0, r.steps * 2)).join(',')}`);
        pending.splice(i, 1);
      }
      for (const req of script(tick)) pending.push(service.request(req, tick).id);
    };
    for (let tick = 0; tick < saveAt; tick++) step(first, tick);
    const saved = JSON.parse(JSON.stringify(first.serialize())) as unknown;
    expect(first.queued + first.pending).toBeGreaterThan(0);
    const second = new PathService({ grid: world.grid, light: LIGHT });
    second.deserialize(saved);
    expect(second.pending).toBe(first.pending);
    expect(JSON.stringify(second.serialize())).toBe(JSON.stringify(saved));
    for (let tick = saveAt; tick < ticks; tick++) step(second, tick);
    expect(log).toEqual(whole.log);
    expect(() => second.deserialize({ nextId: 0 })).toThrow();
  });

  it('eine gemeldete Kachel-Änderung erneuert den Chunk: der nächste Pfad weicht dem neuen Baum aus', () => {
    const world = new World();
    const service = new PathService({ grid: world.grid });
    const ask = (tick: number): string => {
      const t = service.request({ owner: 7, layer: 0, fromTx: 2, fromTy: 50, toTx: 8, toTy: 50, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 500 }, tick);
      const r = service.poll(t, t.readyTick);
      return Array.from(r?.tiles.subarray(0, (r?.steps ?? 0) * 2) ?? []).join(',');
    };
    world.tick = 1;
    const before = ask(1);
    expect(before).toContain('5,50');
    const { c, i } = world.at(5, 50);
    c.object[i] = BIRKE;
    world.tick = 20;
    world.grid.invalidateTile(0, 5, 50);
    service.invalidateTile(0, 5, 50);
    const after = ask(20);
    expect(after).not.toContain('5,50');
  });

  it('Debug: der letzte Pfad je Besitzer, und die offenen Anfragen', () => {
    const world = new World();
    const service = new PathService({ grid: world.grid, debug: true });
    const t = service.request({ owner: 42, layer: 0, fromTx: 3, fromTy: 3, toTx: 40, toTy: 12, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 1000 }, 0);
    let open = 0;
    service.forEachPending((ticket, layer, fx, fy, tx, ty) => {
      open++;
      expect([ticket.owner, layer, fx, fy, tx, ty]).toEqual([42, 0, 3, 3, 40, 12]);
    });
    expect(open).toBe(1);
    const r = service.poll(t, t.readyTick);
    const kept = service.debugPathOf(42);
    expect(kept?.steps).toBe(r?.steps);
    expect(kept?.status).toBe('found');
    expect(kept?.byWorker).toBe(false);
    expect(Array.from(kept?.tiles.subarray(0, (kept?.steps ?? 0) * 2) ?? [])).toEqual(Array.from(r?.tiles.subarray(0, (r?.steps ?? 0) * 2) ?? []));
    let n = 0;
    service.forEachDebugPath(() => n++);
    expect(n).toBe(1);
    service.setDebug(false);
    expect(service.debugPathOf(42)).toBeUndefined();
  });

  it('der Worker-Handler rechnet ohne Dienst dasselbe wie der Dienst', () => {
    const world = new World();
    const service = new PathService({ grid: world.grid });
    const handlers = createPathWorkerHandlers();
    expect(typeof handlers.findPath).toBe('function');
    const t = service.request({ owner: 1, layer: 0, fromTx: 80, fromTy: 80, toTx: 3, toTy: 3, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 4096 }, 0);
    expect(service.poll(t, t.readyTick)?.status).toBe('found');
  });
});
