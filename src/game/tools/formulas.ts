/**
 * Pure rules of tools and of using items (MASTERPROMPT §13.2, §14, §D; M3-15, M3-16): mining power and
 * durability per tier, what the bucket becomes when poured out, which conditions an item cures. Whether a
 * power opens a hardness is the gathering rule `powerSuffices` (src/game/gathering/formulas.ts).
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import { wornDurability } from '../items/formulas';
import type { ItemStack } from '../items/stack';

/** Uses one pour costs a bucket (§D counts durability in uses: pouring out is one use). */
const POUR_USES = 1;

/** Mining power of a tool of tier `tier` [power] (§13.2: T0 1 … T7 8). */
export function toolPower(tier: number): number {
  const power = BALANCE.tools.miningPowerByTier[tier];
  if (power === undefined) throw new RangeError(`no tier T${tier}`);
  return power;
}

/** Durability of a piece of tier `tier` [uses] (§D: T0 60 … T7 1200). */
export function tierDurability(tier: number): number {
  const uses = BALANCE.items.durabilityByTier[tier];
  if (uses === undefined) throw new RangeError(`no tier T${tier}`);
  return uses;
}

/**
 * The empty bucket `empty` that a poured-out full bucket `full` becomes: the same bucket – quality kept,
 * worn by one use (pouring is the use; §D counts durability in uses), broken at 0.
 */
export function pouredBucket(full: ItemStack, empty: ItemDef): ItemStack {
  const stack: { -readonly [K in keyof ItemStack]: ItemStack[K] } = { item: empty.id, count: 1 };
  if (full.haltbarkeit !== undefined && empty.haltbarkeit !== undefined) stack.haltbarkeit = wornDurability(full.haltbarkeit, POUR_USES);
  if (full.qualitaet !== undefined) stack.qualitaet = full.qualitaet;
  return stack;
}

/** The conditions among `cures` that are active (`has`), in the order of `cures`. */
export function curable(cures: readonly string[], has: (id: string) => boolean): string[] {
  return cures.filter(has);
}
