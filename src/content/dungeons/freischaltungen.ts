/**
 * The schematics' rows of the unlock registry (MASTERPROMPT §15.1 "Baupläne"; docs/SPIEL.md §22 "Freischaltungen … Quelle
 * `bauplan:<item>`"; src/content/unlocks/schema.ts "`bp_<ziel>` for blueprint unlocks (C)"; M7-16, M7-18): using a schematic
 * (`bauplan_<ziel>`) grants its row (src/game/research/), and the recipe waiting for it shows. Spread into the registry by
 * src/content/unlocks/index.ts; no beacon teaches them (`leuchtfeuer: null`).
 */
import type { UnlockInput } from '../unlocks/schema';

export const VAULT_UNLOCKS: readonly UnlockInput[] = [
  { id: 'bp_kartentisch', leuchtfeuer: null, art: 'station', ziel: 'kartentisch', name: { de: 'Kartentisch', en: 'Map Table' }, umgesetzt: true },
  { id: 'bp_erbauer_amulett', leuchtfeuer: null, art: 'rezept', ziel: 'rezept_erbauer_amulett', name: { de: 'Ratsamulett', en: 'Councillor’s Amulet' }, umgesetzt: true },
  { id: 'bp_erbauer_ring', leuchtfeuer: null, art: 'rezept', ziel: 'rezept_erbauer_ring', name: { de: 'Mechanikerring', en: 'Mechanic’s Ring' }, umgesetzt: true },
];
