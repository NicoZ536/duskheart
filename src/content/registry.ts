/**
 * Content registry (docs/ARCHITEKTUR.md "Content"). Collections of typed, zod-validated records,
 * looked up by id.
 *
 * - `defineCollection(name, schema, records, options)` validates every record at load time,
 *   rejects duplicate ids, freezes the data and returns the registry with a widened type, so
 *   `registry.get('items', 'stone_axe')` is typed as the item schema output.
 * - Each collection declares its §C count categories and its reference fields; the content
 *   validator (tools/validator) uses `countsByCategory()` and `references()` generically.
 * - The registry works with zero collections.
 */
import type { z } from 'zod';
import { isContentCategory, type ContentCategory } from './categories';
import { deepFreeze } from './freeze';
import { idSchema, parseRefPath, resolvePath, type RefDeclaration } from './schema/common';

/** Every content record has a unique snake_case id. */
export interface ContentRecord {
  readonly id: string;
}

/** Collection name → record type. */
export type CollectionMap = Record<string, ContentRecord>;

/** Collection names are lowerCamelCase ASCII (`items`, `statusEffects`). */
export const COLLECTION_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
/** Maximum number of issues quoted in one schema error message. */
const MAX_REPORTED_ISSUES = 8;

/** Error in content data or a content lookup. */
export class ContentError extends Error {
  override readonly name = 'ContentError';
}

/** How a collection maps its records to §C count categories. */
export type CategoryMapping<T> = ContentCategory | readonly ContentCategory[] | ((record: T) => readonly ContentCategory[]);

/** Options of `defineCollection`. */
export interface CollectionOptions<T> {
  /** Categories each record counts towards (e.g. weapons count as `items` and `weapons`). */
  readonly category?: CategoryMapping<T>;
  /** Reference fields of the records (see `ref()` in schema/common.ts). */
  readonly refs?: readonly RefDeclaration[];
}

/** Read access to one collection. */
export interface ContentCollection<T extends ContentRecord> {
  readonly name: string;
  readonly size: number;
  readonly refs: readonly RefDeclaration[];
  /** The record with this id; throws a descriptive `ContentError` if it does not exist. */
  get(id: string): T;
  /** The record with this id, or `undefined`. */
  find(id: string): T | undefined;
  has(id: string): boolean;
  /** Ids in definition order. */
  ids(): readonly string[];
  /** Records in definition order. */
  values(): readonly T[];
  /** Categories a record counts towards (deduplicated). */
  categoriesOf(record: T): readonly ContentCategory[];
}

/** One reference value found in a record. */
export interface ReferenceUse {
  /** Collection of the referencing record. */
  readonly collection: string;
  /** Id of the referencing record. */
  readonly id: string;
  /** Concrete location inside the record (`inputs[1].item`). */
  readonly at: string;
  /** Declared target collection. */
  readonly target: string;
  /** The raw value (should be an id string). */
  readonly value: unknown;
}

/** Untyped read view used by generic tools (validator, debug inspectors). */
export interface ContentRegistryView {
  collectionNames(): readonly string[];
  collections(): ReadonlyArray<ContentCollection<ContentRecord>>;
  hasCollection(name: string): boolean;
  has(collection: string, id: string): boolean;
  countsByCategory(): Partial<Record<ContentCategory, number>>;
  references(): ReferenceUse[];
}

function formatIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES).map((i) => `${i.path.map(String).join('.') || '(record)'}: ${i.message}`);
  const more = error.issues.length > MAX_REPORTED_ISSUES ? ` (+${error.issues.length - MAX_REPORTED_ISSUES} more)` : '';
  return issues.join('; ') + more;
}

function normalizeMapping<T>(mapping: CategoryMapping<T> | undefined): (record: T) => readonly ContentCategory[] {
  if (mapping === undefined) return () => [];
  if (typeof mapping === 'function') return mapping;
  const fixed: readonly ContentCategory[] = typeof mapping === 'string' ? [mapping] : mapping;
  return () => fixed;
}

class Collection<T extends ContentRecord> implements ContentCollection<T> {
  readonly refs: readonly RefDeclaration[];
  private readonly byId = new Map<string, T>();
  private readonly list: readonly T[];
  private readonly idList: readonly string[];
  private readonly mapping: (record: T) => readonly ContentCategory[];

  constructor(
    readonly name: string,
    records: readonly T[],
    options: CollectionOptions<T>,
  ) {
    for (const r of records) this.byId.set(r.id, r);
    this.list = Object.freeze(records.slice());
    this.idList = Object.freeze(records.map((r) => r.id));
    this.mapping = normalizeMapping(options.category);
    this.refs = Object.freeze((options.refs ?? []).slice());
  }

  get size(): number {
    return this.list.length;
  }

  get(id: string): T {
    const r = this.byId.get(id);
    if (r === undefined) {
      throw new ContentError(`Unknown id "${id}" in content collection "${this.name}" (${this.list.length} records)`);
    }
    return r;
  }

  find(id: string): T | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  ids(): readonly string[] {
    return this.idList;
  }

