/**
 * Debug overlays of the world view (M2-29, MASTERPROMPT §31.6 "Overlays (Chunks, Kollision, …,
 * Temperaturfeld)"): coloured rectangles and short labels in world px that the producers (the game
 * view, `world/overlays.ts`) put into the frame's `DebugOverlayList`; `DebugOverlayPass` draws them on
 * top of the final image – unlit, on whole internal pixels, below the world UI – so the overlay reads
 * the same by day, by night and in caves.
 *
 * Like the world UI the list is pooled: a frame with as many elements as the last one allocates
 * nothing. Labels are strings the producer keeps (formatted once, never per frame).
 */

/** The overlays of the world view. */
export const WORLD_OVERLAYS = ['chunks', 'kollision', 'temperatur'] as const;
export type WorldOverlay = (typeof WORLD_OVERLAYS)[number];

export function isWorldOverlay(name: string): name is WorldOverlay {
  return (WORLD_OVERLAYS as readonly string[]).includes(name);
}

/** One element of the overlay (pooled; `text` is only read for labels). */
export class DebugOverlayEntry {
  kind: 'rect' | 'label' = 'rect';
  /** Top left corner (rects) or anchor (labels: left edge, block top) in world px. */
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  /** Packed 0xRRGGBBAA. */
  color = 0;
  text = '';
}

/** The debug overlay of one frame. */
export class DebugOverlayList {
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
  }

  /** A filled rectangle in world px. */
  rect(x: number, y: number, width: number, height: number, color: number): void {
    const e = this.next('rect', x, y);
    e.width = width;
    e.height = height;
    e.color = color;
  }

  /** A text with its left edge on `x` and its block top on `y` (world px), outlined for contrast. */
  label(x: number, y: number, text: string, color: number): void {
    const e = this.next('label', x, y);
    e.text = text;
    e.color = color;
  }

  private next(kind: DebugOverlayEntry['kind'], x: number, y: number): DebugOverlayEntry {
    let e = this.pool[this.n];
    if (e === undefined) {
      e = new DebugOverlayEntry();
      this.pool.push(e);
    }
    this.n++;
    e.kind = kind;
    e.x = x;
    e.y = y;
    return e;
  }
}
