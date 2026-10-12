/**
 * M7-151: the sprite table of the generated manifest – frames, clips and sockets as typed-array columns, decoded per
 * sprite on first read, interned (one object per distinct rectangle, frame sequence and socket point), and the entries
 * as both the module's and the renderer's sprite contract. The generator's data (`spriteTableData`) round-trips through
 * the table to the decoded view (`manifestSprites`).
 */
import { describe, expect, it } from 'vitest';
import type { ManifestSprite } from '../../../tools/assets/atlas';
import { manifestSprite, spriteTableData, spriteTableSource, typedColumns } from '../../../tools/assets/manifest';
import { manifestFromGenerated, type GeneratedAtlasModule } from '../../../src/render/assets/generated';
import { RECT_INTS, SEQUENCE_INTS, type SpriteEntry, SpriteTable, type SpriteColumns } from '../../../src/render/assets/spriteTable';

const RECT_A = { x: 1, y: 1, w: 16, h: 16, ax: 8, ay: 15 };
const RECT_B = { x: 18, y: 1, w: 16, h: 16, ax: 8, ay: 15 };
const RECT_C = { x: 35, y: 1, w: 10, h: 12, ax: 5, ay: -3 };
/** The torch's first rectangle with another anchor: a rectangle of its own (the anchor is part of a frame). */
const RECT_A2 = { ...RECT_A, ay: 14 };

function sprite(id: string, over: Partial<ManifestSprite> = {}): ManifestSprite {
  return {
    id,
    group: 'licht',
    size: [16, 16],
    anchor: [8, 15],
    hitbox: null,
    sockets: {},
    frames: [RECT_A, RECT_B, RECT_A],
    clips: { idle: { frames: [0, 1, 2], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] }, aus: { frames: [2], fps: 1, loop: false, events: [] }, an: { frames: [0, 1], fps: 2, loop: true, events: [] } },
    occluder: { kind: 'none' },
    schatten: { kind: 'none' },
    hoehe: 'zylinder',
    emissiv: true,
    material: 8,
    bounds: { x: 4, y: 1, w: 8, h: 15 },
    spiegelbar: true,
    farben: 5,
    ...over,
  };
}

const SPRITES: readonly ManifestSprite[] = [
  sprite('fackel', { sockets: { licht: [[8, 2], [8, 3], [8, 2]] } }),
  // Shares the torch's rectangles and its `aus` sequence; a trimmed frame with a negative anchor; a silhouette shadow.
  sprite('kerze', {
    frames: [RECT_B, RECT_C],
    clips: { brennt: { frames: [0, 1], fps: 1.5, loop: true, events: [] }, aus: { frames: [2], fps: 1, loop: false, events: [] } },
    sockets: { licht: [[8, 3], [1, 1]], kopf: [[8, 2], [8, 2]] },
    occluder: { kind: 'ellipse', x: 8, y: 14, rx: 4, ry: 2 },
    schatten: { kind: 'silhouette', basisY: 15, bounds: { x: 4, y: 1, w: 8, h: 15 } },
    hoehe: 'kugel',
    emissiv: false,
    spiegelbar: false,
  }),
  sprite('leer', { frames: [RECT_A, RECT_A2], clips: {}, sockets: {} }),
];

function table(): SpriteTable {
  const data = spriteTableData(SPRITES);
  return new SpriteTable(data.headers, typedColumns(data.columns));
}

