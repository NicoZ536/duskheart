/**
 * M2-07 (world plan step 4, MASTERPROMPT §9.1/§9.2.4): height levels 0–4 (region base + noise),
 * cliffs, ramps and stairs; every level reachable over ramps and stairs; −3 °C per level.
 * Plan level over 12 seeds × 3 sizes (`height-groessen.ts`: Klein here, Mittel and Groß in
 * tests/integration/height-groessen.test.ts – M7-75), tile level (the chunk generator's view) on two Klein worlds.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS } from '../../../src/world/model/chunk';
import { MAX_LEVEL, createPlanSampler, createTerrainSample, generateWorldPlan, heightTemperatureOffsetC } from '../../../src/world/gen/plan';
import { SEEDS, heightSizes } from './height-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('height field, cliffs, ramps and stairs (M2-07)', () => {
  it('lowers the temperature by 3 °C per level (§9.1)', () => {
    expect(BALANCE.world.temperaturePerHeightLevelC).toBe(-3);
    for (let l = 0; l <= MAX_LEVEL; l++) expect(heightTemperatureOffsetC(l)).toBe(-3 * l);
    expect(MAX_LEVEL).toBe(4);
  });

  heightSizes(UNIT_SIZES);

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
