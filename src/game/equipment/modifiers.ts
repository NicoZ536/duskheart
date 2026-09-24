/**
 * The equipment as a source of the player's modifiers (src/game/survival/modifiers.ts): armour weight
 * (§11.4), clothing insulation and cooling (§11.2), maximum health and stamina bonuses (§11.1) and the
 * movement speed bonus of the worn pieces. Reads the cached stats – no allocation per tick.
 */
import type { PlayerModifierSource } from '../survival/modifiers';
import { heavierWeight } from './formulas';
import type { EquipmentSystem } from './system';

/** A modifier source adding the worn equipment's stats; registered in `createSimulation`. */
export function equipmentModifierSource(equipment: EquipmentSystem): PlayerModifierSource {
  return (_sim, _player, out) => {
    const stats = equipment.stats();
    if (stats.ruestungsgewicht !== null) out.armorWeight = heavierWeight(out.armorWeight, stats.ruestungsgewicht);
    out.insulation += stats.werte.isolation;
    out.cooling += stats.werte.kuehlung;
    out.maxHealthBonus += stats.werte.maxLeben;
    out.maxStaminaBonus += stats.werte.maxAusdauer;
    out.moveSpeedFactor *= 1 + stats.werte.tempo;
  };
}
