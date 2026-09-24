/**
 * M2-08 (world plan step 5, MASTERPROMPT §9.2.5): rivers from the mountains to the coast along the
 * slope (1–4 tiles wide), lakes in basins, fords, streams and springs. Every river ends in the sea
 * or a lake and never flows uphill. 12 seeds × 3 sizes; tile raster on two Mittel worlds.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { TILE_FLAG_FORD, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../../src/world/model/chunk';
import { WATER } from '../../../src/world/gen/plan/params';
import { createPlanSampler, createTerrainSample, generateWorldPlan, neighbour4, type PlanRiver, type WorldPlan } from '../../../src/world/gen/plan';

const SEEDS = Array.from({ length: 12 }, (_, i) => 13 + i * 49979687);

/** Follows tributaries to the final mouth; throws on a cycle. */
function finalEnd(plan: WorldPlan, river: PlanRiver): 'meer' | 'see' {
  const visited = new Set<number>();
  let r = river;
  for (;;) {
    if (visited.has(r.id)) throw new Error(`river ${river.id}: cycle`);
    visited.add(r.id);
    if (r.end.kind !== 'fluss') return r.end.kind;
    const next = plan.rivers[r.end.river];
    if (next === undefined) throw new Error(`river ${r.id}: joins a missing river`);
    r = next;
  }
}

