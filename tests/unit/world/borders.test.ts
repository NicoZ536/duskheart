/**
 * M2-09 (world plan step 6, MASTERPROMPT §9.2.6): biome borders blurred by a domain warp, with
 * transition strips 4–12 tiles wide (e.g. taiga between Grünhain and Frostkamm). The strip width is
 * measured in tile space along the numeric normal of the border distance, on sampled border points
 * of 5 seeds × 3 sizes.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';
import { blueNoiseAt, createBlueNoiseTile } from '../../../src/world/gen/sampling';
import { BIOME_ROLES } from '../../../src/world/gen/plan/params';
import { PLAN_BIOME_IDS, cellAtTile, createBiomeSample, createBiomeSampler, generateWorldPlan, pickBiome, type BiomeSampler, type WorldPlan } from '../../../src/world/gen/plan';
import { sampleBilinear } from '../../../src/world/gen/plan/grid';

const SEEDS = Array.from({ length: 5 }, (_, i) => 17 + i * 86028121);
/** Border points measured per world. */
const PROBES = 60;
/** Walk step [tiles]. */
const STEP = 0.2;
/** Longest walk from a probe to its border and across the strip [tiles]. */
const MAX_WALK = 16;
/** Directions tried through a border point; the narrowest crossing is the strip width. */
const DIRECTIONS = 12;
/** Radius around a border point that must hold only the two biomes of the border [tiles]. */
const CLEAN_RADIUS = 12;

interface Strip {
  width: number;
  pair: [number, number];
  blendAtBorder: [number, number];
}

/**
 * Measures the strip through the tile-space point (x, y): walks down the gradient of the border
 * distance to the border (where the primary biome flips); the width is the shortest crossing of
 * the strip (blend > 0) through that border point over `DIRECTIONS` directions – for a strip of
 * width w, a crossing at angle θ to the normal is w / cos θ long. Returns null near a third biome
 * (triple junctions have no single strip width), at the sea or without a border.
 */
function measure(plan: WorldPlan, sampler: BiomeSampler, x: number, y: number): Strip | null {
  const s = createBiomeSample();
  const land = (px: number, py: number): boolean => sampleBilinear(plan.grid, plan.coastDistance, px, py) > 0;
  sampler.sampleAt(x, y, s);
  if (s.blend <= 0 || !land(x, y)) return null;
  const own = s.primary;
  const other = s.secondary;
  const h = 0.25;
  const d = (px: number, py: number): number => sampler.sampleAt(px, py, s).borderDistance;
  let gx = d(x + h, y) - d(x - h, y);
  let gy = d(x, y + h) - d(x, y - h);
  const len = Math.hypot(gx, gy);
  if (!(len > 0)) return null;
  gx /= len;
  gy /= len;
  let bx = x;
  let by = y;
  for (let walked = 0; ; walked += STEP) {
    if (walked > MAX_WALK) return null;
    sampler.sampleAt(bx - gx * STEP, by - gy * STEP, s);
    if (s.primary !== own) break;
    bx -= gx * STEP;
    by -= gy * STEP;
  }
  if (s.primary !== other) return null;
  for (let k = 0; k < 16; k++) {
    for (const r of [CLEAN_RADIUS / 3, (2 * CLEAN_RADIUS) / 3, CLEAN_RADIUS]) {
      const a = (2 * Math.PI * k) / 16;
      sampler.sampleAt(bx + Math.cos(a) * r, by + Math.sin(a) * r, s);
      if (s.primary !== own && s.primary !== other) return null;
    }
  }
  const crossing = (dx: number, dy: number): number | null => {
    let total = 0;
    for (const sign of [1, -1]) {
      for (let t = 0; ; t += STEP) {
        if (t > MAX_WALK) return null;
        const px = bx + sign * dx * (t + STEP);
        const py = by + sign * dy * (t + STEP);
        if (!land(px, py)) return null;
        sampler.sampleAt(px, py, s);
        if (s.blend <= 0) {
          total += t + STEP / 2;
          break;
        }
      }
    }
    return total;
  };
  let width = Infinity;
  let nx = gx;
  let ny = gy;
  for (let k = 0; k < DIRECTIONS; k++) {
    const a = (Math.PI * k) / DIRECTIONS;
    const w = crossing(Math.cos(a), Math.sin(a));
    if (w !== null && w < width) {
      width = w;
      nx = Math.cos(a);
      ny = Math.sin(a);
    }
  }
  if (!Number.isFinite(width)) return null;
  const inner = sampler.sampleAt(bx + nx * STEP, by + ny * STEP, s).blend;
  const outer = sampler.sampleAt(bx - nx * STEP, by - ny * STEP, s).blend;
  return { width, pair: [Math.min(own, other), Math.max(own, other)], blendAtBorder: [inner, outer] };
}

