/**
 * Item lookup for the simulation (docs/SPIEL.md §2). Systems resolve item ids through an
 * `ItemCatalog` instead of the content registry, so tests can run the same code on fixture items
 * (tools, armour, backpacks) validated with the real item schema. `contentItemCatalog()` is the
 * catalog of the game's content, built once.
 */
import { CONTENT } from '../../content/index';
import type { ItemDef } from '../../content/schema/item';

/** Unknown item id or inconsistent catalog. */
export class ItemCatalogError extends Error {
  override readonly name = 'ItemCatalogError';
}

/** Item definitions by id. */
export class ItemCatalog {
  private readonly byId = new Map<string, ItemDef>();
  private readonly idList: readonly string[];

  constructor(defs: readonly ItemDef[]) {
    for (const def of defs) {
      if (this.byId.has(def.id)) throw new ItemCatalogError(`Item catalog: duplicate item "${def.id}"`);
      this.byId.set(def.id, def);
    }
    this.idList = Object.freeze(defs.map((d) => d.id));
  }

  /** The item `id`; throws `ItemCatalogError` if it does not exist. */
  get(id: string): ItemDef {
    const def = this.byId.get(id);
    if (def === undefined) throw new ItemCatalogError(`Unknown item "${id}" (${this.idList.length} items in the catalog)`);
    return def;
  }

  /** The item `id`, or `undefined`. */
  find(id: string): ItemDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Item ids in definition order. */
  ids(): readonly string[] {
    return this.idList;
  }
}

let contentCatalog: ItemCatalog | null = null;

/** The catalog of the game's items (src/content/items), built on first use. */
export function contentItemCatalog(): ItemCatalog {
  contentCatalog ??= new ItemCatalog(CONTENT.collection('items').values());
  return contentCatalog;
}
