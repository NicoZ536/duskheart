/**
 * M2-12 acceptance (MASTERPROMPT §9.2.9, world generation step 9): validation and repair.
 * - 20 seeds (Mittel): the report of every world is free of problems – every region reachable from
 *   the start beach, every beacon site and the Nachtherz with a boss arena, the roads join every
 *   site, every resource at its minimum per tier – and its repair counters add up. The structural
 *   facts are re-checked here from the world data, not only read from the report.
 * - Repairs work: plans with ramps or fords taken away get ramps/stairs, fords and bridges back
 *   until every cell is reachable; the resource re-scatter lifts every tier to its minimum; the
 *   structure check notices a missing arena, a missing site and a broken road network.
 * - Tile level (Klein): a walker with the collision rules of the game (no swimming, jumping down one
 *   step allowed, ramps and stairs to climb) reaches every region of the main island and every place
 *   on it from the spawn tile through the real chunks – objects never cut a path.
 */
import { describe, expect, it } from 'vitest';
import { WATER_SEA, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, CollisionGrid, blocksMover, type MoverRules } from '../../../src/world/collision/tiles';
import { cellAtTile, neighbour4 } from '../../../src/world/gen/plan/grid';
import { HEIGHT, WATER } from '../../../src/world/gen/plan/params';
import { MAIN_LANDMASS } from '../../../src/world/gen/plan/island';
import { createTerrainSample, type WorldPlan } from '../../../src/world/gen/plan/index';
import { generateChunk } from '../../../src/world/gen/chunk';
import { BEACON_BIOMES, createCellInfo, slotCellMask, type LocationSlot } from '../../../src/world/gen/locations';
import { OBJECTS_BY_ID, resourceRequirements } from '../../../src/world/gen/resources';
import { rampDirections, roadCellMask, type RoadNetwork } from '../../../src/world/gen/roads';
import { checkStructure, createReachModel, repairReachability, VALIDATION } from '../../../src/world/gen/validate';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';

/** The 20 seeds of the acceptance (Mittel). */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260924 + i * 7_368_787);
/** Generation of a Mittel world takes ≈ 0,4 s alone; parallel test files slow it down. */
const WORLD_TIMEOUT_MS = 30_000;
/** Largest |cos| between a bridge span and the river course (≈ perpendicular). */
const PERPENDICULAR_COS = 1e-6;

/** Start cell of the reachability (the spawn tile on the start beach). */
function rootCell(world: GeneratedWorld, plan: WorldPlan = world.plan): number {
  return cellAtTile(plan.grid, world.spawn.x + 0.5, world.spawn.y + 0.5);
}

/** Cells repairs must leave alone: places and roads (as the generator passes them). */
function avoidMask(world: GeneratedWorld): Uint8Array {
  const avoid = slotCellMask(world.plan.grid, world.locations);
  roadCellMask(world.plan.grid, world.roads).forEach((v, c) => {
    if (v === 1) avoid[c] = 1;
  });
  return avoid;
}