describe('Sprite-Tabelle (M7-151)', () => {
  it('interns rectangles, sequences and points in the columns; spans cover the columns exactly', () => {
    const { headers, columns: c } = spriteTableData(SPRITES);
    expect(headers.map((h) => h.id)).toEqual(['fackel', 'kerze', 'leer']);
    expect(headers[0]).not.toHaveProperty('frames');
    // 7 frames on 4 distinct rectangles (the anchor counts); 5 clips on 3 distinct sequences (`an` and `brennt` play the
    // same frames under different names); 7 socket points on 3 distinct pairs.
    expect([c.frames.length, c.rects.length / RECT_INTS]).toEqual([7, 4]);
    expect(c.frames).toEqual([0, 1, 0, 1, 2, 0, 3]);
    expect([c.clipFps.length, c.sequences.length / SEQUENCE_INTS, c.clipFrames]).toEqual([5, 3, [0, 1, 2, 2, 0, 1]]);
    expect(c.clipNames).toEqual(['idle', 'aus', 'an', 'brennt']);
    expect(c.clipFps).toEqual([12, 1, 2, 1.5, 1]);
    expect([c.socketNames, c.sockets, c.socketPoints, c.points]).toEqual([['licht', 'kopf'], [0, 0, 0, 3, 1, 5], [0, 1, 0, 1, 2, 0, 0], [8, 2, 8, 3, 1, 1]]);
    expect([c.eventNames, c.events]).toEqual([['knistern'], [1, 0]]);
    expect(c.spans).toEqual([0, 3, 0, 3, 0, 1, 3, 2, 3, 2, 1, 2, 5, 2, 5, 0, 3, 0]);
  });

  it('decodes the view the plain manifest shows, sprite by sprite on first read, and keeps it', () => {
    const t = table();
    expect(t.count).toBe(3);
    const plain = Object.fromEntries(SPRITES.map((s) => [s.id, manifestSprite(s)]));
    expect(t.decodedCounts()).toEqual({ sprites: 0, frames: 0, clips: 0, sockets: 0, rects: 0, sequences: 0, points: 0 });
    const fackel = t.sprites['fackel'] as SpriteEntry;
    expect([fackel.id, fackel.group, fackel.size, fackel.anchor, fackel.hoehe, fackel.emissiv, fackel.spiegelbar, fackel.material, fackel.farben]).toEqual(['fackel', 'licht', [16, 16], [8, 15], 'zylinder', true, true, 8, 5]);
    expect(t.decodedCounts().sprites).toBe(0);
    expect(fackel.frames).toEqual(plain['fackel']?.frames);
    expect(t.decodedCounts()).toEqual({ sprites: 1, frames: 1, clips: 0, sockets: 0, rects: 3, sequences: 0, points: 0 });
    expect(fackel.clips).toEqual(plain['fackel']?.clips);
    expect(fackel.sockets).toEqual(plain['fackel']?.sockets);
    expect(t.decodedCounts()).toEqual({ sprites: 1, frames: 1, clips: 1, sockets: 1, rects: 3, sequences: 3, points: 2 });
    // The same objects on every read.
    expect(fackel.frames).toBe(fackel.frames);
    expect(fackel.clips).toBe(fackel.clips);
    expect(fackel.sockets).toBe(fackel.sockets);
    for (const id of ['kerze', 'leer']) {
      const e = t.sprites[id] as SpriteEntry;
      expect([e.frames, e.clips, e.sockets], id).toEqual([plain[id]?.frames, plain[id]?.clips, plain[id]?.sockets]);
    }
    expect(t.decodedCounts()).toEqual({ sprites: 3, frames: 3, clips: 3, sockets: 3, rects: 7, sequences: 3, points: 3 });
  });

  it('every frame is an object of its own (a frame object names sprite and index); sequences and points are shared', () => {
    const t = table();
    const fackel = t.sprites['fackel'] as SpriteEntry;
    const kerze = t.sprites['kerze'] as SpriteEntry;
    // The owner maps of the render tests tell sprite and frame index by the object: a repeated picture within a clip and
    // the candle's copy of the torch's rectangle are equal, never the same object.
    expect(fackel.frames[0]).toEqual(fackel.frames[2]);
    expect(fackel.frames[0]).not.toBe(fackel.frames[2]);
    expect(fackel.frames[1]).toEqual(kerze.frames[0]);
    expect(fackel.frames[1]).not.toBe(kerze.frames[0]);
    expect(fackel.clips['aus']?.frames).toBe(kerze.clips['aus']?.frames);
    expect(fackel.clips['an']?.frames).toBe(kerze.clips['brennt']?.frames);
    const leer = t.sprites['leer'] as SpriteEntry;
    expect(leer.frames[0]).not.toBe(leer.frames[1]);
    expect([leer.frames[0]?.ay, leer.frames[1]?.ay]).toEqual([15, 14]);
    expect(fackel.sockets['licht']?.[0]).toBe(kerze.sockets['kopf']?.[0]);
    expect(fackel.clips['aus']?.events).toBe(kerze.clips['aus']?.events);
  });

  it('an entry is the renderer’s sprite too, and a spread copy carries the decoded views as fields', () => {
    const t = table();
    const kerze = t.sprites['kerze'] as SpriteEntry;
    expect([kerze.heightHint, kerze.emissive, kerze.symmetric, kerze.sunShadow, kerze.occluder, kerze.bounds]).toEqual(['kugel', false, false, true, { kind: 'ellipse', x: 8, y: 14, rx: 4, ry: 2 }, { x: 4, y: 1, w: 8, h: 15 }]);
    expect((t.sprites['fackel'] as SpriteEntry).sunShadow).toBe(false);
    const copy = { ...kerze, clips: (t.sprites['fackel'] as SpriteEntry).clips };
    expect(copy.frames).toBe(kerze.frames);
    expect(copy.sockets).toBe(kerze.sockets);
    expect(Object.keys(copy.clips)).toEqual(['idle', 'aus', 'an']);
    expect(copy).not.toHaveProperty('table');
    expect(JSON.parse(JSON.stringify(kerze)).frames).toEqual(kerze.frames);
    // `manifestFromGenerated` hands the entries out as they are.
    const mod = { ATLAS: { width: 64, height: 32, albedoUrl: 'a', normalUrl: 'n', sourceHash: 'x' }, SPRITES: t.sprites, PALETTE_ROWS: [], OBJEKT_ZEILEN: {} } as unknown as GeneratedAtlasModule;
    const m = manifestFromGenerated(mod);
    expect(m.sprites['kerze']).toBe(kerze);
  });

  it('refuses columns whose extents do not match the headers, in constant time (no value decoded)', () => {
    const data = spriteTableData(SPRITES);
    const c = typedColumns(data.columns);
    const broken = (over: Partial<SpriteColumns>): (() => SpriteTable) => () => new SpriteTable(data.headers, { ...c, ...over });
    expect(broken({ frames: c.frames.subarray(0, 5) })).toThrow(/Spannen enden bei Frame 7, die Frame-Spalte hat 5/);
    expect(broken({ spans: c.spans.subarray(0, 12) })).toThrow(/3 Sprites, aber 2 Spannen/);
    expect(broken({ clipFps: new Float64Array(4) })).toThrow(/Clip-Spalte/);
    expect(broken({ sockets: c.sockets.subarray(0, 4) })).toThrow(/Spannen enden bei Sockel 3, die Sockel-Spalte hat 2/);
    expect(broken({ rects: c.rects.subarray(0, 23) })).toThrow(/Rechteck-Spalte mit 23 Zahlen/);
    expect(() => new SpriteTable([...data.headers, data.headers[0] as (typeof data.headers)[number]], c)).toThrow(/4 Sprites, aber 3 Spannen/);
    expect(table().decodedCounts().sprites).toBe(0);
  });

  it('the source form is JSON for the headers and typed arrays for the columns, and evaluates back to the same table', () => {
    const data = spriteTableData(SPRITES);
    const source = spriteTableSource(data);
    expect(source).toMatch(/^new SpriteTable\(JSON\.parse\(`\[\{"id":"fackel"/);
    expect(source).toMatch(/\n {2}spans: new Int32Array\(JSON\.parse\(`\[0,3,0,3,0,1,/);
    expect(source).toMatch(/\n {2}clipFps: new Float64Array\(JSON\.parse\(`\[12,1,2,1\.5,1\]`\)\),/);
    expect(source).toMatch(/\n {2}clipNames: JSON\.parse\(`\["idle","aus","an","brennt"\]`\),/);
    expect(source).not.toMatch(/"frames":\[\{/);
    const built = new Function('SpriteTable', `return ${source};`)(SpriteTable) as SpriteTable;
    expect(built.count).toBe(3);
    expect(built.columns.points).toEqual(Int32Array.from(data.columns.points));
    expect((built.sprites['kerze'] as SpriteEntry).clips).toEqual((table().sprites['kerze'] as SpriteEntry).clips);
  });

  it('a socket track must have one point per frame', () => {
    expect(() => spriteTableData([sprite('krumm', { sockets: { licht: [[1, 1]] } })])).toThrow(/krumm – Sockel licht hat 1 Punkte für 3 Frames/);
  });
});
