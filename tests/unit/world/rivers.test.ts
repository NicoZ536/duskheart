/**
 * M2-08 (world plan step 5, MASTERPROMPT §9.2.5): rivers from the mountains to the coast along the
 * slope (1–4 tiles wide), lakes in basins, fords, streams and springs. Every river ends in the sea
 * or a lake and never flows uphill. 12 seeds × 3 sizes (`rivers-groessen.ts`: Klein here, Mittel and Groß in
 * tests/integration/rivers-groessen.test.ts – M7-75); tile raster on two Mittel worlds.
 */
import { describe, expect, it } from 'vitest';
import { TILE_FLAG_FORD, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../../src/world/model/chunk';
import { createPlanSampler, createTerrainSample, generateWorldPlan } from '../../../src/world/gen/plan';
import { SEEDS, riverSizes } from './rivers-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('rivers, lakes, fords, streams and springs (M2-08)', () => {
  riverSizes(UNIT_SIZES);

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
