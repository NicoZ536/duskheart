/**
 * Skills and perks in the fight (MASTERPROMPT §23.2 "je Stufe +0,5 % Wirkung im Bereich", "Bei 30/60/90 Wahl zwischen 2
 * Perks …, alle spürbar"; docs/SPIEL.md §14 "Perks (18)"; M6-34).
 *
 * `CombatModifiers` is the one record the combat system reads its skill and perk effects from – a held record, refilled
 * by `CombatPerks.fill` from the skill system's state (levels and the perks chosen at 30/60/90) and the perk content
 * (src/content/perks.ts, effect kinds and units there). Neutral values change nothing, so a simulation without skills
 * (tests of single systems) fights exactly as before.
 *
 * - **Skill bonus** (§23.2, `SkillsSystem.bonus`: +0,5 % per level above 1): Nahkampf raises melee damage, Fernkampf ranged
 *   and thrown damage, Verteidigung lets less of a blocked hit through (the block power grows by the bonus's share of what
 *   it lets through: power + (1 − power) × bonus).
 * - **Perks**: each effect kind of the chosen perks adds its value to its field (factors start at 1, additions at 0).
 *
 * The hook (`CombatSystem.usePerks`, wired in `createSimulation`) applies the record at a few documented places:
 * `applyProfileModifiers` scales the hand's attack profile (damage, stamina, stagger, draw and reload, speed and reach), `applyBlockModifiers` the block; the blow, the shot and `resolve` read the rest (heavy damage, crit, the
 * finishing blow, the riposte, the full draw, saved ammunition, steady aim, a longer parry window, less knockback and
 * stagger taken, stamina and health a kill or a dodge gives back).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import { COMBAT_PERK_SKILLS, type PerkDef, type PerkEffect } from '../../content/perks';
import type { SkillsSystem } from '../skills/system';
import type { Vitals } from '../survival/state';
import { secondsToTicks } from './formulas';
import type { AttackProfile, BlockProfile } from './weapons';

const K = BALANCE.skills;
const P = BALANCE.perks;
/** The skills of the fight (§23.2): their bonuses raise melee and ranged damage and soften blocked hits. */
const [MELEE, RANGED, DEFENCE] = COMBAT_PERK_SKILLS;

/** Skill and perk effects on the player's fight (see the module comment; neutral values in `resetCombatModifiers`). */
export interface CombatModifiers {
  /** Melee damage [factor] (Nahkampf bonus). */
  meleeDamage: number;
  /** Ranged and thrown damage [factor] (Fernkampf bonus). */
  rangedDamage: number;
  /** Damage of heavy melee attacks [factor]. */
  heavyDamage: number;
  /** Stamina per melee blow [factor]. */
  meleeStamina: number;
  /** Crit chance of melee blows [added share]. */
  meleeCrit: number;
  /** Stagger dealt by melee blows [factor]. */
  meleeStagger: number;
  /** Damage of melee hits on a target below `BALANCE.perks.lowHealthShare` of its health [added fraction]. */
  finisher: number;
  /** Stamina [points] and health [HP] a melee kill gives back. */
  killStamina: number;
  killHealth: number;
  /** Shots and throws as steady as when aiming. */
  steady: boolean;
  /** Draw and reload time [factor]. */
  drawTime: number;
  /** Damage of a fully drawn shot [factor]. */
  fullDraw: number;
  /** Chance a shot takes no ammunition [0–1]. */
  ammoSave: number;
  /** Speed and reach of shots [factor]. */
  shotReach: number;
  /** Damage of thrown weapons [factor]. */
  throwDamage: number;
  /** Reach of throws [factor]. */
  throwReach: number;
  /** Block power [added share]. */
  blockPower: number;
  /** Share of what a block lets through that it absorbs as well [0–1] (Verteidigung bonus). */
  blockPass: number;
  /** Stamina per absorbed point [factor]. */
  blockStamina: number;
  /** Parry window [added ticks]. */
  parryTicks: number;
  /** Knockback and stagger the player takes [factor]. */
  taken: number;
  /** Damage of the hit on a parried foe [added fraction]. */
  riposte: number;
  /** Stamina a roll through an attack gives back [points]. */
  dodgeStamina: number;
}

