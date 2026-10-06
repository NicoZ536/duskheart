/**
 * Test support for the fishing tests (angeln, the `fishing` roundtrip): the gathering test world (drawn chunks, player, bags,
 * interaction) with a lake and the fishing system wired as in `createSimulation` (E on water casts, E held reels, the figure
 * faces the float), the experience it awards recorded.
 *
 * The map: meadow, a lake (`w` deep, `s` shallow, fresh water of Grünhain) east of x = 8, a frozen strip (`eis(…)`) drawn by the
 * test. The player stands at the shore (6, 5).
 */
import { FishingSystem, fishingFeet, fishingUses, type FishingSample } from '../../../src/game/fishing/index';
import { createFishingSample } from '../../../src/game/samples/feld';
import { WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_LAKE } from '../../../src/world/model/chunk';
import type { ChunkData } from '../../../src/world/model/chunk';
import { gatherWorld, OFFSET, TILE_PX, type GatherWorld } from './interaktion-testwelt';

/** Map: meadow west of x = 8, the lake from x = 8 on (rows 0–11). */
export const LAKE_ROWS: readonly string[] = Array.from({ length: 12 }, () => '........ssswwwwwwwwwwwwww');

export interface AngelWelt extends GatherWorld {
  readonly fishing: FishingSystem;
  readonly awarded: string[];
  /** World px of the centre of drawn tile (x, y). */
  px(x: number, y: number): { x: number; y: number };
  /** The line now. */
  line(): FishingSample;
  /** Freezes drawn tile (x, y) (frozen lake water). */
  eis(x: number, y: number): void;
}

/** The fishing world on `rows` (default `LAKE_ROWS`; objects by the gathering legend, e.g. `L` flowers at the shore). */
export function angelWelt(seed = 7, rows: readonly string[] = LAKE_ROWS): AngelWelt {
  const w = gatherWorld(rows as string[], seed);
  // The drawn water is a lake.
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < (rows[0] as string).length; x++) {
      const { chunk, i } = w.at(x, y);
      const water = chunk.water[i] as number;
      if (water !== 0) chunk.water[i] = water | WATER_LAKE;
    }
  }
  const awarded: string[] = [];
  const fishing = w.sim.addSystem(
    new FishingSystem(w.sim, {
      world: { chunk: (layer, cx, cy) => w.chunks.get(layer, cx, cy), activeChunks: () => w.active, regionAt: () => -1, weather: () => null },
      calendar: w.calendar,
      inventory: w.inventory,
      catalog: w.inventory.bags.catalog,
      player: w.player,
      spill: () => undefined,
      holding: () => w.interaction.holding,
    }),
  );
  fishing.useSkills({ award: (_s, id) => awarded.push(id) });
  w.interaction.addUses(fishingUses({ fishing, inventory: w.inventory, aimPoint: () => w.interaction.aimPoint, feet: fishingFeet(w.player) }));
  w.player.addFacingSource(fishing.facingSource);
  const sample = createFishingSample();
  const aw: AngelWelt = Object.assign(w, {
    fishing,
    awarded,
    px: (x: number, y: number) => ({ x: (OFFSET + x) * TILE_PX + TILE_PX / 2, y: (OFFSET + y) * TILE_PX + TILE_PX / 2 }),
    line: () => fishing.sample(sample),
    eis: (x: number, y: number) => {
      const { chunk, i } = w.at(x, y);
      (chunk as ChunkData).water[i] = WATER_DEPTH_SHALLOW | WATER_LAKE | WATER_FROZEN;
    },
  });
  return aw;
}
