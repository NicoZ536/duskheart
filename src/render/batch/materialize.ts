/**
 * Materialisation of the shadow brood (M6-25; docs/SPIEL.md §13 "Schattenbrut-Materialisierung (Tinten-Rauch per
 * Rauschschwelle + violetter Rand) als Sprite-Effekt im G-Buffer-Shader"; docs/ART.md §15.2): a sprite flagged
 * `materialize` does not dither out with its `fade` but dissolves into ink smoke – every pixel has a smoke threshold, the
 * pixels whose threshold lies below the fade are gone, the top cluster of what stays is the violet rim that glows, and a
 * short tongue of dark ink smoke rises from it in some columns. Raised, the fade takes the body apart from the top down
 * (dissolving, dying into violet sparks); lowered, the body forms from the ground up (materialising).
 *
 * The threshold grows down every column of the frame: mostly the pixel's height in the frame (its cluster's row), plus a
 * front noise that depends on the column alone (world-anchored 2 px columns, drifting with the time) and makes the edge
 * wavy. So the body of a column is always one run from its foot up to the front – nothing of it floats above the front
 * (M6 gate `schattenbrut-materialisierung`: with a 2D noise mixed in, islands of rim and body hung up to 13 px above the
 * formed body, a violet "!" over a creature). The rim is the top cluster of each column's run; the tongues sit right on it,
 * whole clusters of the same column. This module is the CPU mirror of the smoke branch of sprite_gbuffer.frag – the same
 * formulas and constants (`materializeDefines`) – so tests can check it.
 */
import { BALANCE } from '../../content/balance';
import { clusterNoise } from '../surface/rules';
import { rampIndex } from '../surface/params';