/** Sets `m` to the neutral values (no skill, no perk). */
export function resetCombatModifiers(m: CombatModifiers): CombatModifiers {
  m.meleeDamage = 1;
  m.rangedDamage = 1;
  m.heavyDamage = 1;
  m.meleeStamina = 1;
  m.meleeCrit = 0;
  m.meleeStagger = 1;
  m.finisher = 0;
  m.killStamina = 0;
  m.killHealth = 0;
  m.steady = false;
  m.drawTime = 1;
  m.fullDraw = 1;
  m.ammoSave = 0;
  m.shotReach = 1;
  m.throwDamage = 1;
  m.throwReach = 1;
  m.blockPower = 0;
  m.blockPass = 0;
  m.blockStamina = 1;
  m.parryTicks = 0;
  m.taken = 1;
  m.riposte = 0;
  m.dodgeStamina = 0;
  return m;
}

/** A fresh, neutral record. */
export function createCombatModifiers(): CombatModifiers {
  return resetCombatModifiers({} as CombatModifiers);
}

/** Adds one perk effect of value `wert` to `m` (units: src/content/perks.ts). */
export function applyPerkEffect(m: CombatModifiers, art: PerkEffect, wert: number): void {
  switch (art) {
    case 'nahkampf_schwer':
      m.heavyDamage += wert;
      return;
    case 'nahkampf_ausdauer':
      m.meleeStamina += wert;
      return;
    case 'nahkampf_krit':
      m.meleeCrit += wert;
      return;
    case 'nahkampf_stagger':
      m.meleeStagger += wert;
      return;
    case 'nahkampf_gnadenstoss':
      m.finisher += wert;
      return;
    case 'nahkampf_sieg_ausdauer':
      m.killStamina += wert;
      return;
    case 'nahkampf_sieg_leben':
      m.killHealth += wert;
      return;
    case 'fernkampf_ruhig':
      m.steady = wert > 0;
      return;
    case 'fernkampf_spannen':
      m.drawTime += wert;
      return;
    case 'fernkampf_vollschuss':
      m.fullDraw += wert;
      return;
    case 'fernkampf_sparen':
      m.ammoSave += wert;
      return;
    case 'fernkampf_weite':
      m.shotReach += wert;
      return;
    case 'wurf_schaden':
      m.throwDamage += wert;
      return;
    case 'wurf_weite':
      m.throwReach += wert;
      return;
    case 'block_kraft':
      m.blockPower += wert;
      return;
    case 'block_ausdauer':
      m.blockStamina += wert;
      return;
    case 'parade_fenster':
      m.parryTicks += secondsToTicks(wert);
      return;
    case 'standfest':
      m.taken += wert;
      return;
    case 'vergeltung':
      m.riposte += wert;
      return;
    case 'ausweich_ausdauer':
      m.dodgeStamina += wert;
      return;
  }
}

/** A factor clamped to at least 0 (effects never turn a cost or a time negative). */
function nonNegative(f: number): number {
  return f > 0 ? f : 0;
}

/** Ticks scaled by `factor`, rounded, at least 1 when there were any. */
function scaledTicks(ticks: number, factor: number): number {
  if (ticks <= 0) return ticks;
  return Math.max(1, Math.round(ticks * nonNegative(factor)));
}

/**
 * Scales the hand's attack profile `prof` (refilled by `resolveProfile`) by `m`: a blow's damage, stamina and stagger; a
 * shot's draw, reload, speed and reach; a throw's damage, draw and reach. The fist and tools count as melee.
 */
export function applyProfileModifiers(prof: AttackProfile, m: CombatModifiers): AttackProfile {
  if (prof.mode === 'nahkampf') {
    prof.damage *= m.meleeDamage;
    prof.stamina *= nonNegative(m.meleeStamina);
    prof.staggerSeconds *= nonNegative(m.meleeStagger);
    return prof;
  }
  prof.drawTicks = scaledTicks(prof.drawTicks, m.drawTime);
  prof.reloadTicks = scaledTicks(prof.reloadTicks, m.drawTime);
  if (prof.mode === 'wurf') {
    prof.damage *= m.rangedDamage * m.throwDamage;
    prof.reach *= nonNegative(m.throwReach);
    return prof;
  }
  // A shot's damage (weapon and ammunition) scales in the launch (`CombatSystem.shoot`): the skill bonus and a full draw.
  prof.speed *= nonNegative(m.shotReach);
  prof.reach *= nonNegative(m.shotReach);
  return prof;
}

