/**
 * Pure formulas of the fight (MASTERPROMPT §19.1–§19.3, §D; docs/SPIEL.md §10; values `BALANCE.combat`): the aim angle and
 * the facing that follows it, weapon damage, resistance and armour (R / (R + 50)), crits, block and parry, hitstop and
 * knockback by impact, the swing's arc, bow tension, shot spread, throw arcs and who may hit whom. Tested directly
 * (tests/unit/game/zielen.test.ts, schaden.test.ts, angriff.test.ts, parade.test.ts).
 *
 * Determinism: the aim angle is `Math.atan2` of the pixel offset (docs/SPIEL.md §10); every decision about hits uses
 * only + − × ÷ and `sqrt` of vectors (the arc is a dot product against a precomputed cosine), so no hit depends on the
 * last bit of a trigonometric function.
 */
import { BALANCE } from '../../content/balance';
import type { WeaponClass } from '../../content/balance/tools';
import { FACINGS, type Facing } from '../player/state';
import type { CombatTeam } from './targets';

const C = BALANCE.combat;
const TICK_HZ = BALANCE.time.tickHz;

/** A full turn [rad]. */
export const FULL_TURN = Math.PI * 2;
/** Degrees of a half turn (degree ↔ radian). */
const HALF_TURN_DEG = 180;
/** Half the width of one facing's sector [rad] (four facings share the circle). */
const HALF_SECTOR = FULL_TURN / FACINGS.length / 2;

/** Angle of each facing [rad] (0 = east, south = +π/2: y points down in the world). */
export const FACING_ANGLE: Readonly<Record<Facing, number>> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

/** Degrees → radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / HALF_TURN_DEG;
}

/** Simulated seconds → whole ticks (rounded; at least `min`). */
export function secondsToTicks(seconds: number, min = 0): number {
  const t = Math.round(seconds * TICK_HZ);
  return t < min ? min : t;
}

/** Angle from the figure towards (dx, dy) = aim − figure [rad] (docs/SPIEL.md §10: `atan2`, 0 = east, south = +π/2). */
export function aimAngle(dx: number, dy: number): number {
  return Math.atan2(dy, dx);
}

/** `a` wrapped into (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a % FULL_TURN;
  if (x <= -Math.PI) x += FULL_TURN;
  else if (x > Math.PI) x -= FULL_TURN;
  return x;
}

/** The facing whose 90° sector holds `angle` (a diagonal exactly between two sectors goes to the horizontal one). */
export function nearestFacing(angle: number): Facing {
  const a = wrapAngle(angle);
  if (a >= -HALF_SECTOR && a <= HALF_SECTOR) return 'right';
  if (a > HALF_SECTOR && a < Math.PI - HALF_SECTOR) return 'down';
  if (a < -HALF_SECTOR && a > -Math.PI + HALF_SECTOR) return 'up';
  return 'left';
}

/**
 * The facing of a figure aiming at `angle` that faced `current` (M6-01, §19.1 "Sprites in 4 Richtungen"): it stays while
 * the angle lies within its own sector widened by `hysteresis` [rad] on both sides, else it turns to the sector of the
 * angle – so a cursor resting on a diagonal does not flip the sprite.
 */
export function facingForAngle(angle: number, current: Facing, hysteresis = degToRad(C.aim.facingHysteresisDeg)): Facing {
  const d = wrapAngle(angle - FACING_ANGLE[current]);
  if (d >= -(HALF_SECTOR + hysteresis) && d <= HALF_SECTOR + hysteresis) return current;
  return nearestFacing(angle);
}

/** Damage of a weapon of class `klasse` and tier `tier` [HP] (§D: base damage of the tier × class factor). */
export function weaponDamage(tier: number, klasse: WeaponClass): number {
  const base = BALANCE.tools.weaponDamageByTier[tier];
  if (base === undefined) throw new RangeError(`no tier T${tier}`);
  return base * BALANCE.tools.weaponClassFactor[klasse];
}