/** Parameters of the smoke (px, px/s, shares 0…1). */
export const MATERIALIZE = {
  /** Wavelength of the front's broad waves along a row [px]: one or two crests across a 10–14 px body. */
  wavelengthPx: 7,
  /** Wavelength of the front's finer ripples [px]. */
  detailPx: 3,
  /** Cluster size [px]: 2 × 2 pixels form and dissolve together (pixel art: no lone pixels, docs/ART.md §2.2). */
  cellPx: 2,
  /** The smoke rises this fast [px/s]: the cluster rows drift up and the front's waves roll while the body forms or fades. */
  risePxPerSecond: 9,
  /**
   * Weight of the height in the frame against the column's front noise [0–1]: 0,8 keeps the front within about ±4 px of a
   * level line on a 32 px frame – the body rises from the ground as a whole with a wavy edge; less let single columns run
   * ahead as strips (0,6: up to 20 px apart), more flattened the edge into a bar.
   */
  heightWeight: 0.8,
  /** Thickness of the glowing rim at the top of each column's body [px]: one cluster row. */
  rimPx: 2,
  /** Emission of the rim [0–1 of the emissive range]: it glows at night like the brood's eyes. */
  edgeGlow: 0.85,
  /** Longest tongue of ink smoke right above the rim [px]: none, one or two cluster rows per column. */
  tonguePx: 4,
  /** Wavelength of the tongues along a row [px] and of their finer ripples [px]: neighbouring columns differ, like wisps. */
  tongueWavelengthPx: 3,
  tongueDetailPx: 2,
  /** The tongues flicker this fast [px/s along their noise]: twice the rise, so they lick up faster than the body forms. */
  tongueDriftPxPerSecond: 18,
  /** Salt of the front's noise (another field than the surface effects') and of the tongues'. */
  salt: 173,
  tongueSalt: 184,
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

/** Palette index of the tongues' ink smoke (`verderb.1`: a dark violet over the glowing rim, not the body's grey ink). */
export function smokeTongueIndex(): number {
  return rampIndex('verderb', 1);
}

/** Front noise 0…1 of the column at world x at `seconds` (`smokeFront` of sprite_gbuffer.frag): the same down the column. */
export function smokeFront(x: number, seconds: number): number {
  const M = MATERIALIZE;
  return clusterNoise(x, seconds * M.risePxPerSecond, M.wavelengthPx, M.detailPx, M.cellPx, M.salt);
}

/**
 * Smoke threshold 0…1 of a pixel whose cluster row lies `rowShare` of the way down its frame (0 top, 1 bottom) in a column
 * with front noise `front` (`smokeFront`): a pixel is gone once the fade exceeds it. It never falls down a column.
 */
export function smokeThreshold(rowShare: number, front: number): number {
  const w = MATERIALIZE.heightWeight;
  return rowShare * w + front * (1 - w);
}

/**
 * How far [px] a pixel with threshold `threshold` in a frame `height` px high lies below the front at fade `fade`
 * (negative: above it, where the smoke is) – the threshold falls by `heightWeight / height` per px up a column.
 */
export function smokeBelow(threshold: number, fade: number, height: number): number {
  return ((threshold - fade) * height) / MATERIALIZE.heightWeight;
}

/** Px of ink smoke rising above the front in the column at world x at `seconds`: whole clusters, 0 … `tonguePx`. */
export function smokeTonguePx(x: number, seconds: number): number {
  const M = MATERIALIZE;
  const n = clusterNoise(x, seconds * M.tongueDriftPxPerSecond, M.tongueWavelengthPx, M.tongueDetailPx, M.cellPx, M.tongueSalt);
  return Math.floor(n * (M.tonguePx / M.cellPx + 1)) * M.cellPx;
}

/**
 * What a pixel `below` px under the front (`smokeBelow`) shows in a column with a tongue of `tongue` px (`smokeTonguePx`)
 * at fade `fade` (0 whole … 1 gone): gone, the tongue of smoke, the glowing rim, or the body.
 */
export function materializePixel(below: number, tongue: number, fade: number): 'weg' | 'rauch' | 'rand' | 'koerper' {
  if (fade <= 0) return 'koerper';
  if (below < 0) return -below <= tongue ? 'rauch' : 'weg';
  return below < MATERIALIZE.rimPx ? 'rand' : 'koerper';
}

/**
 * Row share of the smoke cluster that the pixel at world y `worldY` (its row `localY` px down its frame, `height` px high)
 * lies in at `seconds` (`smokeRowShare` of sprite_gbuffer.frag): the row of the cluster's centre in the rising field, not
 * the pixel's own – every pixel of a 2 × 2 cluster gets the same threshold, so a cluster forms and dissolves whole and never
 * leaves one of its rows standing alone (M6 gate visual:materialize-orphan-pixels, ADR-0169).
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
export const SMOKE_PIXEL = { none: 0, body: 1, rim: 2, smoke: 3 } as const;

/**
 * Of a frame dissolving at `fade` (0 whole … 1 gone) at `seconds`, what each pixel shows into `out` (row-major,
 * `SMOKE_PIXEL`): the CPU mirror of the smoke branch of sprite_gbuffer.frag, its crumb rule included. Thresholds are per
 * 2 × 2 cluster (`smokeRowShare`) and grow down every column (`smokeThreshold`): each column shows its body as one run up
 * from its foot, the rim on top of it and the tongue of smoke on the rim. A pixel alone in its cluster – the silhouette cut
 * its partners away – stays only beside a shown pixel of a neighbouring cluster and then never as rim: no single glowing
 * pixel and no pixel without a neighbour (§4.5 "keine verwaisten Einzelpixel"). Requires `cellPx` 2.
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

/** What the frame's opaque pixel (lx, ly) shows by its cluster's threshold, before the crumb rule (`smokeShowsAt` of the shader). */
function shownAt(frame: SmokeFrame, lx: number, ly: number, fade: number, seconds: number): number {
  const x = worldXOf(frame, lx);
  const threshold = smokeThreshold(smokeRowShare(worldYOf(frame, ly), ly + 0.5, frame.h, seconds), smokeFront(x, seconds));
  const k = materializePixel(smokeBelow(threshold, fade, frame.h), smokeTonguePx(x, seconds), fade);
  return k === 'weg' ? SMOKE_PIXEL.none : k === 'rauch' ? SMOKE_PIXEL.smoke : k === 'rand' ? SMOKE_PIXEL.rim : SMOKE_PIXEL.body;
}

/** `SMOKE_PIXEL` of the frame's pixel (lx, ly) at `fade` (see `materializeMask`). */
function smokePixelAt(frame: SmokeFrame, lx: number, ly: number, fade: number, seconds: number): number {
  if (!frame.opaque(lx, ly)) return SMOKE_PIXEL.none;
  if (fade <= 0) return SMOKE_PIXEL.body;
  const shown = shownAt(frame, lx, ly, fade, seconds);
  if (shown === SMOKE_PIXEL.none) return SMOKE_PIXEL.none;
  // The partners in the cluster: the other column and row of its 2 × 2 cell in the rising field.
  const cell = MATERIALIZE.cellPx;
  const fx = worldXOf(frame, lx);
  const fy = worldYOf(frame, ly) + seconds * MATERIALIZE.risePxPerSecond;
  const dxWorld = fx - Math.floor(fx / cell) * cell < cell / 2 ? 1 : -1;
  const dy = fy - Math.floor(fy / cell) * cell < cell / 2 ? 1 : -1;
  const dx = frame.mirrored ? -dxWorld : dxWorld;
  const alone = !frame.opaque(lx + dx, ly) && !frame.opaque(lx, ly + dy) && !frame.opaque(lx + dx, ly + dy);
  if (!alone) return shown;
  // Alone: kept only beside a shown pixel of the neighbouring clusters (the 4-neighbours outside its own cell), never as rim.
  const left = frame.opaque(lx - dx, ly) && shownAt(frame, lx - dx, ly, fade, seconds) !== SMOKE_PIXEL.none;
  const up = frame.opaque(lx, ly - dy) && shownAt(frame, lx, ly - dy, fade, seconds) !== SMOKE_PIXEL.none;
  if (!left && !up) return SMOKE_PIXEL.none;
  return shown === SMOKE_PIXEL.rim ? SMOKE_PIXEL.body : shown;
}

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the smoke for the sprite program (sprite_gbuffer.frag, the `DH_SMOKE` variant). */
export function materializeDefines(): Readonly<Record<string, string>> {
  const M = MATERIALIZE;
  return {
    DH_SMOKE_WAVELENGTH: glslFloat(M.wavelengthPx),
    DH_SMOKE_DETAIL: glslFloat(M.detailPx),
    DH_SMOKE_CELL: glslFloat(M.cellPx),
    DH_SMOKE_RISE: glslFloat(M.risePxPerSecond),
    DH_SMOKE_HEIGHT_WEIGHT: glslFloat(M.heightWeight),
    DH_SMOKE_RIM_PX: glslFloat(M.rimPx),
    DH_SMOKE_EDGE_GLOW: glslFloat(M.edgeGlow),
    DH_SMOKE_TONGUE_PX: glslFloat(M.tonguePx),
    DH_SMOKE_TONGUE_WAVELENGTH: glslFloat(M.tongueWavelengthPx),
    DH_SMOKE_TONGUE_DETAIL: glslFloat(M.tongueDetailPx),
    DH_SMOKE_TONGUE_DRIFT: glslFloat(M.tongueDriftPxPerSecond),
    DH_SMOKE_SALT: `${M.salt}u`,
    DH_SMOKE_TONGUE_SALT: `${M.tongueSalt}u`,
    DH_SMOKE_RIM_INDEX: `${smokeRimIndex()}`,
    DH_SMOKE_TONGUE_INDEX: `${smokeTongueIndex()}`,
  };
}
