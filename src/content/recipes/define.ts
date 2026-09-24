/**
 * Building block of the recipe content files: every group file (`grundlagen.ts`, later one per station)
 * validates its records with `defineRecipeGroup` – schema, unique ids inside the group – and
 * src/content/recipes/index.ts joins the groups into the registry collection `recipes`.
 */
import { deepFreeze } from '../freeze';
import { recipeSchema, type RecipeDef, type RecipeInput } from './schema';

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
