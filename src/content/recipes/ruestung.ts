/**
 * Recipes of the armour T0–T1, its materials, the leather backpack and the stations of the armoury (MASTERPROMPT §13.1,
 * §15.1 "Verarbeitungsstationen (… Gerbrahmen …)", §15.2 "Webstuhl · Schneidertisch"; docs/SPIEL.md §14; M6-12, M6-31;
 * the items: src/content/items/ruestung.ts).
 *
 * - **Stations** from Werkbank I: the loom and the tanning frame are frames of logs, twigs and rope; the tailor's table is
 *   a plank table.
 * - **Loom:** fibres into woven fibre. **Tailor's table:** the fibre garb from woven fibre and rope; the leather armour
 *   from leather sewn with yarn (T1: yarn comes from the spinning wheel); the leather backpack laced with rope.
 * - **Tanning frame** (processing, no fuel; §15.1): a hide from hunting and carving (M6-30) with bark for the tannin cures
 *   into leather over the time class `gerben` – in unloaded chunks by timestamp like the drying rack.
 * - **Bronze anvil:** the bronze armour, hammered from bars over a lining of woven fibre.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the armour, its materials, the backpack and the armoury stations. */
export const RUESTUNG_REZEPTE = defineRecipeGroup('ruestung', [
  // ---- Stations (Werkbank I) ----
  recipe({ item: 'webstuhl', zutaten: { holz: 8, zweig: 6, faserseil: 4 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'schneidertisch', zutaten: { brett: 4, holz: 2, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'gerbrahmen', zutaten: { holz: 4, zweig: 8, faserseil: 4 }, station: 'werkbank', dauer: 'gross' }),
  // ---- Materials ----
  recipe({ item: 'fasergewebe', zutaten: { fasern: 6 }, station: 'webstuhl', dauer: 'werkzeug' }),
  // ---- Fibre garb (T0, tailor's table) ----
  recipe({ item: 'faserkappe', zutaten: { fasergewebe: 2, faserseil: 1 }, station: 'schneidertisch', dauer: 'werkzeug' }),
  recipe({ item: 'faserhemd', zutaten: { fasergewebe: 4, faserseil: 1 }, station: 'schneidertisch', dauer: 'gross' }),
  recipe({ item: 'faserhose', zutaten: { fasergewebe: 3, faserseil: 1 }, station: 'schneidertisch', dauer: 'gross' }),
  recipe({ item: 'faserschuhe', zutaten: { fasergewebe: 2, faserseil: 1, rinde: 2 }, station: 'schneidertisch', dauer: 'werkzeug' }),
  // ---- Bronze (T1, bronze anvil) ----
  recipe({ item: 'bronzehelm', zutaten: { bronzebarren: 3, fasergewebe: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzebrustpanzer', zutaten: { bronzebarren: 5, fasergewebe: 2 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzebeinschienen', zutaten: { bronzebarren: 4, fasergewebe: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
  recipe({ item: 'bronzestiefel', zutaten: { bronzebarren: 3, fasergewebe: 1 }, station: 'amboss_bronze', dauer: 'gross' }),
]);

/**
 * Recipes that need the hide of src/content/items/jagd.ts (M6-30, the creature strand): leather from the tanning frame and
 * everything sewn from it – the leather armour and the leather backpack (M6-31 "Leder stammt aus Jagen & Zerlegen").
 */
export const RUESTUNG_REZEPTE_JAGD = defineRecipeGroup('ruestung_jagd', [
  recipe({ item: 'leder', zutaten: { fell: 1, rinde: 2 }, station: 'gerbrahmen', dauer: 'gerben' }),
  recipe({ item: 'lederrucksack', zutaten: { leder: 4, faserseil: 2 }, station: 'schneidertisch', dauer: 'gross' }),
  recipe({ item: 'lederkappe', zutaten: { leder: 2, garn: 1 }, station: 'schneidertisch', dauer: 'werkzeug' }),
  recipe({ item: 'lederwams', zutaten: { leder: 5, garn: 2 }, station: 'schneidertisch', dauer: 'gross' }),
  recipe({ item: 'lederhose', zutaten: { leder: 4, garn: 2 }, station: 'schneidertisch', dauer: 'gross' }),
  recipe({ item: 'lederstiefel', zutaten: { leder: 3, garn: 1 }, station: 'schneidertisch', dauer: 'werkzeug' }),
]);
