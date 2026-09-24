/**
 * M2-05 / M2-06 (world plan step 3, MASTERPROMPT §9.2.3): biome assignment by constraint solver.
 * Every rule is checked over 20 seeds × 3 sizes with independent re-implementations (no solver code
 * is reused for the checks):
 * - Grundregeln (M2-05): Grünhain start on the south coast, tier grows with the graph distance
 *   (with jitter), every biome several times, no tier skipped.
 * - Klimaregeln (M2-06): Salzküste as coastal ring, Frostkamm north or high, Glutsand dry in the
 *   south/east and away from the Nebelmoor, Aschenschlund next to Frostkamm or Glutsand, Scherbenhain
 *   as ring around the Nachtherz in the farthest region.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { isolatedVolcanicAreas, regionGraph, unreachableByTier, missingTiers } from '../../../src/world/gen/plan/biomes';
import { BIOME_ROLES, BIOME_SOLVER, PLAN_MAX_ATTEMPTS } from '../../../src/world/gen/plan/params';
import { MAX_TIER, PLAN_BIOME_IDS, PlanConstraintError, neighbour4, planBiomeStage, type PlanBiomeStage } from '../../../src/world/gen/plan';
import type { WorldSizePreset } from '../../../src/content/balance';

const SEEDS = Array.from({ length: 20 }, (_, i) => 3 + i * 15485863);
const { start: GRUENHAIN, ring: SALZKUESTE, wet: NEBELMOOR, cold: FROSTKAMM, dry: GLUTSAND, volcanic: ASCHENSCHLUND, coreRing: SCHERBENHAIN, core: NACHTHERZ } = BIOME_ROLES;

/** The stage the world plan uses: the first attempt whose biome rules are satisfiable. */
function stage(seed: number, preset: WorldSizePreset): PlanBiomeStage & { attempt: number } {
  for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
    try {
      return { ...planBiomeStage(seed, attempt, preset), attempt };
    } catch (e) {
      if (!(e instanceof PlanConstraintError)) throw e;
    }
  }
  throw new Error(`seed ${seed} ${preset}: no plan attempt satisfies the biome rules`);
}

/** Connected set reachable from `start` through regions accepted by `ok`. */
function reach(neighbours: readonly (readonly number[])[], start: number, ok: (r: number) => boolean): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const u = queue.pop() as number;
    for (const v of neighbours[u] as readonly number[]) {
      if (seen.has(v) || !ok(v)) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  return seen;
}

/** Spearman rank correlation. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (v: readonly number[]): number[] => {
    const order = v.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
    const r = new Array<number>(v.length).fill(0);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && (order[j + 1] as { x: number }).x === (order[i] as { x: number }).x) j++;
      for (let k = i; k <= j; k++) r[(order[k] as { i: number }).i] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += ((ra[i] as number) - ma) * ((rb[i] as number) - mb);
    va += ((ra[i] as number) - ma) ** 2;
    vb += ((rb[i] as number) - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

/** Independent progression distance: Dijkstra over centroid distances, ring and sea crossings weighted. */
function distances(s: PlanBiomeStage): number[] {
  const { regions, neighbours, edges } = s.regions;
  const crossing = new Set(edges.filter((e) => e.crossing).map((e) => `${e.a}:${e.b}`));
  const dist = regions.map(() => Infinity);
  const done = regions.map(() => false);
  dist[s.biomes.start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && (dist[i] as number) < Infinity && (u < 0 || (dist[i] as number) < (dist[u] as number))) u = i;
    if (u < 0) break;
    done[u] = true;
    const a = regions[u] as (typeof regions)[number];
    for (const v of neighbours[u] as readonly number[]) {
      const b = regions[v] as (typeof regions)[number];
      let w = Math.hypot(b.centroidX - a.centroidX, b.centroidY - a.centroidY);
      if (b.kind === 'band') w *= BIOME_SOLVER.ringDistanceFactor;
      if (crossing.has(`${Math.min(u, v)}:${Math.max(u, v)}`)) w *= BIOME_SOLVER.crossingDistanceFactor;
      if ((dist[u] as number) + w < (dist[v] as number)) dist[v] = (dist[u] as number) + w;
    }
  }
  return dist;
}

