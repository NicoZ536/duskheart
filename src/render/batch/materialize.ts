/**
 * Materialisation of the shadow brood (M6-25; docs/SPIEL.md §13 "Schattenbrut-Materialisierung (Tinten-Rauch per
 * Rauschschwelle + violetter Rand) als Sprite-Effekt im G-Buffer-Shader"; docs/ART.md §15.2): a sprite flagged
 * `materialize` does not dither out with its `fade` but dissolves into ink smoke – every pixel has a smoke threshold, the
 * pixels whose threshold lies below the fade are gone, and a band just above it is the violet rim that glows. Raised,
 * the fade takes the body apart from the top down in drifting clusters (dissolving, dying into violet sparks); lowered,
 * the body forms from the ground up (materialising).
 *
 * The threshold of a pixel is the world-anchored cluster noise of the surface (`clusterNoise`, 2 × 2 px clusters, never
 * single-pixel speckle) drifting upward with the time like rising smoke, mixed with the pixel's height in the frame (top
 * rows first). This module is the CPU mirror of `smokeThreshold` in sprite_gbuffer.frag – the same formula and
 * constants (`materializeDefines`) – so tests can check it.
 */
import { BALANCE } from '../../content/balance';
import { clusterNoise } from '../surface/rules';
import { rampIndex } from '../surface/params';

/** Parameters of the smoke (px, s, shares 0…1). */
export const MATERIALIZE = {
  /** Wavelength of the broad smoke field [px]: a few blobs across a 32 px body. */
  wavelengthPx: 7,
  /** Wavelength of the finer wisps on top [px]. */
  detailPx: 3,
  /** Cluster size [px]: 2 × 2 pixels dissolve together (pixel art: no lone pixels, docs/ART.md §2.2). */
  cellPx: 2,
  /** The smoke rises this fast [px/s]: the clusters drift up while the body forms or fades. */
  risePxPerSecond: 9,
  /** Weight of the height in the frame against the noise [0–1]: top rows go first, the feet last. */
  heightWeight: 0.35,
  /** Width of the glowing rim above the dissolving edge [share of the threshold range]. */
  edge: 0.1,
  /** Emission of the rim [0–1 of the emissive range]: it glows at night like the brood's eyes. */
  edgeGlow: 0.85,
  /** Salt of the smoke's noise (another field than the surface effects'). */
  salt: 173,
} as const;

/**
 * How long a shadow brood forms out of the smoke after it appears [s]: the simulation's own value
 * (`BALANCE.creatures.shadowBrood.formSeconds`, M6-13c – it neither moves, thinks nor strikes meanwhile), so the picture
 * shows the body whole exactly when it starts to act (M6-13e).
 */
const FORM_SECONDS = BALANCE.creatures.shadowBrood.formSeconds;

/**
 * Smoke fade of a shadow brood `ticksAlive` ticks after it appeared at `tickHz`: 1 (only smoke) → 0 (whole) over the
 * forming span in whole ticks – rounded like the simulation's (`secondsToTicks(formSeconds, 1)`), at least one.
 */
