/**
 * Building block of the creature content files (`kreaturen.ts`, `profile.ts`, `beute.ts`, `spawn.ts`, `fallen.ts`): every
 * file is a zod-validated list of its own – `defineCreatureRecords` parses each record with its schema, rejects duplicate
 * ids and freezes the result (the same contract as the item and recipe groups); src/content/index.ts registers the lists
 * as the collections `creatures`, `aiProfiles`, `lootTables`, `spawnTables` and `traps`.
 */
import type { z } from 'zod';
import { deepFreeze } from '../freeze';
import { spawnEntrySchema, type AiProfileDef, type CreatureDef, type LootTableDef, type SpawnEntry, type SpawnTableDef } from './schema';

/** Error in a creature content list. */
export class CreatureContentError extends Error {
  override readonly name = 'CreatureContentError';
}

/** Entries a group adds to the spawn table of a biome another group owns (shadow brood in every biome's night). */
export interface SpawnAddition {
  /** The biome (= the id of its table). */
  readonly biom: string;
  readonly tag: readonly SpawnEntry[];
  readonly nacht: readonly SpawnEntry[];
}

/**
 * A group of creature content – one file per set of creatures (docs/SPIEL.md §11 "Daten"): its creatures, AI profiles,
 * loot tables, the spawn tables of the biomes it owns and the entries it adds to other groups' tables. The core's lists
 * (kreaturen.ts, profile.ts, beute.ts, spawn.ts) are the group `kern`; src/content/creatures/index.ts registers every
 * group with one line in `CREATURE_GROUPS` and joins them into the collections.
 */
export interface CreatureGroup {
  readonly id: string;
  readonly kreaturen: readonly CreatureDef[];
  readonly profile: readonly AiProfileDef[];
  readonly beute: readonly LootTableDef[];
  readonly spawnTabellen: readonly SpawnTableDef[];
  readonly spawnZusaetze: readonly SpawnAddition[];
}

/** Validates the spawn additions of a group (every entry with `spawnEntrySchema`) and freezes them. */
export function defineSpawnAdditions(what: string, additions: ReadonlyArray<{ biom: string; tag?: ReadonlyArray<z.input<typeof spawnEntrySchema>>; nacht?: ReadonlyArray<z.input<typeof spawnEntrySchema>> }>): readonly SpawnAddition[] {
  const parsed = additions.map((a) => {
    const entries = (list: ReadonlyArray<z.input<typeof spawnEntrySchema>> | undefined, time: string): SpawnEntry[] =>
      (list ?? []).map((raw, index) => {
        const result = spawnEntrySchema.safeParse(raw);
        if (!result.success) throw new CreatureContentError(`${what} ${a.biom}.${time}[${index}] invalid: ${result.error.issues.map((i) => `${i.path.map(String).join('.') || '(entry)'}: ${i.message}`).join('; ')}`);
        return result.data;
      });
    return { biom: a.biom, tag: entries(a.tag, 'tag'), nacht: entries(a.nacht, 'nacht') };
  });
  deepFreeze(parsed);
  return parsed;
}

/**
 * The spawn tables of all groups: every group's own tables (a biome has one owner – a second table of the same biome is an
 * error) with the other groups' additions appended to their `tag` and `nacht` lists, in group order. An addition to a biome
 * without a table is an error. Frozen.
 */
export function joinSpawnTables(groups: readonly CreatureGroup[]): readonly SpawnTableDef[] {
  const tables: SpawnTableDef[] = [];
  for (const g of groups) {
    for (const t of g.spawnTabellen) {
      if (tables.some((x) => x.id === t.id)) throw new CreatureContentError(`spawnTables: biome "${t.id}" has a table twice (group ${g.id})`);
      tables.push({ ...t, tag: [...t.tag], nacht: [...t.nacht] });
    }
  }
  for (const g of groups) {
    for (const a of g.spawnZusaetze) {
      const t = tables.find((x) => x.id === a.biom);
      if (t === undefined) throw new CreatureContentError(`spawnTables: group ${g.id} adds to biome "${a.biom}", which has no table`);
      t.tag.push(...a.tag);
      t.nacht.push(...a.nacht);
    }
  }
  deepFreeze(tables);
  return tables;
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
