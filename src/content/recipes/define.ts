/**
 * Building blocks of the recipe content files: every group file (`grundlagen.ts`, `stationen.ts`,
 * `verarbeitung.ts`, `bronze.ts` …) validates its records with `defineRecipeGroup` – schema, unique ids inside
 * the group – and src/content/recipes/index.ts joins the groups into the registry collection `recipes`.
 * `recipe()` writes one record from item → count maps.
 */
import { deepFreeze } from '../freeze';
import { recipeSchema, type RecipeDef, type RecipeIngredient, type RecipeInput } from './schema';

/** Error in a recipe group. */
export class RecipeGroupError extends Error {
  override readonly name = 'RecipeGroupError';
}

/**
 * Validates one group of recipes with the recipe schema. Throws `RecipeGroupError` naming the group, the
 * record and every issue; duplicate ids inside the group are an error too.
 */
export function defineRecipeGroup(group: string, records: readonly RecipeInput[]): readonly RecipeDef[] {
  const seen = new Set<string>();
  const parsed: RecipeDef[] = records.map((raw, index) => {
    const result = recipeSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(recipe)'}: ${i.message}`).join('; ');
      throw new RecipeGroupError(`Recipe group "${group}" [${index}] "${raw.id}" invalid: ${issues}`);
    }
    if (seen.has(result.data.id)) throw new RecipeGroupError(`Recipe group "${group}": duplicate id "${result.data.id}"`);
    seen.add(result.data.id);
    return result.data;
  });
  // Frozen in place: the group arrays are shared by the registry and the game.
  deepFreeze(parsed);
  return parsed;
}

/** What one recipe needs and makes, for `recipe()`. */
export interface RecipeSpec {
  /** Product and pieces per craft (default 1). */
  readonly item: string;
  readonly anzahl?: number;
  /** Concrete ingredients [item → pieces per craft]. */
  readonly zutaten?: Readonly<Record<string, number>>;
  /** Group ingredients [group → pieces per craft] (src/content/recipes/gruppen.ts). */
  readonly gruppen?: Readonly<Record<string, number>>;
  readonly station: string | null;
  readonly dauer: RecipeInput['dauer'];
  /** Id suffix of a second recipe of the same product (`rezept_<item>_<suffix>`). */
  readonly suffix?: string;
}

/** One recipe record `rezept_<item>[_<suffix>]` from a spec; `extra` adds the optional fields. */
export function recipe(spec: RecipeSpec, extra: Partial<Pick<RecipeInput, 'name' | 'umgebung' | 'behaelt' | 'aufwerten' | 'bauplan' | 'sound'>> = {}): RecipeInput {
  const zutaten: RecipeIngredient[] = [
    ...Object.entries(spec.zutaten ?? {}).map(([item, anzahl]) => ({ item, anzahl })),
    ...Object.entries(spec.gruppen ?? {}).map(([gruppe, anzahl]) => ({ gruppe, anzahl })),
  ];
  return {
    id: spec.suffix === undefined ? `rezept_${spec.item}` : `rezept_${spec.item}_${spec.suffix}`,
    ergebnis: { item: spec.item, anzahl: spec.anzahl ?? 1 },
    zutaten,
    station: spec.station,
    dauer: spec.dauer,
    ...extra,
  };
}