describe('biome borders and transition strips (M2-09)', () => {
  const green = PLAN_BIOME_IDS.indexOf(BIOME_ROLES.start);
  const frost = PLAN_BIOME_IDS.indexOf(BIOME_ROLES.cold);
  let taiga = 0;

  for (const preset of WORLD_SIZE_PRESETS) {
    describe(preset, () => {
      const worlds = SEEDS.map((seed) => {
        const plan = generateWorldPlan(seed, preset);
        return { plan, sampler: createBiomeSampler(plan) };
      });

      it('has transition strips 4–12 tiles wide, blending ½ : ½ on the border', () => {
        for (const { plan, sampler } of worlds) {
          const rng = new Rng(plan.seed);
          const s = createBiomeSample();
          const widths: number[] = [];
          for (let tries = 0; widths.length < PROBES && tries < PROBES * 400; tries++) {
            const x = rng.float(0, plan.grid.tiles);
            const y = rng.float(0, plan.grid.tiles);
            if (sampler.sampleAt(x, y, s).blend <= 0) continue;
            const strip = measure(plan, sampler, x, y);
            if (strip === null) continue;
            widths.push(strip.width);
            if ((strip.pair[0] === Math.min(green, frost) && strip.pair[1] === Math.max(green, frost))) taiga++;
            for (const b of strip.blendAtBorder) expect(b).toBeGreaterThan(0.4);
          }
          expect(widths.length).toBe(PROBES);
          expect(Math.min(...widths)).toBeGreaterThanOrEqual(4);
          expect(Math.max(...widths)).toBeLessThanOrEqual(12);
          // The width breathes along the border instead of being constant.
          expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(2);
        }
      });

      it('warps the borders off the region raster without losing the plan', () => {
        for (const { plan, sampler } of worlds) {
          const s = createBiomeSample();
          let land = 0;
          let moved = 0;
          const step = 4;
          for (let y = 0; y < plan.grid.tiles; y += step) {
            for (let x = 0; x < plan.grid.tiles; x += step) {
              const c = cellAtTile(plan.grid, x + 0.5, y + 0.5);
              if (plan.region[c] === -1 || sampleBilinear(plan.grid, plan.coastDistance, x + 0.5, y + 0.5) <= 0) continue;
              land++;
              if (plan.regions[sampler.sample(x, y, s).region]?.biome !== plan.regions[plan.region[c] as number]?.biome) moved++;
            }
          }
          // Borders wander (domain warp) but the biome map stays the plan's.
          expect(moved / land).toBeGreaterThan(0.01);
          expect(moved / land).toBeLessThan(0.15);
        }
      });

      it('mixes both biomes inside a strip when dithered', () => {
        const blue = createBlueNoiseTile(1);
        for (const { plan, sampler } of worlds) {
          const s = createBiomeSample();
          const picked = new Map<string, Set<number>>();
          const samples = new Map<string, number>();
          for (let y = 0; y < plan.grid.tiles; y += 5) {
            for (let x = 0; x < plan.grid.tiles; x += 5) {
              sampler.sample(x, y, s);
              if (s.blend <= 0.25) continue;
              const key = `${Math.min(s.primary, s.secondary)}:${Math.max(s.primary, s.secondary)}`;
              const set = picked.get(key) ?? new Set<number>();
              set.add(pickBiome(s, blueNoiseAt(blue, x, y)));
              picked.set(key, set);
              samples.set(key, (samples.get(key) ?? 0) + 1);
            }
          }
          // Every strip with enough samples shows both biomes.
          const sampled = [...picked.entries()].filter(([key]) => (samples.get(key) ?? 0) >= 10);
          expect(sampled.length).toBeGreaterThan(3);
          for (const [, set] of sampled) expect(set.size).toBe(2);
        }
      });

      it('samples the same biome in any order and from a fresh sampler', () => {
        const { plan, sampler } = worlds[0] as { plan: WorldPlan; sampler: BiomeSampler };
        const other = createBiomeSampler(plan);
        const rng = new Rng(3);
        const tiles = Array.from({ length: 400 }, () => [rng.int(0, plan.grid.tiles), rng.int(0, plan.grid.tiles)] as const);
        const a = createBiomeSample();
        const b = createBiomeSample();
        const forward = tiles.map(([x, y]) => ({ ...sampler.sample(x, y, a) }));
        const backward = [...tiles].reverse().map(([x, y]) => ({ ...other.sample(x, y, b) })).reverse();
        expect(backward).toEqual(forward);
      });
    });
  }

  it('grows taiga strips between Grünhain and Frostkamm (§9.2.6 example)', () => {
    expect(taiga).toBeGreaterThan(0);
  });
});
