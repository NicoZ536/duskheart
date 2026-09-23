/**
 * M1-21 UI-Grafik als Pixelquellen (assets-src/ui → tools/assets/ui-step.ts): jede Quelle ist
 * gültig und nutzt nur Palettenfarben, Zustände einer Schaltfläche/eines Slots teilen Maße und
 * Ränder, 9-Slice-Zusammensetzung wie in CSS, generiertes Stylesheet/Manifest und der Build-Schritt
 * (PNGs, Aufräumen, idempotent).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UI_KIT_FARBEN } from '../../../assets-src/ui/farben';
import { uiFarbe, uiGrafik, UiGrafikFehler, type UiGrafik } from '../../../assets-src/ui/format';
import { UI_GRAFIK_QUELLEN } from '../../../assets-src/ui/index';
import { flatPalette, UI_COLORS } from '../../../assets-src/palette';
import { lineHeightOf, PIXEL_FONT } from '../../../src/render/text/pixelFont';
import { decodePng } from '../../../tools/lib/png';
import { buildUi, compose9Slice, GRAFIK_CLASS_PREFIX, loadUiGrafiken, uiKitCss, uiManifest, UI_URL_PREFIX } from '../../../tools/assets/ui-step';

const grafiken = loadUiGrafiken();
const byId = new Map(grafiken.map((g) => [g.id, g]));
const RGBA = 4;
/** §4.3: höchstens 12 Farben je Grafik. */
const MAX_FARBEN = 12;

function get(id: string): UiGrafik {
  const g = byId.get(id);
  if (g === undefined) throw new Error(`UI-Grafik ${id} fehlt`);
  return g;
}

