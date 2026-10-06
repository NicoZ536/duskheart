/**
 * Pure rules of the boss fight (docs/SPIEL.md §22 "Boss-Framework", MASTERPROMPT §20.2, §D, §4.6; M7-32): which phase a
 * health share belongs to, how long a telegraph lasts, which attacks are ready, the weighted choice among them, and the
 * shapes of the area attacks (line, circle, cone, ring – with a fan of lines or a scatter of circles) against the player's
 * body circle. Everything here is arithmetic on its arguments: the system calls it, tests check it directly.
 */
import { BALANCE } from '../../content/balance';
import { BOSS_DEFAULT_WUCHT, type BossAttackDef, type BossAreaAttackDef, type BossDef, type BossPhaseDef } from '../../content/bosses/schema';
import { creatureDamageBy } from '../creatures/formulas';
import { armorReduction, degToRad, resistFactor, secondsToTicks } from '../combat/formulas';
import type { Difficulty } from '../../content/balance/death';

const B = BALANCE.bosses;
/** A full turn [rad]. */
const TURN = 2 * Math.PI;

/** Index of the phase a boss with `health` of `maxHealth` is in (the last phase whose threshold the share has reached). */
export function phaseFor(def: Pick<BossDef, 'phasen'>, health: number, maxHealth: number): number {
  const share = maxHealth > 0 ? health / maxHealth : 0;
  let phase = 0;
  for (let i = 1; i < def.phasen.length; i++) if (share <= (def.phasen[i] as BossPhaseDef).abLebensanteil) phase = i;
  return phase;
}

/** Telegraph of an attack [ticks]: an area attack its own (≥ `telegraphMinSeconds`), a summon or arena effect the cast. */
export function telegraphTicks(attack: BossAttackDef): number {
  const seconds = attack.art === 'flaeche' ? attack.telegraphSekunden : B.castSeconds;
  return secondsToTicks(Math.max(seconds, B.telegraphMinSeconds), 1);
}

/** Pause after an attack at phase tempo `tempo` [ticks] for a roll `u` ∈ [0, 1) (stream `bosses`). */
export function attackGapTicks(tempo: number, u: number): number {
  return secondsToTicks((B.attackGapSeconds.min + u * B.attackGapSeconds.spread) / tempo, 1);
}

/** Cooldown of an attack at phase tempo `tempo` [ticks]. */
export function cooldownTicks(attack: BossAttackDef, tempo: number): number {
  return secondsToTicks(attack.abklingSekunden / tempo);
}

/**
 * Index of the attack chosen among the ready ones (`readyAt[i] ≤ tick`), weighted by `gewicht`, for a roll `u` ∈ [0, 1);
 * −1 when none is ready.
 */
export function chooseAttack(attacks: readonly BossAttackDef[], readyAt: (i: number) => number, tick: number, u: number): number {
  let total = 0;
  for (let i = 0; i < attacks.length; i++) if (readyAt(i) <= tick) total += (attacks[i] as BossAttackDef).gewicht;
  if (total <= 0) return -1;
  let r = u * total;
  for (let i = 0; i < attacks.length; i++) {
    if (readyAt(i) > tick) continue;
    r -= (attacks[i] as BossAttackDef).gewicht;
    if (r < 0) return i;
  }
  for (let i = attacks.length - 1; i >= 0; i--) if (readyAt(i) <= tick) return i;
  return -1;
}

/** Damage of an area attack with the world's enemy damage factor `factor` before the player's armour [HP] (§29 "Gegnerschaden", the creatures' factor). */
export function bossAttackDamage(attack: Pick<BossAreaAttackDef, 'schaden'>, factor: number): number {
  return creatureDamageBy(attack.schaden, factor);
}

/** Impact class of an area hit. */
export function bossAttackWucht(attack: Pick<BossAreaAttackDef, 'wucht'>): number {
  return attack.wucht ?? BOSS_DEFAULT_WUCHT;
}

/**
 * Share of the maximum health `maxHealth` one hit of `attack` takes from a player with armour `armor` and no resistance on
 * `difficulty` (§D "Boss-Spezial 30–45 % … kein One-Shot auf Normal"; `BALANCE.bosses.maxHitShare`).
 */
export function hitShare(attack: Pick<BossAreaAttackDef, 'schaden'>, difficulty: Difficulty, armor: number, maxHealth: number): number {
  return (bossAttackDamage(attack, BALANCE.difficulty.presets[difficulty].enemyDamage) * resistFactor(0) * (1 - armorReduction(armor))) / maxHealth;
}

