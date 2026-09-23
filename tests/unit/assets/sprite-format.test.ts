/**
 * M1-03: Sprite-Quellformat `sprite()` (MASTERPROMPT §5, docs/RENDER.md §1). Das Beispiel `fackel_wand`
 * aus §5 parst (Stufen 0-basiert wie in docs/RENDER.md: `feuer.3*`/`feuer.5*`; das Raster aus §5 steht
 * unten in der 16×16-Zelle); unbekannte Legendenzeichen und ungleiche Framegrößen sind Fehler.
 */
import { describe, expect, it } from 'vitest';
import fackelWand from '../../../assets-src/sprites/licht/fackel_wand';
import { paletteIndex } from '../../../assets-src/palette';
import {
  HEIGHT_AUTO_VALUE,
  MATERIAL_BITS,
  SpriteFormatError,
  TRANSPARENT,
  rasterRows,
  resolveColor,
  sprite,
  spriteColorCount,
  spriteColors,
  spriteFromPixels,
  spriteHasEmissive,
  spriteMaterialFlags,
  type SpriteSource,
} from '../../../assets-src/lib/sprite';

const EMPTY_ROW = '................';

/** §5-Beispiel: fünf Rasterzeilen, darüber leere Zeilen bis zur Zellhöhe 16. */
const PARAGRAPH_5_RASTER = [
  ...Array.from({ length: 11 }, () => EMPTY_ROW),
  '......fF........',
  '.....fFFf.......',
  '......fF........',
  '.......O........',
  '.......o........',
].join('\n     ');

function example(overrides: Partial<SpriteSource> = {}): SpriteSource {
  return {
    id: 'fackel_wand',
    group: 'licht',
    size: [16, 16],
    anchor: [8, 15],
    hoehe: 'zylinder',
    legende: { '.': null, o: 'holz.2', O: 'holz.4', f: 'feuer.3*', F: 'feuer.5*' },
    frames: [PARAGRAPH_5_RASTER],
    clips: { idle: { frames: [0], fps: 10, loop: true } },
    ...overrides,
  };
}

function px(s: ReturnType<typeof sprite>, frame: number, x: number, y: number): { index: number; emissive: number; material: number } {
  const f = s.frames[frame];
  if (f === undefined) throw new Error('Frame fehlt');
  const p = y * s.w + x;
  return { index: f.index[p] ?? -1, emissive: f.emissive[p] ?? -1, material: f.material[p] ?? -1 };
}

describe('sprite(): Beispiel aus §5', () => {
  it('parst: Legende → Palettenindex, * → emissiv, Anker, Clip, Gruppe', () => {
    const s = sprite(example());
    expect(s.kind).toBe('sprite');
    expect([s.id, s.group, s.w, s.h, s.hoehe]).toEqual(['fackel_wand', 'licht', 16, 16, 'zylinder']);
    expect(s.anchor).toEqual([8, 15]);
    expect(s.frames).toHaveLength(1);
    expect(px(s, 0, 6, 11)).toEqual({ index: paletteIndex('feuer.3'), emissive: 1, material: 0 });
    expect(px(s, 0, 7, 11)).toEqual({ index: paletteIndex('feuer.5'), emissive: 1, material: 0 });
    expect(px(s, 0, 7, 14)).toEqual({ index: paletteIndex('holz.4'), emissive: 0, material: 0 });
    expect(px(s, 0, 7, 15)).toEqual({ index: paletteIndex('holz.2'), emissive: 0, material: 0 });
    expect(px(s, 0, 0, 0).index).toBe(TRANSPARENT);
    expect(spriteColors(s)).toEqual([paletteIndex('holz.2'), paletteIndex('holz.4'), paletteIndex('feuer.3'), paletteIndex('feuer.5')].sort((a, b) => a - b));
    expect(s.clips.idle).toEqual({ frames: [0], fps: 10, loop: true, events: [] });
    expect(spriteHasEmissive(s)).toBe(true);
    expect(s.farbFehler).toEqual([]);
    // Standardwerte
    expect(s.occluder).toEqual({ kind: 'none' });
    expect(s.schatten).toBe('silhouette');
    expect(s.hitbox).toBeNull();
    expect(s.spiegelbar).toBe(false);
  });

  it('die ausgearbeitete Wandfackel (assets-src) hat 4 Flammen-Frames, ≤ 12 Farben und Metall am Ring', () => {
    expect(fackelWand.id).toBe('fackel_wand');
    expect(fackelWand.frames).toHaveLength(4);
    expect(fackelWand.clips.idle?.frames).toEqual([0, 3, 2, 1]);
    expect(spriteColorCount(fackelWand)).toBeLessThanOrEqual(12);
    expect(spriteMaterialFlags(fackelWand)).toBe(MATERIAL_BITS.metall);
    expect(fackelWand.sockets.licht).toHaveLength(4);
    // Die Flammenframes unterscheiden sich, der Griff nicht.
    const rows = fackelWand.frames.map((f) => Array.from(f.index.subarray(0, 16 * 9)).join(','));
    expect(new Set(rows).size).toBe(4);
    const griff = fackelWand.frames.map((f) => Array.from(f.index.subarray(16 * 9)).join(','));
    expect(new Set(griff).size).toBe(1);
  });
});

