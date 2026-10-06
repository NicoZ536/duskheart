/**
 * Recipes of the first beacon's knowledge (MASTERPROMPT §23.1 "Leuchtfeuer 1 Grünhain: Lumen-Werkbank, Lumen-Laterne,
 * Wegsteine"; docs/SPIEL.md §22 "Freischaltungen … Rezepte tragen optional `freischaltung`"; M7-36, M7-37): each waits for its
 * unlock (granted when the beacon of Grünhain is lit, src/content/unlocks/index.ts) and binds Lumen shards with the
 * Borkenvater's resin:
 * - the Lumen workbench at Werkbank II (planks, bronze bars, glass, resin, shards),
 * - the Lumen lantern at the Lumen workbench (bronze, glass, resin and one shard – the charge it is made with),
 * - the way stone at the Lumen workbench (stone blocks, resin, shards).
 */
import { defineRecipeGroup, recipe } from './define';

/** The Lumen workbench, the Lumen lantern and the way stone. */
export const LUMEN_REZEPTE = defineRecipeGroup('lumen', [
  { ...recipe({ item: 'lumen_werkbank', zutaten: { brett: 6, bronzebarren: 2, glas: 2, borkenharz: 2, lumen_scherbe: 3 }, station: 'werkbank_2', dauer: 'gross' }), freischaltung: 'lf1_lumen_werkbank' },
  { ...recipe({ item: 'lumen_laterne', zutaten: { bronzebarren: 2, glas: 1, borkenharz: 1, lumen_scherbe: 1 }, station: 'lumen_werkbank', dauer: 'werkzeug' }), freischaltung: 'lf1_lumen_laterne' },
  { ...recipe({ item: 'wegstein', zutaten: { steinblock: 4, borkenharz: 1, lumen_scherbe: 2 }, station: 'lumen_werkbank', dauer: 'gross' }), freischaltung: 'lf1_wegsteine' },
]);
