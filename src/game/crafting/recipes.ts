/**
 * Recipe lookup for the simulation (MASTERPROMPT §15; docs/SPIEL.md §6, §8). The crafting system, the
 * processing stations and repair resolve recipe ids through a `RecipeBook` instead of the content registry,
 * so tests can run them on fixture recipes validated with the real recipe schema.
 *
 * Building a book checks every recipe against the item catalog, the ingredient groups and the stations: its
 * product, ingredients, groups and station exist; the station is a placeable item with a station record; a
 * group ingredient overlaps neither a concrete ingredient nor another group of the recipe (a piece is taken
 * for exactly one ingredient); hand recipes use a hand time class, recipes of processing stations a
 * processing class and need neither surroundings nor a blueprint (the station runs whatever its slots hold)
 * and fit into its input slots; an upgrade makes the next stage of its station's line; a recipe whose product
 * keeps the durability of an ingredient has exactly one ingredient with durability (one piece) and a product
 * with durability.
 *
 * Each recipe's ingredients are resolved once (`ingredients`): a concrete item, or a group with its members
 * in taking order.
 */
import { HAND_TIME_CLASSES, PROCESS_TIME_CLASSES } from '../../content/balance/crafting';
import { CONTENT } from '../../content/index';
import { INGREDIENT_GROUPS, type IngredientGroup } from '../../content/recipes/gruppen';
import { isGroupIngredient, type RecipeDef } from '../../content/recipes/schema';
import type { ItemCatalog } from '../items/catalog';
import { contentStationCatalog, type StationCatalog } from '../stations/catalog';

/** Unknown recipe id or a recipe that does not fit the item catalog, the groups or the stations. */
export class RecipeBookError extends Error {
  override readonly name = 'RecipeBookError';
}

/** One ingredient of a recipe, resolved: the items that satisfy it. */
export interface ResolvedIngredient {
  /** Item id, or the group id of a group ingredient. */
  readonly key: string;
  /** Whether it is a group (any member). */
  readonly gruppe: boolean;
  /** The items that satisfy it, in taking order (one item for a concrete ingredient). */
  readonly items: readonly string[];
  /** Pieces per craft. */
  readonly anzahl: number;
}

/** Recipes by id, checked against items, ingredient groups and stations. */
export class RecipeBook {
  private readonly byId = new Map<string, RecipeDef>();
  private readonly resolved = new Map<string, readonly ResolvedIngredient[]>();
  private readonly groupById = new Map<string, IngredientGroup>();
  private readonly byStation = new Map<string, RecipeDef[]>();
  private readonly byProduct = new Map<string, RecipeDef[]>();
  /** Recipes in definition order (discovery events follow it). */
  readonly list: readonly RecipeDef[];

