/**
 * M2-07 (world plan step 4, MASTERPROMPT §9.1/§9.2.4): height levels 0–4 (region base + noise),
 * cliffs, ramps and stairs; every level reachable over ramps and stairs; −3 °C per level.
 * Plan level over 12 seeds × 3 sizes, tile level (the chunk generator's view) on two Klein worlds.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS } from '../../../src/world/model/chunk';
import { BIOME_ROLES, HEIGHT } from '../../../src/world/gen/plan/params';
import { MAX_LEVEL, cellAtTile, createPlanSampler, createTerrainSample, generateWorldPlan, heightTemperatureOffsetC, neighbour4, type WorldPlan } from '../../../src/world/gen/plan';

const SEEDS = Array.from({ length: 12 }, (_, i) => 5 + i * 32452843);

/** Plan cells reachable per landmass: same level freely, one level only across a ramp or stairs. */
function unreachableCells(plan: WorldPlan): { unreachable: number; levels: Set<number>[] } {
  const { grid, level, landmass, lake } = plan;
  const ramp = new Set<string>();
  for (const r of plan.ramps) {
    ramp.add(`${r.low}:${r.high}`);
    ramp.add(`${r.high}:${r.low}`);
  }
  const walkable = (c: number): boolean => landmass[c] !== -1 && (lake[c] as number) < 0;
  const seen = new Uint8Array(grid.count);
  const levels: Set<number>[] = [];
  let unreachable = 0;
  const startOf = new Map<number, number>();
  // Start each landmass at the start region's seed (main island) or at its first walkable cell.
  const startRegion = plan.regions[plan.start];
  if (startRegion !== undefined) startOf.set(0, cellAtTile(grid, startRegion.seedX, startRegion.seedY));
  for (let c = 0; c < grid.count; c++) if (walkable(c) && !startOf.has(landmass[c] as number)) startOf.set(landmass[c] as number, c);
  for (const [lm, start] of startOf) {
    const queue = [start];
    seen[start] = 1;
    const found = new Set<number>([level[start] as number]);
    while (queue.length > 0) {
      const c = queue.pop() as number;
      for (let d = 0; d < 4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || seen[n] === 1 || !walkable(n)) continue;
        const diff = Math.abs((level[n] as number) - (level[c] as number));
        if (diff > 1 || (diff === 1 && !ramp.has(`${c}:${n}`))) continue;
        seen[n] = 1;
        found.add(level[n] as number);
        queue.push(n);
      }
    }
    levels[lm] = found;
  }
  for (let c = 0; c < grid.count; c++) if (walkable(c) && seen[c] === 0) unreachable++;
  return { unreachable, levels };
}

