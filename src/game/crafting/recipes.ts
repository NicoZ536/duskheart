/**
 * Recipe lookup for the simulation (MASTERPROMPT §15; docs/SPIEL.md §6). The crafting system resolves
 * recipe ids through a `RecipeBook` instead of the content registry, so tests can run it on fixture
 * recipes validated with the real recipe schema. Building a book checks every recipe against the item
 * catalog: its product, ingredients and station exist, the station is a placeable item, and a recipe
 * whose product keeps the durability of an ingredient has exactly one ingredient with durability (one
 * piece) and a product with durability.
 */
import { CONTENT } from '../../content/index';
import type { RecipeDef } from '../../content/recipes/schema';
import type { ItemCatalog } from '../items/catalog';

/** Unknown recipe id or a recipe that does not fit the item catalog. */
export class RecipeBookError extends Error {
  override readonly name = 'RecipeBookError';
}

/** Recipes by id, checked against an item catalog. */
export class RecipeBook {
  private readonly byId = new Map<string, RecipeDef>();
  /** Recipes in definition order (discovery events follow it). */
  readonly list: readonly RecipeDef[];

  constructor(
    recipes: readonly RecipeDef[],
    readonly catalog: ItemCatalog,
  ) {
    for (const r of recipes) {
      if (this.byId.has(r.id)) throw new RecipeBookError(`Recipe book: duplicate recipe "${r.id}"`);
      const problem = this.problem(r);
      if (problem !== null) throw new RecipeBookError(`Recipe book: "${r.id}" ${problem}`);
      this.byId.set(r.id, r);
    }
    this.list = Object.freeze([...recipes]);
  }

  /** The recipe `id`; throws `RecipeBookError` if it does not exist. */
  get(id: string): RecipeDef {
    const r = this.byId.get(id);
    if (r === undefined) throw new RecipeBookError(`Unknown recipe "${id}" (${this.list.length} recipes)`);
    return r;
  }

  /** The recipe `id`, or `undefined`. */
  find(id: string): RecipeDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  private problem(r: RecipeDef): string | null {
    const c = this.catalog;
    const product = c.find(r.ergebnis.item);
    if (product === undefined) return `makes the unknown item "${r.ergebnis.item}"`;
    for (const z of r.zutaten) if (!c.has(z.item)) return `needs the unknown item "${z.item}"`;
    if (r.station !== null) {
      const station = c.find(r.station);
      if (station === undefined) return `needs the unknown station "${r.station}"`;
      if (station.kategorie !== 'platzierbar') return `names "${r.station}" as its station, but it is not placeable`;
    }
    if (r.behaelt === 'haltbarkeit') {
      const durable = r.zutaten.filter((z) => c.get(z.item).haltbarkeit !== undefined);
      if (product.haltbarkeit === undefined) return 'keeps the durability of an ingredient, but its product has none';
      if (durable.length !== 1 || durable[0]?.anzahl !== 1) return 'keeps the durability of an ingredient, so exactly one ingredient with durability (one piece) is needed';
    }
    return null;
  }
}

let contentBook: RecipeBook | null = null;

/** The book of the game's recipes (src/content/recipes) on the game's item catalog, built on first use. */
export function contentRecipeBook(catalog: ItemCatalog): RecipeBook {
  if (contentBook === null || contentBook.catalog !== catalog) contentBook = new RecipeBook(CONTENT.collection('recipes').values(), catalog);
  return contentBook;
}
