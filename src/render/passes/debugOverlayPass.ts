/**
 * Debug overlay pass (M2-29, MASTERPROMPT §31.6): draws the frame's `DebugOverlayList` – chunk
 * borders, collision tiles, the temperature field, the creatures' overlays, the build overlays and the build ghost –
 * into the final image (`targets.ldr`) after post and outline and before the world UI, with the pixel font's glyph
 * atlas for its labels. One `TextBatch` (one instanced draw call) holds the whole overlay; nothing is drawn while the
 * list is empty (overlays off) or until the font has loaded.
 *
 * Labels stay readable and with their thing (M6 gate, §31.5 "UI-Ausrichtung", ADR-0170 and its supplement;
 * `queueDebugOverlay`): layer by layer (`OVERLAY_LAYER`: the overlays' information under the player's tools, so no
 * label covers the frame of the build ghost), all geometry first and the labels after it, so no dot, cone or path
 * square lands inside the letters. A value label is centred in its cell, outlined without a plate, and never moved – it
 * belongs to its tile, and the tile's colour shows around it. A name label lies on a dark backing plate (all its lines on
 * one); one that would cover a value, a mark (`DebugOverlayList.mark`) or a label placed before it moves below it (above
 * it when there is no room below) – `DebugLabelPlacer`. A label that does not fit in the picture where it belongs is not
 * drawn: it is not moved in from the edge, where the HUD's panels lie and would cut its plate.
 */
import { snapToPixel } from '../camera';
import { DEBUG_LABEL, OVERLAY_LAYERS, type DebugOverlayEntry, type DebugOverlayList } from '../debugOverlay';
import type { GlyphAtlas } from '../text/glyphAtlas';
import { layoutText, TextLayout, type GlyphSource } from '../text/layout';
import { TextBatch } from '../text/textBatch';
import { WORLD_UI_COLORS } from '../worldUi/worldUi';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';
import type { TextStyle } from '../text/textBatch';

export { DEBUG_LABEL } from '../debugOverlay';

/** Pixels from the ink to the plate's edge on every side (the layout box of a name label). */
const BOX_PAD = DEBUG_LABEL.outlinePx + DEBUG_LABEL.marginPx;
/** Picture border of the target (camera.ts SCENE_BORDER: the target is one pixel larger on every side). */
const TARGET_BORDER = 1;
/** Boxes of one frame the placer holds before it grows (four ints each). */
const INITIAL_BOXES = 64;
const BOX_INTS = 4;

/** The plate colour: the outline's dark at `DEBUG_LABEL.plateAlpha`. */
export const DEBUG_LABEL_PLATE = (WORLD_UI_COLORS.outline - (WORLD_UI_COLORS.outline % 256) + DEBUG_LABEL.plateAlpha) >>> 0;

/**
 * Places the label boxes of one frame (target px, whole numbers). `reserve` keeps a box clear that nothing moves (a mark,
 * a value label); `place` puts a name label's box where it is wanted when it fits in the picture there, moved below (or
 * above) every box before it that it would overlap; the result is in `x`, `y`. Typed storage, nothing allocated per box.
 */
export class DebugLabelPlacer {
  /** Top-left corner of the box `place` placed last. */
  x = 0;
  y = 0;
  /** Whether the box `place` placed last found a free place (false: it stands at its wanted place over another box). */
  free = false;
  private boxes = new Int32Array(INITIAL_BOXES * BOX_INTS);
  private n = 0;
  private width = 0;
  private height = 0;

  /** Boxes reserved and placed since `begin`. */
  get count(): number {
    return this.n;
  }

  /** Starts a frame on a target `width` × `height` px (the 1 px scene border included). */
  begin(width: number, height: number): void {
    this.n = 0;
    this.width = width;
    this.height = height;
  }

  /** Whether the box (x, y, w, h) lies in the picture with `margin` free pixels to its edges (the scene border excluded). */
  inPicture(x: number, y: number, w: number, h: number, margin: number): boolean {
    const lo = TARGET_BORDER + margin;
    return x >= lo && y >= lo && x + w <= this.width - lo && y + h <= this.height - lo;
  }

  /** Keeps the box (x, y, w, h) clear for the boxes placed after it; it is not moved. */
  reserve(x: number, y: number, w: number, h: number): void {
    this.store(x, y, w, h);
  }

