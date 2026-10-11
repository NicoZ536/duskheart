/**
 * The rules of meals as pure functions (MASTERPROMPT §18 "Mahlzeit-Effekte … Überdruss", §12.3 "Wohlfühlessen −10 bis −25",
 * §16.4 "Küche … +10 % Mahlzeitwirkung", "Speisesaal … Essen senkt Furcht zusätzlich"; docs/SPIEL.md §21; M7-26 … M7-28;
 * tests/unit/game/mahlzeiten.test.ts).
 *
 * - **Boredom**: every eaten piece of a dish raises its counter by 1; a piece eaten with the counter at 2 or more (the third
 *   of a day) gives half its nutrition; at every 06:00 each counter falls by 1,5 (after two dawns three pieces are forgotten).
 * - **Nutrition** of one piece after its freshness (src/game/actions/formulas.ts): boredom halves what it gives (satiety and
 *   the thirst it quenches – never the thirst salt takes), a kitchen's dish gives 10 % more (`daten.kueche`), salt takes thirst
 *   (`mahlzeit.salz`), comfort food calms by the larger of the dish comfort and its own (`wohlfuehl`), a dining hall a little
 *   more.
 * - **Effects**: the conditions of a meal (`mahlzeit.zustaende`) and a potion (`trank.gibt`) last their seconds, a kitchen's
 *   10 % longer; raw meat and raw fish (group `fleisch_roh`) poison with 30 % (`BALANCE.meals.rawMeatPoison`).
 */
import { BALANCE } from '../../content/balance';
import { INGREDIENT_GROUPS } from '../../content/recipes/gruppen';
import type { ItemDef } from '../../content/schema/item';
import { dishComfort } from '../actions/formulas';
import type { Nutrition } from '../actions/hooks';
import type { ItemStack } from '../items/stack';

const M = BALANCE.meals;

/** The ingredient group whose members poison when eaten raw (docs/SPIEL.md §21). */
export const RAW_MEAT_GROUP = 'fleisch_roh';
/** Data key of a stack made in a kitchen (docs/SPIEL.md §21 "Stapel aus der Küche tragen `daten.kueche = true`"). */
export const KITCHEN_DATA_KEY = 'kueche';

const RAW_MEAT: ReadonlySet<string> = new Set(INGREDIENT_GROUPS.find((g) => g.id === RAW_MEAT_GROUP)?.items ?? []);

/** Whether `item` is raw meat or raw fish (a member of `fleisch_roh`). */
export function isRawMeat(item: string): boolean {
  return RAW_MEAT.has(item);
}

/** Whether the next piece of a dish whose counter is `counter` is eaten in boredom (§18 "3× an einem Tag"). */
export function bored(counter: number): boolean {
  return counter >= M.boredom.from;
}

/** A boredom counter after one dawn [pieces] (`decayPerDawn`, never below 0). */
export function decayedBoredom(counter: number): number {
  const n = counter - M.boredom.decayPerDawn;
  return n > 0 ? n : 0;
}

/** Whether a piece counts towards boredom: food and dishes (`nahrung`, `gericht`) – not potions or medicine. */
export function countsForBoredom(def: Pick<ItemDef, 'kategorie'>): boolean {
  return def.kategorie === 'nahrung' || def.kategorie === 'gericht';
}

/** Whether a stack was made in a kitchen. */
export function fromKitchen(stack: Pick<ItemStack, 'daten'>): boolean {
  return stack.daten?.[KITCHEN_DATA_KEY] === true;
}

/** The comfort a piece of `def` gives [fear points]: the larger of the dish comfort (§12.3, every dish 10) and its own `wohlfuehl`. */
export function comfortOf(def: ItemDef): number {
  const own = def.mahlzeit?.wohlfuehl ?? 0;
  const dish = dishComfort(def);
  return own > dish ? own : dish;
}

/**
 * Changes the nutrition `out` of one piece of `def` (already scaled by its freshness) in place: boredom (`isBored`), the
 * kitchen (`kitchen`), salt, comfort, the dining hall (`diningHall`) and a potion's instant fear (`trank.sofort.furcht`).
 */
export function mealNutrition(def: ItemDef, isBored: boolean, kitchen: boolean, diningHall: boolean, out: Nutrition): Nutrition {
  if (isBored) {
    out.satiety *= M.boredom.factor;
    if (out.thirst > 0) out.thirst *= M.boredom.factor;
  }
  if (kitchen) {
    out.satiety *= M.kitchen.effect;
    if (out.thirst > 0) out.thirst *= M.kitchen.effect;
  }
  const salt = def.mahlzeit?.salz;
  if (salt !== undefined) out.thirst -= salt;
  let comfort = comfortOf(def);
  if (kitchen) comfort *= M.kitchen.effect;
  if (comfort > out.fearRelief) out.fearRelief = comfort;
  if (diningHall) out.fearRelief += M.diningHallComfort;
  const fear = def.trank?.sofort?.furcht;
  if (fear !== undefined && fear < 0) out.fearRelief -= fear;
  return out;
}

/** Duration of a meal or potion condition [s]: its own, 10 % longer from a kitchen. */
export function effectSeconds(seconds: number, kitchen: boolean): number {
  return kitchen ? seconds * M.kitchen.effect : seconds;
}