export function formingFade(ticksAlive: number, tickHz: number): number {
  const span = Math.round(FORM_SECONDS * tickHz);
  const f = 1 - ticksAlive / (span < 1 ? 1 : span);
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/** Palette index of the rim's violet (`verderb.3`, the brood's glow, docs/ART.md §15.2). */
export function smokeRimIndex(): number {
  return rampIndex('verderb', 3);
}

/**
 * Smoke threshold 0…1 of the pixel at world px (x, y) whose row lies `rowShare` of the way down its frame (0 top, 1 bottom)
 * at time `seconds`: a pixel is gone once the fade exceeds it (`materializePixel`).
 */
export function smokeThreshold(x: number, y: number, rowShare: number, seconds: number): number {
  const M = MATERIALIZE;
  const n = clusterNoise(x, y + seconds * M.risePxPerSecond, M.wavelengthPx, M.detailPx, M.cellPx, M.salt);
  return n * (1 - M.heightWeight) + rowShare * M.heightWeight;
}

/** What a pixel with threshold `threshold` shows at fade `fade` (0 whole … 1 gone): gone, the glowing rim, or the body. */
export function materializePixel(threshold: number, fade: number): 'weg' | 'rand' | 'koerper' {
  if (fade <= 0) return 'koerper';
  if (threshold < fade) return 'weg';
  return threshold < fade + MATERIALIZE.edge ? 'rand' : 'koerper';
}

/**
 * Row share of the smoke cluster that the pixel at world y `worldY` (its row `localY` px down its frame, `height` px high)
 * lies in at `seconds` (`smokeRowShare` of sprite_gbuffer.frag): the row of the cluster's centre in the rising field, not
 * the pixel's own – every pixel of a 2 × 2 cluster gets the same threshold, so a cluster dissolves whole and never leaves
 * one of its rows standing alone (M6 gate visual:materialize-orphan-pixels, ADR-0169).
 */
export function smokeRowShare(worldY: number, localY: number, height: number, seconds: number): number {
  const cell = MATERIALIZE.cellPx;
  const y = worldY + seconds * MATERIALIZE.risePxPerSecond;
  const centre = (Math.floor(y / cell) + 0.5) * cell;
  return (localY + centre - y) / height;
}

/** A sprite frame as the smoke sees it: size, coverage, the anchor in the frame and on the world grid, the mirroring. */
export interface SmokeFrame {
  readonly w: number;
  readonly h: number;
  /** Whether the frame's pixel (x, y) is opaque (outside the frame: not). */
  opaque(x: number, y: number): boolean;
  readonly anchorX: number;
  readonly anchorY: number;
  /** The sprite's anchor on the world grid (snapped, whole px). */
  readonly worldX: number;
  readonly worldY: number;
  readonly mirrored: boolean;
}

/** What a pixel of a materialising frame shows (`materializeMask`). */
export const SMOKE_PIXEL = { none: 0, body: 1, rim: 2 } as const;

/**
 * Of a frame dissolving at `fade` (0 whole … 1 gone) at `seconds`, what each pixel shows into `out` (row-major,
 * `SMOKE_PIXEL`): the CPU mirror of the smoke branch of sprite_gbuffer.frag, its crumb rule included. Thresholds are
 * per 2 × 2 cluster (`smokeRowShare`); a pixel alone in its cluster – the silhouette cut its partners away – stays only
 * beside a surviving pixel of a neighbouring cluster and is drawn as body, never as rim: no single glowing pixel and no
 * pixel without a neighbour (§4.5 "keine verwaisten Einzelpixel"). Requires `cellPx` 2.
 */
export function materializeMask(frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array): void {
  for (let ly = 0; ly < frame.h; ly++) {
    for (let lx = 0; lx < frame.w; lx++) out[ly * frame.w + lx] = smokePixelAt(frame, lx, ly, fade, seconds);
  }
}

/** World pixel centre of the frame's pixel (lx, ly) (the shader's `world`). */
function worldXOf(frame: SmokeFrame, lx: number): number {
  const local = lx + 0.5;
  return frame.worldX + (frame.mirrored ? frame.anchorX - local : local - frame.anchorX);
}

function worldYOf(frame: SmokeFrame, ly: number): number {
  return frame.worldY + (ly + 0.5 - frame.anchorY);
}

/** The cluster threshold of the frame's pixel (lx, ly). */
function thresholdAt(frame: SmokeFrame, lx: number, ly: number, seconds: number): number {
  const y = worldYOf(frame, ly);
  return smokeThreshold(worldXOf(frame, lx), y, smokeRowShare(y, ly + 0.5, frame.h, seconds), seconds);
}

/** `SMOKE_PIXEL` of the frame's pixel (lx, ly) at `fade` (see `materializeMask`). */
function smokePixelAt(frame: SmokeFrame, lx: number, ly: number, fade: number, seconds: number): number {
  if (!frame.opaque(lx, ly)) return SMOKE_PIXEL.none;
  if (fade <= 0) return SMOKE_PIXEL.body;
  const threshold = thresholdAt(frame, lx, ly, seconds);
  if (threshold < fade) return SMOKE_PIXEL.none;
  const rim = threshold < fade + MATERIALIZE.edge;
  // The partners in the cluster: the other column and row of its 2 × 2 cell in the rising field.
  const cell = MATERIALIZE.cellPx;
  const fx = worldXOf(frame, lx);
  const fy = worldYOf(frame, ly) + seconds * MATERIALIZE.risePxPerSecond;
  const dxWorld = fx - Math.floor(fx / cell) * cell < cell / 2 ? 1 : -1;
  const dy = fy - Math.floor(fy / cell) * cell < cell / 2 ? 1 : -1;
  const dx = frame.mirrored ? -dxWorld : dxWorld;
  const alone = !frame.opaque(lx + dx, ly) && !frame.opaque(lx, ly + dy) && !frame.opaque(lx + dx, ly + dy);
  if (!alone) return rim ? SMOKE_PIXEL.rim : SMOKE_PIXEL.body;
  // Alone: kept only beside a surviving pixel of the neighbouring clusters (the 4-neighbours outside its own cell).
  const left = frame.opaque(lx - dx, ly) && thresholdAt(frame, lx - dx, ly, seconds) >= fade;
  const up = frame.opaque(lx, ly - dy) && thresholdAt(frame, lx, ly - dy, seconds) >= fade;
  return left || up ? SMOKE_PIXEL.body : SMOKE_PIXEL.none;
}

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the smoke for the sprite program (sprite_gbuffer.frag `smokeThreshold`). */
export function materializeDefines(): Readonly<Record<string, string>> {
  const M = MATERIALIZE;
  return {
    DH_SMOKE_WAVELENGTH: glslFloat(M.wavelengthPx),
    DH_SMOKE_DETAIL: glslFloat(M.detailPx),
    DH_SMOKE_CELL: glslFloat(M.cellPx),
    DH_SMOKE_RISE: glslFloat(M.risePxPerSecond),
    DH_SMOKE_HEIGHT_WEIGHT: glslFloat(M.heightWeight),
    DH_SMOKE_EDGE: glslFloat(M.edge),
    DH_SMOKE_EDGE_GLOW: glslFloat(M.edgeGlow),
    DH_SMOKE_SALT: `${M.salt}u`,
    DH_SMOKE_RIM_INDEX: `${smokeRimIndex()}`,
  };
}
