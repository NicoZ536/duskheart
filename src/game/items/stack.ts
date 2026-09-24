/**
 * Item stacks: the runtime form of items in bags (docs/SPIEL.md §2 "Laufzeit").
 *
 * `ItemStack = { item; count; haltbarkeit?; qualitaet? (1–3); frische? (0–100); daten? }` – plain,
 * immutable JSON data. Canonical form: optional fields are absent rather than `undefined`, and
 * `qualitaet` is only stored above 1 star, so equal stacks serialize identically.
 *
 * Two stacks join when item, quality and extra data agree and neither carries durability (pieces with
 * durability never stack, §13.1); their freshness is averaged by count.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import type { ItemDef } from '../../content/schema/item';
import { FRESHNESS_MAX, maxDurability, QUALITY_MAX, QUALITY_MIN, weightedFreshness } from './formulas';

/** Extra per-stack data (e.g. a named map, a remembered owner): flat and JSON-safe. */
export type ItemStackData = Readonly<Record<string, string | number | boolean>>;

/** Items of one kind in one slot. */
export interface ItemStack {
  readonly item: string;
  /** Number of items [≥ 1]. */
  readonly count: number;
  /** Remaining durability [uses]; only items with durability; 0 = broken. */
  readonly haltbarkeit?: number;
  /** Quality [stars 2–3]; absent = 1 star. */
  readonly qualitaet?: number;
  /** Freshness [percent 0–100]; only items with a shelf life. */
  readonly frische?: number;
  readonly daten?: ItemStackData;
}

/** Schema of a stack in saves and commands (shape only; `checkStack` checks it against its item). */
export const itemStackSchema = z
  .object({
    item: idSchema,
    count: z.number().int().min(1),
    haltbarkeit: z.number().int().min(0).optional(),
    qualitaet: z
      .number()
      .int()
      .min(QUALITY_MIN + 1)
      .max(QUALITY_MAX)
      .optional(),
    frische: z.number().min(0).max(FRESHNESS_MAX).optional(),
    daten: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

/** Quality of a stack [stars]. */
export function stackQuality(stack: ItemStack): number {
  return stack.qualitaet ?? QUALITY_MIN;
}

/** Options of a new stack. */
export interface NewStackOptions {
  /** Quality [stars 1–3]; default 1. */
  readonly qualitaet?: number;
  /** Freshness [percent]; default full for items with a shelf life. */
  readonly frische?: number;
  readonly daten?: ItemStackData;
}

/**
 * `count` new pieces of `def`: full durability for its quality, full freshness for food. `count` may
 * exceed the stack size – bags split such a stack over several slots.
 */
export function newStack(def: ItemDef, count: number, options: NewStackOptions = {}): ItemStack {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`stack count must be an integer ≥ 1, got ${count}`);
  const quality = options.qualitaet ?? QUALITY_MIN;
  const stack: { -readonly [K in keyof ItemStack]: ItemStack[K] } = { item: def.id, count };
  if (def.haltbarkeit !== undefined) stack.haltbarkeit = maxDurability(def.haltbarkeit, quality);
  if (quality !== QUALITY_MIN) stack.qualitaet = quality;
  if (def.frische !== undefined) stack.frische = options.frische ?? FRESHNESS_MAX;
  if (options.daten !== undefined) stack.daten = { ...options.daten };
  return stack;
}

/** The same stack with another count. */
export function withCount(stack: ItemStack, count: number): ItemStack {
  return { ...stack, count };
}

function sameData(a: ItemStackData | undefined, b: ItemStackData | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/** Whether two stacks may join into one slot (same item, quality and data; no durability). */
export function canStack(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.haltbarkeit === undefined && b.haltbarkeit === undefined && stackQuality(a) === stackQuality(b) && sameData(a.daten, b.daten);
}

/** `target` after `moved` items of `source` joined it; freshness becomes the count-weighted mean. */
export function joinedStack(target: ItemStack, source: ItemStack, moved: number): ItemStack {
  const count = target.count + moved;
  if (target.frische === undefined || source.frische === undefined) return withCount(target, count);
  return { ...target, count, frische: weightedFreshness(target.frische, target.count, source.frische, moved) };
}

/**
 * Why `stack` is not a valid stack of `def` in a slot holding at most `capacity` items, or `null`.
 * Checks count, durability (only durable items, at most the maximum of its quality) and freshness
 * (only items with a shelf life).
 */
export function checkStack(def: ItemDef, stack: ItemStack, capacity: number): string | null {
  if (stack.item !== def.id) return `stack of "${stack.item}" checked against item "${def.id}"`;
  if (stack.count > capacity) return `${stack.count} × "${def.id}" exceed the slot capacity ${capacity}`;
  if ((def.haltbarkeit === undefined) !== (stack.haltbarkeit === undefined)) {
    return def.haltbarkeit === undefined ? `"${def.id}" has no durability` : `"${def.id}" needs its durability`;
  }
  if (def.haltbarkeit !== undefined && stack.haltbarkeit !== undefined && stack.haltbarkeit > maxDurability(def.haltbarkeit, stackQuality(stack))) {
    return `durability ${stack.haltbarkeit} of "${def.id}" exceeds its maximum`;
  }
  if ((def.frische === undefined) !== (stack.frische === undefined)) {
    return def.frische === undefined ? `"${def.id}" does not spoil` : `"${def.id}" needs its freshness`;
  }
  return null;
}
