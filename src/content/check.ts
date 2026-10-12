/**
 * How content records are checked (M7-115): validated where the content is built and tested, trusted in the game.
 *
 * Every content record is authored as a typed TS module and described by a zod schema (MASTERPROMPT §2.4). Checking all
 * of them with zod while the page loads cost the main thread some 45 MB of short-lived objects plus a retained second copy
 * of the content; V8's memory reducer swept that boot garbage up in one long collection in the middle of play. So:
 *
 * - **Mode `voll`** (unit and integration tests, the content validator and every Node tool, the dev server): every record
 *   is checked with its schema, and for a schema that only checks – no default, catch or transform anywhere in it
 *   (`shapesOutput`) – the record must also be authored complete: zod's result may differ from it in nothing but key order
 *   (no unknown key dropped, no text trimmed by a normalising check such as `trim`). A record that is not is an error naming
 *   the place.
 * - **Mode `vertraut`** (the production build, `import.meta.env.PROD`): such a record is used as authored, without zod.
 *
 * In both modes the game gets the very same object – the authored record – so the tests check exactly what the game runs.
 * A schema that shapes its output (defaults of the SFX presets, of the particle sources and of the drops of world objects)
 * is parsed in both modes, as before; a frozen record is a group definition's parsed result (the groups freeze what they
 * checked) and is not parsed again – the full mode parses it once more and requires it unchanged. `npm run check` runs the
 * full check on every change; the production build trusts what it checked.
 */
import { z } from 'zod';

/** `voll`: zod check and completeness check; `vertraut`: records of checking schemas are used without zod. */
export type ContentCheckMode = 'voll' | 'vertraut';

/** The mode of this build: `vertraut` only in Vite's production build (Node tools and tests have no `import.meta.env`). */
export const CONTENT_CHECK_MODE: ContentCheckMode = import.meta.env?.PROD === true ? 'vertraut' : 'voll';

/** The result of `checkContent`, shaped like zod's `safeParse`. */
export type ContentCheckResult<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: z.ZodError };

/** The parts of a zod schema the walk reads (zod 4 core: `_zod.def`). */
interface SchemaDef {
  readonly type: string;
  readonly shape?: Readonly<Record<string, z.ZodType>>;
  readonly catchall?: z.ZodType;
  readonly element?: z.ZodType;
  readonly items?: readonly z.ZodType[];
  readonly rest?: z.ZodType | null;
  readonly keyType?: z.ZodType;
  readonly valueType?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly left?: z.ZodType;
  readonly right?: z.ZodType;
  readonly innerType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly out?: z.ZodType;
  readonly getter?: () => z.ZodType;
}

function defOf(schema: z.ZodType): SchemaDef {
  return (schema as unknown as { readonly _zod: { readonly def: SchemaDef } })._zod.def;
}

/** Schema kinds whose result is the checked value itself (or, for containers, made of their parts' results). */
const CHECKING_LEAVES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'int',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'never',
  'any',
  'unknown',
  'date',
  'enum',
  'literal',
  'nan',
  'template_literal',
  'custom',
]);

/** Whether each schema shapes its output (memo; schemas live as long as the content). */
const shaping = new Map<z.ZodType, boolean>();

/**
 * Whether `schema` is built to hand back something other than the checked value: a default, prefault or catch, a transform
 * or a kind this walk does not know – anywhere in it. Otherwise its result equals the input up to key order, dropped unknown
 * keys and normalising checks (`trim`, `toLowerCase`, …: zod's `overwrite`) – the completeness check rules out the last two,
 * so such a record reads the same checked or not.
 */
export function shapesOutput(schema: z.ZodType): boolean {
  const known = shaping.get(schema);
  if (known !== undefined) return known;
  // A cycle (`z.lazy`) is assumed to only check while it is being walked; the completeness check verifies the answer.
  shaping.set(schema, false);
  const result = walk(defOf(schema));
  shaping.set(schema, result);
  return result;
}

