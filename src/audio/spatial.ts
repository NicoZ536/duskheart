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
import { DOUBLE_FIELD } from '../engine/heldRecords';
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
 * A placement that `place` overwrites every frame: a class of its own whose fields start as fractional numbers
 * (`DOUBLE_FIELD`, src/engine/heldRecords.ts), so a store updates them in place – an object literal would share its hidden
 * class with every literal of the same keys and could box each store.
 */
export class HeldPlacement implements Placement {
  gain = DOUBLE_FIELD;
  pan = DOUBLE_FIELD;
  cutoffHz = DOUBLE_FIELD;

  constructor() {
    this.gain = 0;
    this.pan = 0;
    this.cutoffHz = OPEN_CUTOFF_HZ;
  }
}

/** Horizontal offset that pans a sound fully to one side [px]. */
const PAN_SPREAD_PX = PAN_SPREAD_TILES * TILE_PX;
/** Level lost by a fully occluded sound. */
const OCCLUDED_LOSS = 1 - CLOSED_GAIN;
/** Cutoff ratio of a fully occluded sound to an open one. */
const CUTOFF_RATIO = CLOSED_CUTOFF_HZ / OPEN_CUTOFF_HZ;

/**
 * Places a sound at (x, y) on `layer` for `listener`; `occlusion` 0 … 1. Writes into `out` (no
 * allocation per frame for moving loops) and returns it.
 *
 * Every frame for each positioned voice (`SfxPlayer.update`): the distance, pan and occlusion terms are computed here in
 * locals – the same arithmetic as `distanceGain`, `stereoPan`, `occlusionGain` and `occlusionCutoffHz`, bit for bit – so no
 * fractional number crosses a call, and the frame stays free of heap numbers also when the optimising compiler has not inlined
 * the helpers (ADR-0274, M7-78). An open sound (`occlusion` 0) takes the open cutoff without a power.
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
  // `Math.sqrt` instead of `Math.hypot`: the builtin hypot allocates its argument list and result on every call (M7-78).
  const distance = Math.sqrt(dx * dx + dy * dy);
  const range = rangeTiles * TILE_PX;
  const near = range * NEAR_FRACTION;
  let gain: number;
  if (distance <= near) gain = 1;
  else if (distance >= range) gain = 0;
  else {
    const u = (range - distance) / (range - near);
    gain = u * u;
  }
  const o = occlusion < 0 ? 0 : occlusion > 1 ? 1 : occlusion;
  const p = dx / PAN_SPREAD_PX;
  out.gain = gain * (1 - OCCLUDED_LOSS * o);
  out.pan = (p < -1 ? -1 : p > 1 ? 1 : p) * MAX_PAN;
  out.cutoffHz = o === 0 ? OPEN_CUTOFF_HZ : OPEN_CUTOFF_HZ * CUTOFF_RATIO ** o;
  return out;
}