  values(): readonly T[] {
    return this.list;
  }

  categoriesOf(record: T): readonly ContentCategory[] {
    const cats = this.mapping(record);
    for (const c of cats) {
      if (!isContentCategory(c)) throw new ContentError(`Collection "${this.name}" maps "${record.id}" to unknown category "${String(c)}"`);
    }
    return [...new Set(cats)];
  }
}

/**
 * Registry of content collections. The type parameter tracks the defined collections; build it
 * by chaining `defineCollection` calls and keep the returned value.
 */
export class ContentRegistry<C extends CollectionMap = Record<never, never>> implements ContentRegistryView {
  private readonly byName = new Map<string, Collection<ContentRecord>>();

  /**
   * Validates `records` with `schema`, rejects duplicate ids and registers the collection.
   * Throws `ContentError` naming the collection, record index/id and every schema issue.
   */
  defineCollection<N extends string, S extends z.ZodType<ContentRecord>>(
    name: N,
    schema: S,
    records: ReadonlyArray<z.input<S>>,
    options: CollectionOptions<z.output<S>> = {},
  ): ContentRegistry<C & Record<N, z.output<S>>> {
    if (!COLLECTION_NAME_PATTERN.test(name)) throw new ContentError(`Invalid collection name "${name}" (lowerCamelCase ASCII expected)`);
    if (this.byName.has(name)) throw new ContentError(`Content collection "${name}" is already defined`);
    for (const r of options.refs ?? []) {
      try {
        parseRefPath(r.path);
      } catch (err) {
        throw new ContentError(`Collection "${name}": ${(err as Error).message}`);
      }
      if (!COLLECTION_NAME_PATTERN.test(r.collection)) throw new ContentError(`Collection "${name}": reference "${r.path}" targets invalid collection name "${r.collection}"`);
    }
    const parsed: Array<z.output<S>> = [];
    const seen = new Map<string, number>();
    records.forEach((raw, index) => {
      const result = schema.safeParse(raw);
      const rawId = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
      const label = `${name}[${index}]${typeof rawId === 'string' ? ` "${rawId}"` : ''}`;
      if (!result.success) throw new ContentError(`Content ${label} invalid: ${formatIssues(result.error)}`);
      const record = result.data;
      const idCheck = idSchema.safeParse(record.id);
      if (!idCheck.success) throw new ContentError(`Content ${label} invalid: id: ${formatIssues(idCheck.error)}`);
      const previous = seen.get(record.id);
      if (previous !== undefined) throw new ContentError(`Duplicate id "${record.id}" in content collection "${name}" (records ${previous} and ${index})`);
      seen.set(record.id, index);
      parsed.push(deepFreeze(record) as z.output<S>);
    });
    const collection = new Collection<z.output<S>>(name, parsed, options);
    // Validate the category mapping eagerly so a wrong mapping fails at load time.
    for (const r of parsed) collection.categoriesOf(r);
    this.byName.set(name, collection as unknown as Collection<ContentRecord>);
    return this as unknown as ContentRegistry<C & Record<N, z.output<S>>>;
  }

  /** Typed access to a collection; throws `ContentError` for unknown names. */
  collection<N extends keyof C & string>(name: N): ContentCollection<C[N]> {
    return this.require(name) as unknown as ContentCollection<C[N]>;
  }

  /** The record `id` of `collection`; throws a descriptive `ContentError` if either is unknown. */
  get<N extends keyof C & string>(collection: N, id: string): C[N] {
    return this.collection(collection).get(id);
  }

  /** Whether `collection` exists and contains `id`. */
  has(collection: string, id: string): boolean {
    return this.byName.get(collection)?.has(id) ?? false;
  }

  hasCollection(name: string): boolean {
    return this.byName.has(name);
  }

  /** Collection names in definition order. */
  collectionNames(): readonly string[] {
    return [...this.byName.keys()];
  }

  /** All collections (untyped) in definition order. */
  collections(): ReadonlyArray<ContentCollection<ContentRecord>> {
    return [...this.byName.values()];
  }

  /** Number of records per §C category over all collections. */
  countsByCategory(): Partial<Record<ContentCategory, number>> {
    const counts: Partial<Record<ContentCategory, number>> = {};
    for (const c of this.byName.values()) {
      for (const r of c.values()) {
        for (const cat of c.categoriesOf(r)) counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Every declared reference value of every record. */
  references(): ReferenceUse[] {
    const out: ReferenceUse[] = [];
    for (const c of this.byName.values()) {
      for (const decl of c.refs) {
        for (const r of c.values()) {
          for (const { at, value } of resolvePath(r, decl.path)) out.push({ collection: c.name, id: r.id, at, target: decl.collection, value });
        }
      }
    }
    return out;
  }

  private require(name: string): Collection<ContentRecord> {
    const c = this.byName.get(name);
    if (c === undefined) {
      const known = this.collectionNames();
      throw new ContentError(`Unknown content collection "${name}" (defined: ${known.length === 0 ? 'none' : known.join(', ')})`);
    }
    return c;
  }
}
