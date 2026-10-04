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
 *
 * An interaction marker's key cap is the hint glyph sprite `hinweis_taste` of the scene's atlas (M4-38, `keyCap.ts`:
 * the HUD's cap, stretched sideways for long key names) with the key's name in its face; scenes on an atlas without
 * it (the render debug scenes) get a cap drawn in the same parchment colours.
 */
import type { GlyphAtlas } from '../text/glyphAtlas';
import { layoutText, TextLayout, type LayoutOptions, type TextAlign } from '../text/layout';
import { TextBatch, type TextEffect } from '../text/textBatch';
import { BAR_COLORS, barFill, damageFadeStep, damageRise, fadeStepOpacity, markerBottomClearOf, WORLD_UI_COLORS, type WorldUiEntry } from '../worldUi/worldUi';
import type { AtlasData } from '../assets/atlas';
import { KEY_CAP_FACE, KEY_CAP_PAD, KEY_CAP_RIM, KeyCapShape } from './keyCap';
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
/** Gap between a marker lifted clear of its keep-out box (the player's figure) and that box (px). */
const MARKER_AVOID_GAP = 2;
const BYTE = 0xff;
const ALPHA_MASK = 0xffffff00;

/** `color` with its alpha multiplied by the opacity of fade step `step` (`fadeStepOpacity`; a whole number through the call). */
function withFade(color: number, step: number): number {
  const a = Math.round((color & BYTE) * fadeStepOpacity(step));
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

/** Start of an empty ink box [px]: beyond any glyph position, a small integer. */
const NO_INK = 1 << 29;

/** Layout options of the marker measurements (single line, no wrapping). */
const PLAIN_LAYOUT: LayoutOptions = {};

/** Ink bounding box of a laid-out text relative to its block (x from the pen start, y from the block top). */
class InkBox {
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;

  /**
   * The ink box of `l`. Whole numbers all the way (glyph positions are whole pixels; the empty box starts at ±`NO_INK`, not
   * at ±∞): a marker measures its texts every frame, and a field that once held ∞ would hand back a new number per read.
   */
  of(l: TextLayout): this {
    let left = NO_INK;
    let top = NO_INK;
    let right = -NO_INK;
    let bottom = -NO_INK;
    for (let i = 0; i < l.count; i++) {
      const p = l.glyphs[i];
      if (p === undefined) continue;
      if (p.x < left) left = p.x;
      if (p.y < top) top = p.y;
      if (p.x + p.glyph.width > right) right = p.x + p.glyph.width;
      if (p.y + p.glyph.height > bottom) bottom = p.y + p.glyph.height;
    }
    if (left === NO_INK) left = top = right = bottom = 0;
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
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
  /** Keep-out box of the marker drawn now, in target px (reused: no allocation per marker). */
  private readonly avoidBox = { left: 0, top: 0, right: 0, bottom: 0 };
  private drawnAll = true;
  /** The key cap sprite of the scene's atlas (read once per atlas), null without it. */
  private cap: KeyCapShape | null = null;
  private capAtlas: AtlasData | null = null;

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
    this.capOf(ctx.scene.atlas);
    ctx.targets.ldr.bind();
    batch.begin(f.width, f.height);
    // The camera origin is whole px: as small integers once per frame, so no element's offset is a new number (§30).
    const originX = f.camera.originX | 0;
    const originY = f.camera.originY | 0;
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e === undefined) continue;
      // World px → target px (the target includes the 1 px border). Snapped here – `snapToPixel`'s formula without its
      // call, which would take the anchor as a new number (§30).
      const x = Math.floor(e.x + 0.5) - originX;
      const y = Math.floor(e.y + 0.5) - originY;
      if (e.kind === 'label') this.label(batch, e, x, y);
      else if (e.kind === 'bar') this.bar(batch, e, x, y);
      else if (e.kind === 'damage') this.damage(batch, e, x, y);
      else this.marker(batch, e, x, y, originX, originY);
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
    const age = e.age;
    const step = damageFadeStep(age);
    if (step < 0) return;
    const top = y - damageRise(age) - this.ascent();
    batch.text(e.text, x, top, this.style.set(withFade(e.color, step), 'outline', withFade(WORLD_UI_COLORS.outline, step), 'center'));
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

  /**
   * Bottom edge [target px] of a marker whose bottom would be `y`, spanning `groupW` × `height` from `left`, lifted clear
   * of the entry's keep-out box (whole world px, shifted into the target by the camera origin like the anchor).
   */
  private clearOf(e: WorldUiEntry, originX: number, originY: number, y: number, left: number, groupW: number, height: number): number {
    // The box is in whole world px (`WorldUiBox`): shifted by the camera origin like the anchor, integers only (§30).
    const box = this.avoidBox;
    box.left = e.avoidLeft - originX;
    box.right = e.avoidRight - originX;
    box.top = e.avoidTop - originY;
    box.bottom = e.avoidBottom - originY;
    return markerBottomClearOf(left, left + groupW, y, height, box, MARKER_AVOID_GAP);
  }

  /** The key cap sprite of `atlas` (read when the atlas changes). */
  private capOf(atlas: AtlasData | null): void {
    if (atlas === this.capAtlas) return;
    this.capAtlas = atlas;
    this.cap = atlas === null ? null : KeyCapShape.from(atlas);
  }

  /**
   * Key cap sprite (`hinweis_taste`) with the key's name in its face and the action text beside it on the same baseline;
   * the cap's bottom edge sits on the marker's anchor, lifted clear of its keep-out box.
   */
  private marker(batch: TextBatch, e: WorldUiEntry, x: number, y: number, originX: number, originY: number): void {
    const glyphs = this.glyphs;
    if (glyphs === null) return;
    const cap = this.cap;
    if (cap === null) {
      this.drawnMarker(batch, e, x, y, originX, originY);
      return;
    }
    const key = this.keyInk.of(layoutText(glyphs, e.key, PLAIN_LAYOUT, this.measure));
    const text = this.textInk.of(layoutText(glyphs, e.text, PLAIN_LAYOUT, this.measure));
    const capW = cap.widthFor(key.width);
    // The cap's cell down to its last row with pixels: that row is the marker's bottom edge.
    const capH = cap.bottomRow + 1;
    const groupW = e.text === '' ? capW : capW + MARKER_GAP + text.width;
    const capL = x - Math.floor(groupW / 2);
    const capT = (e.avoid ? this.clearOf(e, originX, originY, y, capL, groupW, capH) : y) - capH;
    cap.draw(batch, capL, capT, capW);
    // The key's ink centred in the face (rows 3–10, between the rims); the action text on its baseline.
    const faceH = KEY_CAP_FACE.bottom - KEY_CAP_FACE.top + 1;
    const faceW = capW - KEY_CAP_RIM.left - KEY_CAP_RIM.right;
    const inkTop = capT + KEY_CAP_FACE.top + Math.max(0, Math.floor((faceH - key.height) / 2));
    const inkLeft = capL + KEY_CAP_RIM.left + Math.max(KEY_CAP_PAD, Math.floor((faceW - key.width) / 2));
    const blockTop = inkTop - key.top;
    batch.text(e.key, inkLeft - key.left, blockTop, this.style.set(WORLD_UI_COLORS.keyInk, 'none', 0, 'left'));
    if (e.text !== '') batch.text(e.text, capL + capW + MARKER_GAP - text.left, blockTop, this.style.set(WORLD_UI_COLORS.text, 'outline', WORLD_UI_COLORS.outline, 'left'));
  }

  /** A cap drawn in the parchment colours (parchment face, shade row, dark frame with cut corners): atlases without the sprite. */
  private drawnMarker(batch: TextBatch, e: WorldUiEntry, x: number, y: number, originX: number, originY: number): void {
    const glyphs = this.glyphs;
    if (glyphs === null) return;
    const key = this.keyInk.of(layoutText(glyphs, e.key, PLAIN_LAYOUT, this.measure));
    const text = this.textInk.of(layoutText(glyphs, e.text, PLAIN_LAYOUT, this.measure));
    const capW = key.width + 2 * (KEY_PAD_X + KEY_BORDER);
    const capH = key.height + 2 * KEY_PAD_Y + KEY_SHADE + 2 * KEY_BORDER;
    // Without an action text (the HUD shows it) the key cap stands alone, centred.
    const groupW = e.text === '' ? capW : capW + MARKER_GAP + text.width;
    const capL = x - Math.floor(groupW / 2);
    const capT = (e.avoid ? this.clearOf(e, originX, originY, y, capL, groupW, capH) : y) - capH;
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
    if (e.text !== '') batch.text(e.text, capL + capW + MARKER_GAP - text.left, blockTop, this.style.set(WORLD_UI_COLORS.text, 'outline', o, 'left'));
  }
}
