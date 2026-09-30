/**
 * Building block of the creature content files (`kreaturen.ts`, `profile.ts`, `beute.ts`, `spawn.ts`, `fallen.ts`): every
 * file is a zod-validated list of its own – `defineCreatureRecords` parses each record with its schema, rejects duplicate
 * ids and freezes the result (the same contract as the item and recipe groups); src/content/index.ts registers the lists
 * as the collections `creatures`, `aiProfiles`, `lootTables`, `spawnTables` and `traps`.
 */
import type { z } from 'zod';
import { deepFreeze } from '../freeze';

/** Error in a creature content list. */
export class CreatureContentError extends Error {
  override readonly name = 'CreatureContentError';
}

/**
 * Validates `records` with `schema`. Throws `CreatureContentError` naming the list, the record and every issue; duplicate
 * ids are an error too.
 */
export function defineCreatureRecords<S extends z.ZodType<{ id: string }>>(what: string, schema: S, records: ReadonlyArray<z.input<S>>): readonly z.output<S>[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const id = (raw as { id?: unknown }).id;
      const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(record)'}: ${i.message}`).join('; ');
      throw new CreatureContentError(`${what} [${index}] "${String(id)}" invalid: ${issues}`);
    }
    if (seen.has(result.data.id)) throw new CreatureContentError(`${what}: duplicate id "${result.data.id}"`);
    seen.add(result.data.id);
    return result.data;
  });
  deepFreeze(parsed);
  return parsed;
}
