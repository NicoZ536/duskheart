/**
 * Pure rules of the condition system (MASTERPROMPT §11.3, M3-19; tests/unit/game/zustaende.test.ts).
 *
 * - `applyStack`: what a new application does to an active condition under its stack rule – `erneuern`
 *   restarts the duration (never shortens it), `verlaengern` adds the duration up to `maxSekunden`,
 *   `stapeln` adds a stack up to `max` and restarts the duration, `einmalig` leaves it untouched.
 * - `valueStageActive`: whether a `wert` condition holds for the survival values (stage ids of the
 *   vitals system; `wohlgenaehrt` from satiety and thirst ≥ 80).
 * - `aggregateEffects`: the combined effect of all active conditions – factors multiply, points and
 *   rates add up, damage counts per stack, resistances take the strongest.
 * - `countdownStep`: how many ticks of its duration a condition loses in one tick (`heiltInRuhe`).
 */
import { BALANCE } from '../../content/balance';
import type { ConditionDef, ConditionEffect } from '../../content/conditions';
import { secondsToTicks } from '../player/formulas';
import type { Vitals } from '../survival/state';
import type { ActiveCondition } from './state';

/** What an application did. */
export type ApplyOutcome = 'neu' | 'erneuert' | 'verlaengert' | 'gestapelt' | 'unveraendert';

/** Stacks and remaining time of a condition after an application. */
export interface StackResult {
  stacks: number;
  remainingTicks: number;
  outcome: ApplyOutcome;
}

/**
 * Applies a timed or curable condition `def` for `durationTicks` to `active` (`null` = not active yet)
 * under its stack rule; writes into `out` and returns it.
 */
export function applyStack(def: ConditionDef, active: Pick<ActiveCondition, 'stacks' | 'remainingTicks'> | null, durationTicks: number, out: StackResult = { stacks: 0, remainingTicks: 0, outcome: 'neu' }): StackResult {
  if (active === null) {
    out.stacks = 1;
    out.remainingTicks = durationTicks;
    out.outcome = 'neu';
    return out;
  }
  const rule = def.stapel;
  out.stacks = active.stacks;
  out.remainingTicks = active.remainingTicks;
  out.outcome = 'unveraendert';
  switch (rule.regel) {
    case 'erneuern':
      if (durationTicks > active.remainingTicks) out.remainingTicks = durationTicks;
      out.outcome = 'erneuert';
      break;
    case 'verlaengern': {
      const max = secondsToTicks(rule.maxSekunden);
      out.remainingTicks = Math.min(max, active.remainingTicks + durationTicks);
      out.outcome = 'verlaengert';
      break;
    }
    case 'stapeln':
      out.stacks = Math.min(rule.max, active.stacks + 1);
      out.remainingTicks = Math.max(active.remainingTicks, durationTicks);
      out.outcome = 'gestapelt';
      break;
    case 'einmalig':
      break;
  }
  return out;
}

/** Whether satiety and thirst make the player well fed (`BALANCE.conditions.wellFed`). */
export function isWellFed(satiety: number, thirst: number): boolean {
  const w = BALANCE.conditions.wellFed;
  return satiety >= w.satietyFrom && thirst >= w.thirstFrom;
}

/** Whether the `wert` condition `def` holds for the vitals `v` (false for other conditions). */
export function valueStageActive(def: ConditionDef, v: Vitals): boolean {
  const d = def.dauer;
  if (d.art !== 'wert') return false;
  switch (d.quelle) {
    case 'saettigung':
      return v.satietyStage === d.stufe;
    case 'durst':
      return v.thirstStage === d.stufe;
    case 'erschoepfung':
      return v.exhaustionStage === d.stufe;
    case 'naesse':
      return v.wetnessStage === d.stufe;
    case 'temperatur':
      return v.temperatureStage === d.stufe;
    case 'atem':
      return v.drowning;
    case 'naehrzustand':
      return isWellFed(v.satiety, v.thirst);
  }
}

/** Ticks of its duration a condition loses in one tick: `heiltInRuhe` times as many while resting or asleep. */
export function countdownStep(effect: ConditionEffect, resting: boolean): number {
  return resting && effect.heiltInRuhe !== undefined ? effect.heiltInRuhe : 1;
}