function walk(def: SchemaDef): boolean {
  const any = (parts: ReadonlyArray<z.ZodType | null | undefined>): boolean => parts.some((p) => p !== null && p !== undefined && shapesOutput(p));
  switch (def.type) {
    case 'object':
      return any(Object.values(def.shape ?? {})) || any([def.catchall]);
    case 'array':
    case 'set':
      return any([def.element ?? def.valueType]);
    case 'tuple':
      return any([...(def.items ?? []), def.rest]);
    case 'record':
    case 'map':
      return any([def.keyType, def.valueType]);
    case 'union':
      return any(def.options ?? []);
    case 'intersection':
      return any([def.left, def.right]);
    case 'optional':
    case 'nullable':
    case 'nonoptional':
    case 'readonly':
      return any([def.innerType]);
    case 'pipe':
      return any([def.in, def.out]);
    case 'lazy':
      return def.getter === undefined || shapesOutput(def.getter());
    default:
      return !CHECKING_LEAVES.has(def.type);
  }
}

/**
 * The first place where zod's result `parsed` and the authored `raw` differ other than in key order (`null`: nowhere):
 * a missing or extra key, another value, another kind of container.
 */
export function contentDifference(parsed: unknown, raw: unknown, path: readonly PropertyKey[] = []): readonly PropertyKey[] | null {
  if (Object.is(parsed, raw)) return null;
  if (typeof parsed !== 'object' || typeof raw !== 'object' || parsed === null || raw === null) return path;
  if (Object.getPrototypeOf(parsed) !== Object.getPrototypeOf(raw)) return path;
  if (Array.isArray(parsed)) {
    const r = raw as readonly unknown[];
    if (parsed.length !== r.length) return path;
    for (let i = 0; i < parsed.length; i++) {
      const d = contentDifference(parsed[i], r[i], [...path, i]);
      if (d !== null) return d;
    }
    return null;
  }
  if (parsed instanceof Map || parsed instanceof Set) return contentDifference([...parsed], [...(raw as Map<unknown, unknown> | Set<unknown>)], path);
  const p = parsed as Readonly<Record<string, unknown>>;
  const r = raw as Readonly<Record<string, unknown>>;
  for (const k of Object.keys(r)) if (!Object.hasOwn(p, k)) return [...path, k];
  for (const k of Object.keys(p)) {
    if (!Object.hasOwn(r, k)) return [...path, k];
    const d = contentDifference(p[k], r[k], [...path, k]);
    if (d !== null) return d;
  }
  return null;
}

function incomplete(path: readonly PropertyKey[], what: string): z.ZodError {
  return new z.ZodError([{ code: 'custom', path: [...path], message: what, input: undefined }]);
}

/**
 * Checks one authored content record against `schema` (see the module comment) and returns the record the game uses: the
 * authored one for a schema that only checks, zod's result for one that shapes its output. `mode` defaults to this build's
 * (`CONTENT_CHECK_MODE`); tests pass it to check both paths.
 */
export function checkContent<S extends z.ZodType>(schema: S, raw: unknown, mode: ContentCheckMode = CONTENT_CHECK_MODE): ContentCheckResult<z.output<S>> {
  if (shapesOutput(schema)) {
    // Frozen: a group definition's result of this schema (it freezes what it checked, e.g. `defineSfxGroup`) – not parsed again.
    const settled = typeof raw === 'object' && raw !== null && Object.isFrozen(raw);
    if (settled && mode === 'vertraut') return { success: true, data: raw as z.output<S> };
    const result = schema.safeParse(raw);
    if (!result.success) return { success: false, error: result.error };
    if (!settled) return { success: true, data: result.data as z.output<S> };
    // Parsing a settled record again must change nothing: no default left to fill in, no transform that is not idempotent.
    const d = contentDifference(result.data, raw);
    if (d !== null) return { success: false, error: incomplete(d, 'a frozen record counts as checked, but checking it again changes it – freeze only what the schema returned') };
    return { success: true, data: raw as z.output<S> };
  }
  if (mode === 'vertraut') return { success: true, data: raw as z.output<S> };
  const result = schema.safeParse(raw);
  if (!result.success) return { success: false, error: result.error };
  const d = contentDifference(result.data, raw);
  if (d !== null) return { success: false, error: incomplete(d, 'not authored complete – the check would add, drop or change this value; write the record as the schema checks it, so the game can use it unchecked (M7-115)') };
  return { success: true, data: raw as z.output<S> };
}
