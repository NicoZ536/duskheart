/**
 * World-near UI pass (MASTERPROMPT §26, M1-23): draws the frame's `WorldUiList` – names, life bars,
 * damage numbers, interaction markers – into the final image (`targets.ldr`) after light,
 * composition, post and the interaction outline. Text comes from the pixel font's glyph atlas
 * (`src/render/text`), every element sits on whole internal pixels and is scaled up with the scene,
 * so it is exactly as crisp as the sprites; it is never lit, tonemapped or darkened by the night.
 *
 * One `TextBatch` (one instanced draw call) holds the whole world UI. The glyph atlas needs the web
 * font, which loads asynchronously: until `setGlyphs` provides it, the pass draws nothing and
 * reports itself incomplete while the scene has world UI (screenshots wait for it).
 */
import { snapToPixel } from '../camera';
import type { GlyphAtlas } from '../text/glyphAtlas';
import { layoutText, TextLayout, type LayoutOptions, type TextAlign } from '../text/layout';
import { TextBatch, type TextEffect } from '../text/textBatch';
import { BAR_COLORS, barFill, damageOpacity, damageRise, WORLD_UI_COLORS, type WorldUiEntry } from '../worldUi/worldUi';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Bar geometry: 1 px frame around two fill rows (upper row lit). */
const BAR_BORDER = 1;
const BAR_ROWS = 2;
const BAR_HEIGHT = BAR_ROWS + 2 * BAR_BORDER;
/** Key cap geometry: frame, inner padding around the key's ink, one shade row under the face. */
const KEY_BORDER = 1;
const KEY_PAD_X = 2;
const KEY_PAD_Y = 1;
const KEY_SHADE = 1;
/** Gap between key cap and action text (px). */
const MARKER_GAP = 3;
const BYTE = 0xff;
const ALPHA_MASK = 0xffffff00;

/** `color` with its alpha multiplied by `opacity` (0…1). */
function withOpacity(color: number, opacity: number): number {
  const a = Math.round((color & BYTE) * opacity);
  return ((color & ALPHA_MASK) | a) >>> 0;
}

/** A text style the pass rewrites per element (one object for the whole frame: no allocation per element). */
class MutableTextStyle {
  color = 0;
  effect: TextEffect = 'none';
  effectColor = 0;
  align: TextAlign = 'left';

  set(color: number, effect: TextEffect, effectColor: number, align: TextAlign): this {
    this.color = color;
    this.effect = effect;
    this.effectColor = effectColor;
    this.align = align;
    return this;
  }
}

/** Layout options of the marker measurements (single line, no wrapping). */
const PLAIN_LAYOUT: LayoutOptions = {};

/** Ink bounding box of a laid-out text relative to its block (x from the pen start, y from the block top). */
class InkBox {
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;

  of(l: TextLayout): this {
    this.left = Number.POSITIVE_INFINITY;
    this.top = Number.POSITIVE_INFINITY;
    this.right = Number.NEGATIVE_INFINITY;
    this.bottom = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < l.count; i++) {
      const p = l.glyphs[i];
      if (p === undefined) continue;
      this.left = Math.min(this.left, p.x);
      this.top = Math.min(this.top, p.y);
      this.right = Math.max(this.right, p.x + p.glyph.width);
      this.bottom = Math.max(this.bottom, p.y + p.glyph.height);
    }
    if (!Number.isFinite(this.left)) this.left = this.top = this.right = this.bottom = 0;
    return this;
  }

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }
}

export class WorldUiPass implements RenderPass {
  readonly name = 'welt-ui';
  enabled = true;
  private setup: PassSetup | null = null;
  private glyphs: GlyphAtlas | null = null;
  private batch: TextBatch | null = null;
  private readonly measure = new TextLayout();
  private readonly keyInk = new InkBox();
  private readonly textInk = new InkBox();
  private readonly style = new MutableTextStyle();
  private drawnAll = true;

  /** Whether the last frame drew all of its world UI (false while the font is still loading). */
  get complete(): boolean {
    return this.drawnAll;
  }

  /** Whether the glyph atlas is there. */
  get hasGlyphs(): boolean {
    return this.glyphs !== null;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    this.createBatch();
  }

  /** Provides the glyph atlas of the pixel font (once the web font is loaded). */
  setGlyphs(atlas: GlyphAtlas): void {
    if (this.glyphs === atlas) return;
    this.glyphs = atlas;
    this.batch?.dispose();
    this.batch = null;
    this.createBatch();
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's LDR target.
  }

