/**
 * M1-11: palette LUT (64 × rows) – row 0 is the master palette, variant rows remap whole ramps
 * (seasons, corruption, costumes); every LUT texel is a palette colour.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX, PALETTE_RAMPS, UI_HEX } from '../../../src/generated/palette';
import { brightestPaletteIndex, buildPaletteLutPixels, identityRow, nearestPaletteIndex, PALETTE_SIZE, parseHexColor, validateRow } from '../../../src/render/palette/lut';
import { rampRemapRow } from '../../../src/render/palette/rows';
import { scenePaletteRows } from '../../../src/render/assets/sceneSprites';
import { paletteRefResolver } from '../../../src/render/assets/spriteSource';

const RGBA = 4;

function texel(pixels: Uint8Array, index: number, row: number): string {
  const o = (row * PALETTE_SIZE + index - 1) * RGBA;
  return `#${[pixels[o], pixels[o + 1], pixels[o + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

describe('Paletten-LUT', () => {
  it('row 0 shows every palette colour at its index', () => {
    const px = buildPaletteLutPixels(PALETTE_HEX, [identityRow()]);
    expect(px.length).toBe(PALETTE_SIZE * RGBA);
    for (let i = 1; i <= PALETTE_SIZE; i++) expect(texel(px, i, 0)).toBe(PALETTE_HEX[i - 1]);
  });

  it('a ramp remap moves every step proportionally onto the target ramp', () => {
    const ref = paletteRefResolver(PALETTE_RAMPS);
    const autumn = rampRemapRow('herbst', PALETTE_RAMPS, { gras: 'laub' });
    const gras = PALETTE_RAMPS.find((r) => r.name === 'gras');
    const laub = PALETTE_RAMPS.find((r) => r.name === 'laub');
    if (!gras || !laub) throw new Error('Rampen fehlen');
    expect(autumn.map[ref('gras.0') - 1]).toBe(ref('laub.0'));
    expect(autumn.map[ref(`gras.${gras.size - 1}`) - 1]).toBe(ref(`laub.${laub.size - 1}`));
    // Other ramps stay.
    expect(autumn.map[ref('holz.2') - 1]).toBe(ref('holz.2'));
  });

  it('every texel of the scene LUT is a master palette colour', () => {
    const rows = scenePaletteRows();
    const px = buildPaletteLutPixels(PALETTE_HEX, rows);
    const palette = new Set(PALETTE_HEX.slice(0, PALETTE_SIZE));
    for (let r = 0; r < rows.length; r++) for (let i = 1; i <= PALETTE_SIZE; i++) expect(palette.has(texel(px, i, r))).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['grund', 'herbst', 'winter', 'verderbt', 'tracht_blau', 'tracht_gruen']);
  });

  it('rejects broken rows and colours', () => {
    expect(() => validateRow({ name: 'kurz', map: [1, 2, 3] })).toThrow(/3 statt 64/);
    expect(() => validateRow({ name: 'null', map: new Array(PALETTE_SIZE).fill(0) })).toThrow(/außerhalb/);
    expect(() => parseHexColor('rot')).toThrow(/#rrggbb/);
    expect(() => rampRemapRow('x', PALETTE_RAMPS, { gras: 'gibtsnicht' })).toThrow(/fehlt/);
  });

  it('finds the accent and the flash colour in the palette', () => {
    const accent = nearestPaletteIndex(PALETTE_HEX, UI_HEX.akzent);
    expect(accent).toBeGreaterThanOrEqual(1);
    const bright = brightestPaletteIndex(PALETTE_HEX);
    const [r, g, b] = parseHexColor(PALETTE_HEX[bright - 1] ?? '#000000');
    for (const hex of PALETTE_HEX.slice(0, PALETTE_SIZE)) {
      const [pr, pg, pb] = parseHexColor(hex);
      expect(pr + pg + pb).toBeLessThanOrEqual(r + g + b);
    }
  });
});
