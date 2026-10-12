/**
 * The per-size cases of `tests/unit/world/height.test.ts` (M2-07, height field, cliffs, ramps and stairs, 12 seeds per size), moved here
 * unchanged (M7-75): the unit file runs them for the sizes of `UNIT_SIZES`, `tests/integration/height-groessen.test.ts`
 * for the others (`weltgroessen.ts`).
 */
import { describe, expect, it } from 'vitest';
import { BIOME_ROLES, HEIGHT } from '../../../src/world/gen/plan/params';
import { MAX_LEVEL, cellAtTile, generateWorldPlan, neighbour4, type WorldPlan } from '../../../src/world/gen/plan';
import type { WorldSizePreset } from '../../../src/content/balance';

export const SEEDS = Array.from({ length: 12 }, (_, i) => 5 + i * 32452843);

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

/** The cases of every size of `presets` (one `describe` per size). */
export function heightSizes(presets: readonly WorldSizePreset[]): void {
  for (const preset of presets) {
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
}
