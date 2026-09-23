/**
 * M1-08: Generator-Framework (gleicher Seed ⇒ identische Pixel), Materialstufen-Recolor (eine Form ×
 * 8 Material-Rampen) und Möbel-Farbvarianten; dazu die Zeichenhilfen für Generatoren.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import axtStufen from '../../../assets-src/sprites/werkzeug/axt';
import { defineGenerator, isGeneratorResult } from '../../../assets-src/lib/generator';
import { PixelCanvas, blobMask, darkestOfRamp } from '../../../assets-src/lib/raster';
import { HOLZ_VARIANTEN, STOFF_VARIANTEN, farbVarianten, materialStufen, recolor } from '../../../assets-src/lib/recolor';
import { MATERIAL_BITS, TRANSPARENT, sprite, spriteColorCount, spriteFromPixels, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteIndex, rampStart } from '../../../assets-src/palette';
import { MATERIAL_TIERS, PALETTE_ROWS, identityMap } from '../../../assets-src/paletteRows';
import { Rng } from '../../../src/engine/rng';
import { felsGenerator } from '../../fixtures/sprites/generatoren';

function pixelHash(sprites: readonly Sprite[]): string {
  const h = createHash('sha256');
  for (const s of sprites) {
    h.update(`${s.id}:${s.w}x${s.h}`);
    for (const f of s.frames) h.update(f.index).update(f.emissive).update(f.material);
  }
  return h.digest('hex');
}

describe('Generator-Framework', () => {
  it('gleicher Seed ⇒ identische Pixel (Hash); anderer Seed ⇒ andere Pixel', () => {
    const a = felsGenerator.generate(42, { anzahl: 4, groesse: 16 });
    const b = felsGenerator.generate(42, { anzahl: 4, groesse: 16 });
    const c = felsGenerator.generate(43, { anzahl: 4, groesse: 16 });
    expect(isGeneratorResult(a)).toBe(true);
    expect(a.seed).toBe(42);
    expect(a.sprites.map((s) => s.id)).toEqual(['fx_fels_0', 'fx_fels_1', 'fx_fels_2', 'fx_fels_3']);
    expect(pixelHash(a.sprites)).toBe(pixelHash(b.sprites));
    expect(pixelHash(a.sprites)).not.toBe(pixelHash(c.sprites));
  });

  it('der Generatorname fließt in den Seed ein; doppelte Ids sind ein Fehler', () => {
    const draw = (rng: Rng): Sprite => spriteFromPixels({ id: 'zufall', size: [4, 1], anchor: [2, 1], hoehe: 'flach' }, [{ index: Uint8Array.from({ length: 4 }, () => rng.int(1, 65)) }]);
    const a = defineGenerator('a', draw).generate(1, undefined);
    const b = defineGenerator('b', draw).generate(1, undefined);
    expect(pixelHash(a.sprites)).not.toBe(pixelHash(b.sprites));
    const doppelt = defineGenerator('doppelt', (rng: Rng) => [draw(rng), draw(rng)]);
    expect(() => doppelt.generate(1, undefined)).toThrow(/zufall doppelt/);
  });

  it('Felsen aus dem Fixture-Generator sind geschlossene Formen mit Outline in der dunkelsten Rampenstufe', () => {
    const [fels] = felsGenerator.generate(7, { anzahl: 1, groesse: 16 }).sprites;
    expect(fels).toBeDefined();
    if (fels === undefined) return;
    const index = fels.frames[0]?.index ?? new Uint8Array();
    const used = new Set(Array.from(index).filter((v) => v !== TRANSPARENT));
    expect(used).toContain(paletteIndex('stein.0'));
    expect(used.size).toBeGreaterThanOrEqual(4);
    expect(spriteColorCount(fels)).toBeLessThanOrEqual(12);
  });
});

describe('Zeichenhilfen', () => {
  it('Linie, Ellipse, selektive Outline, Blob', () => {
    const c = new PixelCanvas(8, 8);
    c.line(0, 0, 7, 7, 'holz.3');
    for (let i = 0; i < 8; i++) expect(c.get(i, i)).toBe(paletteIndex('holz.3'));
    expect(c.get(1, 0)).toBe(TRANSPARENT);
    const e = new PixelCanvas(9, 9);
    e.fillEllipse(4.5, 4.5, 3, 3, 'gras.3');
    e.outline();
    expect(e.get(4, 4)).toBe(paletteIndex('gras.3'));
    expect(e.get(4, 1)).toBe(paletteIndex('gras.3'));
    expect(e.get(4, 0)).toBe(paletteIndex('gras.0'));
    expect(e.get(0, 0)).toBe(TRANSPARENT);
    expect(darkestOfRamp(paletteIndex('feuer.4'))).toBe(rampStart('feuer'));
    const m1 = blobMask(new Rng(5), 16, 16, 8, 8, 6, 5, 0.25);
    const m2 = blobMask(new Rng(5), 16, 16, 8, 8, 6, 5, 0.25);
    expect(Array.from(m1)).toEqual(Array.from(m2));
    expect(m1[8 * 16 + 8]).toBe(1);
    expect(m1[0]).toBe(0);
  });
});

describe('Materialstufen (eine Form × 8 Material-Rampen)', () => {
  const form = sprite({
    id: 'haue',
    size: [4, 2],
    anchor: [2, 2],
    hoehe: 'block',
    legende: { '.': null, a: 'stein.0', f: 'stein.5', h: 'holz.2' },
    frames: ['afhh\naa..'],
  });

  it('erzeugt 8 Sprites <id>_<material>; nur stein-Pixel wechseln die Farbe', () => {
    const stufen = materialStufen(form);
    expect(stufen.map((s) => s.id)).toEqual(MATERIAL_TIERS.map((t) => `haue_${t.id}`));
    stufen.forEach((s, i) => {
      const tier = MATERIAL_TIERS[i];
      const f = s.frames[0];
      if (tier === undefined || f === undefined) throw new Error('Stufe fehlt');
      expect(f.index[0]).toBe(paletteIndex(tier.farben[0] ?? ''));
      expect(f.index[1]).toBe(paletteIndex(tier.farben[5] ?? ''));
      expect(f.index[2]).toBe(paletteIndex('holz.2'));
      expect(f.material[0]).toBe((tier.metall ? MATERIAL_BITS.metall : 0) | (tier.kristall ? MATERIAL_BITS.eis : 0));
      expect(f.material[2]).toBe(0);
      expect(f.emissive[1]).toBe(tier.leuchtetAb !== null && tier.leuchtetAb <= 5 ? 1 : 0);
      expect(f.emissive[0]).toBe(0);
    });
  });

  it('die Axt aus assets-src liefert 8 unterscheidbare Stufen-Äxte mit je ≤ 12 Farben', () => {
    expect(axtStufen.map((s) => s.id)).toEqual(MATERIAL_TIERS.map((t) => `axt_${t.id}`));
    const heads = new Set(axtStufen.map((s) => Array.from(s.frames[0]?.index ?? []).join(',')));
    expect(heads.size).toBe(8);
    for (const s of axtStufen) expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(12);
    expect(axtStufen.find((s) => s.id === 'axt_magmit')?.frames[0]?.emissive.some((v) => v > 0)).toBe(true);
    expect(axtStufen.find((s) => s.id === 'axt_stein')?.frames[0]?.material.some((v) => v > 0)).toBe(false);
  });

  it('recolor mit der Identität ändert nichts außer der Id; Palettenzeilen stimmen mit MATERIAL_TIERS überein', () => {
    const same = recolor(form, 'haue_kopie', identityMap());
    expect(same.id).toBe('haue_kopie');
    expect(Array.from(same.frames[0]?.index ?? [])).toEqual(Array.from(form.frames[0]?.index ?? []));
    for (const t of MATERIAL_TIERS) {
      const r = PALETTE_ROWS.find((x) => x.id === t.zeile);
      expect(r?.map[rampStart('stein') - 1]).toBe(paletteIndex(t.farben[0] ?? ''));
    }
  });
});

describe('Möbel-Farbvarianten', () => {
  const bett = sprite({
    id: 'bett',
    size: [3, 1],
    anchor: [1, 1],
    hoehe: 'block',
    legende: { s: 'laub.2', S: 'laub.4', w: 'holz.2' },
    frames: ['sSw'],
  });

  it('Stoff (laub) wird je Variante getauscht, Holz bleibt', () => {
    const v = farbVarianten(bett, STOFF_VARIANTEN);
    expect(v.map((s) => s.id)).toEqual(['bett_rot', 'bett_gruen', 'bett_blau', 'bett_violett', 'bett_ocker', 'bett_grau']);
    const blau = v.find((s) => s.id === 'bett_blau')?.frames[0]?.index;
    expect(Array.from(blau ?? [])).toEqual([paletteIndex('wasser.3'), paletteIndex('wasser.5'), paletteIndex('holz.2')]);
    const rot = v.find((s) => s.id === 'bett_rot')?.frames[0]?.index;
    expect(Array.from(rot ?? [])).toEqual(Array.from(bett.frames[0]?.index ?? []));
  });

  it('Holzvarianten tauschen holz; doppelte Varianten-Ids sind ein Fehler', () => {
    const v = farbVarianten(bett, HOLZ_VARIANTEN);
    expect(v.map((s) => s.id)).toEqual(['bett_eiche', 'bett_nussbaum', 'bett_birke']);
    expect(v[2]?.frames[0]?.index[2]).toBe(paletteIndex('sand.2'));
    expect(v[1]?.frames[0]?.index[0]).toBe(paletteIndex('laub.2'));
    expect(() => farbVarianten(bett, [{ id: 'a', tausch: {} }, { id: 'a', tausch: {} }])).toThrow(/doppelt/);
  });
});
