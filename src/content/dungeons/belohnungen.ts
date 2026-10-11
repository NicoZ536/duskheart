/**
 * The unique rewards of the vaults (MASTERPROMPT §21 "Belohnungen: … einzigartige Baupläne"; docs/SPIEL.md §19 "Belohnungen";
 * M7-16): the blueprints that lie once in a world – each planned vault's end chest holds one of them, in slot order
 * (src/game/vaults/formulas.ts `uniqueBlueprintOf`). The research desk turns relics into the same blueprints (src/content/
 * recipes/forschung.ts), so a world with fewer vaults still has every one of them.
 */
export const VAULT_UNIQUE_BLUEPRINTS: readonly string[] = ['bauplan_kartentisch', 'bauplan_erbauer_amulett', 'bauplan_erbauer_ring'];
