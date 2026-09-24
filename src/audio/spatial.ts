/**
 * Spatial audio of a top-down world (MASTERPROMPT §27 "räumliches Panning + Distanzdämpfung; Tiefpass bei
 * Verdeckung"), as pure functions of positions in world pixels:
 *
 * - **Distance:** full volume inside the near zone (a fifth of the preset's `reichweite`), then a
 *   quadratic fade to silence at the edge – a sound out of range is not started at all.
 * - **Panning:** left/right by the horizontal offset; at `PAN_SPREAD_TILES` a sound sits fully at the
 *   side, but never more than `MAX_PAN` (a hard-panned sound on headphones is tiring).
 * - **Occlusion:** 0 (open) … 1 (behind walls, indoors) closes a low-pass from `OPEN_CUTOFF_HZ` down to
 *   `CLOSED_CUTOFF_HZ` and lowers the level – the hook for walls and rooms (M4 building, M7-01 reverb).
 * - **Layers:** a sound on another world layer (surface vs. caves) is not heard.
 */
import { TILE_PX } from '../world/model/coords';

/** Share of the audible radius that plays at full volume. */
export const NEAR_FRACTION = 0.2;
/** Horizontal offset that pans a sound fully to one side [tiles] (half the 480-px view). */
export const PAN_SPREAD_TILES = 15;
/** Largest pan (±1 = one speaker only). */
export const MAX_PAN = 0.8;
/** Low-pass cutoff of an unoccluded sound [Hz] (above the 16 kHz of the 32 kHz SFX: no effect). */
export const OPEN_CUTOFF_HZ = 18000;
/** Low-pass cutoff of a fully occluded sound [Hz]. */
export const CLOSED_CUTOFF_HZ = 500;
/** Level of a fully occluded sound. */
export const CLOSED_GAIN = 0.5;

/** Where the listener is (the player, or the camera focus). */
export interface Listener {
  x: number;
  y: number;
  layer: number;
}

/** Volume factor at `distancePx` of a sound audible up to `rangeTiles`. */
export function distanceGain(distancePx: number, rangeTiles: number): number {
  const range = rangeTiles * TILE_PX;
  const near = range * NEAR_FRACTION;
  if (distancePx <= near) return 1;
  if (distancePx >= range) return 0;
  const u = (range - distancePx) / (range - near);
  return u * u;
}

/** Stereo position (−`MAX_PAN` … +`MAX_PAN`) of a sound `dxPx` right of the listener. */
export function stereoPan(dxPx: number): number {
  const p = dxPx / (PAN_SPREAD_TILES * TILE_PX);
  return Math.max(-1, Math.min(1, p)) * MAX_PAN;
}

/** Low-pass cutoff [Hz] for an occlusion of 0 (open) … 1 (closed), exponential in between. */
export function occlusionCutoffHz(occlusion: number): number {
  const o = Math.max(0, Math.min(1, occlusion));
  return OPEN_CUTOFF_HZ * (CLOSED_CUTOFF_HZ / OPEN_CUTOFF_HZ) ** o;
}

/** Level factor of an occlusion of 0 … 1. */
export function occlusionGain(occlusion: number): number {
  const o = Math.max(0, Math.min(1, occlusion));
  return 1 - (1 - CLOSED_GAIN) * o;
}

/** Placement of one positioned sound relative to the listener. */
export interface Placement {
  /** Volume factor from distance and occlusion (0 = inaudible). */
  gain: number;
  pan: number;
  cutoffHz: number;
}

/**
 * Places a sound at (x, y) on `layer` for `listener`; `occlusion` 0 … 1. Writes into `out` (no
 * allocation per frame for moving loops) and returns it.
 */
export function place(x: number, y: number, layer: number, rangeTiles: number, listener: Listener, occlusion: number, out: Placement): Placement {
  if (layer !== listener.layer) {
    out.gain = 0;
    out.pan = 0;
    out.cutoffHz = OPEN_CUTOFF_HZ;
    return out;
  }
  const dx = x - listener.x;
  const dy = y - listener.y;
  out.gain = distanceGain(Math.hypot(dx, dy), rangeTiles) * occlusionGain(occlusion);
  out.pan = stereoPan(dx);
  out.cutoffHz = occlusionCutoffHz(occlusion);
  return out;
}