/** Whether a condition that ends in water (`endetBeiNaesse`) goes out: swimming or soaked. */
export function quenched(effect: ConditionEffect, swimming: boolean, soaked: boolean): boolean {
  return effect.endetBeiNaesse === true && (swimming || soaked);
}

/** Combined effect of all active conditions (neutral: `createConditionEffects()`). */
export interface ConditionEffects {
  /** Factors [×]. */
  moveSpeed: number;
  actionSpeed: number;
  precision: number;
  maxHealth: number;
  maxStamina: number;
  healthRegen: number;
  staminaRegen: number;
  xp: number;
  sight: number;
  /** Added clothing values [points of §11.2]. */
  insulation: number;
  cooling: number;
  /** Share of incoming damage taken away [fraction]. */
  damageResistance: number;
  /** Rates [points/s]: health lost, satiety and thirst change, fear change. */
  damagePerSecond: number;
  satietyPerSecond: number;
  thirstPerSecond: number;
  fearPerSecond: number;
}

/** Neutral effects (no condition). */
export function createConditionEffects(): ConditionEffects {
  const e = {} as ConditionEffects;
  resetConditionEffects(e);
  return e;
}

/** Resets `e` to the neutral effects. */
export function resetConditionEffects(e: ConditionEffects): void {
  e.moveSpeed = 1;
  e.actionSpeed = 1;
  e.precision = 1;
  e.maxHealth = 1;
  e.maxStamina = 1;
  e.healthRegen = 1;
  e.staminaRegen = 1;
  e.xp = 1;
  e.sight = 1;
  e.insulation = 0;
  e.cooling = 0;
  e.damageResistance = 0;
  e.damagePerSecond = 0;
  e.satietyPerSecond = 0;
  e.thirstPerSecond = 0;
  e.fearPerSecond = 0;
}

/** Adds the effect of one condition with `stacks` stacks to `e`. */
export function addConditionEffect(e: ConditionEffects, w: ConditionEffect, stacks: number): void {
  if (w.tempo !== undefined) e.moveSpeed *= w.tempo;
  if (w.aktionstempo !== undefined) e.actionSpeed *= w.aktionstempo;
  if (w.praezision !== undefined) e.precision *= w.praezision;
  if (w.maxLeben !== undefined) e.maxHealth *= w.maxLeben;
  if (w.maxAusdauer !== undefined) e.maxStamina *= w.maxAusdauer;
  if (w.lebensRegeneration !== undefined) e.healthRegen *= w.lebensRegeneration;
  if (w.ausdauerRegeneration !== undefined) e.staminaRegen *= w.ausdauerRegeneration;
  if (w.erfahrung !== undefined) e.xp *= w.erfahrung;
  if (w.sicht !== undefined) e.sight *= w.sicht;
  if (w.isolation !== undefined) e.insulation += w.isolation;
  if (w.kuehlung !== undefined) e.cooling += w.kuehlung;
  if (w.schadensresistenz !== undefined && w.schadensresistenz > e.damageResistance) e.damageResistance = w.schadensresistenz;
  if (w.schadenProSekunde !== undefined) e.damagePerSecond += w.schadenProSekunde * stacks;
  if (w.saettigungProSekunde !== undefined) e.satietyPerSecond += w.saettigungProSekunde;
  if (w.durstProSekunde !== undefined) e.thirstPerSecond += w.durstProSekunde;
  if (w.furchtProSekunde !== undefined) e.fearPerSecond += w.furchtProSekunde;
}

/** Combined effect of `active` (definitions from `defOf`) into `out`. */
export function aggregateEffects(active: readonly ActiveCondition[], defOf: (id: string) => ConditionDef, out: ConditionEffects = createConditionEffects()): ConditionEffects {
  resetConditionEffects(out);
  for (let i = 0; i < active.length; i++) {
    const c = active[i] as ActiveCondition;
    addConditionEffect(out, defOf(c.id).wirkung, c.stacks);
  }
  return out;
}
