/**
 * Content entry point: the game's content registry plus the shared schemas and balance table.
 * Collections are defined here in dependency order; the validator (`npm run validate:content`)
 * loads `CONTENT` and checks schemas, references, texts and the §C counts.
 */
import { ContentRegistry } from './registry';

/** The registry holding every content collection of the game. */
export const CONTENT = new ContentRegistry();

export { BALANCE, type Balance, type WorldSizePreset } from './balance';
export { CONTENT_CATEGORIES, contentCategorySchema, isContentCategory, type ContentCategory } from './categories';
export { deepFreeze, type DeepReadonly } from './freeze';
export {
  COLLECTION_NAME_PATTERN,
  ContentError,
  ContentRegistry,
  type CategoryMapping,
  type CollectionMap,
  type CollectionOptions,
  type ContentCollection,
  type ContentRecord,
  type ContentRegistryView,
  type ReferenceUse,
} from './registry';
export * from './schema/common';
