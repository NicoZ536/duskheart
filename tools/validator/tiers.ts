/**
 * Stufenreihenfolge des Content-Validators (M3-38; MASTERPROMPT §13.2 „Stufen & Gating“): Die Stufe
 * eines Rezepts ist die Stufe seines Produkts; kein Rezept braucht Material einer höheren Stufe als seine
 * eigene – weder als Zutat noch als Station. Sonst ließe sich ein Gegenstand einer Stufe erst mit dem
 * Material einer späteren herstellen, und das Gating der Bosse (§13.2) liefe ins Leere. Reine Funktion
 * über eine Registry; `runChecks()` (checks.ts) wendet sie auf die echte Registry an.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import { ITEMS_COLLECTION } from '../../src/content/items/usage';
import { RECIPES_COLLECTION } from './reachability';

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

/** Stufe des Items `id` (`null`, wenn es fehlt oder keine Stufe hat). */
function tierOf(registry: ContentRegistryView, id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const item = registry
    .collections()
    .find((c) => c.name === ITEMS_COLLECTION)
    ?.find(id);
  const tier = item === undefined ? undefined : field(item, 'stufe');
  return typeof tier === 'number' ? tier : null;
}

/** Fehler für jedes Rezept, das eine Zutat oder Station höherer Stufe braucht als sein Produkt hat. */
export function checkTierOrder(registry: ContentRegistryView): string[] {
  const errors: string[] = [];
  const recipes = registry.collections().find((c) => c.name === RECIPES_COLLECTION);
  for (const recipe of recipes?.values() ?? []) {
    const product = field(recipe, 'ergebnis');
    const productId = typeof product === 'object' && product !== null ? field(product, 'item') : undefined;
    const own = tierOf(registry, productId);
    if (own === null) continue;
    const inputs = field(recipe, 'zutaten');
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const id = typeof input === 'object' && input !== null ? field(input, 'item') : undefined;
      const tier = tierOf(registry, id);
      if (tier !== null && tier > own) errors.push(`Stufenreihenfolge: Rezept ${recipe.id} (T${own}) braucht die Zutat ${String(id)} der Stufe T${tier}`);
    }
    const station = field(recipe, 'station');
    const stationTier = tierOf(registry, station);
    if (stationTier !== null && stationTier > own) errors.push(`Stufenreihenfolge: Rezept ${recipe.id} (T${own}) braucht die Station ${String(station)} der Stufe T${stationTier}`);
  }
  return errors;
}
