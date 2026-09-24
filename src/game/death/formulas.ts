/**
 * Death and respawn as pure functions (MASTERPROMPT §11.6, §29; M3-26; tests/unit/game/tod.test.ts).
 *
 * - `penaltyOf`: what a death costs on a difficulty (§29 "Tod"): Entspannt keeps everything, Normal puts
 *   the carried bags into the grave (equipment, belt and backpack stay on) and costs 25 % of each skill
 *   level's progress, Hart puts everything into the grave, Unbarmherzig ends the world.
 * - `graveAreas`: the bag areas that go into the grave.
 * - `respawnVitals`: the survival values after the respawn – full health and stamina within the maxima of
 *   "Erschüttert" (−15 % max. health), satiety and thirst at least half, body temperature normal, dry.
 */
import { BALANCE } from '../../content/balance';
import type { DeathPenalty, Difficulty, GraveContents } from '../../content/balance/death';
import type { BagArea } from '../items/slots';
import type { Vitals } from '../survival/state';

const D = BALANCE.death;

/** Penalties of a difficulty (§29). */
export function penaltyOf(difficulty: Difficulty): DeathPenalty {
  return D.penalties[difficulty];
}

/** The carried bags (Normal): inventory, hotbar and the backpack's compartment. */
const CARRIED: readonly BagArea[] = ['inventar', 'schnellleiste', 'rucksackfach'];
/** Everything (Hart): also equipment, belt and the backpack itself. */
const EVERYTHING: readonly BagArea[] = ['inventar', 'schnellleiste', 'rucksackfach', 'ausruestung', 'guertel', 'rucksack'];

/** Bag areas that go into the grave. */
export function graveAreas(contents: GraveContents): readonly BagArea[] {
  if (contents === 'nichts') return [];
  return contents === 'inventar' ? CARRIED : EVERYTHING;
}

/**
 * Survival values after a respawn, written into `v`: health and stamina at their maxima (`maxHealth`,
 * `maxStamina` already with "Erschüttert"), satiety and thirst at least `BALANCE.death.respawnMin…`,
 * core temperature normal, dry, no drowning, the regeneration timers reset, no damage pending.
 */
export function respawnVitals(v: Vitals, maxHealth: number, maxStamina: number): void {
  const T = BALANCE.survival.temperature;
  v.maxHealth = maxHealth;
  v.health = maxHealth;
  v.maxStamina = maxStamina;
  v.stamina = maxStamina;
  v.satiety = Math.max(v.satiety, D.respawnMinSatiety);
  v.thirst = Math.max(v.thirst, D.respawnMinThirst);
  v.coreC = T.coreNormalC;
  v.coreRateCps = 0;
  v.wetness = 0;
  v.drowning = false;
  v.sprintLocked = false;
  v.staminaRestTicks = 0;
  v.damageFreeTicks = 0;
  for (const cause of Object.keys(v.pendingDamage) as Array<keyof Vitals['pendingDamage']>) v.pendingDamage[cause] = 0;
}
