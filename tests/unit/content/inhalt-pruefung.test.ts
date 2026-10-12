/**
 * Content checked where it is built, trusted in the game (M7-115, src/content/check.ts): a record of a schema that only
 * checks is used as authored – in the tests after zod and the completeness check, in the production build without zod –,
 * a schema built to shape its output (defaults, transforms) is parsed in both modes and its result not parsed again.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkContent, contentDifference, shapesOutput, CONTENT_CHECK_MODE } from '../../../src/content/check';
import { CONTENT, BIOMES } from '../../../src/content/index';
import { deepFreeze } from '../../../src/content/freeze';
import { ITEMS } from '../../../src/content/items/index';
import { localizedTextSchema } from '../../../src/content/schema/common';

const text = localizedTextSchema;
const tool = z
  .object({ id: z.string(), name: text, tier: z.number().int(), tags: z.array(z.enum(['a', 'b'])), extra: z.record(z.string(), z.number()).optional() })
  .strict();
const withDefault = z.object({ id: z.string(), count: z.number().default(1) });
const doubled = z.object({ id: z.string(), n: z.number().transform((n) => n * 2) });

describe('Inhaltsprüfung', () => {
  it('runs every test, tool and the validator in the full mode', () => {
    expect(CONTENT_CHECK_MODE).toBe('voll');
  });

  it('tells checking schemas from those built to shape their output', () => {
    expect(shapesOutput(tool)).toBe(false);
    // `trim` normalises – the completeness check forbids a text it would change, so such schemas still only check.
    expect(shapesOutput(text)).toBe(false);
    expect(shapesOutput(z.union([z.literal('x'), z.object({ a: z.number() }).nullable()]))).toBe(false);
    expect(shapesOutput(z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b'), v: z.tuple([z.number(), z.string()]) })]))).toBe(false);
    const tree: z.ZodType = z.lazy(() => z.object({ kinder: z.array(tree) }));
    expect(shapesOutput(tree)).toBe(false);
    expect(shapesOutput(withDefault)).toBe(true);
    expect(shapesOutput(doubled)).toBe(true);
    expect(shapesOutput(z.array(z.object({ a: z.string().catch('?') })))).toBe(true);
    expect(shapesOutput(z.string().pipe(z.transform((s: string) => s.length)))).toBe(true);
    expect(shapesOutput(z.lazy(() => withDefault))).toBe(true);
  });

  it('full mode: checks with zod and hands back the authored record itself', () => {
    const raw = { tier: 2, id: 'axt', tags: ['a'], name: { en: 'Axe', de: 'Axt' } };
    const r = checkContent(tool, raw, 'voll');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(raw);
    const bad = checkContent(tool, { ...raw, tier: 1.5 }, 'voll');
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['tier']);
  });

  it('full mode: a record the check would change is not authored complete – unknown key, untrimmed text', () => {
    const lax = z.object({ id: z.string(), name: text });
    const unknown = checkContent(lax, { id: 'a', name: { de: 'A', en: 'A' }, tippfehler: 1 }, 'voll');
    expect(unknown.success).toBe(false);
    if (!unknown.success) {
      expect(unknown.error.issues[0]?.path).toEqual(['tippfehler']);
      expect(unknown.error.issues[0]?.message).toMatch(/not authored complete/);
    }
    const spaced = checkContent(lax, { id: 'a', name: { de: ' A', en: 'A' } }, 'voll');
    expect(spaced.success).toBe(false);
    if (!spaced.success) expect(spaced.error.issues[0]?.path).toEqual(['name', 'de']);
  });

  it('trusted mode: the authored record without zod – the production build pays nothing for the check', () => {
    const raw = { id: 'axt', name: { de: 'Axt', en: 'Axe' }, tier: 2, tags: ['b'] };
    const r = checkContent(tool, raw, 'vertraut');
    expect(r.success && r.data).toBe(raw);
    // No zod ran: a record the full mode rejects passes unseen (the full mode of `npm run check` is what keeps it out).
    const unchecked = { id: 'x', tier: 'zwei' };
    const t = checkContent(tool, unchecked, 'vertraut');
    expect(t.success && t.data).toBe(unchecked);
  });

  it("a shaping schema is parsed in both modes; its frozen result – a group definition's – is not parsed again", () => {
    for (const mode of ['voll', 'vertraut'] as const) {
      const first = checkContent(withDefault, { id: 'a' }, mode);
      expect(first.success).toBe(true);
      if (!first.success) continue;
      expect(first.data).toEqual({ id: 'a', count: 1 });
      deepFreeze(first.data);
      const again = checkContent(withDefault, first.data, mode);
      expect(again.success && again.data).toBe(first.data);
    }
    // The full mode parses a frozen record once more: one that misses its default was frozen unchecked.
    const unchecked = checkContent(withDefault, deepFreeze({ id: 'c' }), 'voll');
    expect(unchecked.success).toBe(false);
    if (!unchecked.success) expect(unchecked.error.issues[0]?.path).toEqual(['count']);
    // A transform that is not idempotent cannot have its result checked again (the full mode finds it).
    const once = checkContent(doubled, { id: 'b', n: 2 }, 'voll');
    expect(once.success && once.data).toEqual({ id: 'b', n: 4 });
    if (once.success) expect(checkContent(doubled, deepFreeze(once.data), 'voll').success).toBe(false);
  });

  it('compares content up to key order, telling a missing key from one set to undefined', () => {
    expect(contentDifference({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBeNull();
    expect(contentDifference({ a: 1, b: undefined }, { a: 1 })).toEqual(['b']);
    expect(contentDifference({ a: [1, 2] }, { a: [1] })).toEqual(['a']);
    expect(contentDifference({ a: { b: 1 } }, { a: { b: 2 } })).toEqual(['a', 'b']);
    expect(contentDifference(new Map([[1, 'a']]), new Map([[1, 'b']]))).toEqual([0, 1]);
  });

  it('the game registry holds the authored records themselves – content once on the heap, no checked copy', () => {
    const gruenhain = BIOMES.find((b) => b.id === 'gruenhain');
    expect(gruenhain).toBeDefined();
    expect(CONTENT.get('biomes', 'gruenhain')).toBe(gruenhain);
    // Items pass their group's check and the registry's without a copy.
    const axe = ITEMS[0];
    expect(axe).toBeDefined();
    if (axe !== undefined) expect(CONTENT.get('items', axe.id)).toBe(axe);
  });
});
