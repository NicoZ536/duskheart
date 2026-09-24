/**
 * Ground of a surface tile (docs/WORLD.md §3 `ground`, §7 terrain ids; MASTERPROMPT §9.3 biome
 * features): the terrain type under a tile from its biome, height, water and position.
 *
 * - Sea floor under the sea, a river or lake bed of the biome (sand, bog mud, earth) under inland water.
 * - Grünhain: grass with earth patches. Salzküste: a sand beach along the sea, dune grass (its own
 *   terrain, sand held by tufts – not the Grünhain meadow) behind it with open dune sand.
 *   Nebelmoor: bog mud in the wet hollows, peat patches, grass. Frostkamm: snow on the heights with
 *   glacier ice on the summits, tundra grass and earth below level 2. Glutsand: sand with hardpan
 *   (earth) patches. Aschenschlund: ash with scorched earth and lava pools. Scherbenhain: crystal
 *   ground with grass patches. Nachtherz: ash with crystal patches.
 * Patches follow seeded simplex noise at tile coordinates (a pure function of the tile).
 */
import { WATER_LAKE, WATER_RIVER, WATER_SEA } from '../model/chunk';
import type { RuntimeIdTable } from '../model/runtimeIds';
import type { Noise2 } from '../../engine/noise';
import { sampleBilinear } from './plan/grid';
import { PLAN_BIOME_IDS } from './plan/index';
import { genNoise, type SurfaceContext } from './worldContext';

export const GROUND = {
  /** Width of the sand beach along the sea [tiles]. Beach, surf and dunes (§9.3 Salzküste "Strände"). */
  beachTiles: 9,
  /** Variation of the beach width [tiles, ±]. */
  beachVariationTiles: 4,
  /** Wavelength of the patch noises [tiles per cycle]. Patches a few tiles to a chunk across. */
  patchWavelengthTiles: 14,
  /** Wavelength of the wetness noise of the moor [tiles per cycle]. Hollows larger than patches. */
  wetWavelengthTiles: 22,
  /** Grünhain: earth where the patch noise exceeds this [noise units]. */
  gruenhainEarth: 0.5,
  /** Salzküste: dune sand behind the beach where the patch noise exceeds this [noise units]. */
  dunesSand: 0.25,
  /** Nebelmoor: bog mud above, peat below these wetness values [noise units]. */
  moorMud: 0.1,
  moorPeat: -0.45,
  /** Frostkamm: glacier ice from this level where the patch noise exceeds `iceNoise` [level, noise units]. */
  iceLevel: 3,
  iceNoise: 0.2,
  /** Frostkamm: snow from this level, or below where the patch noise exceeds `lowSnow` [level, noise units]. */
  snowLevel: 2,
  lowSnow: 0.2,
  /** Frostkamm tundra: earth where the patch noise exceeds this [noise units]. */
  tundraEarth: 0.45,
  /** Glutsand: hardpan earth where the patch noise exceeds this [noise units]. */
  hardpan: 0.45,
  /** Aschenschlund: scorched earth where the patch noise exceeds this [noise units]. */
  scorched: 0.5,
  /** Scherbenhain: grass where the patch noise exceeds this [noise units]. */
  shardGrass: 0.35,
  /** Nachtherz: crystal ground where the patch noise exceeds this [noise units]. */
  coreCrystal: 0.2,
} as const;

/** Terrain ids the rules use (WORLD.md §7). */
const TERRAIN_IDS = ['gras', 'erde', 'sand', 'duenengras', 'schnee', 'asche', 'kristallboden', 'moorschlamm', 'torf', 'meeresgrund', 'strasse', 'eis', 'lava'] as const;
type TerrainId = (typeof TERRAIN_IDS)[number];

/** Ground rules of one world. */
export interface GroundRules {
  /** Runtime ids of the terrain types used. */
  readonly ids: Readonly<Record<TerrainId, number>>;
  /** Ground runtime id of a surface tile (without roads). `biome` is the plan biome index. */
  groundAt(tx: number, ty: number, land: boolean, level: number, water: number, biome: number): number;
}

/** Builds the ground rules of a world. */
export function createGroundRules(ctx: SurfaceContext, terrain: RuntimeIdTable): GroundRules {
  const ids = Object.fromEntries(TERRAIN_IDS.map((id) => [id, terrain.runtimeId(id)])) as Record<TerrainId, number>;
  const patch: Noise2 = genNoise(ctx.plan.seed, 'boden.flecken');
  const wet: Noise2 = genNoise(ctx.plan.seed, 'boden.naesse');
  const beach: Noise2 = genNoise(ctx.plan.seed, 'boden.strand');
  const b = (id: string): number => PLAN_BIOME_IDS.indexOf(id);
  const GRUENHAIN = b('gruenhain');
  const SALZKUESTE = b('salzkueste');
  const NEBELMOOR = b('nebelmoor');
  const FROSTKAMM = b('frostkamm');
  const GLUTSAND = b('glutsand');
  const ASCHENSCHLUND = b('aschenschlund');
  const SCHERBENHAIN = b('scherbenhain');
  const { grid } = ctx;
  const wl = GROUND.patchWavelengthTiles;
  return {
    ids,
    groundAt(tx: number, ty: number, land: boolean, level: number, water: number, biome: number): number {
      if (!land || (water & WATER_SEA) !== 0) return ids.meeresgrund;
      if ((water & (WATER_RIVER | WATER_LAKE)) !== 0) {
        if (biome === SALZKUESTE || biome === GLUTSAND) return ids.sand;
        if (biome === NEBELMOOR) return ids.moorschlamm;
        return ids.erde;
      }
      if (ctx.lavaAt(tx, ty)) return ids.lava;
      const p = patch(tx / wl, ty / wl);
      switch (biome) {
        case GRUENHAIN:
          return p > GROUND.gruenhainEarth ? ids.erde : ids.gras;
        case SALZKUESTE: {
          const coast = sampleBilinear(grid, ctx.plan.coastDistance, tx + 0.5, ty + 0.5);
          const width = GROUND.beachTiles + GROUND.beachVariationTiles * beach(tx / wl, ty / wl);
          return coast < width || p > GROUND.dunesSand ? ids.sand : ids.duenengras;
        }
        case NEBELMOOR: {
          const w = wet(tx / GROUND.wetWavelengthTiles, ty / GROUND.wetWavelengthTiles);
          return w > GROUND.moorMud ? ids.moorschlamm : w < GROUND.moorPeat ? ids.torf : ids.gras;
        }
        case FROSTKAMM:
          if (level >= GROUND.iceLevel && p > GROUND.iceNoise) return ids.eis;
          if (level >= GROUND.snowLevel || p > GROUND.lowSnow) return ids.schnee;
          return p < -GROUND.tundraEarth ? ids.erde : ids.gras;
        case GLUTSAND:
          return p > GROUND.hardpan ? ids.erde : ids.sand;
        case ASCHENSCHLUND:
          return p > GROUND.scorched ? ids.erde : ids.asche;
        case SCHERBENHAIN:
          return p > GROUND.shardGrass ? ids.gras : ids.kristallboden;
        default:
          return p > GROUND.coreCrystal ? ids.kristallboden : ids.asche;
      }
    },
  };
}
