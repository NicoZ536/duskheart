/**
 * The compiled particle tables of the content (kinds and sources), built once per page – the content is frozen – and
 * shared by the producers (who look up a source by id once) and the particle system.
 */
import { buildEmitterTable, buildKindTable, type EmitterTable, type KindTable } from './kinds';

export interface ParticleTables {
  readonly kinds: KindTable;
  readonly emitters: EmitterTable;
}

let tables: ParticleTables | null = null;

/** Kind and source tables of the content. */
export function particleTables(): ParticleTables {
  if (tables === null) {
    const kinds = buildKindTable();
    tables = { kinds, emitters: buildEmitterTable(kinds) };
  }
  return tables;
}

/** Index of the particle source `id` of the content (look it up once, not per frame). */
export function particleEmitter(id: string): number {
  return particleTables().emitters.index(id);
}

/** Row of the particle kind `id` of the content. */
export function particleKind(id: string): number {
  return particleTables().kinds.index(id);
}