/** Share of damage armour `armor` [points] takes away (§19.3: R / (R + 50); broken armour below 0 takes nothing). */
export function armorReduction(armor: number): number {
  return armor > 0 ? armor / (armor + C.damage.armorConstant) : 0;
}

/** Factor of a resistance on damage (§19.3: 0,5 halves, −0,5 is a weakness taking 1,5×; clamped to −1 … 1). */
export function resistFactor(resist: number): number {
  const r = resist < -1 ? -1 : resist > 1 ? 1 : resist;
  return 1 - r;
}

/**
 * Damage of a hit [HP] (docs/SPIEL.md §10 "Schaden je Art × (1 − Resistenz) × (1 − Rüstungsreduktion)", crit ×1,75,
 * a block absorbs its power's share): `base` the blow's or shot's damage before the target (weapon, combo, heavy,
 * tension, backstab), `resist` the target's resistance to the type (−1 … 1), `armor` its armour [points], `blockPower`
 * 0–1 of a block that met the blow (0 = not blocked). Never below 0. Positional (a hit allocates nothing).
 */
export function hitDamage(base: number, resist: number, armor: number, crit: boolean, blockPower: number): number {
  const d = base * resistFactor(resist) * (1 - armorReduction(armor)) * (crit ? C.damage.critFactor : 1) * (1 - blockPower);
  return d > 0 ? d : 0;
}

/** Whether a crit roll `roll` ∈ [0, 1) hits with chance `chance`. */
export function critRoll(roll: number, chance: number = C.damage.critChance): boolean {
  return roll < chance;
}

/** Impact class clamped to 1–5. */
export function clampWucht(wucht: number): number {
  const top = C.impact.hitstopTicksByWucht.length;
  const w = Math.round(wucht);
  return w < 1 ? 1 : w > top ? top : w;
}

/** Hitstop of a hit of impact class `wucht` [ticks] (docs/SPIEL.md §10: 2–6 ticks). */
export function hitstopTicks(wucht: number): number {
  return C.impact.hitstopTicksByWucht[clampWucht(wucht) - 1] as number;
}

/** Knockback of a hit of impact class `wucht` [px]. */
export function knockbackPx(wucht: number): number {
  return C.impact.knockbackPxByWucht[clampWucht(wucht) - 1] as number;
}

/**
 * Whether a body at offset (dx, dy) [px] from the attacker with radius `radius` lies in the swing: within `reach` of the
 * attacker (to the body's edge) and within the arc around the unit direction (fx, fy) whose half angle has the cosine
 * `cosHalf` (a body the attacker overlaps is always in it). Dot product only – no trigonometry per body.
 */
export function inSwing(fx: number, fy: number, dx: number, dy: number, radius: number, reach: number, cosHalf: number): boolean {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist - radius > reach) return false;
  if (dist <= radius) return true;
  return fx * dx + fy * dy >= cosHalf * dist;
}

/** Whether a blow from direction (dx, dy) = attacker − blocker meets a block facing `facing` [rad] (its arc `arcDeg` [°]). */
export function blockCovers(facing: number, dx: number, dy: number, arcDeg: number = C.block.arcDeg): boolean {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return true;
  return Math.cos(facing) * dx + Math.sin(facing) * dy >= Math.cos(degToRad(arcDeg / 2)) * len;
}

/** Ticks of the parry window (§19.1: 0,15 s = 9 ticks). */
export const PARRY_WINDOW_TICKS = secondsToTicks(C.parry.windowSeconds);

/**
 * Whether a block begun at `blockSinceTick` parries a blow in tick `tick` (docs/SPIEL.md §10: begun ≤ 9 ticks before, exactly;
 * `windowTicks` longer for a blocker with the perk „Paradekunst“, src/game/combat/perks.ts).
 */
export function parries(blockSinceTick: number, tick: number, windowTicks: number = PARRY_WINDOW_TICKS): boolean {
  return blockSinceTick >= 0 && tick - blockSinceTick >= 0 && tick - blockSinceTick <= windowTicks;
}

