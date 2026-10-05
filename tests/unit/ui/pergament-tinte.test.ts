/**
 * M6-Gate (ui-inventar-ruestung): inks on the parchment panels of the inventory (MASTERPROMPT §4.6 Lesbarkeit). The set
 * panel greyed the bonuses not reached with the grey of the dark panels (`pergamentDunkel`, 1.85 : 1 on parchment, the
 * parchment's texture strokes running through the glyphs in almost the same tone). Every ink of the set panel and the
 * greyed values of the stats panel now reach 4.5 : 1 (WCAG AA) on the parchment and on its strokes (`sand.3`).
 *
 * Second picture review: the weighting was inverted – the bonuses not reached stood in the dark secondary ink (`rahmen`,
 * 9.5 : 1, hardly lighter than the headings), the reached ones in a green that looked lighter (6.9 : 1), while the tooltip
 * beside them dims the bonus not reached. One state language now: a reached bonus is primary (the parchment's ink, with a
 * filled green marker), one not reached is secondary (a muted ink, with a hollow marker), like the greyed values.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_KIT_FARBEN } from '../../../assets-src/ui/farben';
import { PALETTE_HEX, PALETTE_RAMPS, UI_HEX } from '../../../src/generated/palette';
import { paletteRefHex } from '../../../src/render/palette/rows';
import { PARCHMENT_MUTED_INK, SET_MARKER_INK } from '../../../src/ui/screens/inventar/stats';
import { themeColorVar, type UiColorName } from '../../../src/ui/theme';

const CSS = readFileSync(join(process.cwd(), 'src/ui/screens/inventar/inventar.css'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'src/ui/screens/inventar/InventoryScreen.tsx'), 'utf8');
/** Least contrast of text (WCAG 2 AA, normal text). */
const AA = 4.5;
/** The parchment and the strokes of its texture (the parchment frame graphic). */
const GROUNDS = { pergament: UI_HEX.pergament, strich: paletteRefHex('sand.3', PALETTE_RAMPS, PALETTE_HEX) } as const;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The custom property of the `color` of the rule `selector` in inventar.css. */
function colourVar(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const block = CSS.slice(at, CSS.indexOf('}', at));
  const m = /(?:^|[\s;{])color:\s*var\((--[\w-]+)\)/.exec(block);
  expect(m, selector).not.toBeNull();
  return m?.[1] ?? '';
}

/** The screen's own tokens (InventoryScreen.tsx `SCREEN_TOKENS`) and the palette references they are set from. */
const SCREEN_INKS: Record<string, readonly [string, string]> = {
  '--dh-inv-erreicht': ['SET_MARKER_INK', SET_MARKER_INK],
  '--dh-inv-gedaempft': ['PARCHMENT_MUTED_INK', PARCHMENT_MUTED_INK],
};

/** Hex colour of a custom property: a UI colour of the theme, the kit's ink, or a token of the inventory screen. */
function resolve(name: string): string {
  const own = SCREEN_INKS[name];
  if (own !== undefined) {
    // The screen sets the token from the palette reference of the stats module.
    expect(SCREEN).toContain(`'${name}': paletteRefHex(${own[0]}, PALETTE_RAMPS, PALETTE_HEX)`);
    return paletteRefHex(own[1], PALETTE_RAMPS, PALETTE_HEX);
  }
  if (name === '--dh-kit-tinte') return paletteRefHex(UI_KIT_FARBEN.tinte, PALETTE_RAMPS, PALETTE_HEX);
  const ui = (Object.keys(UI_HEX) as UiColorName[]).find((k) => themeColorVar(k) === name);
  expect(ui, name).toBeDefined();
  return ui === undefined ? '#000000' : UI_HEX[ui];
}

describe('Tinten auf Pergament (Inventar)', () => {
  it('das Grau dunkler Tafeln ist auf Pergament unlesbar (der Mangel)', () => {
    expect(contrast(UI_HEX.pergamentDunkel, GROUNDS.pergament)).toBeLessThan(2);
  });

  it.each([
    ['nicht erreichter Set-Bonus', '.dh-inv__setbonus--aus'],
    ['erreichter Set-Bonus', '.dh-inv__setbonus[data-aktiv]'],
    ['gedämpfter Wert (0, Set ohne Bonus)', '.dh-inv__wert--dim'],
  ])('%s: mindestens 4,5 : 1 auf Pergament und seinen Strichen', (_, selector) => {
    const ink = resolve(colourVar(selector));
    for (const [ground, hex] of Object.entries(GROUNDS)) expect(contrast(ink, hex), `${selector} auf ${ground}`).toBeGreaterThanOrEqual(AA);
  });

  it('eine Zustandssprache mit dem Tooltip: erreicht ist Haupttext, nicht erreicht und gedämpfte Werte sind Nebentext', () => {
    const an = resolve(colourVar('.dh-inv__setbonus[data-aktiv]'));
    const aus = resolve(colourVar('.dh-inv__setbonus--aus'));
    const ueberschrift = resolve(colourVar('.dh-rahmen--pergament .dh-inv__titel'));
    // Reached: the parchment's own ink, the primary text of the panel (the set's name line inherits it).
    expect(an).toBe(paletteRefHex(UI_KIT_FARBEN.tinte, PALETTE_RAMPS, PALETTE_HEX));
    // Not reached: clearly lighter than the ink and the headings (the defect: rahmen, 9.5 : 1, as dark as a heading), and
    // the same ink as every greyed value of the panels.
    for (const [name, primary] of [
      ['Tinte', an],
      ['Überschrift', ueberschrift],
    ] as const) {
      expect(contrast(primary, GROUNDS.pergament) / contrast(aus, GROUNDS.pergament), name).toBeGreaterThan(1.3);
    }
    expect(resolve(colourVar('.dh-inv__wert--dim'))).toBe(aus);
  });

  it('die gefüllte Marke eines erreichten Bonus ist grün (≥ 3 : 1 als Grafik), die hohle trägt die gedämpfte Tinte', () => {
    const marke = resolve(colourVar('.dh-inv__setbonus[data-aktiv] .dh-inv__setmarke'));
    const rgb = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = rgb(marke);
    expect(g ?? 0).toBeGreaterThan(Math.max(r ?? 0, b ?? 0));
    for (const hex of Object.values(GROUNDS)) expect(contrast(marke, hex)).toBeGreaterThanOrEqual(3);
    // The hollow marker draws in the current colour of its bonus (SVG `currentColor`), no own colour rule.
    expect(CSS).not.toContain('.dh-inv__setbonus--aus .dh-inv__setmarke');
    expect(SCREEN).toContain('fill="currentColor"');
  });
});