/** Union-find over the roads: whether they join every terminal. */
function roadsJoin(net: RoadNetwork): boolean {
  const parent = new Map<number, number>(net.terminals.map((t) => [t, t]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const r of net.roads) parent.set(find(r.from), find(r.to));
  const roots = new Set(net.terminals.map(find));
  return roots.size === 1;
}

describe('20 Seeds (Mittel): alle Validierungen grün', () => {
  it.each(SEEDS)(
    'Seed %i',
    (seed) => {
      const w = generateWorld(seed, 'medium');
      const r = w.report;
      expect(r.problems).toEqual([]);
      // Every region reachable (plan model), no cell left behind after the repair.
      expect(r.reachability.unreachableAfter).toBe(0);
      const ctx = createSurfaceContext(w.plan);
      const cells = createCellInfo(ctx);
      const model = createReachModel(ctx, cells, w.roads, w.bridges, rampDirections(ctx));
      const structure = checkStructure(w.plan, model, rootCell(w), w.locations, w.roads);
      expect(structure.unreachableRegions).toEqual([]);
      expect(structure.unreachableSlots).toEqual([]);
      // Six beacon sites (one per boss biome) and the Nachtherz, each linked to its own boss arena.
      const sites = w.locations.filter((s) => s.type === 'leuchtfeuer');
      expect(sites.map((s) => s.variant).sort()).toEqual([...BEACON_BIOMES].sort());
      const core = w.locations.filter((s) => s.type === 'nachtherz');
      expect(core).toHaveLength(1);
      for (const s of [...sites, ...core]) {
        const arena = w.locations[s.link] as LocationSlot;
        expect(arena.type).toBe('bossarena');
        expect(arena.link).toBe(s.id);
        expect(arena.level).toBe(s.level);
      }
      expect(w.locations.filter((s) => s.type === 'bossarena')).toHaveLength(BEACON_BIOMES.length + 1);
      // Roads join all seven sites.
      expect(w.roads.terminals).toHaveLength(BEACON_BIOMES.length + 1);
      expect(roadsJoin(w.roads)).toBe(true);
      // Minimum amounts per tier: every tier of the world has requirements, all met.
      const tiers = new Set(w.plan.regions.map((reg) => reg.tier));
      const required = new Set(r.resources.tallies.map((t) => t.tier));
      expect([...required].sort()).toEqual([...tiers].sort());
      expect(r.resources.tallies).toHaveLength(resourceRequirements(w.plan).length);
      for (const t of r.resources.tallies) expect(t.after, `${t.object} auf Stufe ${t.tier}`).toBeGreaterThanOrEqual(t.min);
      // Repair counters of the report.
      const reach = r.reachability;
      expect(r.repairs).toBe(reach.rampsAdded + reach.fordsAdded + reach.bridgesAdded + r.resources.rescattered);
      expect(w.bridges.filter((b) => b.kind === 'reparatur')).toHaveLength(reach.bridgesAdded);
      expect(w.resources.deposits.filter((d) => d.rescatter)).toHaveLength(r.resources.rescattered);
    },
    WORLD_TIMEOUT_MS,
  );
});

describe('Reparatur', () => {
  it('fügt Rampen und Treppen ein, bis jede Zelle erreichbar ist (Pläne ohne Rampen)', () => {
    let added = 0;
    for (const seed of [11, 13, 15]) {
      const w = generateWorld(seed, 'medium');
      const plan: WorldPlan = { ...w.plan, ramps: [] };
      const ctx = createSurfaceContext(plan);
      const cells = createCellInfo(ctx);
      const model = createReachModel(ctx, cells, null, [], rampDirections(ctx));
      const avoid = avoidMask(w);
      const repair = repairReachability(ctx, cells, model, rootCell(w, plan), avoid, 0);
      expect(repair.unreachableBefore).toBeGreaterThan(0);
      expect(repair.unreachableAfter).toBe(0);
      expect(repair.ramps.length).toBeGreaterThan(0);
      const s = createTerrainSample();
      for (const rp of repair.ramps) {
        // A one-level step between edge neighbours, on dry flat tiles, away from places and roads.
        expect(neighbour4(plan.grid, rp.low, rp.dir)).toBe(rp.high);
        expect(plan.level[rp.high]).toBe((plan.level[rp.low] as number) + 1);
        expect(rp.level).toBe(plan.level[rp.low]);
        expect(avoid[rp.low] === 1 || avoid[rp.high] === 1).toBe(false);
        const biome = cells.biome[rp.high] as string;
        expect(rp.kind).toBe((HEIGHT.stairBiomes as readonly string[]).includes(biome) ? 'treppe' : 'rampe');
        for (let y = rp.y; y < rp.y + rp.h; y++) {
          for (let x = rp.x; x < rp.x + rp.w; x++) {
            const t = ctx.terrain.sample(x, y, s);
            expect(t.land && t.water === 0 && t.flags === 0).toBe(true);
          }
        }
      }
      added += repair.ramps.length;
    }
    expect(added).toBeGreaterThan(0);
  }, WORLD_TIMEOUT_MS);

  it('fügt Furten und Brücken über tiefe Flüsse ein (Pläne ohne Furten)', () => {
    let crossings = 0;
    for (const [seed, preset] of [
      [13, 'small'],
      [12, 'medium'],
      [15, 'medium'],
    ] as const) {
      const w = generateWorld(seed, preset);
      const plan: WorldPlan = { ...w.plan, fords: [] };
      const ctx = createSurfaceContext(plan);
      const cells = createCellInfo(ctx);
      const model = createReachModel(ctx, cells, null, [], rampDirections(ctx));
      const repair = repairReachability(ctx, cells, model, rootCell(w, plan), avoidMask(w), 0);
      expect(repair.unreachableBefore).toBeGreaterThan(0);
      expect(repair.unreachableAfter).toBe(0);
      for (const f of repair.fords) {
        const river = plan.rivers[f.river];
        expect(river).toBeDefined();
        expect(river?.width[f.vertex]).toBeLessThanOrEqual(VALIDATION.fordMaxWidth);
        expect(f.level).toBe(river?.level[f.vertex]);
      }
      for (const b of repair.bridges) {
        const river = plan.rivers[b.river];
        expect(b.kind).toBe('reparatur');
        expect(river).toBeDefined();
        // Across the river: centred on a vertex of the course, (nearly) perpendicular to it.
        const i = vertexAt(plan, b.river, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        const last = (river?.xs.length ?? 1) - 1;
        const tx = (river?.xs[Math.min(last, i + 1)] ?? 0) - (river?.xs[Math.max(0, i - 1)] ?? 0);
        const ty = (river?.ys[Math.min(last, i + 1)] ?? 0) - (river?.ys[Math.max(0, i - 1)] ?? 0);
        const sx = b.x1 - b.x0;
        const sy = b.y1 - b.y0;
        const span = Math.hypot(sx, sy);
        expect(Math.abs(tx * sx + ty * sy) / (Math.hypot(tx, ty) * span)).toBeLessThan(PERPENDICULAR_COS);
        expect(span).toBeGreaterThan(WATER.deepRiverWidth);
      }
      crossings += repair.fords.length + repair.bridges.length;
    }
    expect(crossings).toBeGreaterThan(0);
  }, WORLD_TIMEOUT_MS);

  it('streut fehlende Ressourcen lokal nach, bis jede Stufe ihre Mindestmenge hat (Klein)', () => {
    let below = 0;
    for (const seed of [5, 6, 7]) {
      const w = generateWorld(seed, 'small');
      for (const t of w.report.resources.tallies) {
        if (t.before < t.min) below++;
        expect(t.after).toBeGreaterThanOrEqual(t.min);
      }
      const objects = w.resources.objects;
      for (const d of w.resources.deposits.filter((dep) => dep.rescatter)) {
        // Re-scattered deposits lie in a region of their tier whose biome grows the object.
        const region = w.plan.regions[d.region];
        expect(region?.tier).toBe(d.tier);
        expect(OBJECTS_BY_ID.get(objects[d.object] as string)?.biomes).toContain(region?.biome);
      }
    }
    // The check is not vacuous: small worlds need the re-scatter.
    expect(below).toBeGreaterThan(0);
  }, WORLD_TIMEOUT_MS);

  it('die Strukturprüfung bemerkt fehlende Arenen, Stätten und Straßen', () => {
    const w = generateWorld(4242, 'small');
    const ctx = createSurfaceContext(w.plan);
    const cells = createCellInfo(ctx);
    const model = createReachModel(ctx, cells, w.roads, w.bridges, rampDirections(ctx));
    const root = rootCell(w);
    const ok = checkStructure(w.plan, model, root, w.locations, w.roads);
    expect(ok.sitesWithoutArena).toEqual([]);
    expect(ok.missingSites).toEqual([]);
    // An arena turned into something else: its site has no arena.
    const site = w.locations.find((s) => s.type === 'leuchtfeuer') as LocationSlot;
    const noArena = w.locations.map((s) => (s.id === site.link ? { ...s, type: 'gewoelbe' as const } : s));
    expect(checkStructure(w.plan, model, root, noArena, w.roads).sitesWithoutArena).toEqual([site.id]);
    // A beacon site missing.
    const noSite = w.locations.filter((s) => s.id !== site.id);
    expect(checkStructure(w.plan, model, root, noSite, w.roads).missingSites).toEqual([`leuchtfeuer:${site.variant}`]);
    // A broken road network.
    expect(checkStructure(w.plan, model, root, w.locations, { ...w.roads, connected: false }).roadsConnected).toBe(false);
  }, WORLD_TIMEOUT_MS);
});

/** Vertex of river `river` nearest to (x, y) [tiles]. */
function vertexAt(plan: WorldPlan, river: number, x: number, y: number): number {
  const r = plan.rivers[river];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < (r?.xs.length ?? 0); i++) {
    const d = Math.hypot((r?.xs[i] ?? 0) - x, (r?.ys[i] ?? 0) - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A walker that neither swims nor climbs cliffs: jumps down, climbs ramps and stairs (collision rules, ADR-0022). */
const WALKER: MoverRules = { blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID | BLOCK_DEEP_WATER, mode: 'walk', dropDown: true };
/** Largest share of standable main-island land tiles a walker may miss (single tiles in cliff corners). */
const MAX_UNREACHED_SHARE = 0.001;

describe('Kachelebene (Klein): echte Chunks, Kollisionsregeln', () => {
  it.each([20260924, 7])(
    'Seed %i: jede Region und jeder Ort der Hauptinsel ist vom Startstrand zu Fuß erreichbar',
    (seed) => {
      const w = generateWorld(seed, 'small');
      const tiles = w.plan.grid.tiles;
      const n = tiles / CHUNK_SIZE;
      const chunks = new Map<number, ChunkData>();
      for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) chunks.set(cy * n + cx, generateChunk(w, 0, cx, cy));
      const grid = new CollisionGrid({ chunks: { get: (_layer, cx, cy) => chunks.get(cy * n + cx) }, worldTiles: tiles });
      const info = new Uint16Array(tiles * tiles);
      grid.fillInfo(0, 0, 0, tiles, tiles, info);
      // Flood from the spawn tile with the walker's rules.
      const reached = new Uint8Array(tiles * tiles);
      const queue = new Int32Array(tiles * tiles);
      let tail = 0;
      const spawn = w.spawn.y * tiles + w.spawn.x;
      expect((info[spawn] as number) & WALKER.blockMask).toBe(0);
      reached[spawn] = 1;
      queue[tail++] = spawn;
      const DX = [1, 0, -1, 0];
      const DY = [0, 1, 0, -1];
      for (let head = 0; head < tail; head++) {
        const u = queue[head] as number;
        const ux = u % tiles;
        const uy = Math.floor(u / tiles);
        for (let d = 0; d < DX.length; d++) {
          const vx = ux + (DX[d] as number);
          const vy = uy + (DY[d] as number);
          if (vx < 0 || vy < 0 || vx >= tiles || vy >= tiles) continue;
          const v = vy * tiles + vx;
          if (reached[v] === 1 || blocksMover(WALKER, info[u] as number, info[v] as number, 0)) continue;
          reached[v] = 1;
          queue[tail++] = v;
        }
      }
      // Standable main-island land tiles per region and how many were reached.
      const g = w.plan.grid;
      const total = new Map<number, number>();
      const hit = new Map<number, number>();
      let standable = 0;
      let missed = 0;
      for (let ty = 0; ty < tiles; ty++) {
        for (let tx = 0; tx < tiles; tx++) {
          const i = ty * tiles + tx;
          if (((info[i] as number) & WALKER.blockMask) !== 0) continue;
          const c = Math.floor(ty / g.cellTiles) * g.width + Math.floor(tx / g.cellTiles);
          const region = w.plan.region[c] as number;
          if (region < 0 || w.plan.landmass[c] !== MAIN_LANDMASS) continue;
          const chunk = chunks.get(Math.floor(ty / CHUNK_SIZE) * n + Math.floor(tx / CHUNK_SIZE)) as ChunkData;
          if (((chunk.water[(ty % CHUNK_SIZE) * CHUNK_SIZE + (tx % CHUNK_SIZE)] as number) & WATER_SEA) !== 0) continue;
          standable++;
          total.set(region, (total.get(region) ?? 0) + 1);
          if (reached[i] === 1) hit.set(region, (hit.get(region) ?? 0) + 1);
          else missed++;
        }
      }
      const mainRegions = w.plan.regions.filter((r) => r.landmass === MAIN_LANDMASS).map((r) => r.id);
      for (const r of mainRegions) expect(hit.get(r) ?? 0, `Region ${r}`).toBeGreaterThan(0);
      expect(missed / standable).toBeLessThan(MAX_UNREACHED_SHARE);
      // Every place of the main island: its centre tile is reached.
      for (const s of w.locations) {
        if (s.landmass !== MAIN_LANDMASS) continue;
        expect(reached[s.y * tiles + s.x], `${s.type} ${s.id}`).toBe(1);
      }
    },
    WORLD_TIMEOUT_MS,
  );
});
