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
  /** A shadow brood forms out of the smoke over this long after it appears [s] (the night spawner, the Nachtmahr). */
  formSeconds: 0.9,
} as const;

/** Smoke fade of a shadow brood `ticksAlive` ticks after it appeared at `tickHz`: 1 (only smoke) → 0 (whole) over `formSeconds`. */
export function formingFade(ticksAlive: number, tickHz: number): number {
  const f = 1 - ticksAlive / (MATERIALIZE.formSeconds * tickHz);
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