  /**
   * Places a box `w` × `h` wanted at (`x`, `y`). False when it does not fit in the picture there (nothing is kept: the
   * label is not drawn). Else true, at the first place below – then above – its wanted place that keeps the gap to every
   * box before it, within the picture; without such a place at its wanted place (`free` false).
   */
  place(x: number, y: number, w: number, h: number): boolean {
    const g = DEBUG_LABEL.gapPx;
    const left = Math.round(x);
    const wantY = Math.round(y);
    if (!this.inPicture(left, wantY, w, h, g)) return false;
    const minY = TARGET_BORDER + g;
    const maxY = this.height - TARGET_BORDER - g;
    let top = wantY;
    let down = true;
    let free = false;
    // Every move clears one box and passes it: twice the boxes (down, then up) bound the search.
    for (let tries = 0; tries <= 2 * this.n + 1; tries++) {
      const hit = this.overlapping(left, top, w, h);
      if (hit < 0) {
        free = true;
        break;
      }
      const b = hit * BOX_INTS;
      if (down) {
        top = (this.boxes[b + 1] as number) + (this.boxes[b + 3] as number) + g;
        if (top + h > maxY) {
          down = false;
          top = wantY;
        }
      } else {
        top = (this.boxes[b + 1] as number) - g - h;
        if (top < minY) break;
      }
    }
    if (!free) top = wantY;
    this.store(left, top, w, h);
    this.x = left;
    this.y = top;
    this.free = free;
    return true;
  }

  /** Index of the first box that the box (x, y, w, h) – with the gap – overlaps, −1 for none. */
  private overlapping(x: number, y: number, w: number, h: number): number {
    const g = DEBUG_LABEL.gapPx;
    const boxes = this.boxes;
    for (let i = 0; i < this.n; i++) {
      const b = i * BOX_INTS;
      const bx = boxes[b] as number;
      const by = boxes[b + 1] as number;
      if (x < bx + (boxes[b + 2] as number) + g && bx < x + w + g && y < by + (boxes[b + 3] as number) + g && by < y + h + g) return i;
    }
    return -1;
  }

  private store(x: number, y: number, w: number, h: number): void {
    if ((this.n + 1) * BOX_INTS > this.boxes.length) {
      const grown = new Int32Array(this.boxes.length * 2);
      grown.set(this.boxes);
      this.boxes = grown;
    }
    const b = this.n * BOX_INTS;
    this.boxes[b] = x;
    this.boxes[b + 1] = y;
    this.boxes[b + 2] = w;
    this.boxes[b + 3] = h;
    this.n++;
  }
}

/** What the overlay is queued into (the pass's text batch; a recorder in the tests). */
export interface DebugOverlaySink {
  rect(x: number, y: number, width: number, height: number, color: number): void;
  text(text: string, x: number, y: number, style: TextStyle): unknown;
}

/** A text style the pass rewrites per label (one object: no allocation per element). */
export class DebugLabelStyle implements TextStyle {
  color = 0;
  readonly effect = 'outline' as const;
  readonly effectColor = WORLD_UI_COLORS.outline;
  readonly align = 'left' as const;
}

/**
 * Queues `list` for a target `width` × `height` px whose pixel (0, 0) is world px (`originX`, `originY`): layer by
 * layer every rect, then every value label in its cell, then every name label on its plate, placed by `placer`.
 * Returns the elements queued.
 */
export function queueDebugOverlay(
  list: DebugOverlayList,
  originX: number,
  originY: number,
  width: number,
  height: number,
  sink: DebugOverlaySink,
  font: GlyphSource,
  layout: TextLayout,
  placer: DebugLabelPlacer,
  style: DebugLabelStyle,
): number {
  let drawn = 0;
  placer.begin(width, height);
  for (let layer = 0; layer < OVERLAY_LAYERS; layer++) {
    let labels = 0;
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e === undefined || e.layer !== layer) continue;
      if (e.kind !== 'rect') {
        labels++;
        continue;
      }
      // World px → target px (the target includes the 1 px border; the camera origin is whole px).
      const x = snapToPixel(e.x) - originX;
      const y = snapToPixel(e.y) - originY;
      sink.rect(x, y, e.width, e.height, e.color);
      if (e.fixed) placer.reserve(x, y, Math.round(e.width), Math.round(e.height));
      drawn++;
    }
    if (labels === 0) continue;
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e !== undefined && e.layer === layer && e.kind === 'label' && e.fixed && queueValue(e, originX, originY, sink, font, layout, placer, style)) drawn++;
    }
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e !== undefined && e.layer === layer && e.kind === 'label' && !e.fixed && queueName(e, originX, originY, sink, font, layout, placer, style)) drawn++;
    }
  }
  return drawn;
}

