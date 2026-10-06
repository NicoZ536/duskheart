/**
 * The places in a generated world (M7-07 … M7-09; docs/SPIEL.md §18): in a medium world every one of the ten place types of
 * M7 gets a layout, every placement keeps the marks its effect needs, and the generated chunks carry the layout's chests on
 * their chest marks, the tower on the tower's tile, the shrine on the altar. The choice is the same for the same seed.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/content/index';
import type { PlaceDef } from '../../src/content/places/schema';
import { generateChunk } from '../../src/world/gen/chunk';
import { generateWorld } from '../../src/world/gen/world';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

const SEED = 20260923;
/** The ten place types of strand B (M7-08, M7-09). */
const TYPES = ['leuchtfeuer', 'aussichtsturm', 'gehoeft', 'schrein', 'naturwunder', 'buddelstelle', 'eremitenhuette', 'brueckenruine', 'friedhof', 'meteoritenkrater'];
/** The mark each effect needs (tools/validator/orte.ts `EFFECT_MARK`). */
const EFFECT_MARK: Readonly<Record<string, string>> = { aussicht: 'aussicht', segen: 'altar', tafel: 'tafel', buddeln: 'buddel', krater: 'erz' };

describe('places in a generated world (Mittel)', () => {
  it(
    'every type of M7 has places, each with the marks of its effect; the chunks carry chests and monuments on their marks',
    () => {
      const w = generateWorld(SEED, 'medium');
      expect(w.report.problems).toEqual([]);
      const ids = contentWorldIdTables();
      const types = new Set(w.placeLayouts.map((p) => p.type));
      for (const t of TYPES) expect(types.has(t as never), t).toBe(true);
      const chunks = new Map<string, ChunkData>();
      const objectAt = (tx: number, ty: number): string | null => {
        const key = `${tx >> CHUNK_SHIFT},${ty >> CHUNK_SHIFT}`;
        let c = chunks.get(key);
        if (c === undefined) {
          c = generateChunk(w, 0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
          chunks.set(key, c);
        }
        const o = c.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
        return o === 0 ? null : ids.objects.stringId(o);
      };
      let chests = 0;
      for (const p of w.placeLayouts) {
        const def = CONTENT.collection('locationTypes').find(p.type) as PlaceDef | undefined;
        if (def === undefined || !TYPES.includes(p.type)) continue;
        const need = EFFECT_MARK[def.wirkung];
        if (need !== undefined) expect(p.markers.some((m) => m.mark === need), `${p.layout} @${p.slot}: ${need}`).toBe(true);
        for (const m of p.markers) {
          if (m.mark === 'truhe') {
            expect(objectAt(m.tx, m.ty), `${p.layout} chest`).toBe(`ort_truhe_${m.data}`);
            chests++;
          }
          if (m.mark === 'altar') expect(objectAt(m.tx, m.ty)).toBe('ort_schrein');
          if (m.mark === 'erz') expect(objectAt(m.tx, m.ty)).toBe('erz_sternenerz');
        }
      }
      expect(chests).toBeGreaterThan(10);
      // The same seed chooses the same layouts, turns and marks.
      expect(generateWorld(SEED, 'medium').placeLayouts).toEqual(w.placeLayouts);
    },
    WORLD_TIMEOUT_MS * 2,
  );
});