describe('biome constraint solver – rule helpers', () => {
  // Path graph 0 – 1 – 2 – 3.
  const path = [[1], [0, 2], [1, 3], [2]];
  it('counts regions only reachable through a harder tier', () => {
    expect(unreachableByTier(regionGraph(path), [0, 1, 2, 3], 0, 3)).toBe(0);
    // Region 2 (tier 1) hides behind region 1 (tier 3): cut off for k = 1 and k = 2.
    expect(unreachableByTier(regionGraph(path), [0, 3, 1, 3], 0, 3)).toBe(2);
  });
  it('counts missing tiers', () => {
    expect(missingTiers([0, 1, 2, 3], 3)).toBe(0);
    expect(missingTiers([0, 0, 3, 3], 3)).toBe(2);
  });
  it('counts Aschenschlund areas without Frostkamm or Glutsand neighbour', () => {
    const cluster = new Int32Array(4);
    const queue = new Int32Array(4);
    const noBand = [0, 0, 0, 0];
    // 5 – 5 – 3: one area, borders Frostkamm.
    expect(isolatedVolcanicAreas(regionGraph(path), [2, 5, 5, 3], noBand, cluster, queue)).toBe(0);
    // 5 – 2 – 5 – 1: two areas, neither borders tier 3 or 4.
    expect(isolatedVolcanicAreas(regionGraph(path), [5, 2, 5, 1], noBand, cluster, queue)).toBe(2);
  });
});

