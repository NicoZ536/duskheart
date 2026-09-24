/**
 * Pixel text for the WebGL pass (MASTERPROMPT §5 "Schrift", §26): font descriptor, glyph atlas
 * (Canvas2D bake with hard alpha threshold), whole-pixel layout and the instanced text batch.
 *
 * Typical setup in the browser:
 * ```ts
 * await loadPixelFont(PIXEL_FONT, document.fonts);
 * const atlas = new GlyphAtlas(PIXEL_FONT, createCanvasRasterizer(PIXEL_FONT), { preload: PIXEL_FONT.charset });
 * const text = new TextBatch(gl, renderer.resources, atlas, { shaders: renderer.shaders });
 * text.begin(viewWidth, viewHeight);
 * text.text('Feuerstein ×3', x, y, { color: rgbaFromHex(UI_HEX.text), effect: 'outline', effectColor: rgbaFromHex(UI_HEX.dunkel), align: 'center' });
 * text.end();
 * ```
 */
export { createCanvasRasterizer, loadPixelFont, OVERSAMPLE, type CanvasFactory, type FontLoader } from './canvasRasterizer';
export {
  ALPHA_THRESHOLD,
  bakeGlyph,
  DEFAULT_ATLAS_WIDTH,
  GLYPH_PADDING,
  GlyphAtlas,
  glyphWindow,
  gridSnap,
  INK,
  MAX_ATLAS_SIZE,
  type CellWindow,
  type FontMetrics,
  type Glyph,
  type GlyphAtlasOptions,
  type GlyphAtlasStats,
  type GlyphBitmap,
  type GlyphRasterizer,
} from './glyphAtlas';
export { layoutText, measureText, TextLayout, type GlyphSource, type LayoutOptions, type PlacedGlyph, type TextAlign } from './layout';
export {
  charRange,
  cssFamilies,
  cssFont,
  fontCovers,
  FUSION_PIXEL_10,
  glyphCharOf,
  lineHeightOf,
  PIXEL_FONT,
  uncoveredChars,
  unitsPerPixel,
  type PixelFontSource,
  type PixelFontSpec,
  type PixelFontSupplement,
} from './pixelFont';
export {
  packRgba,
  rgbaFromHex,
  TEXT_INITIAL_INSTANCES,
  TEXT_INSTANCE_STRIDE,
  TEXT_LOCATION,
  TEXT_MODE,
  TEXT_OFFSET,
  TEXT_SHADER_FILES,
  TEXT_SHADOW_OFFSET,
  TextBatch,
  type TextBatchOptions,
  type TextEffect,
  type TextStyle,
} from './textBatch';
