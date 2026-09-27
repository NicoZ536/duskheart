/**
 * M2-12 acceptance (MASTERPROMPT §9.2.9, world generation step 9): repairs. The slow sweeps of the
 * acceptance – 20 seeds (Mittel) with every validation green, and the tile level (Klein: a walker reaches
 * every region and place of the main island through the real chunks) – run in the integration project
 * (`tests/integration/weltgen-validierung.test.ts`, M4-37, ADR-0036).
 * - Repairs work: plans with ramps or fords taken away get ramps/stairs, fords and bridges back
 *   until every cell is reachable; the resource re-scatter lifts every tier to its minimum; the
 *   structure check notices a missing arena, a missing site and a broken road network.
 */
import { describe, expect, it } from 'vitest';
import { neighbour4 } from '../../../src/world/gen/plan/grid';
import { HEIGHT, WATER } from '../../../src/world/gen/plan/params';
import { createTerrainSample, type WorldPlan } from '../../../src/world/gen/plan/index';
import { createCellInfo, type LocationSlot } from '../../../src/world/gen/locations';
import { OBJECTS_BY_ID } from '../../../src/world/gen/resources';
import { rampDirections } from '../../../src/world/gen/roads';
import { checkStructure, createReachModel, repairReachability, VALIDATION } from '../../../src/world/gen/validate';
import { generateWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';
import { avoidMask, rootCell, WORLD_TIMEOUT_MS } from './weltgen-hilfen';

/** Largest |cos| between a bridge span and the river course (≈ perpendicular). */
const PERPENDICULAR_COS = 1e-6;

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