describe('sprite(): Fehler', () => {
  it('unbekanntes Legendenzeichen ⇒ SpriteFormatError mit Frame und Position', () => {
    const frames = [PARAGRAPH_5_RASTER.replace('.......o........', '.......x........')];
    expect(() => sprite(example({ frames }))).toThrow(SpriteFormatError);
    expect(() => sprite(example({ frames }))).toThrow(/Frame 0 \(7, 15\): Zeichen "x" fehlt in der Legende/);
  });

  it('ungleiche Framegrößen ⇒ Fehler (Zeilenzahl und Zeilenlänge)', () => {
    const kurz = PARAGRAPH_5_RASTER.split('\n').slice(1).join('\n');
    expect(() => sprite(example({ frames: [PARAGRAPH_5_RASTER, kurz] }))).toThrow(/Frame 1: 15 Zeilen, erwartet 16/);
    const schmal = PARAGRAPH_5_RASTER.replace('.......o........', '.......o.......');
    expect(() => sprite(example({ frames: [PARAGRAPH_5_RASTER, schmal] }))).toThrow(/Frame 1 Zeile 15: 15 Zeichen, erwartet 16/);
  });

  it('Schema- und Strukturfehler werden mit Sprite-Id gemeldet', () => {
    expect(() => sprite(example({ id: 'Fackel Wand' }))).toThrow(/Sprite Fackel Wand: id/);
    expect(() => sprite(example({ hoehe: 'kegel' as never }))).toThrow(/hoehe/);
    expect(() => sprite(example({ legende: { '..': null } }))).toThrow(/genau ein sichtbares Zeichen/);
    expect(() => sprite(example({ legende: { '.': null, o: 'holz', O: 'holz.4', f: 'feuer.3*', F: 'feuer.5*' } }))).toThrow(/legende\.o/);
    expect(() => sprite(example({ anchor: [17, 3] }))).toThrow(/Anker/);
    expect(() => sprite(example({ hitbox: [10, 10, 8, 2] }))).toThrow(/Hitbox/);
    expect(() => sprite(example({ clips: { idle: { frames: [0, 1], fps: 10 } } }))).toThrow(/Clip idle nennt Frame 1/);
    expect(() => sprite(example({ clips: { idle: { frames: [0], fps: 10, events: [{ frame: 1, name: 'schritt' }] } } }))).toThrow(/Event schritt/);
    expect(() => sprite(example({ frames: [PARAGRAPH_5_RASTER, PARAGRAPH_5_RASTER], sockets: { hand: [[1, 1], [2, 2], [3, 3]] } }))).toThrow(/Sockel hand: 3 Punkte, erwartet 1 oder 2/);
    expect(() => sprite(example({ hoehe: 'custom' }))).toThrow(/custom.*hoehenRaster/);
    expect(() => sprite(example({ material: { metall: 'q' } }))).toThrow(/Material metall: Zeichen "q"/);
    expect(() => sprite(example({ occluder: { kind: 'rect', x: 10, y: 10, w: 8, h: 2 } }))).toThrow(/Occluder/);
    expect(() => sprite(example({ ausnahmeFarben: 'weil' }))).toThrow(/Begründung/);
    expect(() => sprite(example({ frames: [] }))).toThrow(/frames/);
  });
});

