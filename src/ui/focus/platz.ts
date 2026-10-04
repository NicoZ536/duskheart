/**
 * Room of a menu screen (MASTERPROMPT §26 "ganzzahlige UI-Skalierung", "Tastenhinweise auf jedem Bildschirm"; M6-Gate):
 * the screen layer centres its panels and their hint line in the view and must never cut them off. Pure numbers for the
 * layer (`ScreenLayer`) and for screens whose content grows with data (the settings list), so the unit tests pin them.
 *
 * - `SCREEN_MARGIN`: the free design pixels a screen keeps above and below its content. Screens with a fixed layout are
 *   built for the reference frame 480×270 (§4.2) and keep at least this margin there; a screen with a list of
 *   variable length sizes the list to the room left (`wholeRows`).
 * - `fittingDesignPixel`: when the content does not fit the view at the theme's UI scale even so (a fixed scale "4×" in a
 *   small window, chosen in this very menu), the layer draws at the largest smaller whole scale at which it fits – the
 *   screen stays whole and usable, its hint line included, instead of losing its bottom edge (`overflow: hidden`).
 */
import { devicePixelScale, MAX_UI_SCALE, MIN_UI_SCALE, type UiScale } from '../theme';

/**
 * Free design pixels above and below a screen's content in the view (panels plus hint line): the station screens with
 * their tabs above the panels (264 of 270 px) keep exactly this.
 */
export const SCREEN_MARGIN = 3;

/** Room of a screen's content [design px]: the view less `SCREEN_MARGIN` above and below. */
export interface ScreenRoom {
  readonly width: number;
  readonly height: number;
}

/** Tolerance when comparing CSS lengths (products of fractional device pixel scales). */
const EPSILON = 1e-6;

/** The room [design px] in a view of `viewWidth`×`viewHeight` CSS px at a design pixel of `step` CSS px. */
export function screenRoom(viewWidth: number, viewHeight: number, step: number): ScreenRoom {
  const s = step > 0 ? step : 1;
  return { width: Math.floor(viewWidth / s + EPSILON), height: Math.max(0, Math.floor(viewHeight / s + EPSILON) - 2 * SCREEN_MARGIN) };
}

/**
 * The design pixel [CSS px] a screen layer draws with: `themeStep` (the theme's `--dh-ui-scale`) when the content of
 * `contentWidth`×`contentHeight` design px plus `SCREEN_MARGIN` above and below fits the view of `viewWidth`×`viewHeight`
 * CSS px at it; else the largest smaller whole UI scale (snapped to device pixels like the theme's) at which it fits; at
 * worst scale 1×.
 */
export function fittingDesignPixel(viewWidth: number, viewHeight: number, contentWidth: number, contentHeight: number, themeStep: number, devicePixelRatio: number): number {
  const fits = (step: number): boolean => contentWidth * step <= viewWidth + EPSILON && (contentHeight + 2 * SCREEN_MARGIN) * step <= viewHeight + EPSILON;
  if (fits(themeStep)) return themeStep;
  for (let f = MAX_UI_SCALE; f > MIN_UI_SCALE; f--) {
    const step = devicePixelScale(f as UiScale, devicePixelRatio);
    if (step < themeStep - EPSILON && fits(step)) return step;
  }
  return Math.min(themeStep, devicePixelScale(MIN_UI_SCALE, devicePixelRatio));
}

/**
 * How many rows of `row` design px with `gap` px between them fit `space` px – whole rows only, so a list never ends
 * in a cut row; at least `min` (the list then scrolls in a smaller room, `fittingDesignPixel`), at most `total`.
 */
export function wholeRows(space: number, row: number, gap: number, total: number, min: number): number {
  const pitch = row + gap;
  const fit = pitch > 0 ? Math.floor((space + gap + EPSILON) / pitch) : total;
  return Math.max(Math.min(min, total), Math.min(total, fit));
}

/** Height [design px] of `n` rows of `row` px with `gap` px between them. */
export function rowsHeight(n: number, row: number, gap: number): number {
  return n > 0 ? n * row + (n - 1) * gap : 0;
}
