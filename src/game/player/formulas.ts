/**
 * Movement rules of the player (MASTERPROMPT §11.4, M3-08, M3-09) as pure functions; the player system
 * (`system.ts`) applies them every tick.
 *
 * - Speeds [tiles/s]: walk 4,5 · sprint 7 · sneak 2,5 · swim 2,5; armour weight light ×1, medium ×0,95,
 *   heavy ×0,9; conditions multiply (`moveSpeedFactor`). The roll covers 3 tiles in 0,4 s whatever the
 *   armour (a dodge is a fixed distance).
 * - Mode: in deep water the player swims; otherwise sneaking beats sprinting, a sprint needs stamina
 *   (`sprintAllowed`), no input means standing.
 * - Falls: 1 level is harmless, every further level costs 15 HP; from 3 levels a bone may break (40 %,
 *   +30 % per further level); landing in deep water is always harmless.
 */
import { BALANCE } from '../../content/balance';
import type { ArmorWeight, PlayerMoveState } from '../../content/balance/player';
import type { Facing } from './state';

const M = BALANCE.player.movement;
const R = BALANCE.player.roll;
const C = BALANCE.player.cliffs;

/** Ticks of `seconds` at the simulation rate (at least one). */
export function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * BALANCE.time.tickHz));
}

/** Speed of a movement mode [tiles/s] before armour and conditions; 0 for modes that do not steer (idle, roll, jump, climb). */
export function baseSpeedTilesPerSecond(state: PlayerMoveState): number {
  switch (state) {
    case 'walk':
      return M.walkTilesPerSecond;
    case 'sprint':
      return M.sprintTilesPerSecond;
    case 'sneak':
      return M.sneakTilesPerSecond;
    case 'swim':
      return M.swimTilesPerSecond;
    default:
      return 0;
  }
}

/** Speed factor of an armour weight class (§11.4). */
export function armorSpeedFactor(weight: ArmorWeight): number {
  return M.armorWeightFactor[weight];
}

/** Movement speed [tiles/s] of a steered mode with armour and the conditions' factor (§11.4). */
export function moveSpeedTilesPerSecond(state: PlayerMoveState, weight: ArmorWeight, factor: number): number {
  return baseSpeedTilesPerSecond(state) * armorSpeedFactor(weight) * factor;
}

/** Speed of a dodge roll [tiles/s]: 3 tiles in 0,4 s (§11.4). */
export function rollSpeedTilesPerSecond(): number {
  return R.distanceTiles / R.durationSeconds;
}

/**
 * The steered movement mode (§11.4): deep water ⇒ swim; no input ⇒ idle; sneaking beats sprinting;
 * sprinting needs `canSprint` (stamina, `sprintAllowed`); otherwise walking.
 */
export function steeredMode(moving: boolean, swimming: boolean, sneakHeld: boolean, sprintHeld: boolean, canSprint: boolean): PlayerMoveState {
  if (swimming) return 'swim';
  if (!moving) return 'idle';
  if (sneakHeld) return 'sneak';
  if (sprintHeld && canSprint) return 'sprint';
  return 'walk';
}

/** Noise of a movement mode relative to walking (§11.4 "Schleichen … Geräusch −70 %"). */
export function movementNoise(state: PlayerMoveState): number {
  return M.noise[state];
}

/** Writes (dx, dy) clamped to length ≤ 1 into `out` (stick magnitudes below 1 stay, keyboard diagonals shrink to 1). */
export function clampInput(dx: number, dy: number, out: { x: number; y: number }): { x: number; y: number } {
  const len2 = dx * dx + dy * dy;
  if (len2 > 1) {
    const len = Math.sqrt(len2);
    out.x = dx / len;
    out.y = dy / len;
  } else {
    out.x = dx;
    out.y = dy;
  }
  return out;
}

/**
 * Four-way facing of a direction (sprites face down/up/left/right, docs/SPIEL.md §5). The larger axis
 * wins; while both axes are within `facingHysteresis` of each other (a near-diagonal input) the current
 * facing stays if it is one of the two, so a stick at 45° does not flicker. No input keeps the facing.
 */
export function facingFor(dx: number, dy: number, current: Facing): Facing {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return current;
  const horizontal: Facing = dx > 0 ? 'right' : 'left';
  const vertical: Facing = dy > 0 ? 'down' : 'up';
  if (Math.abs(ax - ay) <= M.facingHysteresis && ax > 0 && ay > 0 && (current === horizontal || current === vertical)) return current;
  return ax > ay ? horizontal : vertical;
}

/** Unit vector of a facing (for a roll without input). */
export function facingVector(facing: Facing, out: { x: number; y: number }): { x: number; y: number } {
  out.x = facing === 'right' ? 1 : facing === 'left' ? -1 : 0;
  out.y = facing === 'down' ? 1 : facing === 'up' ? -1 : 0;
  return out;
}

/** Fall damage of a drop over `levels` height levels [HP] (§11.4: 1 level harmless, 2 levels damage). */
export function fallDamage(levels: number): number {
  return levels <= C.safeDropLevels ? 0 : (levels - C.safeDropLevels) * C.damagePerExtraLevel;
}

/** Chance of a broken bone after a drop over `levels` levels (§11.4 "ab 3 Knochenbruch-Risiko"). */
export function fractureChance(levels: number): number {
  if (levels < C.fractureMinLevels) return 0;
  const p = C.fractureChanceAtMin + (levels - C.fractureMinLevels) * C.fractureChancePerExtraLevel;
  return p > 1 ? 1 : p;
}

/** Outcome of a landing. */
export interface FallOutcome {
  damage: number;
  fracture: boolean;
}

/**
 * Outcome of a drop over `levels` levels: damage and whether a bone breaks, decided by `roll01` (a
 * uniform draw in [0, 1) the caller takes only when `fractureChance(levels) > 0`). Deep water catches
 * the fall: no damage, no fracture.
 */
export function fallOutcome(levels: number, intoWater: boolean, roll01: number, out: FallOutcome = { damage: 0, fracture: false }): FallOutcome {
  if (intoWater) {
    out.damage = 0;
    out.fracture = false;
    return out;
  }
  out.damage = fallDamage(levels);
  out.fracture = roll01 < fractureChance(levels);
  return out;
}

/** Duration of a jump down over `levels` levels [ticks]. */
export function jumpTicks(levels: number): number {
  return secondsToTicks(C.jumpSecondsPerLevel * levels);
}

/** Duration of a ladder climb over `levels` levels [ticks]. */
export function climbTicks(levels: number): number {
  return secondsToTicks(C.climbSecondsPerLevel * levels);
}
