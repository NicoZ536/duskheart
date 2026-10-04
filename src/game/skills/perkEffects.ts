/**
 * Perk effects of the non-combat skills (docs/SPIEL.md §23 "Perks M7", MASTERPROMPT §23.2; ADR-0175; strand G): woodcutting,
 * mining, gathering, crafting, smithing, cooking and survival read the summed values of the chosen perks of an effect kind
 * through hooks in their systems; the fight keeps `CombatPerks` (src/game/combat/perks.ts).
 */
import type { PerkEffect } from '../../content/perks';

/** Sum of the values of the chosen perks of one effect kind (0 when none) – for every non-combat skill; CombatPerks stays for the fight. */
export interface PerkEffectsApi {
  value(effect: PerkEffect): number;
}
