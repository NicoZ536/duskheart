/**
 * World plan as a whole (docs/WORLD.md §2 step 1): deterministic from (seed, size), small (< 2 MB),
 * structured-cloneable for the worker hand-over, with a generation report.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { PLAN_MAX_ATTEMPTS } from '../../../src/world/gen/plan/params';
import { PLAN_VERSION, generateWorldPlan, planByteSize, worldPlanHash } from '../../../src/world/gen/plan';

/** WORLD.md §2: "Serialisierbar, klein (< 2 MB)". */
const PLAN_BUDGET_BYTES = 2 * 1024 * 1024;

describe('world plan', () => {
  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const plans = [101, 202, 303].map((seed) => generateWorldPlan(seed, preset));

      it('is a pure function of seed and size', () => {
        const again = generateWorldPlan(101, preset);
        expect(worldPlanHash(again)).toBe(worldPlanHash(plans[0] as (typeof plans)[number]));
        expect(new Set(plans.map(worldPlanHash)).size).toBe(plans.length);
        for (const p of plans) {
          expect(p.version).toBe(PLAN_VERSION);
          expect(p.preset).toBe(preset);
          expect(p.attempt).toBeLessThan(PLAN_MAX_ATTEMPTS);
        }
      });

      it('stays below 2 MB and survives a structured clone unchanged', () => {
        for (const p of plans) {
          expect(planByteSize(p)).toBeLessThan(PLAN_BUDGET_BYTES);
          const copy = structuredClone(p);
          expect(worldPlanHash(copy)).toBe(worldPlanHash(p));
          expect(copy.level).toBeInstanceOf(Uint8Array);
          expect(copy.rivers[0]?.xs).toBeInstanceOf(Float32Array);
        }
      });

      it('reports how it was built', () => {
        for (const p of plans) {
          expect(p.report.planAttempts).toBe(p.attempt + 1);
          expect(p.report.solverAttempts).toBeGreaterThanOrEqual(1);
          expect(p.report.heightRepairs).toBeGreaterThanOrEqual(0);
          expect(p.report.smoothedCells).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(p.report.solverCost)).toBe(true);
        }
      });
    });
  }
});
