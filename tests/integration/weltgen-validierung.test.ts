/**
 * M2-12 acceptance (MASTERPROMPT §9.2.9, world generation step 9): validation and repair – the slow
 * sweeps. They ran in the unit suite until M4-37 and moved here unchanged (ADR-0036: `npm run check`
 * keeps its budget, `npm run verify` runs them); the repairs stay in `tests/unit/world/
 * weltgen-validierung.test.ts`.
 * - 20 seeds (Mittel): the report of every world is free of problems – every region reachable from
 *   the start beach, every beacon site and the Nachtherz with a boss arena, the roads join every
 *   site, every resource at its minimum per tier – and its repair counters add up. The structural
 *   facts are re-checked here from the world data, not only read from the report.
 * - Tile level (Klein): a walker with the collision rules of the game (no swimming, jumping down one
 *   step allowed, ramps and stairs to climb) reaches every region of the main island and every place
 *   on it from the spawn tile through the real chunks – objects never cut a path.
 */
import { describe, expect, it } from 'vitest';
import { WATER_SEA, type ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../src/world/model/coords';
import { CollisionGrid, blocksMover } from '../../src/world/collision/tiles';
import { MAIN_LANDMASS } from '../../src/world/gen/plan/island';
import { generateChunk } from '../../src/world/gen/chunk';
import { BEACON_BIOMES, createCellInfo, type LocationSlot } from '../../src/world/gen/locations';
import { resourceRequirements } from '../../src/world/gen/resources';
import { rampDirections } from '../../src/world/gen/roads';
import { checkStructure, createReachModel } from '../../src/world/gen/validate';
import { generateWorld } from '../../src/world/gen/world';
import { createSurfaceContext } from '../../src/world/gen/worldContext';
import { roadsJoin, rootCell, WALKER, WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

/** The 20 seeds of the acceptance (Mittel). */
const SEEDS = Array.from({ length: 20 }, (_, i) => 20260924 + i * 7_368_787);
/** Largest share of standable main-island land tiles a walker may miss (single tiles in cliff corners). */
const MAX_UNREACHED_SHARE = 0.001;

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
