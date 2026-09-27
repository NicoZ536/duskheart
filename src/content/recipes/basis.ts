/**
 * Recipes of the base (M4-20, M4-21, M4-35): the storage furniture (src/content/items/lagerung.ts), the hearth fire
 * (src/content/items/herdfeuer.ts) and the splint (src/content/items/heilmittel.ts).
 *
 * - **Storage** (§16.7): the wooden crate is the chest of the first day – logs and a rope at the workbench; the shelf
 *   is a frame of beams with plank boards (workbench); the chest has a domed plank lid and bronze nails, so it needs the
 *   Werkbank II (T1).
 * - **Hearth** (§16.5): a ring of hewn stone blocks bedded in clay around a pit with the first logs – made at the
 *   mason's bench, where stone is hewn.
 * - **Splint** (§11.3, M4-35): two twigs and a fibre rope at the workbench, as the task text asks ("Schiene (Zweige +
 *   Faserseil) als Werkbank-Rezept vorziehen").
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the base. */
export const BASIS_REZEPTE = defineRecipeGroup('basis', [
  // Storage.
  recipe({ item: 'kiste_holz', zutaten: { holz: 6, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'lagerregal', zutaten: { balken: 4, brett: 6 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'truhe', zutaten: { brett: 8, balken: 1, nagel_bronze: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  // The hearth fire.
  recipe({ item: 'herdfeuer', zutaten: { steinblock: 6, lehm: 4, holz: 4 }, station: 'steinmetzbank', dauer: 'gross' }),
  // The splint.
  recipe({ item: 'schiene', zutaten: { zweig: 2, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
]);
