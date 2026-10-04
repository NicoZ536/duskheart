/**
 * M6-Gate (ui-inventar-ruestung): inks on the parchment panels of the inventory (MASTERPROMPT §4.6 Lesbarkeit). The set
 * panel greyed the bonuses not reached with the grey of the dark panels (`pergamentDunkel`, 1.85 : 1 on parchment, the
 * parchment's texture strokes running through the glyphs in almost the same tone). Every ink of the set panel and the
 * greyed values of the stats panel now reach 4.5 : 1 (WCAG AA) on the parchment and on its strokes (`sand.3`), and a
 * reached bonus still differs from one not reached (green ink against the secondary ink, besides the filled or hollow
 * marker of `SetPanel`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX, PALETTE_RAMPS, UI_HEX } from '../../../src/generated/palette';
import { paletteRefHex } from '../../../src/render/palette/rows';
import { SET_BONUS_INK } from '../../../src/ui/screens/inventar/stats';
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

/** Hex colour of a custom property: a UI colour of the theme, or the screen's own token for a reached set bonus. */
function resolve(name: string): string {
  if (name === '--dh-inv-erreicht') {
    // The screen sets the token from the palette reference of the stats module.
    expect(SCREEN).toContain("'--dh-inv-erreicht': paletteRefHex(SET_BONUS_INK, PALETTE_RAMPS, PALETTE_HEX)");
    return paletteRefHex(SET_BONUS_INK, PALETTE_RAMPS, PALETTE_HEX);
  }
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

  it('erreichte und nicht erreichte Boni unterscheiden sich in der Tinte', () => {
    const an = resolve(colourVar('.dh-inv__setbonus[data-aktiv]'));
    const aus = resolve(colourVar('.dh-inv__setbonus--aus'));
    expect(an).not.toBe(aus);
    // Green against the brown secondary ink: the green channel leads in the one, red in the other.
    const rgb = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const [ar, ag] = rgb(an);
    const [br, bg] = rgb(aus);
    expect(ag ?? 0).toBeGreaterThan(ar ?? 0);
    expect(br ?? 0).toBeGreaterThan(bg ?? 0);
  });
});