function hexAt(rgba: Uint8Array, i: number): string {
  return `#${[rgba[i], rgba[i + 1], rgba[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

describe('UI-Grafik: Quellen', () => {
  it('alle Grafiken aus §26 sind da: Holz, Eisen, Pergament, Slot, Schaltfläche (4 Zustände), Leiste, Scrollbar', () => {
    for (const id of ['rahmen_holz', 'rahmen_eisen', 'rahmen_pergament', 'slot', 'slot_hover', 'slot_aktiv', 'knopf', 'knopf_hover', 'knopf_gedrueckt', 'knopf_gesperrt', 'leiste', 'leiste_leben', 'leiste_ausdauer', 'scroll_bahn', 'scroll_griff', 'scroll_rillen', 'scroll_hoch', 'scroll_runter']) {
      expect(byId.has(id), id).toBe(true);
    }
    expect(new Set(UI_GRAFIK_QUELLEN.map((q) => q.id)).size).toBe(UI_GRAFIK_QUELLEN.length);
  });

  it('jedes Pixel ist eine Farbe der Master-Palette oder eine UI-Farbe, höchstens 12 Farben je Grafik', () => {
    const erlaubt = new Set([...flatPalette(), ...Object.values(UI_COLORS)].map((h) => h.toLowerCase()));
    for (const g of grafiken) {
      for (let i = 0; i < g.rgba.length; i += RGBA) {
        const a = g.rgba[i + 3];
        expect(a === 0 || a === 255, `${g.id}: Deckung ${String(a)}`).toBe(true);
        if (a === 255) expect(erlaubt.has(hexAt(g.rgba, i)), `${g.id}: ${hexAt(g.rgba, i)}`).toBe(true);
      }
      expect(g.farben, g.id).toBeLessThanOrEqual(MAX_FARBEN);
    }
  });

  it('Zustände teilen Größe und Ränder (kein Layoutsprung beim Hover/Drücken)', () => {
    const families = [
      ['knopf', 'knopf_hover', 'knopf_gedrueckt', 'knopf_gesperrt'],
      ['slot', 'slot_hover', 'slot_aktiv'],
      ['leiste_leben', 'leiste_ausdauer'],
      ['scroll_hoch', 'scroll_runter'],
    ];
    for (const fam of families) {
      const [first, ...rest] = fam.map(get);
      for (const g of rest) expect([g.width, g.height, g.slice], g.id).toEqual([first?.width, first?.height, first?.slice]);
    }
    // The bar fill is exactly as high as the inner trough of the bar frame.
    const leiste = get('leiste');
    expect(get('leiste_leben').height).toBe(leiste.height - (leiste.slice?.[0] ?? 0) - (leiste.slice?.[2] ?? 0));
    // The grooves fit into the 3 px face of the thumb (7 px minus 2 × 2 px rim).
    const griff = get('scroll_griff');
    expect(get('scroll_rillen').width).toBe(griff.width - (griff.slice?.[1] ?? 0) - (griff.slice?.[3] ?? 0));
  });

  it('meldet Strukturfehler mit Namen: fremde Farbe, unbekanntes Zeichen, ungleiche Zeilen, Slice ohne Mitte', () => {
    const base = { id: 'probe', beschreibung: 'Test', legende: { a: 'holz.2', '.': null }, raster: 'aa\naa' };
    expect(uiGrafik(base).width).toBe(2);
    expect(() => uiGrafik({ ...base, legende: { a: 'holz.9' } })).toThrow(UiGrafikFehler);
    expect(() => uiGrafik({ ...base, legende: { a: 'ui.lila' } })).toThrow(/ui\.lila/);
    expect(() => uiGrafik({ ...base, raster: 'ab\naa' })).toThrow(/Zeichen „b“/);
    expect(() => uiGrafik({ ...base, raster: 'aaa\naa' })).toThrow(/Zeile 1/);
    expect(() => uiGrafik({ ...base, slice: 1 })).toThrow(/keine Mitte/);
    expect(() => uiGrafik({ ...base, id: 'Probe' })).toThrow(/snake_case/);
    expect(uiFarbe('ui.akzent')).toBe(UI_COLORS.akzent);
    for (const ref of Object.values(UI_KIT_FARBEN)) expect(uiFarbe(ref)).not.toBeNull();
  });
});

describe('UI-Grafik: 9-Slice', () => {
  it('in Originalgröße ist die Zusammensetzung die Grafik selbst', () => {
    for (const g of grafiken) if (g.slice !== null) expect(compose9Slice(g, g.width, g.height), g.id).toEqual(g.rgba);
  });

  it('Ecken bleiben bei jeder Größe unverändert, gedehnte Kanten bleiben einfarbig', () => {
    for (const g of grafiken) {
      if (g.slice === null) continue;
      const [oben, rechts, unten, links] = g.slice;
      const w = g.width * 3 + 1;
      const h = g.height * 2 + 3;
      const out = compose9Slice(g, w, h);
      const px = (buf: Uint8Array, bw: number, x: number, y: number) => [...buf.subarray((y * bw + x) * RGBA, (y * bw + x + 1) * RGBA)];
      for (let y = 0; y < oben; y++) for (let x = 0; x < links; x++) expect(px(out, w, x, y), `${g.id} oben links`).toEqual(px(g.rgba, g.width, x, y));
      for (let y = 0; y < unten; y++) for (let x = 0; x < rechts; x++) expect(px(out, w, w - 1 - x, h - 1 - y), `${g.id} unten rechts`).toEqual(px(g.rgba, g.width, g.width - 1 - x, g.height - 1 - y));
    }
    const leiste = get('leiste');
    const breit = compose9Slice(leiste, 40, leiste.height);
    for (let x = 2; x < 38; x++) expect(breit.subarray((1 * 40 + x) * RGBA, (1 * 40 + x + 1) * RGBA)).toEqual(leiste.rgba.subarray((1 * leiste.width + 2) * RGBA, (1 * leiste.width + 3) * RGBA));
  });
});

describe('UI-Grafik: generierte Dateien', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-ui-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Stylesheet: eine Klasse je Grafik, 9-Slice mit fill und Wiederholungsart, Bild-Variablen und Schrift-Tokens', () => {
    const css = uiKitCss(grafiken);
    for (const g of grafiken) {
      expect(css).toContain(`.${GRAFIK_CLASS_PREFIX}${g.id} {`);
      expect(css).toContain(`--dh-g-${g.id}-bild: url("${UI_URL_PREFIX}${g.id}.png");`);
      if (g.slice !== null) {
        expect(css).toContain(`border-image-slice: ${g.slice.join(' ')} fill;`);
      }
    }
    expect(css).toContain('border-image-repeat: repeat;');
    expect(css).toContain('border-image-repeat: stretch;');
    expect(css).toContain(`--dh-font-family: "${PIXEL_FONT.family}";`);
    expect(css).toContain(`--dh-font-px: ${PIXEL_FONT.pixelsPerEm}px;`);
    expect(css).toContain(`--dh-line-px: ${lineHeightOf(PIXEL_FONT)}px;`);
    for (const [name, ref] of Object.entries(UI_KIT_FARBEN)) expect(css).toContain(`--dh-kit-${name}: ${uiFarbe(ref) ?? ''};`);
  });

  it('Manifest nennt Größe, Ränder, Klasse und Datei jeder Grafik', () => {
    const ts = uiManifest(grafiken);
    for (const g of grafiken) expect(ts).toContain(`${g.id}: { width: ${g.width}, height: ${g.height}, slice: ${g.slice === null ? 'null' : `[${g.slice.join(', ')}]`}`);
    expect(ts).toContain('export type UiGrafikId = keyof typeof UI_GRAFIKEN;');
  });

  it('der Schritt schreibt PNGs (1 Pixel je Designpixel), räumt veraltete auf und ist idempotent', () => {
    const paths = { generated: join(dir, 'gen'), publicGenerated: join(dir, 'pub'), sheets: join(dir, 'sheets') };
    const stale = join(paths.publicGenerated, 'ui', 'alt.png');
    const first = buildUi(paths);
    expect(first.grafiken).toBe(grafiken.length);
    writeFileSync(stale, 'x');
    const second = buildUi(paths);
    expect(second.geschrieben).toBe(0);
    expect(existsSync(stale)).toBe(false);
    const holz = decodePng(new Uint8Array(readFileSync(join(paths.publicGenerated, 'ui', 'rahmen_holz.png'))));
    expect([holz.width, holz.height]).toEqual([get('rahmen_holz').width, get('rahmen_holz').height]);
    expect(holz.rgba).toEqual(get('rahmen_holz').rgba);
    expect(existsSync(join(paths.sheets, 'ui-kit.png'))).toBe(true);
    expect(readFileSync(join(paths.generated, 'ui-kit.css'), 'utf8')).toBe(uiKitCss(grafiken));
  });
});
