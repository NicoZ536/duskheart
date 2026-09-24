/**
 * Building blocks of the item content files (docs/SPIEL.md §2): every group file
 * (`rohstoffe.ts`, `nahrung.ts`, …) is a zod-validated collection of its own – `defineItemGroup`
 * parses each record with the item schema, rejects duplicate ids and freezes the result – and
 * src/content/items/index.ts joins the groups into the registry collection `items`.
 *
 * `baseItem` fills what follows from the category: the stack size (§13.1, `BALANCE.items.stack`),
 * tier T0, rarity "gewöhnlich" unless given.
 */
import { BALANCE } from '../balance';
import { deepFreeze } from '../freeze';
import { itemSchema, type ItemCategory, type ItemDef, type ItemInput } from '../schema/item';

/**
 * Handling sounds of items by material (picking up, moving, dropping; §27 "materialspezifische
 * Sounds"). The audio presets carry the same ids (M3-33).
 */
export const ITEM_SFX = {
  holz: 'sfx_item_holz',
  stein: 'sfx_item_stein',
  erde: 'sfx_item_erde',
  erz: 'sfx_item_erz',
  pflanze: 'sfx_item_pflanze',
  frucht: 'sfx_item_frucht',
  pilz: 'sfx_item_pilz',
  muschel: 'sfx_item_muschel',
  /** Tools, weapons and other handled wood-and-stone gear (M3-15, M3-16). */
  werkzeug: 'sfx_item_werkzeug',
} as const;

/** Error in an item group. */
export class ItemGroupError extends Error {
  override readonly name = 'ItemGroupError';
}

/** Item data without the fields `baseItem` derives. */
export type ItemSpec = Omit<ItemInput, 'stapel' | 'stufe' | 'raritaet'> & Partial<Pick<ItemInput, 'stufe' | 'raritaet'>>;

/** An item record with stack size, tier and rarity filled in (`stufe` 0, `raritaet` gewöhnlich unless given). */
export function baseItem(spec: ItemSpec): ItemInput {
  const category: ItemCategory = spec.kategorie;
  return { stufe: 0, raritaet: 'gewoehnlich', ...spec, stapel: BALANCE.items.stack[category] };
}

/**
 * Validates one group of items with the item schema. Throws `ItemGroupError` naming the group, the
 * record and every issue; duplicate ids inside the group are an error too.
 */
export function defineItemGroup(group: string, records: readonly ItemInput[]): readonly ItemDef[] {
  const seen = new Set<string>();
  const parsed: ItemDef[] = records.map((raw, index) => {
    const result = itemSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(item)'}: ${i.message}`).join('; ');
      throw new ItemGroupError(`Item group "${group}" [${index}] "${raw.id}" invalid: ${issues}`);
    }
    if (seen.has(result.data.id)) throw new ItemGroupError(`Item group "${group}": duplicate id "${result.data.id}"`);
    seen.add(result.data.id);
    return result.data;
  });
  // Frozen in place: the group arrays are shared by the registry and the game.
  deepFreeze(parsed);
  return parsed;
}
