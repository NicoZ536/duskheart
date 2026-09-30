/**
 * Recipes of the weapons, ammunition and shields T0–T1 (MASTERPROMPT §15.1, §19.2; docs/SPIEL.md §14; M6-08, M6-09, M6-11;
 * the items: src/content/items/waffen.ts, munition.ts, schilde.ts).
 *
 * - **T0 at Werkbank I:** knapped flint and stone bound to wooden grips with fibre rope; bone from hunting and carving
 *   (M6-30) for the bone club and dagger; the bow is an ash stave with a fibre string; the rockbreaker is a dressed stone
 *   block on a beam. The fire flask is a fired clay pot filled with resin and a fibre wick.
 * - **Ammunition:** flint arrows from twigs, flint and feathers (a bundle of eight); fire, poison and glow arrows dress
 *   flint arrows with resin and fibre, crushed fly agaric (§11.3 "Vergiftung") or glow mushroom; blunt arrows get a resin
 *   knob. Sling stones are pebbles ground round at the mason's bench.
 * - **T1 at the bronze anvil:** blades, heads and points cast from bronze bars on wooden hafts; bolts and bronze arrows by
 *   the dozen from one bar. The composite bow and the crossbow need the planing bench of Werkbank II.
 * - **Shields:** boards with a rope rim at Werkbank I; the bronze shield gets its boss and rim at the anvil.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of weapons, ammunition and shields. */
export const WAFFEN_REZEPTE = defineRecipeGroup('waffen', [
  // ---- Weapons T0 (Werkbank I) ----
  recipe({ item: 'feuersteinklinge', zutaten: { feuerstein: 3, holz: 1, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'steinkampfaxt', zutaten: { stein: 3, holz: 2, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'holzkeule', zutaten: { holz: 3 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'felsbrecher', zutaten: { steinblock: 2, balken: 1, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'kurzbogen', zutaten: { holz: 2, faserseil: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'schleuder', zutaten: { faserseil: 1, fasern: 4 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'wurfmesser_feuerstein', anzahl: 2, zutaten: { feuerstein: 2, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'brandflasche', zutaten: { keramik_topf: 1, harz: 2, fasern: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  // ---- Sling stones ----
  recipe({ item: 'schleuderstein', anzahl: 6, zutaten: { kies: 2 }, station: 'steinmetzbank', dauer: 'handgriff' }),
  // ---- Shields ----
  recipe({ item: 'holzschild', zutaten: { brett: 4, faserseil: 1 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'bronzeschild', zutaten: { brett: 4, bronzebarren: 2, nagel_bronze: 4 }, station: 'amboss_bronze', dauer: 'gross' }),
  // ---- Weapons T1 (bronze anvil; the crossbow at Werkbank II) ----
  recipe({ item: 'bronzeschwert', zutaten: { bronzebarren: 3, holz: 1, garn: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzekampfaxt', zutaten: { bronzebarren: 3, holz: 2 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzestreitkolben', zutaten: { bronzebarren: 3, holz: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzespeer', zutaten: { bronzebarren: 2, holz: 3 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzedolch', zutaten: { bronzebarren: 1, garn: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzezweihaender', zutaten: { bronzebarren: 5, holz: 1, garn: 2 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzegrossaxt', zutaten: { bronzebarren: 5, balken: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzekriegshammer', zutaten: { bronzebarren: 5, balken: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'wurfmesser_bronze', anzahl: 3, zutaten: { bronzebarren: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'armbrust', zutaten: { brett: 3, bronzebarren: 1, garn: 2 }, station: 'werkbank_2', dauer: 'gross' }),
  // ---- Ammunition T1 ----
  recipe({ item: 'bolzen_bronze', anzahl: 10, zutaten: { bronzebarren: 1, brett: 2 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
]);

/**
 * Recipes that need the hunting goods of src/content/items/jagd.ts (bone, sinew, feathers; M6-30, the creature strand): the
 * bone club and dagger, the composite bow and every arrow – feathers fletch them, so the first arrows follow the first
 * bird brought down with the sling.
 */
export const WAFFEN_REZEPTE_JAGD = defineRecipeGroup('waffen_jagd', [
  recipe({ item: 'knochenkeule', zutaten: { knochen: 3, holz: 1, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'knochendolch', zutaten: { knochen: 2, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'pfeil_feuerstein', anzahl: 8, zutaten: { zweig: 4, feuerstein: 1, federn: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'pfeil_stumpf', anzahl: 8, zutaten: { zweig: 4, harz: 1, federn: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'pfeil_feuer', anzahl: 4, zutaten: { pfeil_feuerstein: 4, harz: 1, fasern: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'pfeil_gift', anzahl: 4, zutaten: { pfeil_feuerstein: 4, fliegenpilz: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'pfeil_leucht', anzahl: 4, zutaten: { pfeil_feuerstein: 4, leuchtpilz: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'kompositbogen', zutaten: { brett: 2, knochen: 2, sehnen: 2, harz: 2 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'pfeil_bronze', anzahl: 12, zutaten: { bronzebarren: 1, zweig: 6, federn: 3 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
]);
