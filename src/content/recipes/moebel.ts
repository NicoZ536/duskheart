/**
 * Recipes of the furniture, lights and decoration T0–T1 (M4-19; the items: src/content/items/moebel.ts and
 * moebel_deko.ts; docs/SPIEL.md §8 stations and processing products).
 *
 * Stations by craft (§15.2): rough timber work at the sawbuck (stools, benches, crates, the woodpile), joinery
 * at the workbench, fine joinery with bronze nails and fittings at the Werkbank II, stone at the mason's bench,
 * the fired vase in the clay oven, yarn goods at the spinning wheel, the bronze lanterns at the bronze anvil.
 * Only materials of tiers T0–T1 go in: planks, beams, shingles, stone blocks, straw bundles, clay plaster,
 * ceramic pots, glass and charcoal (T0), yarn, copper, tin, bronze and bronze nails (T1), and what the land
 * gives (logs, twigs, bark, resin, leaves, fibres, clay, sand, earth, flowers, apples, a sapling).
 *
 * Quantities follow the material a piece shows: a chair three planks and a beam for the legs, a table four
 * planks on two beams, a bed a frame of planks and beams with straw bundles and a blanket of yarn; flowers dye
 * cloth and straw (red, blue, yellow). A recipe with a T1 ingredient or station makes a T1 product
 * (tools/validator/tiers.ts).
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the furniture, lights and decoration. */
export const MOEBEL_REZEPTE = defineRecipeGroup('moebel', [
  // Beds.
  recipe({ item: 'strohbett', zutaten: { balken: 2, brett: 2, strohbuendel: 4, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'holzbett', zutaten: { brett: 6, balken: 2, strohbuendel: 3, garn: 4 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'wiege', zutaten: { brett: 4, strohbuendel: 1, garn: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  // Seats.
  recipe({ item: 'hocker_holz', zutaten: { brett: 2, balken: 1 }, station: 'saegebock', dauer: 'handgriff' }),
  recipe({ item: 'stuhl_holz', zutaten: { brett: 3, balken: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'bank_holz', zutaten: { brett: 3, balken: 2 }, station: 'saegebock', dauer: 'werkzeug' }),
  recipe({ item: 'gartenbank', zutaten: { steinblock: 2, brett: 3 }, station: 'steinmetzbank', dauer: 'werkzeug' }),
  recipe({ item: 'schaukelstuhl', zutaten: { brett: 4, balken: 2, nagel_bronze: 2 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'truhenbank', zutaten: { brett: 6, balken: 1, nagel_bronze: 2, bronzebarren: 1 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'sitzkissen', zutaten: { garn: 3, fasern: 4 }, station: 'spinnrad', dauer: 'werkzeug' }),
  // Tables.
  recipe({ item: 'tisch_holz', zutaten: { brett: 4, balken: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'tischdecke', zutaten: { tisch_holz: 1, garn: 4, blume_rot: 1 }, station: 'spinnrad', dauer: 'werkzeug' }),
  recipe({ item: 'schreibpult', zutaten: { brett: 5, balken: 1, holzkohle: 2, nagel_bronze: 2 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'nachttisch', zutaten: { brett: 3, balken: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  // Cupboards and shelves.
  recipe({ item: 'schrank_holz', zutaten: { brett: 8, balken: 2, nagel_bronze: 4, bronzebarren: 1 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'kommode', zutaten: { brett: 7, balken: 1, nagel_bronze: 3, bronzebarren: 1 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'buecherregal', zutaten: { brett: 6, balken: 2, rinde: 6, garn: 3 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'weinregal', zutaten: { brett: 4, balken: 2, glas: 4 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'regal_wand', zutaten: { brett: 2, keramik_topf: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'kleiderhaken', zutaten: { brett: 1, zweig: 3, fasern: 6 }, station: 'werkbank', dauer: 'handgriff' }),
  // Decorative containers.
  recipe({ item: 'truhe_deko', zutaten: { brett: 5, kupferbarren: 1, nagel_bronze: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'kiste_deko', zutaten: { brett: 4, apfel: 4 }, station: 'saegebock', dauer: 'handgriff' }),
  recipe({ item: 'fass_holz', zutaten: { brett: 6, zweig: 4 }, station: 'werkbank', dauer: 'werkzeug' }),
  // Lights.
  recipe({ item: 'harzlampe', zutaten: { keramik_topf: 1, harz: 2, balken: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'harzlampe_wand', zutaten: { keramik_topf: 1, harz: 2, brett: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'laterne_stehend', zutaten: { glas: 2, bronzebarren: 1, brett: 1, harz: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'laternenpfahl', zutaten: { balken: 2, glas: 2, bronzebarren: 1, harz: 2 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'kamin_stein', zutaten: { steinblock: 8, lehmputz: 2, balken: 1 }, station: 'steinmetzbank', dauer: 'gross' }),
  // Wall objects.
  recipe({ item: 'bild_landschaft', zutaten: { brett: 2, garn: 2, blume_blau: 1, blume_gelb: 1, holzkohle: 1 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'wandteppich', zutaten: { garn: 8, blume_rot: 1, blume_blau: 1 }, station: 'spinnrad', dauer: 'gross' }),
  recipe({ item: 'wandschild', zutaten: { brett: 2, holzkohle: 1, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'spiegel_wand', zutaten: { glas: 2, zinnbarren: 1, bronzebarren: 1 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'trophaeenbrett', zutaten: { brett: 2, balken: 1, bronzebarren: 1 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'vorhang_leinen', zutaten: { garn: 6, zweig: 1 }, station: 'spinnrad', dauer: 'werkzeug' }),
  recipe({ item: 'fahne_wand', zutaten: { garn: 5, blume_rot: 2, blume_gelb: 1, zweig: 1 }, station: 'spinnrad', dauer: 'werkzeug' }),
  recipe({ item: 'kranz_tuer', zutaten: { zweig: 6, laub: 6, blume_rot: 2, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'werkzeugwand_deko', zutaten: { brett: 3, zweig: 2, stein: 2, faserseil: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'blumenampel', zutaten: { keramik_topf: 1, erde: 2, blume_gelb: 2, faserseil: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  // Plants.
  recipe({ item: 'blumentopf', zutaten: { keramik_topf: 1, erde: 2, blume_rot: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'topfpflanze', zutaten: { keramik_topf: 1, erde: 2, setzling_buche: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'pflanzkuebel', zutaten: { brett: 3, erde: 4, blume_gelb: 3 }, station: 'werkbank', dauer: 'werkzeug' }),
  // Textiles and decoration.
  recipe({ item: 'teppich_stroh', zutaten: { strohbuendel: 4, faserseil: 2, blume_rot: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'vase_keramik', zutaten: { lehm: 3, sand: 1 }, station: 'lehmofen', dauer: 'brennen' }),
  recipe({ item: 'schaukelpferd', zutaten: { brett: 4, balken: 1, fasern: 4 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'waschzuber', zutaten: { brett: 6, zweig: 4 }, station: 'werkbank', dauer: 'werkzeug' }),
  // Yard and garden.
  recipe({ item: 'uhr_sonne', zutaten: { steinblock: 3, bronzebarren: 1 }, station: 'steinmetzbank', dauer: 'gross' }),
  recipe({ item: 'vogelhaus', zutaten: { brett: 3, balken: 1, dachschindel: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'holzstapel', gruppen: { bauholz: 20 }, station: 'saegebock', dauer: 'handgriff' }),
  recipe({ item: 'steinbrunnen_deko', zutaten: { steinblock: 10, balken: 2, dachschindel: 4, faserseil: 2 }, station: 'steinmetzbank', dauer: 'gross' }),
  recipe({ item: 'wegweiser', zutaten: { brett: 3, balken: 1, holzkohle: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
