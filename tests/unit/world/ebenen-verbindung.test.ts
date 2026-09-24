/**
 * Layers meet at their links (docs/WORLD.md §3 flags underground, ADR-0024): `generateChunk` hands
 * layers below 0 to the cave generator, and every link of the underground plan is the same tile in
 * both layers – the upper tile leads down (`TILE_FLAG_STAIRS`: cave mouth on the surface, shaft in a
 * cave), the lower tile leads up (`TILE_FLAG_RAMP`), both walkable and dry.
 */
import { describe, expect, it } from 'vitest';
import { generateChunk } from '../../../src/world/gen/chunk';
import { generateWorld } from '../../../src/world/gen/world';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS } from '../../../src/world/model/chunk';
import { tileLocalIndex, tileToChunk, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const TIMEOUT_MS = 30_000;

describe('surface and underground meet at the links of the underground plan', () => {
  it(
    'cave mouths lead down to a way up on layer −1, shafts down to a way up one layer deeper',
    () => {
      const world = generateWorld(20260924, 'small');
      const terrain = contentWorldIdTables().terrain;
      const tile = (layer: Layer, tx: number, ty: number) => {
        const c = generateChunk(world, layer, tileToChunk(tx), tileToChunk(ty));
        const i = tileLocalIndex(tx, ty);
        return { flags: c.flags[i] as number, solid: c.solid[i] as number, water: c.water[i] as number, ground: terrain.stringId(c.ground[i] as number) };
      };
      const links = world.underground.links;
      expect(links.filter((l) => l.kind === 'eingang').length).toBeGreaterThan(0);
      expect(links.filter((l) => l.kind === 'schacht').length).toBeGreaterThan(0);
      for (const l of links) {
        const upper = tile(l.upper, l.tx, l.ty);
        const lower = tile(l.lower, l.tx, l.ty);
        expect(upper.flags & TILE_FLAG_STAIRS, `${l.kind} ${l.id} leads down on layer ${l.upper}`).not.toBe(0);
        expect(lower.flags & TILE_FLAG_RAMP, `${l.kind} ${l.id} leads up on layer ${l.lower}`).not.toBe(0);
        expect([lower.solid, lower.water], `${l.kind} ${l.id} is open and dry below`).toEqual([0, 0]);
        expect(lower.ground, `${l.kind} ${l.id}`).not.toBe('lava');
      }
      // Only links carry the flags underground (no stray ways up or down).
      const lower = generateChunk(world, -1, tileToChunk(links[0]?.tx ?? 0), tileToChunk(links[0]?.ty ?? 0));
      let ups = 0;
      for (let i = 0; i < lower.flags.length; i++) if (((lower.flags[i] as number) & TILE_FLAG_RAMP) !== 0) ups++;
      const inChunk = links.filter((l) => l.lower === -1 && tileToChunk(l.tx) === lower.cx && tileToChunk(l.ty) === lower.cy).length;
      expect(ups).toBe(inChunk);
    },
    TIMEOUT_MS,
  );
});