describe('biome assignment (M2-05, M2-06)', () => {
  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const stages = SEEDS.map((seed) => ({ seed, ...stage(seed, preset) }));
      const biomeOf = (s: PlanBiomeStage, r: number): string => s.biomes.biome[r] as string;

      it('is deterministic and needs at most a retry', () => {
        const again = stage(SEEDS[0] as number, preset);
        expect(Array.from(again.biomes.tier)).toEqual(Array.from((stages[0] as PlanBiomeStage).biomes.tier));
        for (const s of stages) {
          expect(s.attempt).toBeLessThan(PLAN_MAX_ATTEMPTS);
          expect(s.biomes.attempts).toBeLessThanOrEqual(BIOME_SOLVER.attempts);
        }
      });

      describe('Grundregeln (M2-05)', () => {
        it('starts in Grünhain on the south coast', () => {
          for (const s of stages) {
            const start = s.regions.regions[s.biomes.start];
            expect(start?.kind).toBe('interior');
            expect(start?.landmass).toBe(0);
            expect(biomeOf(s, s.biomes.start)).toBe(GRUENHAIN);
            expect(s.biomes.tier[s.biomes.start]).toBe(0);
            expect((s.regions.neighbours[s.biomes.start] as readonly number[]).some((v) => biomeOf(s, v) === SALZKUESTE)).toBe(true);
            // South: the start lies in the southern 40 % of the main island's land.
            const ys: number[] = [];
            for (let c = 0; c < s.regions.grid.count; c++) if (s.island.landmass[c] === 0) ys.push(Math.floor(c / s.regions.grid.width));
            ys.sort((a, b) => a - b);
            const southQuantile = ((ys[Math.floor(ys.length * 0.6)] as number) + 0.5) * s.regions.grid.cellTiles;
            expect(start?.centroidY).toBeGreaterThanOrEqual(southQuantile);
          }
        });

        it('raises the tier with the graph distance to the start, with jitter', () => {
          let inversions = 0;
          const rhos: number[] = [];
          for (const s of stages) {
            const dist = distances(s);
            expect(Array.from(s.biomes.distance)).toEqual(dist.map((d) => expect.closeTo(d, 6)));
            const inland = s.regions.regions.filter((r) => r.kind === 'interior');
            const rho = spearman(
              inland.map((r) => dist[r.id] as number),
              inland.map((r) => s.biomes.tier[r.id] as number),
            );
            rhos.push(rho);
            expect(rho).toBeGreaterThan(0.6);
            for (const a of inland) for (const b of inland) if ((dist[a.id] as number) < (dist[b.id] as number) && (s.biomes.tier[a.id] as number) > (s.biomes.tier[b.id] as number)) inversions++;
          }
          // On average the distance explains the tier well …
          expect(rhos.reduce((a, b) => a + b, 0) / rhos.length).toBeGreaterThan(0.8);
          // … but the jitter keeps the tier from being a pure step function of the distance.
          expect(inversions).toBeGreaterThan(0);
        });

        it('places every biome several times (the Nachtherz is the one wound)', () => {
          for (const s of stages) {
            const counts = new Map<string, number>();
            for (const b of s.biomes.biome) counts.set(b, (counts.get(b) ?? 0) + 1);
            for (const id of PLAN_BIOME_IDS) {
              if (id === NACHTHERZ) expect(counts.get(id)).toBe(1);
              else expect(counts.get(id) ?? 0).toBeGreaterThanOrEqual(BIOME_SOLVER.minRegionsPerBiome);
            }
          }
        });

        it('skips no tier: every tier exists and opens after the one below', () => {
          for (const s of stages) {
            const { neighbours } = s.regions;
            const tier = s.biomes.tier;
            for (let t = 0; t <= MAX_TIER; t++) expect(Array.from(tier)).toContain(t);
            // For every k, the regions of tier ≤ k hang together with the start.
            for (let k = 0; k <= MAX_TIER; k++) {
              const easy = tier.filter((t) => t <= k).length;
              expect(reach(neighbours, s.biomes.start, (r) => (tier[r] as number) <= k).size).toBe(easy);
            }
            // Progression: with gear of the highest tier seen, the next tier is enterable; everything opens up.
            let best = 0;
            let open = reach(neighbours, s.biomes.start, (r) => (tier[r] as number) <= best + 1);
            for (;;) {
              const next = Math.max(...[...open].map((r) => tier[r] as number));
              if (next === best) break;
              best = next;
              open = reach(neighbours, s.biomes.start, (r) => (tier[r] as number) <= best + 1);
            }
            expect(open.size).toBe(s.regions.regions.length);
          }
        });
      });

      describe('Klimaregeln (M2-06)', () => {
        it('lays the Salzküste as a ring of tier 0–2 along the whole coast', () => {
          for (const s of stages) {
            const { regions, neighbours, edges, grid } = s.regions;
            for (const r of regions) {
              expect(biomeOf(s, r.id) === SALZKUESTE).toBe(r.kind === 'band');
              if (r.kind === 'band') expect(s.biomes.tier[r.id]).toBeLessThanOrEqual(2);
            }
            let inlandShore = 0;
            for (let c = 0; c < grid.count; c++) {
              const r = s.regions.region[c] as number;
              if (r < 0 || s.island.landmass[c] !== 0) continue;
              for (let d = 0; d < 4; d++) {
                const n = neighbour4(grid, c, d);
                if (n >= 0 && s.island.land[n] === 0 && biomeOf(s, r) !== SALZKUESTE) inlandShore++;
              }
            }
            expect(inlandShore).toBe(0);
            // Ring: the main island's Salzküste is one connected band (cells and segments over land) that
            // holds the whole shore, so it separates the inland from the sea.
            const ringCell = (c: number): boolean => s.island.landmass[c] === 0 && s.regions.region[c] !== -1 && biomeOf(s, s.regions.region[c] as number) === SALZKUESTE;
            let first = -1;
            let ringCells = 0;
            for (let c = 0; c < grid.count; c++) {
              if (!ringCell(c)) continue;
              ringCells++;
              if (first < 0) first = c;
            }
            const cellNeighbours = (c: number): number[] => [0, 1, 2, 3].map((d) => neighbour4(grid, c, d)).filter((n) => n >= 0 && ringCell(n));
            const connected = reach(Array.from({ length: grid.count }, (_, c) => (ringCell(c) ? cellNeighbours(c) : [])), first, () => true);
            expect(connected.size).toBe(ringCells);
            const landEdge = new Set(edges.filter((e) => !e.crossing).map((e) => `${e.a}:${e.b}`));
            const ringOnMain = regions.filter((r) => r.kind === 'band' && r.landmass === 0).map((r) => r.id);
            const inRing = new Set(ringOnMain);
            const landNeighbours = (u: number): number[] => (neighbours[u] as readonly number[]).filter((v) => inRing.has(v) && landEdge.has(`${Math.min(u, v)}:${Math.max(u, v)}`));
            expect(reach(neighbours.map((_, u) => landNeighbours(u)), ringOnMain[0] as number, () => true).size).toBe(ringOnMain.length);
          }
        });

        it('puts the Frostkamm in the north or up high', () => {
          for (const s of stages) {
            for (const r of s.regions.regions) {
              if (biomeOf(s, r.id) !== FROSTKAMM) continue;
              const north = r.centroidY < s.climate.centerY;
              const high = (s.climate.regionRelief[r.id] as number) >= BIOME_SOLVER.highRelief;
              expect(north || high).toBe(true);
            }
          }
        });

        it('keeps the Glutsand dry in the south or east and away from the Nebelmoor', () => {
          for (const s of stages) {
            const moist = (id: string): number[] => s.regions.regions.filter((r) => biomeOf(s, r.id) === id).map((r) => s.climate.regionMoisture[r.id] as number);
            for (const r of s.regions.regions) {
              if (biomeOf(s, r.id) !== GLUTSAND) continue;
              expect(r.centroidX > s.climate.centerX || r.centroidY > s.climate.centerY).toBe(true);
              expect(s.climate.regionMoisture[r.id]).toBeLessThanOrEqual(BIOME_SOLVER.dryMoisture);
              expect((s.regions.neighbours[r.id] as readonly number[]).some((v) => biomeOf(s, v) === NEBELMOOR)).toBe(false);
            }
            const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
            expect(mean(moist(GLUTSAND))).toBeLessThan(mean(moist(NEBELMOOR)));
          }
        });

        it('borders every Aschenschlund area with Frostkamm or Glutsand', () => {
          for (const s of stages) {
            const { neighbours } = s.regions;
            const done = new Set<number>();
            for (const r of s.regions.regions) {
              if (biomeOf(s, r.id) !== ASCHENSCHLUND || done.has(r.id)) continue;
              const area = reach(neighbours, r.id, (v) => biomeOf(s, v) === ASCHENSCHLUND);
              for (const v of area) done.add(v);
              const borders = [...area].some((u) => (neighbours[u] as readonly number[]).some((v) => biomeOf(s, v) === FROSTKAMM || biomeOf(s, v) === GLUTSAND));
              expect(borders).toBe(true);
            }
          }
        });

        it('rings the Nachtherz in the farthest region with Scherbenhain', () => {
          for (const s of stages) {
            const { neighbours, regions } = s.regions;
            const core = s.biomes.core;
            expect(biomeOf(s, core)).toBe(NACHTHERZ);
            expect(s.biomes.tier[core]).toBe(MAX_TIER);
            const around = neighbours[core] as readonly number[];
            expect(around.length).toBeGreaterThanOrEqual(2);
            for (const v of around) expect(biomeOf(s, v)).toBe(SCHERBENHAIN);
            // Every Scherbenhain region belongs to the ring: next to the Nachtherz or to a ring region.
            for (const r of regions) {
              if (biomeOf(s, r.id) !== SCHERBENHAIN) continue;
              const nb = neighbours[r.id] as readonly number[];
              expect(nb.includes(core) || nb.some((v) => around.includes(v))).toBe(true);
            }
            expect(reach(neighbours, core, (v) => biomeOf(s, v) === SCHERBENHAIN).size).toBe(regions.filter((r) => biomeOf(s, r.id) === SCHERBENHAIN).length + 1);
            // Farthest: no other inland region of the main island away from the coast is farther from the start.
            const dist = distances(s);
            for (const r of regions) {
              if (r.kind !== 'interior' || r.landmass !== 0 || r.id === s.biomes.start) continue;
              const nb = neighbours[r.id] as readonly number[];
              if (nb.length < 2 || nb.includes(s.biomes.start) || nb.some((v) => regions[v]?.kind === 'band')) continue;
              expect(dist[r.id] as number).toBeLessThanOrEqual(dist[core] as number);
            }
          }
        });
      });
    });
  }
});
