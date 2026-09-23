/**
 * The pixel font in the DOM overlay (MASTERPROMPT §5 "Schrift", §26 "eine Pixelschrift"). The same
 * descriptor drives the WebGL glyph atlas (`src/render/text`), so both show one font with the same
 * line pitch. DOM text is set at the font's native size × the UI scale – never at other sizes, which
 * would put the design pixels between screen pixels. The stylesheet of the package is imported by
 * `base.css`; the CSS tokens `--dh-font-px` / `--dh-line-px` come from `npm run assets`
 * (`src/generated/ui-kit.css`, written from this descriptor).
 */
import { cssFont, lineHeightOf, loadPixelFont, PIXEL_FONT, uncoveredChars, type FontLoader } from '../render/text';

/** The font of every UI text. */
export const UI_FONT = PIXEL_FONT;

/** CSS custom properties of the font size and line pitch at 1× (multiplied by `--dh-ui-scale` in CSS). */
export const FONT_PX_VAR = '--dh-font-px';
export const LINE_PX_VAR = '--dh-line-px';

/** Characters every UI font must draw: the German umlauts and ß (§5 "ÄÖÜäöüß sauber darstellt"). */
export const UMLAUT_PROBE = 'ÄÖÜäöüß';

/** Font size [CSS px] at UI scale `scale`. */
export function uiFontPx(scale: number): number {
  return UI_FONT.pixelsPerEm * scale;
}

/** Line pitch [CSS px] at UI scale `scale`. */
export function uiLinePx(scale: number): number {
  return lineHeightOf(UI_FONT) * scale;
}

/** CSS `font` shorthand at UI scale `scale` (canvas measuring, inline styles). */
export function uiFontCss(scale: number): string {
  return cssFont(UI_FONT, scale);
}

/** Characters of `text` the UI font cannot draw (a text using them would fall back to another font). */
export function missingUiGlyphs(text: string): string[] {
  return uncoveredChars(UI_FONT, text);
}

/** Waits until the browser has loaded the UI font for its whole character set; rejects if it cannot. */
export function loadUiFont(fonts: FontLoader): Promise<void> {
  return loadPixelFont(UI_FONT, fonts);
}