describe('sprite(): Format-Details', () => {
  it('Einrückung und Leerzeilen der Template-Strings fallen weg', () => {
    expect(rasterRows(`
        ab
        cd
    `)).toEqual(['ab', 'cd']);
    const s = sprite({ id: 'mini', size: [2, 2], anchor: [1, 2], hoehe: 'flach', legende: { a: 'stein.0', b: 'stein.1' }, frames: [`\n      ab\n      ba\n    `] });
    expect(Array.from(s.frames[0]?.index ?? [])).toEqual([6, 7, 7, 6]);
    expect(s.schatten).toBe('none');
  });

  it('Materialflags je Zeichen oder für alle deckenden Pixel', () => {
    const base = { id: 'mat', size: [2, 1] as [number, number], anchor: [1, 1] as [number, number], hoehe: 'flach' as const, legende: { '.': null, m: 'stein.3', w: 'wasser.4' }, frames: ['mw'] };
    const s = sprite({ ...base, material: { metall: 'm', nass: 'w', eis: 'w' } });
    expect(px(s, 0, 0, 0).material).toBe(MATERIAL_BITS.metall);
    expect(px(s, 0, 1, 0).material).toBe(MATERIAL_BITS.nass | MATERIAL_BITS.eis);
    const all = sprite({ ...base, material: { dach: true } });
    expect(spriteMaterialFlags(all)).toBe(MATERIAL_BITS.dach);
  });

  it('Farben: Hexwert nur exakt aus der Palette, sonst Farbfehler (kein Abbruch)', () => {
    expect(resolveColor('#d4471e*')).toEqual({ index: paletteIndex('feuer.2'), emissive: true });
    expect(resolveColor('stein.3')).toEqual({ index: paletteIndex('stein.3'), emissive: false });
    expect(resolveColor('#ff00ff')).toEqual({ error: expect.stringMatching(/#ff00ff ist keine Palettenfarbe \(nächste: \w+\.\d\)/) });
    const s = sprite({ id: 'fremd', size: [2, 1], anchor: [1, 1], hoehe: 'flach', legende: { a: 'stein.2', p: '#ff00ff', q: 'eis.9' }, frames: ['ap'] });
    expect(s.farbFehler).toHaveLength(2);
    expect(s.fremdFarben).toBe(1);
    expect(spriteColorCount(s)).toBe(2);
  });

  it('Sockel mit einem Punkt gelten für alle Frames; hoehenRaster überschreibt pixelweise', () => {
    const s = sprite({
      id: 'sockel',
      size: [3, 2],
      anchor: [1, 2],
      hoehe: 'block',
      legende: { a: 'holz.2' },
      frames: ['aaa\naaa', 'aaa\naaa'],
      sockets: { hand: [[1, 0]] },
      hoehenRaster: `.9.
                     a.w`,
    });
    expect(s.sockets.hand).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(Array.from(s.frames[1]?.heightOverride ?? [])).toEqual([HEIGHT_AUTO_VALUE, 9, HEIGHT_AUTO_VALUE, 10, HEIGHT_AUTO_VALUE, 32]);
    expect(() => sprite({ id: 'hoch', size: [1, 1], anchor: [0, 1], hoehe: 'custom', legende: { a: 'holz.2' }, frames: ['a'], hoehenRaster: 'z' })).toThrow(/keine Höhe/);
  });

  it('spriteFromPixels prüft Puffergrößen und Palettenbereich', () => {
    const ok = spriteFromPixels({ id: 'pix', size: [2, 1], anchor: [1, 1], hoehe: 'flach' }, [{ index: Uint8Array.of(1, 64) }]);
    expect(spriteColors(ok)).toEqual([1, 64]);
    const bad = spriteFromPixels({ id: 'pix', size: [2, 1], anchor: [1, 1], hoehe: 'flach' }, [{ index: Uint8Array.of(1, 65) }]);
    expect(bad.farbFehler).toEqual(['Frame 0 (1, 0): Index 65 liegt außerhalb der Palette']);
    expect(() => spriteFromPixels({ id: 'pix', size: [2, 1], anchor: [1, 1], hoehe: 'flach' }, [{ index: Uint8Array.of(1) }])).toThrow(/erwartet 2/);
    expect(() => spriteFromPixels({ id: 'pix', size: [2, 1], anchor: [1, 1], hoehe: 'flach' }, [])).toThrow(/mindestens ein Frame/);
  });
});