describe('height field, cliffs, ramps and stairs (M2-07)', () => {
  it('lowers the temperature by 3 °C per level (§9.1)', () => {
    expect(BALANCE.world.temperaturePerHeightLevelC).toBe(-3);
    for (let l = 0; l <= MAX_LEVEL; l++) expect(heightTemperatureOffsetC(l)).toBe(-3 * l);
    expect(MAX_LEVEL).toBe(4);
  });

  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const plans = SEEDS.map((seed) => generateWorldPlan(seed, preset));

      it('has levels 0–4, all of them on the main island, and sea at level 0', () => {
        for (const plan of plans) {
          const counts = new Array<number>(MAX_LEVEL + 1).fill(0);
          let bad = 0;
          for (let c = 0; c < plan.grid.count; c++) {
            const l = plan.level[c] as number;
            if (l > MAX_LEVEL || (plan.land[c] === 0 && l !== 0)) bad++;
            if (plan.landmass[c] === 0) counts[l] = (counts[l] as number) + 1;
          }
          expect(bad).toBe(0);
          for (const n of counts) expect(n).toBeGreaterThan(0);
        }
      });

      it('reaches every level of every landmass over ramps and stairs only', () => {
        for (const plan of plans) {
          const { unreachable, levels } = unreachableCells(plan);
          expect(unreachable).toBe(0);
          expect([...(levels[0] ?? [])].sort()).toEqual([0, 1, 2, 3, 4]);
        }
      });

      it('puts ramps and stairs on one-level steps, centred on the cliff, stairs in rock biomes', () => {
        const kinds = new Set<string>();
        for (const plan of plans) {
          const { grid } = plan;
          for (const r of plan.ramps) {
            kinds.add(r.kind);
            expect(neighbour4(grid, r.low, r.dir)).toBe(r.high);
            expect(plan.level[r.low]).toBe(r.level);
            expect(plan.level[r.high]).toBe(r.level + 1);
            expect(plan.lake[r.low]).toBe(-1);
            expect(plan.lake[r.high]).toBe(-1);
            expect([r.w, r.h].sort()).toEqual([HEIGHT.rampWidthTiles, HEIGHT.rampDepthTiles].sort());
            // Centred on the shared cell edge.
            const lx = ((r.low % grid.width) + 0.5) * grid.cellTiles;
            const ly = (Math.floor(r.low / grid.width) + 0.5) * grid.cellTiles;
            const hx = ((r.high % grid.width) + 0.5) * grid.cellTiles;
            const hy = (Math.floor(r.high / grid.width) + 0.5) * grid.cellTiles;
            expect(r.x + r.w / 2).toBe((lx + hx) / 2);
            expect(r.y + r.h / 2).toBe((ly + hy) / 2);
            const biome = plan.regions[plan.region[r.high] as number]?.biome ?? '';
            expect(r.kind === 'treppe').toBe((HEIGHT.stairBiomes as readonly string[]).includes(biome));
          }
        }
        expect([...kinds].sort()).toEqual(['rampe', 'treppe']);
      });

      it('keeps cliffs: most level steps are walls, not ramps', () => {
        for (const plan of plans) {
          let steps = 0;
          for (let c = 0; c < plan.grid.count; c++) {
            if (plan.land[c] === 0) continue;
            for (let d = 0; d < 2; d++) {
              const n = neighbour4(plan.grid, c, d);
              if (n >= 0 && plan.land[n] === 1 && plan.level[n] !== plan.level[c]) steps++;
            }
          }
          expect(plan.ramps.length).toBeGreaterThan(0);
          expect(steps).toBeGreaterThan(plan.ramps.length * 4);
        }
      });

      it('raises the Frostkamm and the ranges beside the Aschenschlund (§9.2.3 "Gebirge")', () => {
        for (const plan of plans) {
          const sum = new Map<number, number>();
          const cells = new Map<number, number>();
          for (let c = 0; c < plan.grid.count; c++) {
            const r = plan.region[c] as number;
            if (r < 0) continue;
            sum.set(r, (sum.get(r) ?? 0) + (plan.level[c] as number));
            cells.set(r, (cells.get(r) ?? 0) + 1);
          }
          const levelOf = (r: number): number => (sum.get(r) ?? 0) / (cells.get(r) ?? 1);
          const meanOf = (biome: string): number => {
            const rs = plan.regions.filter((r) => r.biome === biome);
            return rs.reduce((a, r) => a + levelOf(r.id) * r.cells, 0) / rs.reduce((a, r) => a + r.cells, 0);
          };
          const lowland = meanOf(BIOME_ROLES.start);
          // Frostkamm: the high mountains, clearly above the Grünhain hills.
          expect(meanOf(BIOME_ROLES.cold)).toBeGreaterThanOrEqual(Math.max(1.8, lowland + 0.8));
          // Every Aschenschlund area borders a Frostkamm or Glutsand range that rises above the lowland.
          const done = new Set<number>();
          for (const r of plan.regions) {
            if (r.biome !== BIOME_ROLES.volcanic || done.has(r.id)) continue;
            const area = [r.id];
            done.add(r.id);
            for (let i = 0; i < area.length; i++) {
              for (const v of plan.neighbours[area[i] as number] as readonly number[]) {
                if (!done.has(v) && plan.regions[v]?.biome === BIOME_ROLES.volcanic) {
                  done.add(v);
                  area.push(v);
                }
              }
            }
            const ranges = area.flatMap((u) => (plan.neighbours[u] as readonly number[]).filter((v) => plan.regions[v]?.biome === BIOME_ROLES.cold || plan.regions[v]?.biome === BIOME_ROLES.dry));
            expect(Math.max(...ranges.map(levelOf))).toBeGreaterThanOrEqual(lowland + 0.4);
          }
        }
      });
    });
  }

  describe('tile level (chunk generator view, Klein)', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      it(`seed ${seed}: every land tile of the main island is reachable over ramps and stairs`, () => {
        const plan = generateWorldPlan(seed, 'small');
        const sampler = createPlanSampler(plan);
        const s = createTerrainSample();
        const n = plan.grid.tiles;
        const level = new Int8Array(n * n).fill(-1);
        const ramp = new Uint8Array(n * n);
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            sampler.sample(x, y, s);
            if (!s.land) continue;
            level[y * n + x] = s.level;
            if (s.flags & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) ramp[y * n + x] = 1;
          }
        }
        // Main land: the 4-connected land component of the start tile, ignoring levels.
        const start = plan.regions[plan.start];
        const t0 = Math.floor(start?.seedY ?? 0) * n + Math.floor(start?.seedX ?? 0);
        const flood = (step: (a: number, b: number) => boolean): Uint8Array => {
          const seen = new Uint8Array(n * n);
          const queue = new Int32Array(n * n);
          let tail = 0;
          queue[tail++] = t0;
          seen[t0] = 1;
          for (let head = 0; head < tail; head++) {
            const t = queue[head] as number;
            const x = t % n;
            for (const nb of [x + 1 < n ? t + 1 : -1, x > 0 ? t - 1 : -1, t + n < n * n ? t + n : -1, t - n]) {
              if (nb < 0 || seen[nb] === 1 || (level[nb] as number) < 0 || !step(t, nb)) continue;
              seen[nb] = 1;
              queue[tail++] = nb;
            }
          }
          return seen;
        };
        const land = flood(() => true);
        const walk = flood((a, b) => {
          const d = Math.abs((level[a] as number) - (level[b] as number));
          return d === 0 || (d === 1 && ramp[a] === 1 && ramp[b] === 1);
        });
        let landTiles = 0;
        let missed = 0;
        for (let t = 0; t < n * n; t++) {
          if (land[t] !== 1) continue;
          landTiles++;
          if (walk[t] !== 1) missed++;
        }
        // Only wobble artefacts (a few tiles in the tightest cliff corners) may stay cut off.
        expect(missed / landTiles).toBeLessThan(0.002);
        // Every ramp rectangle spans both of its levels.
        for (const r of plan.ramps) {
          const seenLevels = new Set<number>();
          for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) seenLevels.add(level[y * n + x] as number);
          expect([...seenLevels].sort()).toEqual([r.level, r.level + 1]);
        }
      });
    }
  });
});
