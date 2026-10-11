/**
 * Recipes of the kitchen's stations and goods (docs/SPIEL.md §21, §29 "Küche & Vorrat"; MASTERPROMPT §15.2, §16.7, §18; M7-25,
 * M7-28, M7-29; items in src/content/items/kueche.ts):
 * - the cauldron: two fired clay pots on a tripod of wood, bound with rope – at the workbench;
 * - the bread oven: bricks and clay over a stone base – at the workbench;
 * - the smokehouse: planks around a bricked ember pit – at the workbench;
 * - the quern: two dressed stone blocks and a wooden crank – at the mason's bench;
 * - the fermenting barrel: planks bound with rope and sealed with resin, like the bucket but bigger – at the workbench;
 * - the herb table: planks, a clay pot for the mortar and a first bundle of yarrow – at the workbench;
 * - the pantry barrel: planks, rope and resin – at the workbench;
 * - flour: two sheaves of any grain ground at the quern (group `getreide`; ADR-0227 gave the grain its straw, the kitchen its
 *   flour).
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the kitchen's stations, the pantry barrel and flour. */
export const KUECHE_REZEPTE = defineRecipeGroup('kueche', [
  recipe({ item: 'kessel', zutaten: { keramik_topf: 2, holz: 3, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'backofen', zutaten: { ziegel: 8, lehm: 6, stein: 6 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'raeucherkammer', zutaten: { brett: 8, ziegel: 4, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'muehle', zutaten: { steinblock: 2, holz: 2 }, station: 'steinmetzbank', dauer: 'gross' }),
  recipe({ item: 'gaerfass', zutaten: { brett: 6, faserseil: 2, harz: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'kraeutertisch', zutaten: { brett: 4, keramik_topf: 1, schafgarbe: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'vorratsfass', zutaten: { brett: 6, faserseil: 2, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'mehl', gruppen: { getreide: 2 }, station: 'muehle', dauer: 'mahlen' }),
]);