describe('rivers, lakes, fords, streams and springs (M2-08)', () => {
  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const plans = SEEDS.map((seed) => generateWorldPlan(seed, preset));

      it('lets every river and stream end in the sea or a lake', () => {
        for (const plan of plans) {
          for (const r of plan.rivers) {
            expect(['meer', 'see']).toContain(finalEnd(plan, r));
            const last = r.cells[r.cells.length - 1] as number;
            if (r.end.kind === 'meer') expect(plan.land[last]).toBe(0);
            if (r.end.kind === 'see') expect(plan.lake[last]).toBe(r.end.lake);
            if (r.end.kind === 'fluss') {
              // The mouth vertex is a vertex of the main river, and the joined river is older.
              const main = plan.rivers[r.end.river] as PlanRiver;
              expect(r.end.river).toBeLessThan(r.id);
              expect(r.xs[r.xs.length - 1]).toBe(main.xs[r.end.vertex]);
              expect(r.ys[r.ys.length - 1]).toBe(main.ys[r.end.vertex]);
            }
          }
        }
      });

      it('never flows uphill: cell levels, vertex levels and elevations fall monotonically', () => {
        const violations: string[] = [];
        for (const plan of plans) {
          for (const r of plan.rivers) {
            for (let i = 1; i < r.cells.length; i++) {
              const a = r.cells[i - 1] as number;
              const b = r.cells[i] as number;
              // Consecutive cells are edge neighbours.
              if (![0, 1, 2, 3].some((d) => neighbour4(plan.grid, a, d) === b)) violations.push(`${plan.seed}/${r.id}: cells ${i - 1}→${i} not adjacent`);
              if (i === 1 && r.fromLake >= 0) continue;
              if ((plan.level[b] as number) > (plan.level[a] as number)) violations.push(`${plan.seed}/${r.id}: cell level rises at ${i}`);
            }
            for (let i = 1; i < r.xs.length; i++) {
              if ((r.level[i] as number) > (r.level[i - 1] as number)) violations.push(`${plan.seed}/${r.id}: vertex level rises at ${i}`);
              if ((r.elevation[i] as number) > (r.elevation[i - 1] as number)) violations.push(`${plan.seed}/${r.id}: elevation rises at ${i}`);
            }
          }
        }
        expect(violations).toEqual([]);
      });

      it('rises in the mountains, springs from sources and widens downstream (1–4 tiles)', () => {
        for (const plan of plans) {
          const sprung = plan.rivers.filter((r) => r.kind === 'fluss' && r.fromLake < 0);
          expect(sprung.length).toBe(WATER.rivers[preset]);
          expect(plan.rivers.filter((r) => r.kind === 'bach').length).toBe(WATER.streams[preset]);
          for (const r of sprung) {
            expect(plan.level[r.cells[0] as number]).toBeGreaterThanOrEqual(WATER.riverSourceFallbackLevel);
            expect(r.cells.length).toBeGreaterThanOrEqual(WATER.riverMinCells);
          }
          expect(sprung.filter((r) => (plan.level[r.cells[0] as number] as number) >= WATER.riverSourceLevel).length).toBeGreaterThan(0);
          for (const r of plan.rivers) {
            const widths = Array.from(r.width);
            if (r.kind === 'bach') expect(new Set(widths)).toEqual(new Set([1]));
            else {
              expect(Math.min(...widths)).toBeGreaterThanOrEqual(2);
              expect(Math.max(...widths)).toBeLessThanOrEqual(4);
            }
            // Wider downstream, never narrower.
            expect(widths.every((w, i) => i === 0 || w >= (widths[i - 1] as number))).toBe(true);
            // Outflows start on their lake; every other course starts at a spring on land.
            if (r.fromLake >= 0) expect(plan.lake[r.cells[0] as number]).toBe(r.fromLake);
            else expect(plan.land[r.cells[0] as number] === 1 && plan.lake[r.cells[0] as number] === -1).toBe(true);
          }
          expect(plan.rivers.some((r) => (r.width[r.width.length - 1] as number) >= 3)).toBe(true);
        }
      });

      it('fills basins with lakes that drain through their outflow', () => {
        for (const plan of plans) {
          expect(plan.lakes.length).toBeGreaterThan(0);
          for (const lake of plan.lakes) {
            expect(lake.cells).toBeGreaterThanOrEqual(WATER.lakeMinCells);
            let rimBelow = 0;
            let offLevel = 0;
            for (let c = 0; c < plan.grid.count; c++) {
              if (plan.lake[c] !== lake.id) continue;
              if (plan.level[c] !== lake.level) offLevel++;
              // A basin: the land around the lake does not lie below its surface.
              for (let d = 0; d < 4; d++) {
                const n = neighbour4(plan.grid, c, d);
                if (n >= 0 && plan.land[n] === 1 && plan.lake[n] === -1 && (plan.level[n] as number) < lake.level) rimBelow++;
              }
            }
            expect(offLevel).toBe(0);
            // The shore never lies below the lake surface; a lake drains through at most one outflow.
            const outflows = plan.rivers.filter((r) => r.fromLake === lake.id).length;
            expect(outflows).toBeLessThanOrEqual(1);
            expect(rimBelow).toBe(0);
            // A lake fed by a river drains into an outflow.
            const fed = plan.rivers.some((r) => r.kind === 'fluss' && r.end.kind === 'see' && r.end.lake === lake.id);
            if (fed) expect(outflows).toBe(1);
          }
        }
      });

      it('places fords where both banks lie on the river level', () => {
        let fords = 0;
        for (const plan of plans) {
          fords += plan.fords.length;
          for (const f of plan.fords) {
            const river = plan.rivers[f.river] as PlanRiver;
            expect(river.kind).toBe('fluss');
            expect(river.xs[f.vertex]).toBe(f.x);
            expect(river.ys[f.vertex]).toBe(f.y);
            // The two bank cells beside the crossing (across the flow) are dry land on the river's level.
            const at = Array.from(river.cells).indexOf(f.cell);
            expect(at).toBeGreaterThan(0);
            const next = river.cells[at + 1] as number;
            const dir = [0, 1, 2, 3].find((d) => neighbour4(plan.grid, f.cell, d) === next) as number;
            expect(plan.level[f.cell]).toBe(f.level);
            for (const side of [(dir + 1) % 4, (dir + 3) % 4]) {
              const bank = neighbour4(plan.grid, f.cell, side);
              expect(plan.land[bank] === 1 && plan.lake[bank] === -1 && plan.riverCell[bank] === 0).toBe(true);
              expect(plan.level[bank]).toBe(f.level);
            }
          }
          const perRiver = new Map<number, number[]>();
          for (const f of plan.fords) perRiver.set(f.river, [...(perRiver.get(f.river) ?? []), f.vertex]);
          for (const vertices of perRiver.values()) for (let i = 1; i < vertices.length; i++) expect(vertices[i] as number).toBeGreaterThan(vertices[i - 1] as number);
        }
        expect(fords).toBeGreaterThanOrEqual(plans.length);
      });
    });
  }

  describe('tile raster (chunk generator view, Mittel)', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      it(`seed ${seed}: rivers are water tiles with springs, fords and a sea or lake mouth`, () => {
        const plan = generateWorldPlan(seed, 'medium');
        const sampler = createPlanSampler(plan);
        const s = createTerrainSample();
        const dry: string[] = [];
        for (const r of plan.rivers) {
          // Every vertex lies on water (its own river, a lake at the mouth, or the sea), on the river's level.
          for (let i = 0; i < r.xs.length; i++) {
            sampler.sample(Math.floor(r.xs[i] as number), Math.floor(r.ys[i] as number), s);
            if ((s.water & (WATER_RIVER | WATER_LAKE | WATER_SEA)) === 0) dry.push(`${r.id}/${i}`);
            else if (s.water & WATER_RIVER && s.level > (r.level[i] as number)) dry.push(`${r.id}/${i} above its level`);
          }
          sampler.sample(Math.floor(r.xs[0] as number), Math.floor(r.ys[0] as number), s);
          if (r.fromLake < 0) expect(s.water & WATER_SPRING).toBe(WATER_SPRING);
          // Width across the channel: the contiguous wet run along the normal (a neighbouring stream is
          // not counted) against the planned width w.
          const runs: number[] = [];
          for (let i = 3; i + 3 < r.xs.length; i++) {
            const tx = (r.xs[i + 1] as number) - (r.xs[i - 1] as number);
            const ty = (r.ys[i + 1] as number) - (r.ys[i - 1] as number);
            const len = Math.hypot(tx, ty);
            let open = false;
            const wetAt = (k: number): boolean => {
              sampler.sample(Math.floor((r.xs[i] as number) - (ty / len) * k), Math.floor((r.ys[i] as number) + (tx / len) * k), s);
              if (s.water & (WATER_LAKE | WATER_SEA)) open = true;
              return (s.water & WATER_RIVER) !== 0;
            };
            if (!wetAt(0)) continue;
            const step = 0.25;
            let left = 0;
            while (left < 8 && wetAt(-(left + step))) left += step;
            let right = 0;
            while (right < 8 && wetAt(right + step)) right += step;
            // Where the channel opens into a lake or the sea it has no banks to measure.
            if (open) continue;
            runs.push(left + right - (r.width[i] as number));
            // Tile quantisation: a diagonal channel through a tile corner can measure 1,5 tiles short.
            expect(left + right).toBeGreaterThanOrEqual((r.width[i] as number) - 1.5);
          }
          if (runs.length > 0) {
            // On average the raster matches the planned width.
            const meanExcess = runs.reduce((a, b) => a + b, 0) / runs.length;
            expect(meanExcess).toBeGreaterThan(-0.5);
            expect(meanExcess).toBeLessThan(1.5);
          }
        }
        expect(dry).toEqual([]);
        for (const f of plan.fords) {
          sampler.sample(Math.floor(f.x), Math.floor(f.y), s);
          expect(s.flags & TILE_FLAG_FORD).toBe(TILE_FLAG_FORD);
        }
      });
    }
  });
});
