/**
 * Debug overlay pass (M2-29, MASTERPROMPT §31.6): draws the frame's `DebugOverlayList` – chunk
 * borders, collision tiles, the temperature field, the creatures' overlays – into the final image (`targets.ldr`) after
 * post and outline and before the world UI, with the pixel font's glyph atlas for its labels. One
 * `TextBatch` (one instanced draw call) holds the whole overlay; nothing is drawn while the list is
 * empty (overlays off) or until the font has loaded.
 *
 * Labels stay readable (M6 gate, §31.5 "UI-Ausrichtung", ADR-0170; `queueDebugOverlay`): all geometry is queued first and every
 * label after it, on a dark backing plate, so no dot, cone or path square lands inside the letters; a label is moved into
 * the picture when its anchor lies near or up to a tile beyond an edge (further out it is not drawn: it would stand at the
 * edge, away from its thing), and a label that would cover one placed before it moves below it (above it when there is no
 * room below) – `DebugLabelPlacer`.
 */
import { snapToPixel } from '../camera';
import type { DebugOverlayList } from '../debugOverlay';
import type { GlyphAtlas } from '../text/glyphAtlas';
import { layoutText, TextLayout, type GlyphSource } from '../text/layout';
import { TextBatch } from '../text/textBatch';
import { WORLD_UI_COLORS } from '../worldUi/worldUi';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';
import type { TextStyle } from '../text/textBatch';

/** Layout of a label's box: the outline around the ink, the plate's margin around it, the gap between boxes [px]. */
export const DEBUG_LABEL = {
  /** The 8-neighbour outline of the pixel text. */
  outlinePx: 1,
  /** Plate beyond the outline. */
  marginPx: 1,
  /** Free pixels between two label boxes and between a box and the picture's edge (beyond the 1 px scene border). */
  gapPx: 1,
  /** Opacity of the backing plate (0 … 255): the overlay beneath still shows through faintly. */
  plateAlpha: 0xb0,
  /**
   * How far beyond the picture's edge a label's anchor may lie and still be moved in [px] – a tile: a label whose thing
   * stands further out (a creature off screen whose cone reaches in) is not drawn, it would stand at the edge away from it.
   */
  reachPx: 16,
} as const;

/** Pixels from the ink to the box edge on every side. */
const BOX_PAD = DEBUG_LABEL.outlinePx + DEBUG_LABEL.marginPx;
/** Picture border of the target (camera.ts SCENE_BORDER: the target is one pixel larger on every side). */
const TARGET_BORDER = 1;
/** Label boxes of one frame the placer holds before it grows (four ints each). */
const INITIAL_BOXES = 64;
const BOX_INTS = 4;

/** The plate colour: the outline's dark at `DEBUG_LABEL.plateAlpha`. */
export const DEBUG_LABEL_PLATE = (WORLD_UI_COLORS.outline - (WORLD_UI_COLORS.outline % 256) + DEBUG_LABEL.plateAlpha) >>> 0;

/**
 * Places the label boxes of one frame (target px, whole numbers): `place` moves a box into the picture and below (or
 * above) every box placed before it that it would overlap; the result is in `x`, `y`. Typed storage, nothing allocated
 * per label.
 */
export class DebugLabelPlacer {
  /** Top-left corner of the box `place` placed last. */
  x = 0;
  y = 0;
  private boxes = new Int32Array(INITIAL_BOXES * BOX_INTS);
  private n = 0;
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;

  /** Boxes placed since `begin`. */
  get count(): number {
    return this.n;
  }

  /** Starts a frame on a target `width` × `height` px (the 1 px scene border included). */
  begin(width: number, height: number): void {
    this.n = 0;
    this.minX = TARGET_BORDER + DEBUG_LABEL.gapPx;
    this.minY = TARGET_BORDER + DEBUG_LABEL.gapPx;
    this.maxX = width - TARGET_BORDER - DEBUG_LABEL.gapPx;
    this.maxY = height - TARGET_BORDER - DEBUG_LABEL.gapPx;
  }

  /**
   * Places a box `w` × `h` wanted at (`x`, `y`): inside the picture, free of every box placed before. Returns false when
   * no free place was found within the picture (the box then sits at its wanted place, moved into the picture).
   */
  place(x: number, y: number, w: number, h: number): boolean {
    const left = clampInt(Math.round(x), this.minX, this.maxX - w);
    const wantY = clampInt(Math.round(y), this.minY, this.maxY - h);
    let top = wantY;
    let down = true;
    let free = false;
    // Every move clears one placed box and passes it: twice the boxes (down, then up) bound the search.
    for (let tries = 0; tries <= 2 * this.n + 1; tries++) {
      const hit = this.overlapping(left, top, w, h);
      if (hit < 0) {
        free = true;
        break;
      }
      const b = hit * BOX_INTS;
      if (down) {
        top = (this.boxes[b + 1] as number) + (this.boxes[b + 3] as number) + DEBUG_LABEL.gapPx;
        if (top + h > this.maxY) {
          down = false;
          top = wantY;
        }
      } else {
        top = (this.boxes[b + 1] as number) - DEBUG_LABEL.gapPx - h;
        if (top < this.minY) break;
      }
    }
    if (!free) top = wantY;
    this.store(left, top, w, h);
    this.x = left;
    this.y = top;
    return free;
  }

  /** Index of the first placed box that the box (x, y, w, h) – with the gap – overlaps, −1 for none. */
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

function clampInt(v: number, lo: number, hi: number): number {
  return v > hi ? Math.max(lo, hi) : v < lo ? lo : v;
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
 * Queues `list` for a target `width` × `height` px whose pixel (0, 0) is world px (`originX`, `originY`): every rect
 * first, then every label on its plate, placed by `placer`. Returns the elements queued.
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
  for (let i = 0; i < list.count; i++) {
    const e = list.entry(i);
    if (e === undefined || e.kind !== 'rect') continue;
    // World px → target px (the target includes the 1 px border; the camera origin is whole px).
    sink.rect(snapToPixel(e.x) - originX, snapToPixel(e.y) - originY, e.width, e.height, e.color);
    drawn++;
  }
  placer.begin(width, height);
  for (let i = 0; i < list.count; i++) {
    const e = list.entry(i);
    if (e === undefined || e.kind !== 'label') continue;
    const ax = snapToPixel(e.x) - originX;
    const ay = snapToPixel(e.y) - originY;
    if (ax < -DEBUG_LABEL.reachPx || ay < -DEBUG_LABEL.reachPx || ax > width + DEBUG_LABEL.reachPx || ay > height + DEBUG_LABEL.reachPx) continue;
    style.color = e.color;
    const l = layoutText(font, e.text, style, layout);
    const w = l.width + 2 * BOX_PAD;
    const h = l.height + 2 * BOX_PAD;
    placer.place(ax - BOX_PAD, ay - BOX_PAD, w, h);
    sink.rect(placer.x, placer.y, w, h, DEBUG_LABEL_PLATE);
    sink.text(e.text, placer.x + BOX_PAD, placer.y + BOX_PAD, style);
    drawn++;
  }
  return drawn;
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
