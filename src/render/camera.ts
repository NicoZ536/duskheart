/**
 * Camera with subpixel scrolling (MASTERPROMPT §4.2, §3.3; docs/RENDER.md §3 `camera.ts`).
 *
 * The scene is rendered at a whole-pixel camera position into a target one pixel larger on every
 * side; the fractional part is applied as an offset when the image is scaled up, so scrolling is
 * smooth without pixel shimmer. Snapping happens after interpolation: producers pass interpolated
 * float positions, the sprite shader rounds anchors to whole pixels (`snapToPixel`).
 *
 * Focus: when the camera follows an entity (the player), its whole-pixel base is the entity's
 * snapped position and only the offset between camera and entity is subpixel. The followed sprite
 * then stands still on screen instead of jittering by ±½ px, while easing and pans stay smooth.
 */

/** Border around the visible image in the internal targets (px on each side). */
export const SCENE_BORDER = 1;

/** Rounds a world coordinate to its pixel (same rule as the sprite shader: `floor(v + 0.5)`). */
export function snapToPixel(v: number): number {
  return Math.floor(v + 0.5);
}

/** Linear interpolation between the last two simulation states (`alpha` from the fixed-step loop). */
export function interpolate(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

export interface CameraSnap {
  /** World px of target pixel (0, 0) – the top-left corner including the border (integers). */
  readonly originX: number;
  readonly originY: number;
  /** Subpixel offset of the visible image inside the target, each in [0, 1). */
  readonly fracX: number;
  readonly fracY: number;
  /** World px of the visible image's top-left corner (float). */
  readonly viewLeft: number;
  readonly viewTop: number;
}

/** Mutable result of `snapCamera` (reused per frame). */
export interface MutableCameraSnap {
  originX: number;
  originY: number;
  fracX: number;
  fracY: number;
  viewLeft: number;
  viewTop: number;
}

export function emptySnap(): MutableCameraSnap {
  return { originX: 0, originY: 0, fracX: 0, fracY: 0, viewLeft: 0, viewTop: 0 };
}

/** One axis: the view start (world px) of an effective camera centre, following `focus` if finite. */
function viewStart(center: number, focus: number, viewSize: number): number {
  const effective = Number.isFinite(focus) ? snapToPixel(focus) + (center - focus) : center;
  return effective - viewSize / 2;
}

/**
 * Snaps a camera centred on (`centerX`, `centerY`) for a visible image of `viewW`×`viewH` internal px.
 * `focusX/Y` (NaN = none) is the followed entity's interpolated position.
 */
export function snapCamera(out: MutableCameraSnap, centerX: number, centerY: number, focusX: number, focusY: number, viewW: number, viewH: number): MutableCameraSnap {
  const sx = viewStart(centerX, focusX, viewW);
  const sy = viewStart(centerY, focusY, viewH);
  const wx = Math.floor(sx);
  const wy = Math.floor(sy);
  out.viewLeft = sx;
  out.viewTop = sy;
  out.originX = wx - SCENE_BORDER;
  out.originY = wy - SCENE_BORDER;
  out.fracX = sx - wx;
  out.fracY = sy - wy;
  return out;
}

/** Where a world point appears in the visible image (internal px, float), as the presentation shows it. */
export function screenPosition(snap: CameraSnap, worldX: number, worldY: number): [number, number] {
  return [snapToPixel(worldX) - snap.originX - SCENE_BORDER - snap.fracX, snapToPixel(worldY) - snap.originY - SCENE_BORDER - snap.fracY];
}

/** Camera state set by the presentation once per frame (interpolated, world px). */
export class Camera {
  x = 0;
  y = 0;
  /** Followed entity (NaN = free camera). */
  focusX = Number.NaN;
  focusY = Number.NaN;

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  follow(x: number, y: number): this {
    this.focusX = x;
    this.focusY = y;
    return this;
  }

  unfollow(): this {
    this.focusX = Number.NaN;
    this.focusY = Number.NaN;
    return this;
  }
}
