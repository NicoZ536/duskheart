/**
 * Place layouts in the world generator (M7-07; docs/SPIEL.md §18 "Vorlagen als ASCII", ADR-0207): the transform of a layout
 * (mirror east–west, then clockwise quarter turns), the fit into the slot disc, the deterministic choice per slot (large
 * layouts first, small ones only as a fallback), the stamping rule and the chunk stamping matching the marks.
 */
import { describe, expect, it } from 'vitest';
import type { PlaceLayoutDef } from '../../../src/content/places/schema';
import type { LocationSlot, LocationType } from '../../../src/world/gen/locations';
import {
  compileLayout,
  contentPlaceLayouts,
  layoutCellAt,
  layoutFitsDisc,
  placementOf,
  PlaceStamper,
  selectPlaceLayouts,
  STAMP_ALL,
  STAMP_MARK,
  STAMP_NONE,
  stampRight,
  turnedSize,
  type StampTest,
} from '../../../src/world/gen/places';
import { RES_BRIDGE, RES_CAVE, RES_ROAD } from '../../../src/world/gen/worldContext';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

/** An asymmetric 3 × 2 layout: `a b c` over `d e f`, each cell its own mark data. */
const PROBE: PlaceLayoutDef = {
  id: 'probe_vorlage',
  ortstyp: 'schrein',
  biom: 'gruenhain',
  drehbar: true,
  legende: {
    a: { marke: 'truhe', daten: 'a' },
    b: { marke: 'truhe', daten: 'b' },
    c: { marke: 'truhe', daten: 'c' },
    d: { marke: 'truhe', daten: 'd' },
    e: { marke: 'truhe', daten: 'e' },
    f: { marke: 'truhe', daten: 'f' },
  },
  zeilen: ['abc', 'def'],
};

/** The turned layout as rows of its mark data. */
function rows(rotation: 0 | 1 | 2 | 3, mirror: boolean): string[] {
  const l = compileLayout(PROBE);
  const { w, h } = turnedSize(l, rotation);
  return Array.from({ length: h }, (_, v) => Array.from({ length: w }, (_, u) => l.data[layoutCellAt(l, rotation, mirror, u, v)]).join(''));
}

function slot(id: number, type: LocationType, radius: number, x = 200 + id * 40, y = 200): LocationSlot {
  return { id, type, variant: '', x, y, radius, level: 0, region: 0, biome: 'gruenhain', tier: 0, landmass: 0, link: -1 };
}

const ALL: StampTest = () => STAMP_ALL;

describe('place layouts: transform and fit', () => {
  it('turns clockwise, mirrors east–west first', () => {
    expect(rows(0, false)).toEqual(['abc', 'def']);
    expect(rows(1, false)).toEqual(['da', 'eb', 'fc']);
    expect(rows(2, false)).toEqual(['fed', 'cba']);
    expect(rows(3, false)).toEqual(['cf', 'be', 'ad']);
    expect(rows(0, true)).toEqual(['cba', 'fed']);
    expect(rows(1, true)).toEqual(['fc', 'eb', 'da']);
  });

  it('a layout fits a disc when every stamped cell lies inside it (kept corners do not count)', () => {
    const beacon = contentPlaceLayouts().get('leuchtfeuer_gruenhain_01');
    expect(beacon).toBeDefined();
    if (beacon === undefined) return;
    expect(layoutFitsDisc(beacon, 0, false, 6)).toBe(true);
    expect(layoutFitsDisc(beacon, 0, false, 5)).toBe(false);
  });
});

describe('place layouts: choice per slot', () => {
  const layouts = [...contentPlaceLayouts().values()];

  it('is a pure function of seed and slot: same seed, same placements; other seeds turn and choose differently', () => {
    const slots = Array.from({ length: 24 }, (_, i) => slot(i, i % 2 === 0 ? 'friedhof' : 'buddelstelle', i % 2 === 0 ? 6 : 1));
    const a = selectPlaceLayouts(7, slots, layouts, [], ALL);
    expect(selectPlaceLayouts(7, slots, layouts, [], ALL)).toEqual(a);
    expect(a).toHaveLength(24);
    const b = selectPlaceLayouts(8, slots, layouts, [], ALL);
    expect(b.map((p) => `${p.rotation}${p.mirror}`)).not.toEqual(a.map((p) => `${p.rotation}${p.mirror}`));
    // Never-turned layouts stay unturned; the turnable dig site takes every turn over the slots.
    for (const p of a.filter((q) => q.type === 'friedhof')) expect([p.rotation, p.mirror]).toEqual([0, false]);
    expect(new Set(a.filter((q) => q.type === 'buddelstelle').map((p) => p.rotation)).size).toBeGreaterThan(1);
  });

  it('takes the large layout where it fits, the small one only as a fallback', () => {
    const [wide, tight] = selectPlaceLayouts(3, [slot(0, 'schrein', 3), slot(1, 'schrein', 2)], layouts, [], ALL);
    expect(wide?.layout).toBe('schrein_gruenhain_01');
    expect(tight?.layout).toBe('schrein_gruenhain_02');
  });

  it('a slot of a type or biome without layouts gets none', () => {
    expect(selectPlaceLayouts(3, [slot(0, 'wrack', 4)], layouts, [], ALL)).toEqual([]);
  });

  it('the start clearing keeps no place: a slot whose disc reaches into it stays free, one just outside gets its layout', () => {
    // Spawn at (200, 200), clearing 40 tiles: a shrine of radius 3 whose edge lies 39 tiles away, and one at 41.
    const clearing = { x: 200, y: 200, radius: 40 };
    const near = slot(0, 'schrein', 3, 242, 200);
    const far = slot(1, 'schrein', 3, 244, 200);
    expect(selectPlaceLayouts(3, [near, far], layouts, [], ALL, clearing).map((p) => p.slot)).toEqual([1]);
    expect(selectPlaceLayouts(3, [near, far], layouts, [], ALL).map((p) => p.slot)).toEqual([0, 1]);
  });
});