/** A value label: its ink centred in its cell, outlined, no plate; drawn when ink and outline lie in the picture. */
function queueValue(e: DebugOverlayEntry, originX: number, originY: number, sink: DebugOverlaySink, font: GlyphSource, layout: TextLayout, placer: DebugLabelPlacer, style: DebugLabelStyle): boolean {
  style.color = e.color;
  const l = layoutText(font, e.text, style, layout);
  if (l.count === 0) return false;
  // The ink box of the laid out text (glyph bitmaps are trimmed to their ink).
  let inkL = Number.POSITIVE_INFINITY;
  let inkT = Number.POSITIVE_INFINITY;
  let inkR = Number.NEGATIVE_INFINITY;
  let inkB = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < l.count; k++) {
    const p = l.glyphs[k];
    if (p === undefined) continue;
    if (p.x < inkL) inkL = p.x;
    if (p.y < inkT) inkT = p.y;
    if (p.x + p.glyph.width > inkR) inkR = p.x + p.glyph.width;
    if (p.y + p.glyph.height > inkB) inkB = p.y + p.glyph.height;
  }
  const left = snapToPixel(e.x) - originX + Math.floor((Math.round(e.width) - (inkR - inkL)) / 2) - inkL;
  const top = snapToPixel(e.y) - originY + Math.floor((Math.round(e.height) - (inkB - inkT)) / 2) - inkT;
  const o = DEBUG_LABEL.outlinePx;
  const bx = left + inkL - o;
  const by = top + inkT - o;
  const bw = inkR - inkL + 2 * o;
  const bh = inkB - inkT + 2 * o;
  if (!placer.inPicture(bx, by, bw, bh, 0)) return false;
  placer.reserve(bx, by, bw, bh);
  sink.text(e.text, left, top, style);
  return true;
}

/** A name label on its plate, where `placer` puts it; nothing when it does not fit in the picture where it belongs. */
function queueName(e: DebugOverlayEntry, originX: number, originY: number, sink: DebugOverlaySink, font: GlyphSource, layout: TextLayout, placer: DebugLabelPlacer, style: DebugLabelStyle): boolean {
  style.color = e.color;
  const l = layoutText(font, e.text, style, layout);
  const w = l.width + 2 * BOX_PAD;
  const h = l.height + 2 * BOX_PAD;
  if (!placer.place(snapToPixel(e.x) - originX - BOX_PAD, snapToPixel(e.y) - originY - BOX_PAD, w, h)) return false;
  sink.rect(placer.x, placer.y, w, h, DEBUG_LABEL_PLATE);
  sink.text(e.text, placer.x + BOX_PAD, placer.y + BOX_PAD, style);
  return true;
}

export class DebugOverlayPass implements RenderPass {
  readonly name = 'debug-overlay';
  enabled = true;
  private setup: PassSetup | null = null;
  private glyphs: GlyphAtlas | null = null;
  private batch: TextBatch | null = null;
  private readonly style = new DebugLabelStyle();
  private readonly layout = new TextLayout();
  private readonly placer = new DebugLabelPlacer();
  private drawn = 0;

  /** Overlay elements drawn in the last frame. */
  get drawnLastFrame(): number {
    return this.drawn;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    this.createBatch();
  }

  /** Provides the glyph atlas of the pixel font (the same as the world UI's). */
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
    this.drawn = 0;
    const list = ctx.scene.debugOverlay;
    const batch = this.batch;
    if (list.count === 0 || batch === null) return;
    const f = ctx.frame;
    ctx.targets.ldr.bind();
    batch.begin(f.width, f.height);
    this.drawn = queueDebugOverlay(list, f.camera.originX, f.camera.originY, f.width, f.height, batch, batch.atlas, this.layout, this.placer, this.style);
    ctx.stats.drawCalls += batch.end();
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
}
