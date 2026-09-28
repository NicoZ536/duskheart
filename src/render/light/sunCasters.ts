/**
 * Sun and moon casters of the build grid (M5-02, M5-05): walls, closed doors and gates, windows and roofs as blocks
 * between two heights over a footprint on the ground – the shadow pass sweeps each block along the shadow vector
 * (`shadow_block.*`). The grid casts them instead of the parts' sprites, so a house throws the same shadow whether the
 * player looks at it from outside or stands inside, where the roof is faded and the front wall cut down to its sill
 * (M4-27): the roof keeps the sun out of the room, and it falls in through the windows, open doors and gates only.
 *
 * - **Opaque** blocks: walls, closed doors and gates (their full height), roofs (a slab from the wall top up).
 * - **Clear glass:** a glass roof lets the sun through, slightly tinted.
 * - **Pane sprite:** a window samples its sprite's front view (frame 0) at the height and place a ray crosses its
 *   plane – panes let their colour through (the stained-glass window throws red, blue, green and gold into the room),
 *   the frame and the parapet are opaque, an open window's hole lets the sun pass.
 *
 * Struct of arrays in one Float32Array (the instance records of `shadow_block.vert`), preallocated, growing by
 * doubling – no allocation per frame.
 */

/** Kinds of a caster (`aSpan.z` of shadow_block.vert). */
export const SUN_CASTER_KIND = { opaque: 0, clearGlass: 1, paneSprite: 2 } as const;
export type SunCasterKind = (typeof SUN_CASTER_KIND)[keyof typeof SUN_CASTER_KIND];

/** Axis a window's plane runs along: east–west (sprite columns along x) or north–south (along y). */
export const SUN_CASTER_AXIS = { x: 0, y: 1 } as const;
export type SunCasterAxis = (typeof SUN_CASTER_AXIS)[keyof typeof SUN_CASTER_AXIS];

/** Floats per record: box (4), span (bottom, top, kind, axis), pane (along origin, atlas x, atlas y, foot row), frame (palette row, w, h, 0). */
export const SUN_CASTER_FLOATS = 16;
export const SUN_CASTER_STRIDE = SUN_CASTER_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** Float offsets of the attribute groups. */
export const SUN_CASTER_OFFSET = { box: 0, span: 4, pane: 8, frame: 12 } as const;
export const INITIAL_SUN_CASTERS = 256;

/** The pane sprite of a window: its front view in the atlas. */
export interface PaneSprite {
  /** Atlas texel of the frame's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Size of the frame [px]. */
  readonly w: number;
  readonly h: number;
  /** Anchor column of the frame (it stands on the tile's middle). */
  readonly ax: number;
  /** Frame row edge of the wall's foot: height t above the wall's ground shows in frame row ⌊footRow − t⌋. */
  readonly footRow: number;
  /** Palette row the sprite is drawn with. */
  readonly row: number;
}

export class SunCasterList {
  private data = new Float32Array(INITIAL_SUN_CASTERS * SUN_CASTER_FLOATS);
  private n = 0;

  get count(): number {
    return this.n;
  }

  /** The packed records (`count · SUN_CASTER_FLOATS` floats are valid). */
  get records(): Float32Array {
    return this.data;
  }

  clear(): void {
    this.n = 0;
  }

  private next(): number {
    if ((this.n + 1) * SUN_CASTER_FLOATS > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    return this.n++ * SUN_CASTER_FLOATS;
  }

  /** An opaque block (or clear glass) over the rectangle (x0, y0)–(x1, y1) [world px] from height `bottom` to `top` [px]. */
  block(x0: number, y0: number, x1: number, y1: number, bottom: number, top: number, kind: SunCasterKind = SUN_CASTER_KIND.opaque): void {
    if (!(x1 > x0) || !(y1 > y0) || !(top > bottom)) return;
    const o = this.next();
    const d = this.data;
    d[o] = (x0 + x1) / 2;
    d[o + 1] = (y0 + y1) / 2;
    d[o + 2] = (x1 - x0) / 2;
    d[o + 3] = (y1 - y0) / 2;
    d[o + 4] = bottom;
    d[o + 5] = top;
    d[o + 6] = kind;
    d[o + 7] = SUN_CASTER_AXIS.x;
    for (let k = 8; k < SUN_CASTER_FLOATS; k++) d[o + k] = 0;
  }

  /**
   * A window: the block over (x0, y0)–(x1, y1) from `bottom` to `top`, its plane running along `axis`; world
   * coordinate `origin` along that axis is the left edge of the frame's column 0, height `bottom` its `pane.footRow`.
   */
  pane(x0: number, y0: number, x1: number, y1: number, bottom: number, top: number, axis: SunCasterAxis, origin: number, pane: PaneSprite): void {
    if (!(x1 > x0) || !(y1 > y0) || !(top > bottom)) return;
    const o = this.next();
    const d = this.data;
    d[o] = (x0 + x1) / 2;
    d[o + 1] = (y0 + y1) / 2;
    d[o + 2] = (x1 - x0) / 2;
    d[o + 3] = (y1 - y0) / 2;
    d[o + 4] = bottom;
    d[o + 5] = top;
    d[o + 6] = SUN_CASTER_KIND.paneSprite;
    d[o + 7] = axis;
    d[o + 8] = origin;
    d[o + 9] = pane.x;
    d[o + 10] = pane.y;
    d[o + 11] = pane.footRow;
    d[o + 12] = pane.row;
    d[o + 13] = pane.w;
    d[o + 14] = pane.h;
    d[o + 15] = 0;
  }
}

/** How many casters of each kind `list` holds (debug info: `__dh.call('skyInfo')`). */
export function sunCasterKinds(list: SunCasterList): { opaque: number; clearGlass: number; paneSprite: number } {
  const out = { opaque: 0, clearGlass: 0, paneSprite: 0 };
  const r = list.records;
  for (let i = 0; i < list.count; i++) {
    const kind = r[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 2];
    if (kind === SUN_CASTER_KIND.paneSprite) out.paneSprite++;
    else if (kind === SUN_CASTER_KIND.clearGlass) out.clearGlass++;
    else out.opaque++;
  }
  return out;
}
