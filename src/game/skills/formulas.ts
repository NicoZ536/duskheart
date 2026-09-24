/**
 * Skill progression as pure functions (MASTERPROMPT §23.2, M3-32; tests/unit/game/skills.test.ts).
 *
 * - Levels 1–100; going from level L to L + 1 needs `50 × L^1,6` XP (rounded to whole points, so every
 *   platform uses the same table: `Math.pow` may differ between engines in its last bit).
 * - Effect: +0,5 % per level above the first (`skillBonus`: 0 at level 1, 0,495 at level 100).
 * - Perk choices at levels 30, 60 and 90.
 * - Death costs a share of the progress within the current level – never a level (§23.2 "nie ganze Stufen").
 */
import { BALANCE } from '../../content/balance';

const K = BALANCE.skills;

/** XP to go from each level to the next [XP], index = level (entries 1 … 99). */
const XP_TABLE: readonly number[] = Array.from({ length: K.maxLevel }, (_, level) => (level < K.minLevel ? 0 : Math.round(K.xpFactor * Math.pow(level, K.xpExponent))));

/** XP needed to go from `level` to `level + 1` [XP]; 0 at the last level. Throws `RangeError` outside 1–100. */
export function xpToNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < K.minLevel || level > K.maxLevel) throw new RangeError(`skill level must be an integer ${K.minLevel}–${K.maxLevel}, got ${level}`);
  return level === K.maxLevel ? 0 : (XP_TABLE[level] as number);
}

/** Total XP from level 1 to reach `level` [XP]. */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = K.minLevel; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}

/** Effect bonus of a skill level [fraction]: +0,5 % per level above the first. */
export function skillBonus(level: number): number {
  return (level - K.minLevel) * K.bonusPerLevel;
}

/** A skill's level and its progress within the level. */
export interface SkillProgress {
  level: number;
  /** XP within the current level [XP], below `xpToNextLevel(level)` (0 at the last level). */
  xp: number;
}

/**
 * Adds `amount` XP to `p` (in place): full levels are taken while the XP reach the next one; at the last
 * level the rest is dropped. Returns the levels gained.
 */
export function addXp(p: SkillProgress, amount: number): number {
  if (!(amount > 0) || p.level >= K.maxLevel) return 0;
  let gained = 0;
  p.xp += amount;
  while (p.level < K.maxLevel && p.xp >= xpToNextLevel(p.level)) {
    p.xp -= xpToNextLevel(p.level);
    p.level++;
    gained++;
  }
  if (p.level >= K.maxLevel) p.xp = 0;
  return gained;
}

/** Progress lost at death [XP]: `share` of the XP within the current level (§23.2: 25 % on Normal). */
export function deathXpLoss(xp: number, share: number): number {
  const s = share <= 0 ? 0 : share >= 1 ? 1 : share;
  return xp * s;
}

/** Perk levels in (from, to] – the choices a level-up from `from` to `to` opens. */
export function perkLevelsReached(from: number, to: number): number[] {
  return K.perkLevels.filter((l) => l > from && l <= to);
}
