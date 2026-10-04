/**
 * M6-Gate (ui-pause-einstellungen, ui-station): the room of a menu screen and lists that end on whole lines.
 *
 * - `screenRoom`: the view in design pixels less `SCREEN_MARGIN` above and below – at 1920×1080 (4×) and 2560×1440 (4×,
 *   §4.2) the settings screen sizes its list to it.
 * - `fittingDesignPixel`: the theme's design pixel while the content fits with its margins; else the largest smaller whole
 *   scale (device-pixel snapped like the theme's) – a screen is never cut off at the bottom.
 * - `wholeRows`/`rowsHeight`: whole rows only, at least the minimum, at most all; the settings list at 480×270 holds ten of
 *   its twelve rows, the panel plus hint line keeps its margins.
 * - `wholeLinesHeight`: the visible part of a scroll area ends between lines – never across a glyph or an icon.
 */
import { describe, expect, it } from 'vitest';
import { fittingDesignPixel, rowsHeight, SCREEN_MARGIN, screenRoom, wholeRows } from '../../../src/ui/focus/platz';
import { wholeLinesHeight } from '../../../src/ui/kit/geometry';
import { devicePixelScale } from '../../../src/ui/theme';

describe('Raum eines Bildschirms', () => {
  it('Bildhöhe in Designpixeln weniger Rand oben und unten', () => {
    expect(SCREEN_MARGIN).toBeGreaterThanOrEqual(3);
    expect(screenRoom(1920, 1080, 4)).toEqual({ width: 480, height: 270 - 2 * SCREEN_MARGIN });
    expect(screenRoom(2560, 1440, 4)).toEqual({ width: 640, height: 360 - 2 * SCREEN_MARGIN });
    expect(screenRoom(3840, 2160, 4)).toEqual({ width: 960, height: 540 - 2 * SCREEN_MARGIN });
    // 1920×1080 screen pixels at a device pixel ratio of 1.25 (1536×864 CSS px, auto 3×): a design pixel of 3/1.25 CSS px,
    // whole design pixels, never a fraction.
    expect(screenRoom(1536, 864, devicePixelScale(3, 1.25))).toEqual({ width: 640, height: 360 - 2 * SCREEN_MARGIN });
  });

  it('passt der Inhalt mit Rand, bleibt das Designpixel des Themes', () => {
    expect(fittingDesignPixel(1920, 1080, 472, 270 - 2 * SCREEN_MARGIN, 4, 1)).toBe(4);
    expect(fittingDesignPixel(1366, 768, 466, 250, 2, 1)).toBe(2);
  });

  it('sonst die größte kleinere ganze Stufe, bei der er passt – nie abgeschnitten', () => {
    // 283 px high content (the old settings panel plus hint line) at 4× in 1080 px: 3× fits.
    expect(fittingDesignPixel(1920, 1080, 248, 283, 4, 1)).toBe(3);
    // "4×" fixed by the player in a 1366×768 window: the inventory (466 × 260) fits at 2×.
    expect(fittingDesignPixel(1366, 768, 466, 260, 4, 1)).toBe(2);
    // Too wide as well as too high: the smaller scale serves both.
    expect(fittingDesignPixel(1600, 2000, 472, 100, 4, 1)).toBe(3);
    // At a device pixel ratio of 1.5 the smaller scale is snapped to device pixels like the theme's.
    expect(fittingDesignPixel(1280, 720, 472, 270, devicePixelScale(3, 1.5), 1.5)).toBe(devicePixelScale(2, 1.5));
    // Nothing fits: 1× – the smallest scale, never above the theme's.
    expect(fittingDesignPixel(200, 100, 472, 260, 4, 1)).toBe(1);
    expect(fittingDesignPixel(200, 100, 472, 260, 0.5, 2)).toBe(0.5);
  });
});

describe('Ganze Zeilen', () => {
  it('nur ganze Zeilen, mindestens das Minimum, höchstens alle', () => {
    // Settings rows: 13 px with 1 px between. 139 px hold ten rows (10 × 13 + 9), 138 px only nine.
    expect(wholeRows(139, 13, 1, 12, 5)).toBe(10);
    expect(wholeRows(138, 13, 1, 12, 5)).toBe(9);
    expect(wholeRows(400, 13, 1, 12, 5)).toBe(12);
    expect(wholeRows(20, 13, 1, 12, 5)).toBe(5);
    expect(wholeRows(20, 13, 1, 3, 5)).toBe(3);
    expect(rowsHeight(10, 13, 1)).toBe(139);
    expect(rowsHeight(0, 13, 1)).toBe(0);
  });

  it('die Einstellungen bei 480×270: Tafel und Hinweiszeile behalten ihren Rand', () => {
    // Everything but the list (frame 2 × 9, title 12 + 4, three-line description 4 + 46, back button 4 + 19, hint 3 + 12).
    const rest = 2 * 9 + 16 + 50 + 23 + 15;
    const room = screenRoom(1920, 1080, 4).height;
    const n = wholeRows(room - rest, 13, 1, 12, 5);
    expect(n).toBe(10);
    expect(rest + rowsHeight(n, 13, 1) + 2 * SCREEN_MARGIN).toBeLessThanOrEqual(270);
    // At 2560×1440 (4×, 360 design px) all twelve rows show without a scroll bar.
    expect(wholeRows(screenRoom(2560, 1440, 4).height - rest, 13, 1, 12, 5)).toBe(12);
  });
});

describe('Bildlauf endet auf einer Zeilengrenze', () => {
  it('schneidet nie durch eine Glyphenzeile oder ein Icon', () => {
    // Description lines of 12 px from y 100: the area of 145 px ends after the third line … at 136.
    const zeilen = [0, 1, 2, 3].map((i) => [100 + 12 * i, 112 + 12 * i] as const);
    expect(wholeLinesHeight(zeilen, 145)).toBe(136);
    expect(wholeLinesHeight(zeilen, 148)).toBe(148);
    expect(wholeLinesHeight(zeilen, 160)).toBe(160);
  });

  it('eine Zeile in einer Listenzeile zählt als die äußere (kein Krümel des nächsten Icons)', () => {
    // Recipe rows of 18 px, icon 1 … 17 and text 3 … 15 in each: 168 px end after row nine at 162.
    const spans = Array.from({ length: 12 }, (_, i) => [
      [18 * i, 18 * i + 18],
      [18 * i + 1, 18 * i + 17],
      [18 * i + 3, 18 * i + 15],
    ] as const).flat();
    expect(wholeLinesHeight(spans, 168)).toBe(162);
    expect(wholeLinesHeight(spans, 162)).toBe(162);
  });

  it('eine erste Zeile höher als der Bereich behält ihn ganz', () => {
    expect(wholeLinesHeight([[0, 40]], 30)).toBe(30);
    expect(wholeLinesHeight([], 30)).toBe(30);
  });
});