  constructor(
    recipes: readonly RecipeDef[],
    readonly catalog: ItemCatalog,
    groups: readonly IngredientGroup[] = INGREDIENT_GROUPS,
    readonly stations: StationCatalog = contentStationCatalog(),
  ) {
    for (const g of groups) {
      if (this.groupById.has(g.id)) throw new RecipeBookError(`Recipe book: duplicate ingredient group "${g.id}"`);
      const unknown = g.items.find((i) => !catalog.has(i));
      if (unknown !== undefined) throw new RecipeBookError(`Recipe book: ingredient group "${g.id}" names the unknown item "${unknown}"`);
      this.groupById.set(g.id, g);
    }
    for (const r of recipes) {
      if (this.byId.has(r.id)) throw new RecipeBookError(`Recipe book: duplicate recipe "${r.id}"`);
      const problem = this.problem(r);
      if (problem !== null) throw new RecipeBookError(`Recipe book: "${r.id}" ${problem}`);
      this.byId.set(r.id, r);
      this.resolved.set(r.id, Object.freeze(r.zutaten.map((z) => this.resolve(z))));
      if (r.station !== null) this.byStation.set(r.station, [...(this.byStation.get(r.station) ?? []), r]);
      this.byProduct.set(r.ergebnis.item, [...(this.byProduct.get(r.ergebnis.item) ?? []), r]);
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

  /** The resolved ingredients of recipe `id` (in the recipe's order). */
  ingredients(id: string): readonly ResolvedIngredient[] {
    const ings = this.resolved.get(id);
    if (ings === undefined) throw new RecipeBookError(`Unknown recipe "${id}" (${this.list.length} recipes)`);
    return ings;
  }

  /** The ingredient group `id`, or `undefined`. */
  group(id: string): IngredientGroup | undefined {
    return this.groupById.get(id);
  }

  /** Whether `recipe` is a batch of a processing station (§15.1 "Verarbeitungsstationen"). */
  isProcessing(recipe: RecipeDef): boolean {
    return recipe.station !== null && this.stations.find(recipe.station)?.art === 'verarbeitung';
  }

  /**
   * The recipes a placed station `station` can make, in book order: the recipes of every station of its line
   * up to its stage (§15.1 "Stationsstufen erhöhen … verfügbare Rezepte").
   */
  recipesAt(station: string): RecipeDef[] {
    return this.list.filter((r) => r.station !== null && this.stations.satisfies(r.station, station));
  }

  /** The recipes naming `station` exactly (allocation-free view). */
  recipesNaming(station: string): readonly RecipeDef[] {
    return this.byStation.get(station) ?? [];
  }

  /** The recipes that make `item`, in book order. */
  recipesFor(item: string): readonly RecipeDef[] {
    return this.byProduct.get(item) ?? [];
  }

  private resolve(z: RecipeDef['zutaten'][number]): ResolvedIngredient {
    if (isGroupIngredient(z)) {
      const g = this.groupById.get(z.gruppe) as IngredientGroup;
      return { key: g.id, gruppe: true, items: g.items, anzahl: z.anzahl };
    }
    return { key: z.item, gruppe: false, items: [z.item], anzahl: z.anzahl };
  }

  private problem(r: RecipeDef): string | null {
    const c = this.catalog;
    const product = c.find(r.ergebnis.item);
    if (product === undefined) return `makes the unknown item "${r.ergebnis.item}"`;
    const taken = new Set<string>();
    for (const z of r.zutaten) {
      let members: readonly string[];
      if (isGroupIngredient(z)) {
        const g = this.groupById.get(z.gruppe);
        if (g === undefined) return `needs the unknown ingredient group "${z.gruppe}"`;
        members = g.items;
      } else {
        if (!c.has(z.item)) return `needs the unknown item "${z.item}"`;
        members = [z.item];
      }
      const overlap = members.find((m) => taken.has(m));
      if (overlap !== undefined) return `takes "${overlap}" for two ingredients (groups must not overlap other ingredients)`;
      if (members.includes(r.ergebnis.item)) return 'makes one of its own ingredients';
      for (const m of members) taken.add(m);
    }
    const hand = (HAND_TIME_CLASSES as readonly string[]).includes(r.dauer);
    if (r.station === null) {
      if (!hand) return `is made in the hand, but its time class "${r.dauer}" is one of the processing stations`;
    } else {
      const item = c.find(r.station);
      if (item === undefined) return `needs the unknown station "${r.station}"`;
      if (item.kategorie !== 'platzierbar') return `names "${r.station}" as its station, but it is not placeable`;
      const station = this.stations.find(r.station);
      if (station === undefined) return `names "${r.station}" as its station, but it has no station record`;
      if (station.art === 'verarbeitung') {
        if (!(PROCESS_TIME_CLASSES as readonly string[]).includes(r.dauer)) return `is a batch of the processing station "${r.station}", but its time class "${r.dauer}" is for hand work`;
        if (r.umgebung !== undefined || r.behaelt !== undefined || r.aufwerten !== undefined || r.bauplan !== undefined) return 'is a batch of a processing station: no surroundings, kept durability, upgrade or blueprint';
        const slots = station.verarbeitung?.eingang ?? 0;
        if (r.zutaten.length > slots) return `needs ${r.zutaten.length} ingredients, but "${r.station}" has ${slots} input slots`;
      } else if (!hand) return `is hand work at "${r.station}", but its time class "${r.dauer}" is for processing stations`;
    }
    if (r.aufwerten === true) {
      const from = r.station === null ? undefined : this.stations.find(r.station);
      const to = this.stations.find(r.ergebnis.item);
      if (from === undefined || to === undefined || to.linie !== from.linie || to.stufe !== from.stufe + 1) return 'upgrades its station, so its product must be the next stage of the station\'s line';
    }
    if (r.behaelt === 'haltbarkeit') {
      const durable = r.zutaten.filter((z) => !isGroupIngredient(z) && c.get(z.item).haltbarkeit !== undefined);
      if (product.haltbarkeit === undefined) return 'keeps the durability of an ingredient, but its product has none';
      if (durable.length !== 1 || durable[0]?.anzahl !== 1) return 'keeps the durability of an ingredient, so exactly one ingredient with durability (one piece) is needed';
    }
    return null;
  }
}

let contentBook: RecipeBook | null = null;

/** The book of the game's recipes (src/content/recipes) on the game's item catalog, built on first use. */
export function contentRecipeBook(catalog: ItemCatalog): RecipeBook {
  if (contentBook === null || contentBook.catalog !== catalog) contentBook = new RecipeBook(CONTENT.collection('recipes').values(), catalog, CONTENT.collection('ingredientGroups').values());
  return contentBook;
}
