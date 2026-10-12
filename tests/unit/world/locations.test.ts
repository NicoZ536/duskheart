/**
 * M2-11 acceptance, places (MASTERPROMPT §9.2.8, §20.2, §21): location slots placed by rules –
 * distance, biome, height, reachability – only placement.
 * - 3 seeds × 3 sizes (`locations-groessen.ts`: Klein here, Mittel and Groß in tests/integration/locations-groessen.test.ts –
 *   M7-75): the start beach on the south coast, six beacon sites (one per boss biome) and
 *   the Nachtherz, each with its boss arena on the same plateau; Builder vaults 3–4 per biome; every
 *   place type of §21 present in its wanted count; biome, level, islet and coast rules per type;
 *   discs keep their gap and same-type spacing; every disc is flat, dry land of one level without
 *   ramps, fords or lava; a cave mouth per entrance of the underground, at its tile.
 * - Chunks (Klein): every disc carries the place flag and no objects but those its place layout stamps (M7-07),
 *   cave mouths lead down.
 */
import { describe, expect, it } from 'vitest';
import { TILE_FLAG_PLACE, TILE_FLAG_STAIRS, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { generateChunk } from '../../../src/world/gen/chunk';
import { layoutCellAt, placeLayout } from '../../../src/world/gen/places';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { generateWorld } from '../../../src/world/gen/world';
import { TIMEOUT_MS, discTiles, locationSizes } from './locations-groessen';
import { UNIT_SIZES } from './weltgroessen';

describe('Orts-Slots (3 Seeds × 3 Größen)', () => {
  locationSizes(UNIT_SIZES);
});

describe('Orte in den Chunks (Klein)', () => {
  it('Ortsflächen tragen das Ortsflag und keine Objekte außer denen ihrer Ortsvorlage (M7-07), Höhleneingänge führen hinab', () => {
    const w = generateWorld(20260924, 'small');
    const n = w.plan.grid.tiles / CHUNK_SIZE;
    const cache = new Map<number, ChunkData>();
    const at = (x: number, y: number): { chunk: ChunkData; i: number } => {
      const key = Math.floor(y / CHUNK_SIZE) * n + Math.floor(x / CHUNK_SIZE);
      let chunk = cache.get(key);
      if (chunk === undefined) {
        chunk = generateChunk(w, 0, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
        cache.set(key, chunk);
      }
      return { chunk, i: (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE) };
    };
    // The objects the place layouts stamp (src/world/gen/places/stamp.ts): their own, on their cells – nothing else.
    const ids = contentWorldIdTables();
    const layoutObject = new Map<string, number>();
    for (const p of w.placeLayouts) {
      const layout = placeLayout(p.layout);
      for (let v = 0; v < p.height; v++) {
        for (let u = 0; u < p.width; u++) {
          const id = layout.object[layoutCellAt(layout, p.rotation, p.mirror, u, v)];
          if (id !== null && id !== undefined) layoutObject.set(`${p.x0 + u},${p.y0 + v}`, ids.objects.runtimeId(id));
        }
      }
    }
    const bad: string[] = [];
    let stamped = 0;
    for (const slot of w.locations) {
      for (const [x, y] of discTiles(slot)) {
        const { chunk, i } = at(x, y);
        if (((chunk.flags[i] as number) & TILE_FLAG_PLACE) === 0) bad.push(`${slot.type} ${slot.id} @ ${x},${y}: ohne Ortsflag`);
        const o = chunk.object[i] as number;
        if (o !== 0 && layoutObject.get(`${x},${y}`) !== o) bad.push(`${slot.type} ${slot.id} @ ${x},${y}: Objekt`);
        if (o !== 0) stamped++;
      }
      if (slot.type === 'hoehleneingang') {
        const { chunk, i } = at(slot.x, slot.y);
        if (((chunk.flags[i] as number) & TILE_FLAG_STAIRS) === 0) bad.push(`Höhleneingang ${slot.id}: kein Abstieg`);
      }
    }
    expect(bad).toEqual([]);
    expect(stamped).toBeGreaterThan(0);
  }, TIMEOUT_MS);
});
