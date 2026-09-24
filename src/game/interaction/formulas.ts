/**
 * Pure formulas of interacting (MASTERPROMPT §11.4, §4.6 "Interagierbares unter Cursor oder in
 * Reichweite"; M3-10): reach, the choice of the focus, the rhythm of tool hits.
 */
import { BALANCE } from '../../content/balance';
import { TILE_PX } from '../../world/model/coords';
import type { Facing } from '../player/state';

const I = BALANCE.interaction;

/** Reach of E and tools [px] (`BALANCE.interaction.reachTiles`). */
export const REACH_PX = I.reachTiles * TILE_PX;
/** Bonus of a target in front of the player [px]. */
export const FACING_BONUS_PX = I.facingBonusTiles * TILE_PX;

/** Distance [px] from (x, y) to the rectangle [left, right] × [top, bottom] (0 inside). */
export function distanceToRect(x: number, y: number, left: number, top: number, right: number, bottom: number): number {
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return Math.hypot(dx, dy);
}

/** Unit vector of a facing (screen axes, +y south). */
export function facingUnit(facing: Facing, out: { x: number; y: number }): { x: number; y: number } {
  out.x = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
  out.y = facing === 'up' ? -1 : facing === 'down' ? 1 : 0;
  return out;
}

/**
 * Score of a target (lower wins): its distance [px] minus the facing bonus scaled by how much it lies in
 * front of the player (cosine between facing and direction, only the front half counts), plus `penalty`
 * [px] (targets that cannot be worked now come last).
 */
export function targetScore(distance: number, fx: number, fy: number, dx: number, dy: number, penalty = 0): number {
  const len = Math.hypot(dx, dy);
  const front = len > 0 ? Math.max(0, (fx * dx + fy * dy) / len) : 1;
  return distance - FACING_BONUS_PX * front + penalty;
}

/** Facing that looks from the player towards (dx, dy) = target − player (larger axis; `current` when on the spot). */
export function facingToward(dx: number, dy: number, current: Facing): Facing {
  if (dx === 0 && dy === 0) return current;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Whether a tool hit lands on tick `ticks` (1 = the first tick of the action) of a held tool action:
 * the first after `hitTicks` (the swing reaches the target), then every `swingTicks`.
 */
export function hitDue(ticks: number, hitTicks: number, swingTicks: number): boolean {
  return ticks >= hitTicks && (ticks - hitTicks) % swingTicks === 0;
}

/**
 * Progress of the ring [0–1]: by hand the share of the pick time; with a tool the share of the hits
 * already done out of all hits the target needs.
 */
export function actionProgress(byHand: boolean, ticks: number, handTicks: number, hitsDone: number, hitsTotal: number): number {
  if (byHand) return handTicks > 0 ? Math.min(1, ticks / handTicks) : 1;
  return hitsTotal > 0 ? Math.min(1, Math.max(0, hitsDone / hitsTotal)) : 0;
}
