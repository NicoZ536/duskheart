/**
 * Debug overlays of the world view (M2-29, MASTERPROMPT §31.6 "Overlays (Chunks, Kollision, …,
 * Temperaturfeld)"): coloured rectangles and short labels in world px that the producers (the game
 * view, `world/overlays.ts`) put into the frame's `DebugOverlayList`; `DebugOverlayPass` draws them on
 * top of the final image – unlit, on whole internal pixels, below the world UI – so the overlay reads
 * the same by day, by night and in caves.
 *
 * Three kinds of element (M6 gate, ADR-0170 and its supplement):
 * - rects: geometry; a *mark* (`mark`) is geometry the labels keep clear of (a path's steps, its goal, the step a
 *   walker heads for);
 * - name labels (`label`): a name or a short text beside its thing, on a dark plate; one label may hold several lines
 *   (`\n`) on one plate; it moves below (or above) a label or mark it would cover;
 * - value labels (`value`): the value of one cell (a tile's temperature, a roof tile's distance to its support),
 *   centred in that cell, outlined without a plate – the cell's colour, the overlay's theme, stays visible around the
 *   digits – and never moved: a value belongs to its cell.
 *
 * Elements belong to a layer (`OVERLAY_LAYER`): the overlays' information (fields, marks, labels) lies under the
 * player's tools (the build ghost, the trap preview), which producers outside the overlays put into the list on the
 * default layer – no label covers the frame of what the player is about to place.
 *
 * Like the world UI the list is pooled: a frame with as many elements as the last one allocates
 * nothing. Labels are strings the producer keeps (formatted once, never per frame).
 */

/**
 * The overlays of the world view: chunks, collision, temperature field (M2-29) and the creatures' (M6-35, §31.6
 * "Overlays (… Pfade, … Spawnzonen …)"): the spawn ring of the shadow brood, the creatures' perception, their paths.
 */
export const WORLD_OVERLAYS = ['chunks', 'kollision', 'temperatur', 'spawnzonen', 'wahrnehmung', 'pfade'] as const;
export type WorldOverlay = (typeof WORLD_OVERLAYS)[number];

export function isWorldOverlay(name: string): name is WorldOverlay {
  return (WORLD_OVERLAYS as readonly string[]).includes(name);
}

/**
 * Layers of the overlay, drawn bottom to top, each with its geometry first and its labels after it: `info` holds what
 * the overlays show (world debug overlays, build overlays), `tool` what the player is doing over them (the build ghost,
 * the trap preview) – the default of the list, so a producer that knows nothing of layers draws on top.
 */
export const OVERLAY_LAYER = { info: 0, tool: 1 } as const;
export type OverlayLayer = (typeof OVERLAY_LAYER)[keyof typeof OVERLAY_LAYER];
/** Number of layers (`OVERLAY_LAYER` runs 0 … `OVERLAY_LAYERS` − 1). */
export const OVERLAY_LAYERS = 2;

/** Layout of a name label's box around its text [px] (`DebugOverlayPass`). */
export const DEBUG_LABEL = {
  /** The 8-neighbour outline of the pixel text. */
  outlinePx: 1,
  /** Plate beyond the outline. */
  marginPx: 1,
  /** Free pixels between two boxes (labels, marks, value labels) and between a box and the picture's edge (beyond the 1 px scene border). */
  gapPx: 1,
  /** Opacity of the backing plate (0 … 255): the overlay beneath still shows through faintly. */
  plateAlpha: 0xb0,
} as const;

/**
 * How far beside a mark a producer anchors a name label's text so that the label's plate keeps the gap to it [px]: the
 * plate reaches outline + margin beyond the text, the gap lies beyond that.
 */
export const DEBUG_LABEL_CLEARANCE_PX = DEBUG_LABEL.outlinePx + DEBUG_LABEL.marginPx + DEBUG_LABEL.gapPx;

/** One element of the overlay (pooled; `text` is only read for labels). */
export class DebugOverlayEntry {
  kind: 'rect' | 'label' = 'rect';
  /** Top left corner (rects, value labels: of the cell) or anchor (name labels: left edge, block top) in world px. */
  x = 0;
  y = 0;
  /** Size of a rect, of a value label's cell; 0 for name labels. */
  width = 0;
  height = 0;
  /** Packed 0xRRGGBBAA. */
  color = 0;
  text = '';
  /** Rects: a mark name labels keep clear of. Labels: a value label, centred in its cell, never moved. */
  fixed = false;
  /** Layer (`OVERLAY_LAYER`). */
  layer: OverlayLayer = OVERLAY_LAYER.tool;
}

/** The debug overlay of one frame. */
export class DebugOverlayList {
  /** Layer of the elements added from now on (`OVERLAY_LAYER`; `clear` resets it to `tool`). */
  layer: OverlayLayer = OVERLAY_LAYER.tool;
  private readonly pool: DebugOverlayEntry[] = [];
  private n = 0;

  get count(): number {
    return this.n;
  }

  entry(i: number): DebugOverlayEntry | undefined {
    return i < this.n ? this.pool[i] : undefined;
  }

  clear(): void {
    this.n = 0;
    this.layer = OVERLAY_LAYER.tool;
  }

  /** A filled rectangle in world px. */
  rect(x: number, y: number, width: number, height: number, color: number): void {
    this.box('rect', x, y, width, height, color, false);
  }

  /** A filled rectangle in world px that name labels keep clear of (a marker the overlay is about). */
  mark(x: number, y: number, width: number, height: number, color: number): void {
    this.box('rect', x, y, width, height, color, true);
  }

  /** A name label: text (lines split at `\n`) with its left edge on `x` and its block top on `y` (world px), on a plate. */
  label(x: number, y: number, text: string, color: number): void {
    const e = this.box('label', x, y, 0, 0, color, false);
    e.text = text;
  }

  /** A value label: `text` centred in the cell (`x`, `y`, `width`, `height`) in world px, outlined, never moved. */
  value(x: number, y: number, width: number, height: number, text: string, color: number): void {
    const e = this.box('label', x, y, width, height, color, true);
    e.text = text;
  }

  private box(kind: DebugOverlayEntry['kind'], x: number, y: number, width: number, height: number, color: number, fixed: boolean): DebugOverlayEntry {
    let e = this.pool[this.n];
    if (e === undefined) {
      e = new DebugOverlayEntry();
      this.pool.push(e);
    }
    this.n++;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.width = width;
    e.height = height;
    e.color = color;
    e.fixed = fixed;
    e.layer = this.layer;
    return e;
  }
}
