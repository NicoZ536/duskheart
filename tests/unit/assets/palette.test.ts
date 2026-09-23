/**
 * M1-01: Master-Palette (MASTERPROMPT §4.3) – 64 Farben in Rampen zu 5–7 Stufen plus 8 UI-Farben,
 * Rampen dunkel → hell, Hue-Shifting: Schatten Richtung Blau/Violett, Lichter Richtung Warmgelb.
 * Farbtöne werden in OKLCH verglichen (wahrnehmungsgleichmäßig).
 */
import { describe, expect, it } from 'vitest';
import { hexToOklch, hueDistance } from '../../../assets-src/lib/color';
import {
  MASTER_COLOR_COUNT,
  PALETTE_SIZE,
  RAMPS,
  RAMP_STEPS_MAX,
  RAMP_STEPS_MIN,
  RARITY_COLORS,
  UI_COLORS,
  UI_COLOR_COUNT,
  flatPalette,
  paletteIndex,
  paletteRef,
  rampStart,
} from '../../../assets-src/palette';
import { PALETTE_ROWS } from '../../../assets-src/paletteRows';
import { decodePng } from '../../../tools/lib/png';
import { paletteSheet } from '../../../tools/assets/sheets';

/** OKLCH-Farbton von Blau/Violett (Mitte zwischen Blau ≈ 264° und Violett ≈ 305°). */
const COOL_HUE = 285;
/** OKLCH-Farbton von Warmgelb (zwischen Orange ≈ 60° und Gelb ≈ 110°). */
const WARM_HUE = 90;

const HEX = /^#[0-9a-f]{6}$/;

function mid(n: number): number {
  return Math.floor((n - 1) / 2);
}

describe('Master-Palette', () => {
  it('hat 64 Rampenfarben und 8 UI-Farben', () => {
    expect(PALETTE_SIZE).toBe(64);
    expect(MASTER_COLOR_COUNT).toBe(PALETTE_SIZE);
    expect(flatPalette()).toHaveLength(64);
    expect(UI_COLOR_COUNT).toBe(8);
    expect(Object.keys(UI_COLORS)).toHaveLength(8);
  });

  it('jede Rampe hat 5–7 Stufen, eindeutigen Namen und gültige, verschiedene Hexfarben', () => {
    expect(RAMP_STEPS_MIN).toBe(5);
    expect(RAMP_STEPS_MAX).toBe(7);
    expect(new Set(RAMPS.map((r) => r.name)).size).toBe(RAMPS.length);
    for (const r of RAMPS) {
      expect(r.colors.length, r.name).toBeGreaterThanOrEqual(5);
      expect(r.colors.length, r.name).toBeLessThanOrEqual(7);
      for (const c of r.colors) expect(c, r.name).toMatch(HEX);
    }
    const all = [...flatPalette(), ...Object.values(UI_COLORS)];
    for (const c of Object.values(UI_COLORS)) expect(c).toMatch(HEX);
    expect(new Set(flatPalette()).size).toBe(64);
    expect(new Set(all).size).toBe(all.length);
  });

  it('Rampen laufen streng von dunkel nach hell (OKLab-Helligkeit)', () => {
    for (const r of RAMPS) {
      const L = r.colors.map((c) => hexToOklch(c).L);
      for (let i = 1; i < L.length; i++) expect(L[i], `${r.name}.${i}`).toBeGreaterThan(L[i - 1] ?? 0);
    }
  });

  it.each(RAMPS.map((r) => [r.name, r] as const))('Hue-Shift %s: Schatten → Blau/Violett, Lichter → Warmgelb', (_name, ramp) => {
    const hues = ramp.colors.map((c) => hexToOklch(c).h);
    const m = hues[mid(hues.length)] ?? 0;
    const dark = hues[0] ?? 0;
    const light = hues[hues.length - 1] ?? 0;
    expect(hueDistance(dark, COOL_HUE), `dunkelste Stufe ${dark.toFixed(0)}° näher an ${COOL_HUE}° als Mitte ${m.toFixed(0)}°`).toBeLessThan(hueDistance(m, COOL_HUE));
    expect(hueDistance(light, WARM_HUE), `hellste Stufe ${light.toFixed(0)}° näher an ${WARM_HUE}° als Mitte ${m.toFixed(0)}°`).toBeLessThan(hueDistance(m, WARM_HUE));
  });

  it('Palettenreferenzen: rampe.stufe ↔ Index 1…64', () => {
    expect(paletteIndex('nacht.0')).toBe(1);
    expect(paletteIndex('verderb.4')).toBe(64);
    for (let i = 1; i <= 64; i++) expect(paletteIndex(paletteRef(i))).toBe(i);
    expect(rampStart('stein')).toBe(6);
    expect(() => paletteIndex('holz.5')).toThrow(/Stufe 5 fehlt/);
    expect(() => paletteIndex('moor.1')).toThrow(/unbekannte Rampe/);
    expect(() => paletteRef(0)).toThrow(/außerhalb/);
    expect(() => paletteRef(65)).toThrow(/außerhalb/);
    for (const ref of Object.values(RARITY_COLORS)) expect(() => paletteIndex(ref)).not.toThrow();
  });

  it('Palettenbild: palette.png zeigt Rampen, UI-Farben und alle Palettenzeilen', () => {
    const png = decodePng(paletteSheet(PALETTE_ROWS));
    expect(png.width).toBeGreaterThan(600);
    expect(png.height).toBeGreaterThan(600);
    // Jede Rampenfarbe kommt im Bild vor.
    const seen = new Set<string>();
    for (let i = 0; i < png.rgba.length; i += 4) seen.add(`${png.rgba[i]},${png.rgba[i + 1]},${png.rgba[i + 2]}`);
    for (const hex of flatPalette()) {
      const v = Number.parseInt(hex.slice(1), 16);
      expect(seen.has(`${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`), hex).toBe(true);
    }
  });
});