/** Applies `m` to a block `b` (refilled by `blockOf`): more power (at most `BALANCE.perks.blockPowerMax`), less stamina. */
export function applyBlockModifiers(b: BlockProfile, m: CombatModifiers): BlockProfile {
  if (b.kind !== 'block') return b;
  let power = b.power + m.blockPower;
  power += (1 - power) * m.blockPass;
  const base = b.power;
  b.power = power > P.blockPowerMax ? Math.max(base, P.blockPowerMax) : power;
  b.staminaPerDamage *= nonNegative(m.blockStamina);
  return b;
}

/** Whether a target of `health` out of `maxHealth` counts as nearly beaten for the finishing blow. */
export function nearlyBeaten(health: number, maxHealth: number): boolean {
  return maxHealth > 0 && health < maxHealth * P.lowHealthShare;
}

/** Gives the player back `stamina` [points] and `health` [HP] (never above the maxima; a dead body gets nothing). */
export function restoreVitals(v: Vitals, stamina: number, health: number): void {
  if (!(v.health > 0)) return;
  if (stamina > 0) v.stamina = Math.min(v.maxStamina, v.stamina + stamina);
  if (health > 0) v.health = Math.min(v.maxHealth, v.health + health);
}

/** What the combat system reads skills and perks from (`CombatSystem.usePerks`). */
export interface CombatModifierSource {
  /** Refills `out` with the current effects; returns it. */
  fill(out: CombatModifiers): CombatModifiers;
}

/**
 * The player's skills and chosen perks as combat modifiers: the skill bonuses of Nahkampf, Fernkampf and Verteidigung
 * and the effects of every perk chosen at their perk levels. The perk table is built once (skill → level → choice).
 */
export class CombatPerks implements CombatModifierSource {
  /** Skills that have perks, and per skill its perks by level index and choice (built once; `fill` allocates nothing). */
  private readonly skillIds: string[] = [];
  private readonly byLevel: (PerkDef | undefined)[][][] = [];

  constructor(
    private readonly skills: Pick<SkillsSystem, 'skill' | 'bonus'>,
    perks: readonly PerkDef[] = CONTENT.collection('perks').values(),
  ) {
    for (const p of perks) {
      const level = K.perkLevels.indexOf(p.stufe);
      if (level < 0) continue;
      let s = this.skillIds.indexOf(p.fertigkeit);
      if (s < 0) {
        s = this.skillIds.push(p.fertigkeit) - 1;
        this.byLevel.push(K.perkLevels.map(() => []));
      }
      ((this.byLevel[s] as (PerkDef | undefined)[][])[level] as (PerkDef | undefined)[])[p.wahl] = p;
    }
  }

  fill(out: CombatModifiers): CombatModifiers {
    resetCombatModifiers(out);
    out.meleeDamage = 1 + this.skills.bonus(MELEE);
    out.rangedDamage = 1 + this.skills.bonus(RANGED);
    out.blockPass = this.skills.bonus(DEFENCE);
    for (let s = 0; s < this.skillIds.length; s++) {
      const levels = this.byLevel[s] as (PerkDef | undefined)[][];
      const chosen = this.skills.skill(this.skillIds[s] as string).perks;
      for (let i = 0; i < chosen.length; i++) {
        const c = chosen[i];
        if (c === undefined || c.choice === null) continue;
        const perk = levels[K.perkLevels.indexOf(c.level)]?.[c.choice];
        if (perk === undefined) continue;
        for (let j = 0; j < perk.wirkung.length; j++) {
          const w = perk.wirkung[j];
          if (w !== undefined) applyPerkEffect(out, w.art, w.wert);
        }
      }
    }
    return out;
  }
}