/** Squared distance from (px, py) to the segment (ax, ay) → (bx, by). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

/** Angle of line `k` of `n` lines fanned over `spreadDeg` around `angle` [rad] (one line: `angle` itself). */
export function fanAngle(angle: number, k: number, n: number, spreadDeg: number): number {
  if (n <= 1) return angle;
  return angle - degToRad(spreadDeg) / 2 + (degToRad(spreadDeg) * k) / (n - 1);
}

/** Centre of circle `k` of `n` (k = 0 at the aim, the others on a ring of the circle's diameter around it), into `out`. */
export function circleCentre(aimX: number, aimY: number, k: number, n: number, diameterPx: number, out: { x: number; y: number }): { x: number; y: number } {
  if (k === 0 || n <= 1) {
    out.x = aimX;
    out.y = aimY;
    return out;
  }
  const a = (TURN * (k - 1)) / (n - 1);
  out.x = aimX + Math.cos(a) * diameterPx;
  out.y = aimY + Math.sin(a) * diameterPx;
  return out;
}

/**
 * Whether a body circle (bx, by, br) lies in the area of `attack` cast by a boss at (ox, oy) of body radius `bossR` towards
 * angle `angle` with the locked aim point (aimX, aimY):
 * - `linie`: `anzahl` lines fanned over `winkelGrad`, each from the boss's edge `reichweitePx` long and `breitePx` wide;
 * - `kreis`: `anzahl` circles of diameter `breitePx` at the aim (the first) and around it;
 * - `kegel`: the cone of `winkelGrad` around `angle`, `reichweitePx` deep;
 * - `ring`: the band `breitePx` wide inside the radius `reichweitePx` around the boss.
 */
export function inBossArea(attack: BossAreaAttackDef, ox: number, oy: number, bossR: number, angle: number, aimX: number, aimY: number, bx: number, by: number, br: number, scratch: { x: number; y: number }): boolean {
  const n = attack.anzahl ?? 1;
  switch (attack.form) {
    case 'linie': {
      const half = (attack.breitePx ?? 0) / 2 + br;
      for (let k = 0; k < n; k++) {
        const a = fanAngle(angle, k, n, attack.winkelGrad ?? 0);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const d2 = segmentDistance2(bx, by, ox + c * bossR, oy + s * bossR, ox + c * (bossR + attack.reichweitePx), oy + s * (bossR + attack.reichweitePx));
        if (d2 <= half * half) return true;
      }
      return false;
    }
    case 'kreis': {
      const r = (attack.breitePx ?? 0) / 2 + br;
      for (let k = 0; k < n; k++) {
        circleCentre(aimX, aimY, k, n, attack.breitePx ?? 0, scratch);
        const dx = bx - scratch.x;
        const dy = by - scratch.y;
        if (dx * dx + dy * dy <= r * r) return true;
      }
      return false;
    }
    case 'kegel': {
      const dx = bx - ox;
      const dy = by - oy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d - br > attack.reichweitePx + bossR) return false;
      if (d <= br) return true;
      let diff = Math.atan2(dy, dx) - angle;
      while (diff > Math.PI) diff -= TURN;
      while (diff < -Math.PI) diff += TURN;
      return Math.abs(diff) <= degToRad(attack.winkelGrad ?? 0) / 2 + Math.asin(Math.min(1, br / d));
    }
    case 'ring': {
      const dx = bx - ox;
      const dy = by - oy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const outer = attack.reichweitePx;
      const inner = outer - (attack.breitePx ?? 0);
      return d + br >= inner && d - br <= outer;
    }
  }
}

/** The locked aim of an area attack: the player's point, a circle's held within its reach of the boss, into `out`. */
export function lockAim(attack: BossAttackDef, ox: number, oy: number, px: number, py: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = px;
  out.y = py;
  if (attack.art !== 'flaeche' || attack.form !== 'kreis') return out;
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > attack.reichweitePx && d > 0) {
    out.x = ox + (dx / d) * attack.reichweitePx;
    out.y = oy + (dy / d) * attack.reichweitePx;
  }
  return out;
}

/** The phase's attacks as a list (for the choice). */
export function phaseAttacks(phase: BossPhaseDef): readonly BossAttackDef[] {
  return phase.angriffe;
}
