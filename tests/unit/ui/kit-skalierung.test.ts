/**
 * M1-21 Skalierungswahl und Pixelmathematik des UI-Kits: die ganzzahlige UI-Skalierung (Auto oder
 * 1×–4×, src/ui/theme.ts) für typische Bildschirme, und dass jedes Kit-Maß ein ganzzahliges
 * Vielfaches davon ist – im handgeschriebenen Stylesheet, im generierten Stylesheet und bei
 * datenabhängigen Größen (Leistenfüllung, Scrollbar-Griff, Scrollposition).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadUiGrafiken, uiKitCss } from '../../../tools/assets/ui-step';
import { UI_SCALES } from '../../../src/engine/settings';
import { barFillPx, scrollForThumb, snapScroll, thumbGeometry, uiPx } from '../../../src/ui/kit/geometry';
import { autoUiScale, createTheme, devicePixelScale, MAX_UI_SCALE, MIN_UI_SCALE, resolveUiScale, UI_SCALE_VAR } from '../../../src/ui/theme';

const KIT_CSS = readFileSync(join(process.cwd(), 'src/ui/kit/kit.css'), 'utf8');
const SCALES = [1, 2, 3, 4] as const;

describe('UI-Skalierung: Wahl', () => {
  it('Auto wählt das größte ganzzahlige Vielfache von 480×270, das passt (1×–4×)', () => {
    const cases: Array<[number, number, number]> = [
      [320, 200, 1],
      [480, 270, 1],
      [800, 600, 1],
      [960, 540, 2],
      [1280, 720, 2],
      [1366, 768, 2],
      [1440, 810, 3],
      [1600, 900, 3],
      [1920, 1080, 4],
      [2560, 1440, 4],
      [3440, 1440, 4],
      [3840, 2160, 4],
    ];
    for (const [w, h, s] of cases) expect(autoUiScale(w, h), `${w}×${h}`).toBe(s);
  });

  it('eine feste Einstellung gilt unabhängig vom Fenster, Auto folgt ihm', () => {
    for (const setting of UI_SCALES) {
      if (setting === 'auto') expect(resolveUiScale(setting, 1920, 1080)).toBe(4);
      else for (const [w, h] of [[640, 360], [3840, 2160]] as const) expect(resolveUiScale(setting, w, h)).toBe(setting);
    }
    expect([MIN_UI_SCALE, MAX_UI_SCALE]).toEqual([1, 4]);
  });
});

describe('UI-Skalierung: ganze Bildschirmpixel bei jedem Pixelverhältnis', () => {
  it('ein Designpixel deckt immer ganze Gerätepixel (abgerundet, mindestens eines)', () => {
    const ratios = [1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.625, 3];
    for (const dpr of ratios) {
      for (const scale of SCALES) {
        const css = devicePixelScale(scale, dpr);
        const device = css * dpr;
        expect(Math.abs(device - Math.round(device)), `${scale}× bei ${dpr}`).toBeLessThan(1e-9);
        expect(Math.round(device), `${scale}× bei ${dpr}`).toBeGreaterThanOrEqual(1);
        expect(css, `${scale}× bei ${dpr}`).toBeLessThanOrEqual(scale);
      }
    }
    // Windows-Laptop 1920×1080 bei 125 %: Auto 3× → 3 Gerätepixel je Designpixel statt 3,75.
    expect(devicePixelScale(3, 1.25) * 1.25).toBeCloseTo(3, 9);
    expect(devicePixelScale(2, 1.5)).toBe(2);
    expect(devicePixelScale(4, 1)).toBe(4);
    expect(devicePixelScale(1, 0.5)).toBe(2);
    expect(devicePixelScale(2, Number.NaN)).toBe(2);
  });

  it('das Theme schreibt die gerasterte Länge nach --dh-ui-scale und folgt dem Zoom', () => {
    const props = new Map<string, string>();
    const theme = createTheme({ style: { setProperty: (k, v) => props.set(k, v) } }, { setting: 'auto', width: 1536, height: 864, devicePixelRatio: 1.25 });
    expect(theme.uiScale.value).toBe(3);
    expect(Number(props.get(UI_SCALE_VAR)) * 1.25).toBeCloseTo(3, 9);
    theme.setViewport(1280, 720, 1.5);
    expect(theme.uiScale.value).toBe(2);
    expect(props.get(UI_SCALE_VAR)).toBe('2');
    theme.setViewport(1920, 1080);
    expect(props.get(UI_SCALE_VAR)).toBe(String(devicePixelScale(4, 1.5)));
    theme.dispose();
  });
});

describe('UI-Kit: nur ganze Pixel', () => {
  it('uiPx multipliziert Designpixel mit der UI-Skalierung', () => {
    expect(uiPx(7)).toBe(`calc(7px * var(${UI_SCALE_VAR}))`);
    expect(uiPx(0)).toBe('0');
  });

  it('jede Längenangabe im Kit-Stylesheet hängt an --dh-ui-scale (keine festen px)', () => {
    const offending = KIT_CSS.split('\n').filter((line) => /\d+px/.test(line) && !line.includes('var(--dh-ui-scale)'));
    expect(offending).toEqual([]);
    const fixed = [...KIT_CSS.matchAll(/calc\((-?\d+(?:\.\d+)?)px \* var\(--dh-ui-scale\)\)/g)].map((m) => Number(m[1]));
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((n) => Number.isInteger(n))).toBe(true);
    expect(KIT_CSS).toContain('image-rendering: pixelated');
  });

  it('generierte 9-Slice-Ränder sind ganzzahlige Designpixel und ergeben bei 1×–4× ganze Bildschirmpixel', () => {
    const css = uiKitCss(loadUiGrafiken());
    const lengths = [...css.matchAll(/calc\((\d+(?:\.\d+)?)px \* var\(--dh-ui-scale\)\)/g)].map((m) => Number(m[1]));
    expect(lengths.length).toBeGreaterThan(0);
    for (const n of lengths) for (const s of SCALES) expect(Number.isInteger(n * s)).toBe(true);
    expect(css).toMatch(/--dh-font-px: \d+px;/);
    expect(css).toMatch(/--dh-line-px: \d+px;/);
  });

  it('Leistenfüllung: gerundet, aber nie leer bei Rest und nie voll unter dem Maximum', () => {
    expect(barFillPx(0, 100, 96)).toBe(0);
    expect(barFillPx(100, 100, 96)).toBe(96);
    expect(barFillPx(120, 100, 96)).toBe(96);
    expect(barFillPx(50, 100, 96)).toBe(48);
    expect(barFillPx(0.2, 100, 96)).toBe(1);
    expect(barFillPx(99.9, 100, 96)).toBe(95);
    expect(barFillPx(10, 0, 96)).toBe(0);
    expect(barFillPx(Number.NaN, 100, 96)).toBe(0);
    for (let v = 0; v <= 100; v++) expect(Number.isInteger(barFillPx(v, 100, 96))).toBe(true);
  });

  it('Scrollbar-Griff: Mindestlänge, ganze Pixel, von oben bis ganz unten', () => {
    expect(thumbGeometry(36, 30, 0, 50, 10)).toEqual({ size: 50, offset: 0, scrollable: false });
    const top = thumbGeometry(36, 108, 0, 50, 10);
    expect(top).toEqual({ size: 17, offset: 0, scrollable: true });
    const bottom = thumbGeometry(36, 108, 72, 50, 10);
    expect(bottom.offset + bottom.size).toBe(50);
    expect(thumbGeometry(36, 10_000, 0, 50, 10).size).toBe(10);
    for (let s = 0; s <= 72; s++) {
      const g = thumbGeometry(36, 108, s, 50, 10);
      expect(Number.isInteger(g.offset) && Number.isInteger(g.size)).toBe(true);
      expect(g.offset).toBeGreaterThanOrEqual(0);
      expect(g.offset + g.size).toBeLessThanOrEqual(50);
    }
    // Dragging back: the offset of a scroll position leads to (about) the same scroll position.
    expect(scrollForThumb(bottom.offset, 36, 108, 50, bottom.size)).toBeCloseTo(72, 5);
    expect(scrollForThumb(-5, 36, 108, 50, 17)).toBe(0);
  });

  it('Scrollpositionen rasten auf ganze Designpixel der jeweiligen Skalierung ein', () => {
    for (const s of SCALES) {
      for (const raw of [0, 1, 5, 41, 99.5, 250]) {
        const snapped = snapScroll(raw, s);
        expect(snapped % s).toBe(0);
        expect(Math.abs(snapped - raw)).toBeLessThanOrEqual(s / 2);
      }
    }
    expect(snapScroll(13, 0)).toBe(13);
  });
});
