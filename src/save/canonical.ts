/**
 * Canonical JSON and stable hashes for saves (integrity checks, roundtrip tests, export files).
 * The encoder itself lives in `src/game/canonical.ts` because `Simulation.hashState()` uses it and
 * `game` may not import `save`; this module re-exports it and adds structural comparison.
 */
import { canonicalJson } from '../game/canonical';

export { TYPED_ARRAY_TAG, canonicalJson, hashText64, parseCanonical, stableHash64, type TypedArrayTag } from '../game/canonical';

function describe(value: unknown): string {
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${(value as unknown as ArrayLike<number>).length})`;
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  return `${typeof value} ${JSON.stringify(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

/**
 * First place where two plain data values differ canonically (as `canonicalJson` would encode
 * them), described as `path: a ≠ b`, or `null` when they are canonically equal.
 */
export function canonicalDiff(a: unknown, b: unknown, path = ''): string | null {
  const here = path === '' ? '(root)' : path;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    return canonicalJson(a) === canonicalJson(b) ? null : `${here}: ${describe(a)} ≠ ${describe(b)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length || i >= b.length) return `${path}[${i}]: ${i >= a.length ? 'missing' : describe(a[i])} ≠ ${i >= b.length ? 'missing' : describe(b[i])}`;
      const d = canonicalDiff(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== undefined || b[k] !== undefined).sort();
    for (const k of keys) {
      const child = path === '' ? k : `${path}.${k}`;
      if (a[k] === undefined || b[k] === undefined) return `${child}: ${a[k] === undefined ? 'missing' : describe(a[k])} ≠ ${b[k] === undefined ? 'missing' : describe(b[k])}`;
      const d = canonicalDiff(a[k], b[k], child);
      if (d !== null) return d;
    }
    return null;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return `${here}: ${describe(a)} ≠ ${describe(b)}`;
  return canonicalJson(a) === canonicalJson(b) ? null : `${here}: ${describe(a)} ≠ ${describe(b)}`;
}

/** Whether two plain data values have the same canonical JSON. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