/** Tension of a shot drawn for `ticks` of a full draw of `drawTicks` [0–1] (at least `minTension`: a bow let go at once still shoots). */
export function tension(ticks: number, drawTicks: number): number {
  const t = drawTicks > 0 ? ticks / drawTicks : 1;
  const min = C.ranged.minTension;
  return t < min ? min : t > 1 ? 1 : t;
}

/**
 * Ticks of a timed step of the player's fight at action pace `pace` [×] (M6-78: the conditions' `aktionstempo`, §11.1
 * Erschöpft, §11.2 Frierend; ADR-0151 for the creatures' wind-up): `ticks / pace`, rounded, at least 1 when there were
 * any – Verlangsamt (0,85) winds up, recovers, draws and reloads 1/0,85 as long, Erschöpft (0,75) a third longer. Pace 1,
 * and a stun (0, under which the player does not fight), leave `ticks`.
 */
export function actionTicks(ticks: number, pace: number): number {
  if (ticks <= 0 || pace === 1 || !(pace > 0)) return ticks;
  const t = Math.round(ticks / pace);
  return t < 1 ? 1 : t;
}

/** Tangent of the widest spread a lowered precision opens a shot to (`BALANCE.conditions.player.maxSpreadDeg`). */
const MAX_SPREAD_TAN = Math.tan(degToRad(BALANCE.conditions.player.maxSpreadDeg));

/**
 * The spread of a shot – the tangent of its half-angle, `spreadTan` at full precision – fired at precision `precision` [×]
 * (M6-78: the conditions' `praezision`, §11.2 Frierend): `spreadTan / precision`, at most `maxSpreadDeg` – Geblendet (0,5)
 * doubles it. Precision 1 leaves it; none at all (≤ 0) opens it fully.
 */
export function spreadAtPrecision(spreadTan: number, precision: number): number {
  if (precision === 1) return spreadTan;
  if (!(precision > 0)) return MAX_SPREAD_TAN;
  const s = spreadTan / precision;
  return s > MAX_SPREAD_TAN ? MAX_SPREAD_TAN : s;
}

/** Speed of a shot at tension `t` [× the weapon's speed]. */
export function shotSpeedShare(t: number): number {
  const s = C.ranged.minSpeedShare;
  return s + (1 - s) * t;
}

/** Height of a thrown weapon above the ground at share `p` (0–1) of its flight [px] (§19.2 "Wurfbogen": a parabola). */
export function throwArcHeight(p: number, peakPx: number): number {
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  // 4 p (1 − p) peaks at 1 in the middle of the flight.
  const PARABOLA = 4;
  return PARABOLA * q * (1 - q) * peakPx;
}

/** Peak height of a throw over `distancePx` [px]. */
export function throwPeakPx(distancePx: number): number {
  return distancePx * C.throw.arcHeightPerPx;
}

/**
 * Whether team `a` may hit team `b` (docs/SPIEL.md §10: hits between animals and foes only where a creature is
 * explicitly allowed to – none in M6): the player and every creature fight each other, creatures do not fight
 * creatures, nobody hits their own side.
 */
export function hostile(a: CombatTeam, b: CombatTeam): boolean {
  return (a === 'spieler') !== (b === 'spieler');
}

/** Whether a weapon class needs both hands (§12.2 "Zweihandwaffe", §19.2 "Zweihänder … Licht am Gürtel"). */
export function twoHanded(klasse: WeaponClass): boolean {
  return C.twoHandedClasses.includes(klasse);
}

/**
 * Whether a weapon class keeps the off hand busy (ADR-0154, M6-79): the two-hander takes both hands, the bow's off hand
 * draws the string, the crossbow is held in both (`block.noShieldClasses`). With such a weapon in the hand the off-hand
 * shield hangs unused and the carried light hangs on the belt (§12.2 "Mit Schild oder Zweihandwaffe hängt sie am Gürtel
 * (−40 % Radius)"); the sling and throws leave the off hand free.
 */
export function offHandBusy(klasse: WeaponClass): boolean {
  return twoHanded(klasse) || C.block.noShieldClasses.includes(klasse);
}