describe('place layouts: stamping', () => {
  it('the rule: dry land on the place’s level, no ramp, ford or lava, no bridge or cave mouth; a road keeps its road', () => {
    expect(stampRight(true, 0, 0, 0, 0, 0, false)).toBe(STAMP_ALL);
    expect(stampRight(true, 0, 0, 0, 0, RES_ROAD, false)).toBe(STAMP_MARK);
    expect(stampRight(false, 0, 0, 0, 0, 0, false)).toBe(STAMP_NONE);
    expect(stampRight(true, 1, 0, 0, 0, 0, false)).toBe(STAMP_NONE);
    expect(stampRight(true, 0, 0, 2, 0, 0, false)).toBe(STAMP_NONE);
    expect(stampRight(true, 0, 0, 0, 1, 0, false)).toBe(STAMP_NONE);
    expect(stampRight(true, 0, 0, 0, 0, 0, true)).toBe(STAMP_NONE);
    expect(stampRight(true, 0, 0, 0, 0, RES_BRIDGE, false)).toBe(STAMP_NONE);
    expect(stampRight(true, 0, 0, 0, 0, RES_CAVE | RES_ROAD, false)).toBe(STAMP_NONE);
  });

  it('stamps ground and objects where the rule allows, keeps "." and road tiles, and the marks name the stamped cells', () => {
    const ids = contentWorldIdTables();
    const layout = contentPlaceLayouts().get('gehoeft_gruenhain_01');
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const s = slot(0, 'gehoeft', 7, 40, 40);
    const x0 = s.x - Math.floor(layout.w / 2);
    const y0 = s.y - Math.floor(layout.h / 2);
    // The road runs along the layout's column 7; one tile (column 3, row 7) is water.
    const rule = (tx: number, ty: number): number => (tx === x0 + 3 && ty === y0 + 7 ? STAMP_NONE : tx === x0 + 7 ? STAMP_MARK : STAMP_ALL);
    const placement = placementOf(s, layout, 0, false, x0, y0, rule);
    const stamper = new PlaceStamper([placement], [0], ids, 32);
    expect(stamper.touches(1, 1)).toBe(true);
    expect(stamper.touches(3, 3)).toBe(false);
    const chunk = new ChunkData(0, 1, 1);
    const grass = ids.terrain.runtimeId('gras');
    const bush = ids.objects.runtimeId(ids.objects.ids()[1] as string);
    chunk.ground.fill(grass);
    chunk.object.fill(bush);
    stamper.stampChunk(chunk, CHUNK_SIZE, CHUNK_SIZE, { stampRight: (tx, ty) => rule(tx, ty) });
    const at = (tx: number, ty: number): { ground: string; object: string | null } => {
      const i = (ty - CHUNK_SIZE) * CHUNK_SIZE + (tx - CHUNK_SIZE);
      const o = chunk.object[i] as number;
      return { ground: ids.terrain.stringId(chunk.ground[i] as number), object: o === 0 ? null : ids.objects.stringId(o) };
    };
    for (let v = 0; v < layout.h; v++) {
      for (let u = 0; u < layout.w; u++) {
        const tx = x0 + u;
        const ty = y0 + v;
        const cell = layoutCellAt(layout, 0, false, u, v);
        const here = at(tx, ty);
        if (layout.keep[cell] === 1 || rule(tx, ty) !== STAMP_ALL) {
          expect(here, `${u},${v} untouched`).toEqual({ ground: 'gras', object: ids.objects.stringId(bush) });
          continue;
        }
        expect(here.ground, `${u},${v} ground`).toBe(layout.ground[cell] ?? 'gras');
        expect(here.object, `${u},${v} object`).toBe(layout.object[cell]);
      }
    }
    // Every mark lies on a stamped or road cell of the layout; the one on water is gone.
    expect(placement.markers.length).toBeGreaterThan(0);
    for (const m of placement.markers) expect(rule(m.tx, m.ty)).not.toBe(STAMP_NONE);
    const chests = placement.markers.filter((m) => m.mark === 'truhe');
    expect(chests.map((m) => at(m.tx, m.ty).object)).toEqual(chests.map((m) => `ort_truhe_${m.data}`));
  });
});
