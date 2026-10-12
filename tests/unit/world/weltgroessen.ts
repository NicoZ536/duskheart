/**
 * World sizes of the plan and world sweeps (M7-75; ADR-0036 rule 1 "Sweeps in die Integration"): `npm run check` checks every
 * rule of the island, region, biome, height, river, road and place sweeps on the Klein world; the other sizes run the same
 * cases unchanged in the integration project (`tests/integration/*-groessen.test.ts`, `npm run verify`) – as the Mittel sweeps
 * of the world validation since M4-37. Together the two lists are always every size of `WORLD_SIZE_PRESETS`.
 */
import type { WorldSizePreset } from '../../../src/content/balance';
import { WORLD_SIZE_PRESETS } from '../../../src/world/model/worldSize';

/** Sizes whose sweep cases run in the unit suite (`npm run check`). */
export const UNIT_SIZES: readonly WorldSizePreset[] = ['small'];
/** Every other size: its sweep cases run in the integration project (`npm run verify`). */
export const INTEGRATION_SIZES: readonly WorldSizePreset[] = WORLD_SIZE_PRESETS.filter((preset) => !UNIT_SIZES.includes(preset));
