/**
 * The conditions as a source of the player's modifiers (src/game/survival/modifiers.ts): movement speed
 * (Knochenbruch, Verlangsamt, Betäubt), maximum health and stamina (Erschüttert, Ausgeruht, Fieber),
 * health and stamina regeneration (Vergiftung, Wohlgenährt, Behaglich …), insulation and cooling. Reads
 * the combined effect the condition system keeps – no allocation per tick.
 */
import type { PlayerModifierSource } from '../survival/modifiers';
import type { ConditionsSystem } from './system';

/** A modifier source adding the active conditions' effects; registered in `addPlayerLifeSystems`. */
export function conditionModifierSource(conditions: ConditionsSystem): PlayerModifierSource {
  return (_sim, _player, out) => {
    const e = conditions.effects();
    out.moveSpeedFactor *= e.moveSpeed;
    out.maxHealthFactor *= e.maxHealth;
    out.maxStaminaFactor *= e.maxStamina;
    out.healthRegenFactor *= e.healthRegen;
    out.staminaRegenFactor *= e.staminaRegen;
    out.insulation += e.insulation;
    out.cooling += e.cooling;
  };
}
