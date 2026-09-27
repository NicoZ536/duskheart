/**
 * What a build part is made of (MASTERPROMPT §16.3 "50 % Material zurück", §16.6 "Abbauen (100 % zurück in den
 * ersten 30 s, danach 60 %)"): the ingredients of the recipe that makes the part item, per piece. A part whose
 * item no recipe makes (found, not made) counts as its own material.
 *
 * A refund of a share of the materials adds up the pieces first and rounds each material down – never more than
 * the share (§16.6 "danach 60 %"): one plank wall dismantled late gives one of three planks back (1,8 → 1), a part
 * that holds a single piece of a material gives none of it back, a whole collapsed roof half its straw.
 */
import { CONTENT } from '../../content/index';
import { RECIPE_ID_PREFIX } from '../../content/recipes/schema';

/** Tolerance of the rounding down [items]: far below any real share, far above the error of a float product. */
const ROUNDING_TOLERANCE = 1e-9;

/** One material of a part: an item and how many a piece of the part holds (may be fractional). */
export interface PartMaterial {
  readonly item: string;
  readonly perPiece: number;
}

/** A recipe as the material book reads it: product, pieces per craft, concrete inputs per craft. */
export interface MaterialRecipe {
  readonly id: string;
  readonly product: string;
  readonly pieces: number;
  readonly inputs: ReadonlyArray<{ readonly item: string; readonly count: number }>;
}

/** An item and a count. */
export interface ItemAmount {
  readonly item: string;
  readonly count: number;
}

/** Materials of the parts, from recipes. */
export class MaterialBook {
  private readonly byProduct = new Map<string, readonly PartMaterial[]>();

  constructor(recipes: readonly MaterialRecipe[]) {
    for (const r of recipes) {
      // The plain recipe `rezept_<item>` wins over variants at other stations.
      const plain = r.id === `${RECIPE_ID_PREFIX}${r.product}`;
      if (this.byProduct.has(r.product) && !plain) continue;
      this.byProduct.set(
        r.product,
        Object.freeze(r.inputs.map((i) => Object.freeze({ item: i.item, perPiece: i.count / r.pieces }))),
      );
    }
  }

  /** Materials of one piece of part `part` (the part item itself when no recipe makes it). */
  materials(part: string): readonly PartMaterial[] {
    return this.byProduct.get(part) ?? [{ item: part, perPiece: 1 }];
  }

  /**
   * The share `share` of the materials of `pieces` pieces of each part, summed and rounded down per item (never more
   * than the share); items in first-seen order.
   */
  refund(parts: ReadonlyArray<{ readonly part: string; readonly pieces: number }>, share: number): ItemAmount[] {
    const sums = new Map<string, number>();
    for (const { part, pieces } of parts) {
      for (const m of this.materials(part)) sums.set(m.item, (sums.get(m.item) ?? 0) + m.perPiece * pieces * share);
    }
    const out: ItemAmount[] = [];
    for (const [item, amount] of sums) {
      // The tolerance keeps a product like 5 × 0,6 that lands a hair under 3 at 3.
      const count = Math.floor(amount + ROUNDING_TOLERANCE);
      if (count > 0) out.push({ item, count });
    }
    return out;
  }
}

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

/** First member of each ingredient group (registry collection `ingredientGroups`, when it exists). */
function groupFirstMembers(): Map<string, string> {
  const out = new Map<string, string>();
  const groups = CONTENT.collections().find((c) => c.name === 'ingredientGroups');
  for (const g of groups?.values() ?? []) {
    const items = field(g, 'items');
    if (Array.isArray(items) && typeof items[0] === 'string') out.set(g.id, items[0]);
  }
  return out;
}

/**
 * The recipes of the content as material recipes: a group ingredient ("any wood") counts as its first member
 * (the plain log), the material a dismantled part gives back.
 */
export function contentMaterialRecipes(): MaterialRecipe[] {
  const groups = groupFirstMembers();
  const out: MaterialRecipe[] = [];
  for (const r of CONTENT.collection('recipes').values()) {
    const inputs: Array<{ item: string; count: number }> = [];
    for (const z of r.zutaten as ReadonlyArray<object>) {
      const count = field(z, 'anzahl');
      const item = field(z, 'item');
      const group = field(z, 'gruppe');
      const resolved = typeof item === 'string' ? item : typeof group === 'string' ? groups.get(group) : undefined;
      if (resolved !== undefined && typeof count === 'number') inputs.push({ item: resolved, count });
    }
    out.push({ id: r.id, product: r.ergebnis.item, pieces: r.ergebnis.anzahl, inputs });
  }
  return out;
}

let contentBook: MaterialBook | null = null;

/** The material book of the game's recipes, built on first use. */
export function contentMaterialBook(): MaterialBook {
  contentBook ??= new MaterialBook(contentMaterialRecipes());
  return contentBook;
}
