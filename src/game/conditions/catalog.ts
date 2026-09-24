/**
 * Lookup of the condition definitions for the simulation (src/content/conditions.ts): by id, in content
 * order (the HUD shows conditions in this order), with the index of each id for allocation-free lists.
 * Tests hand in their own catalog.
 */
import { CONTENT } from '../../content/index';
import type { ConditionDef } from '../../content/conditions';

export class ConditionCatalog {
  private readonly byId = new Map<string, ConditionDef>();
  private readonly indexById = new Map<string, number>();
  /** Definitions in content order. */
  readonly list: readonly ConditionDef[];

  constructor(defs: readonly ConditionDef[]) {
    this.list = defs;
    defs.forEach((d, i) => {
      this.byId.set(d.id, d);
      this.indexById.set(d.id, i);
    });
  }

  /** The definition of `id`; throws `RangeError` for an unknown id. */
  get(id: string): ConditionDef {
    const d = this.byId.get(id);
    if (d === undefined) throw new RangeError(`Unknown condition "${id}"`);
    return d;
  }

  /** The definition of `id`, or `undefined`. */
  find(id: string): ConditionDef | undefined {
    return this.byId.get(id);
  }

  /** Position of `id` in content order (−1 when unknown). */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }
}

let shared: ConditionCatalog | null = null;

/** The catalog of the game's content (built once). */
export function contentConditionCatalog(): ConditionCatalog {
  shared ??= new ConditionCatalog(CONTENT.collection('conditions').values());
  return shared;
}
