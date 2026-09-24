/**
 * Seeds and continuous noise fields of the world plan. Every generation step draws from its own
 * named stream (`planRng(seed, 'regions')`), so a change in one step never shifts the random numbers
 * of another (docs/ARCHITEKTUR.md "Determinismus"). The fields are pure functions of (seed,
 * position); the tile samplers recompute them instead of storing them.
 */
import type { WorldSizePreset } from '../../../content/balance';
import { createSimplex2, fbm, ridged, type Noise2 } from '../../../engine/noise';
import { Rng, hashCombine, hashString, normalizeSeed } from '../../../engine/rng';
import { CLIMATE, REGIONS } from './params';

/** Seed of the named plan stream of a world seed and plan attempt. */
export function planSeed(worldSeed: number, attempt: number, name: string): number {
  return hashCombine(hashCombine(normalizeSeed(worldSeed), attempt), hashString(`plan.${name}`));
}

/** Fresh generator of the named plan stream. */
export function planRng(worldSeed: number, attempt: number, name: string): Rng {
  return new Rng(planSeed(worldSeed, attempt, name));
}

/** Seeded simplex noise of the named plan stream. */
export function planNoise(worldSeed: number, attempt: number, name: string): Noise2 {
  return createSimplex2(planSeed(worldSeed, attempt, name));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Continuous climate and coast fields of one plan attempt (positions in tiles). */
export interface PlanFields {
  /** Width of the coastal Salzküste band at a tile position [tiles]. */
  bandWidthAt(x: number, y: number): number;
  /** Mountain relief at a tile position [0, 1]; higher in the north. */
  reliefAt(x: number, y: number): number;
  /** Moisture at a tile position [0, 1]; wet in the west and north, dry in the east and south. */
  moistureAt(x: number, y: number): number;
}

/** Builds the climate and coast fields of one plan attempt. */
export function createPlanFields(worldSeed: number, attempt: number, preset: WorldSizePreset, worldTiles: number): PlanFields {
  const band = planNoise(worldSeed, attempt, 'band');
  const relief = planNoise(worldSeed, attempt, 'relief');
  const moisture = planNoise(worldSeed, attempt, 'moisture');
  const bandBase = REGIONS.bandWidthTiles[preset];
  const inv = 1 / worldTiles;
  const reliefOpts = { octaves: CLIMATE.reliefOctaves, frequency: CLIMATE.reliefFrequency };
  const moistureOpts = { octaves: CLIMATE.moistureOctaves, frequency: CLIMATE.moistureFrequency };
  return {
    bandWidthAt(x: number, y: number): number {
      return bandBase + REGIONS.bandWidthVariationTiles * band(x / REGIONS.bandWidthWavelengthTiles, y / REGIONS.bandWidthWavelengthTiles);
    },
    reliefAt(x: number, y: number): number {
      const u = x * inv;
      const v = y * inv;
      const gain = CLIMATE.reliefNorthGain + (CLIMATE.reliefSouthGain - CLIMATE.reliefNorthGain) * v;
      return clamp01(ridged(relief, u, v, reliefOpts) * gain - CLIMATE.reliefOffset);
    },
    moistureAt(x: number, y: number): number {
      const u = x * inv;
      const v = y * inv;
      const n = fbm(moisture, u, v, moistureOpts);
      return clamp01(0.5 + CLIMATE.moistureNoise * n + CLIMATE.moistureEastGradient * (0.5 - u) + CLIMATE.moistureSouthGradient * (0.5 - v));
    },
  };
}
