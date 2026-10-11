/**
 * Recipes of research and maps (MASTERPROMPT §15.1 "Forschungspult (Relikte studieren)", §15.2; docs/SPIEL.md §19 "Forschungspult
 * (Station, Verarbeitung ohne Brennstoff): Eingang Relikt, Dauer, Ausgang `bauplan_<ziel>`", "Kartentisch (Handwerk): Rezepte
 * `ortskarte_<ortstyp>`"; M7-18; strand C):
 *
 * - the research desk at Werkbank II – planks, a copper bar for the lens ring and glass for the lens;
 * - studying a relic at the research desk (time class `forschen`, five minutes) gives its schematic: the compass the map table,
 *   the council seal the councillors' amulet, the cogwheel the mechanics' ring – the study stays in crafting, the unlock comes
 *   when the schematic is used (src/game/research/);
 * - the map table at the workbench, waiting for its schematic (`bp_kartentisch`);
 * - the Builders' jewellery at the bronze anvil, waiting for theirs (`bp_erbauer_amulett`, `bp_erbauer_ring`) – bronze, a
 *   Lumen shard for the glow, sinew for the cord;
 * - maps at the map table: woven cloth and charcoal for the ink, one map per kind of place.
 */
import { defineRecipeGroup, recipe } from './define';

const MAP_TYPES = ['gewoelbe', 'aussichtsturm', 'schrein', 'friedhof'] as const;

export const FORSCHUNG_REZEPTE = defineRecipeGroup('forschung', [
  recipe({ item: 'forschungspult', zutaten: { brett: 4, kupferbarren: 1, glas: 1 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'bauplan_kartentisch', zutaten: { relikt_kompass: 1 }, station: 'forschungspult', dauer: 'forschen' }),
  recipe({ item: 'bauplan_erbauer_amulett', zutaten: { relikt_siegel: 1 }, station: 'forschungspult', dauer: 'forschen' }),
  recipe({ item: 'bauplan_erbauer_ring', zutaten: { relikt_zahnrad: 1 }, station: 'forschungspult', dauer: 'forschen' }),
  { ...recipe({ item: 'kartentisch', zutaten: { brett: 6, kupferbarren: 2, fasergewebe: 2 }, station: 'werkbank', dauer: 'gross' }), freischaltung: 'bp_kartentisch' },
  { ...recipe({ item: 'erbauer_amulett', zutaten: { bronzebarren: 2, lumen_scherbe: 1, sehnen: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }), freischaltung: 'bp_erbauer_amulett' },
  { ...recipe({ item: 'erbauer_ring', zutaten: { bronzebarren: 2, lumen_scherbe: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }), freischaltung: 'bp_erbauer_ring' },
  ...MAP_TYPES.map((t) => recipe({ item: `ortskarte_${t}`, zutaten: { fasergewebe: 1, holzkohle: 1 }, station: 'kartentisch', dauer: 'werkzeug' })),
]);
