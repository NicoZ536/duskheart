/**
 * Base schemas shared by every content collection (docs/ARCHITEKTUR.md "Content", ADR-0005).
 *
 * - `LocalizedText`: bilingual content text `{ de, en }`, both non-empty.
 * - `idSchema`: snake_case ASCII identifiers (`stone_axe`, `glutsand_2`).
 * - `tierSchema`: progression tier T0–T7 (§13.2).
 * - `raritySchema`: the five rarities of §4.5.
 * - References: records store plain ids; each collection declares which fields reference which
 *   collection with `ref(path, collection)`, so the validator can check every reference
 *   generically (`resolvePath`).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

/** snake_case: lowercase ASCII letter first, then letters/digits, words joined by single `_`. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
/** Longest accepted id (keeps save keys and debug output readable). */
export const ID_MAX_LENGTH = 64;

/** A content id. */
export const idSchema = z
  .string()
  .max(ID_MAX_LENGTH, { message: `id longer than ${ID_MAX_LENGTH} characters` })
  .regex(ID_PATTERN, { message: 'id must be snake_case ASCII (a-z, 0-9, single "_")' });
export type ContentId = z.output<typeof idSchema>;

/** Whether `value` is a well formed content id. */
export function isContentId(value: unknown): value is ContentId {
  return typeof value === 'string' && value.length <= ID_MAX_LENGTH && ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------------------------
// Localized text
// ---------------------------------------------------------------------------------------------

/** Languages every content text must provide (§2.2). */
export const CONTENT_LANGUAGES = ['de', 'en'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

const translation = z.string().trim().min(1, { message: 'translation must not be empty' });

/** Bilingual content text; both languages required and non-empty (ADR-0005). */
export const localizedTextSchema = z.object({ de: translation, en: translation }).strict();
export type LocalizedText = z.output<typeof localizedTextSchema>;

/**
 * Whether `value` is shaped like a localized text: a plain object whose keys are a non-empty
 * subset of the content languages. Used by the validator to find texts in any record.
 */
export function looksLikeLocalizedText(value: unknown): value is Partial<Record<ContentLanguage, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => (CONTENT_LANGUAGES as readonly string[]).includes(k));
}

/** A localized text found inside a record, with its path (`name`, `pages[2].text`). */
export interface FoundText {
  readonly path: string;
  readonly text: Partial<Record<ContentLanguage, unknown>>;
}

/** Finds every localized text inside `value` (recursively), in document order. */
export function findLocalizedTexts(value: unknown, basePath = ''): FoundText[] {
  const out: FoundText[] = [];
  collectTexts(value, basePath, out);
  return out;
}

function collectTexts(value: unknown, path: string, out: FoundText[]): void {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return;
  if (looksLikeLocalizedText(value)) {
    out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectTexts(v, `${path}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(value)) collectTexts(v, path === '' ? k : `${path}.${k}`, out);
}

/** Missing or empty languages of a localized text (empty array = complete). */
export function missingLanguages(text: Partial<Record<ContentLanguage, unknown>>): ContentLanguage[] {
  return CONTENT_LANGUAGES.filter((lang) => {
    const v = text[lang];
    return typeof v !== 'string' || v.trim() === '';
  });
}

// ---------------------------------------------------------------------------------------------
// Tier & rarity
// ---------------------------------------------------------------------------------------------

/** Lowest progression tier (T0, §13.2). */
export const TIER_MIN = 0;
/** Highest progression tier (T7, §13.2). */
export const TIER_MAX = 7;
/** Progression tier T0–T7. */
export const tierSchema = z.number().int().min(TIER_MIN).max(TIER_MAX);
export type Tier = z.output<typeof tierSchema>;

/** Rarities in ascending order (§4.5: white, green, blue, violet, gold). */
export const RARITIES = ['gewoehnlich', 'ungewoehnlich', 'selten', 'episch', 'legendaer'] as const;
export type Rarity = (typeof RARITIES)[number];
export const raritySchema = z.enum(RARITIES);

// ---------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------

/** A reference field: an id pointing into another (or the same) collection. */
export const refSchema = idSchema;

/**
 * Declares that the values at `path` of every record are ids of records in `collection`.
 * Path syntax: dot separated field names; `name[]` descends into every array element and
 * `name{}` into every value of a record/map. Examples: `station`, `inputs[].item`, `loot{}.item`.
 * Missing, `undefined` and `null` values are skipped (optional references).
 */
export interface RefDeclaration {
  readonly path: string;
  readonly collection: string;
}

type Segment = { readonly key: string; readonly mode: 'value' | 'array' | 'map' };

const SEGMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(\[\]|\{\})?$/;

/** Parses a reference path. Throws `SyntaxError` on malformed paths. */
export function parseRefPath(path: string): readonly Segment[] {
  if (path === '') throw new SyntaxError('Reference path must not be empty');
  return path.split('.').map((part) => {
    const m = SEGMENT_PATTERN.exec(part);
    if (m === null) throw new SyntaxError(`Invalid reference path "${path}" at "${part}"`);
    const key = m[1] as string;
    const suffix = m[2];
    return { key, mode: suffix === '[]' ? 'array' : suffix === '{}' ? 'map' : 'value' };
  });
}

/** Builds a reference declaration (validates the path syntax). */
export function ref(path: string, collection: string): RefDeclaration {
  parseRefPath(path);
  return { path, collection };
}

/** A value found at a reference path, with its concrete location (`inputs[1].item`). */
export interface PathValue {
  readonly at: string;
  readonly value: unknown;
}

/** Every value at `path` inside `record` (see `RefDeclaration` for the syntax). */
export function resolvePath(record: unknown, path: string): PathValue[] {
  const segments = parseRefPath(path);
  let current: PathValue[] = [{ at: '', value: record }];
  for (const seg of segments) {
    const next: PathValue[] = [];
    for (const { at, value } of current) {
      if (typeof value !== 'object' || value === null) continue;
      const child = (value as Record<string, unknown>)[seg.key];
      const base = at === '' ? seg.key : `${at}.${seg.key}`;
      if (child === undefined || child === null) continue;
      if (seg.mode === 'value') next.push({ at: base, value: child });
      else if (seg.mode === 'array') {
        if (Array.isArray(child)) child.forEach((v, i) => next.push({ at: `${base}[${i}]`, value: v }));
        else next.push({ at: base, value: child });
      } else if (typeof child === 'object' && !Array.isArray(child)) {
        for (const [k, v] of Object.entries(child)) next.push({ at: `${base}.${k}`, value: v });
      } else next.push({ at: base, value: child });
    }
    current = next;
  }
  return current.filter((p) => p.value !== undefined && p.value !== null);
}