  execute(ctx: RenderContext): void {
    const list = ctx.scene.worldUi;
    if (list.count === 0) {
      this.drawnAll = true;
      return;
    }
    const batch = this.batch;
    if (batch === null) {
      this.drawnAll = false;
      return;
    }
    const f = ctx.frame;
    ctx.targets.ldr.bind();
    batch.begin(f.width, f.height);
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e === undefined) continue;
      // World px → target px (the target includes the 1 px border; the camera origin is whole px).
      const x = snapToPixel(e.x) - f.camera.originX;
      const y = snapToPixel(e.y) - f.camera.originY;
      if (e.kind === 'label') this.label(batch, e, x, y);
      else if (e.kind === 'bar') this.bar(batch, e, x, y);
      else if (e.kind === 'damage') this.damage(batch, e, x, y);
      else this.marker(batch, e, x, y);
    }
    ctx.stats.drawCalls += batch.end();
    this.drawnAll = true;
  }

  dispose(_setup: PassSetup): void {
    this.batch?.dispose();
    this.batch = null;
    this.setup = null;
  }

  private createBatch(): void {
    const s = this.setup;
    if (s === null || this.glyphs === null || this.batch !== null) return;
    this.batch = new TextBatch(s.gl, s.resources, this.glyphs, { shaders: s.shaders });
  }

  private ascent(): number {
    return this.glyphs?.metrics.ascent ?? 0;
  }

  private label(batch: TextBatch, e: WorldUiEntry, x: number, y: number): void {
    batch.text(e.text, x, y - this.ascent(), this.style.set(e.color, 'outline', WORLD_UI_COLORS.outline, 'center'));
  }

  private damage(batch: TextBatch, e: WorldUiEntry, x: number, y: number): void {
    const opacity = damageOpacity(e.age);
    if (opacity <= 0) return;
    const top = y - damageRise(e.age) - this.ascent();
    batch.text(e.text, x, top, this.style.set(withOpacity(e.color, opacity), 'outline', withOpacity(WORLD_UI_COLORS.outline, opacity), 'center'));
  }

  /** Frame with cut corners, empty rows, lit fill with a brighter end column (like the HUD bars of the UI kit). */
  private bar(batch: TextBatch, e: WorldUiEntry, x: number, y: number): void {
    const w = Math.max(1, Math.round(e.width));
    const left = x - Math.floor(w / 2);
    const inner = y + BAR_BORDER;
    const o = WORLD_UI_COLORS.outline;
    batch.rect(left, y, w, BAR_BORDER, o);
    batch.rect(left, y + BAR_HEIGHT - BAR_BORDER, w, BAR_BORDER, o);
    batch.rect(left - BAR_BORDER, inner, BAR_BORDER, BAR_ROWS, o);
    batch.rect(left + w, inner, BAR_BORDER, BAR_ROWS, o);
    batch.rect(left, inner, w, BAR_ROWS, WORLD_UI_COLORS.barEmpty);
    const fill = barFill(w, e.value, e.max);
    if (fill === 0) return;
    const c = BAR_COLORS[e.bar];
    batch.rect(left, inner, fill - 1, 1, c.light);
    batch.rect(left, inner + 1, fill - 1, 1, c.body);
    batch.rect(left + fill - 1, inner, 1, 1, c.endLight);
    batch.rect(left + fill - 1, inner + 1, 1, 1, c.endBody);
  }

  /** Key cap (parchment face, shade row, dark frame with cut corners) and the action text beside it. */
  private marker(batch: TextBatch, e: WorldUiEntry, x: number, y: number): void {
    const glyphs = this.glyphs;
    if (glyphs === null) return;
    const key = this.keyInk.of(layoutText(glyphs, e.key, PLAIN_LAYOUT, this.measure));
    const text = this.textInk.of(layoutText(glyphs, e.text, PLAIN_LAYOUT, this.measure));
    const capW = key.width + 2 * (KEY_PAD_X + KEY_BORDER);
    const capH = key.height + 2 * KEY_PAD_Y + KEY_SHADE + 2 * KEY_BORDER;
    const groupW = capW + MARKER_GAP + text.width;
    const capL = x - Math.floor(groupW / 2);
    const capT = y - capH;
    const o = WORLD_UI_COLORS.outline;
    const faceW = capW - 2 * KEY_BORDER;
    const sideH = capH - 2 * KEY_BORDER;
    batch.rect(capL + KEY_BORDER, capT, faceW, KEY_BORDER, o);
    batch.rect(capL + KEY_BORDER, capT + capH - KEY_BORDER, faceW, KEY_BORDER, o);
    batch.rect(capL, capT + KEY_BORDER, KEY_BORDER, sideH, o);
    batch.rect(capL + capW - KEY_BORDER, capT + KEY_BORDER, KEY_BORDER, sideH, o);
    batch.rect(capL + KEY_BORDER, capT + KEY_BORDER, faceW, sideH, WORLD_UI_COLORS.keyFace);
    batch.rect(capL + KEY_BORDER, capT + capH - KEY_BORDER - KEY_SHADE, faceW, KEY_SHADE, WORLD_UI_COLORS.keyShade);
    // Key and action text share one baseline: the key's ink starts right inside the cap's padding.
    const blockTop = capT + KEY_BORDER + KEY_PAD_Y - key.top;
    batch.text(e.key, capL + KEY_BORDER + KEY_PAD_X - key.left, blockTop, this.style.set(WORLD_UI_COLORS.keyInk, 'none', 0, 'left'));
    batch.text(e.text, capL + capW + MARKER_GAP - text.left, blockTop, this.style.set(WORLD_UI_COLORS.text, 'outline', o, 'left'));
  }
}
