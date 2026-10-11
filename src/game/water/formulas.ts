/**
 * The rules of water as pure functions (MASTERPROMPT §18 "Wasser … Regensammler, … Trinkschlauch (5 Schlucke)"; docs/SPIEL.md
 * §21 "Wasser", §28 "water: Regensammler füllen je Tag aus regenMinuten"; M7-30; tests/unit/game/wasser.test.ts).
 *
 * - **Rain collector**: at every 06:00 a collector under the open sky gains the rain minutes of the farm day that ended (the
 *   climate log's `rainMinutes` of its weather region), up to `BALANCE.water.collector.capacityMinutes`; a sip, a skin's charge
 *   or a bucket's sip takes `minutesPerSip`. Whole minutes: every fill and every draw is exact, so a frozen collector catching up
 *   day by day ends with the same water as one that stayed active.
 * - **Vessels** (water skin, bucket of boiled water; block `ladungen`): their sips in `daten.ladungen`, the fever risk of the
 *   water inside in `daten.fieber` (river and lake water stays unfiltered; a collector's water and boiled water are clean).
 *   A skin without `daten.ladungen` is empty; boiled water without it is full (fresh from the fire).
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import type { ItemStack } from '../items/stack';

const W = BALANCE.water;
/** Data keys of a vessel's water (shared with the watering can's `ladungen`, src/game/farming). */
export const CHARGES_KEY = 'ladungen';
export const FEVER_KEY = 'fieber';
/** The vessel that is full when it has no charges written: boiled water comes full from the fire (src/content/items/wasser.ts). */
export const BOILED_WATER = 'wasser_abgekocht';
/** What a bucket of boiled water becomes when it is drunk empty, and what a collector fills to boiled water. */
export const EMPTY_BUCKET = 'holzeimer';

/** Water of a collector after the rain of one day [rain minutes]: at most the capacity. */
export function filledCollector(fill: number, rainMinutes: number): number {
  const n = fill + rainMinutes;
  return n < W.collector.capacityMinutes ? n : W.collector.capacityMinutes;
}

/** Sips a collector holds [sips]. */
export function collectorSips(fill: number): number {
  return Math.floor(fill / W.collector.minutesPerSip);
}

/** Whether `def` is a water vessel of the kitchen (block `ladungen` holding water, not the watering can). */
export function isVessel(def: Pick<ItemDef, 'ladungen' | 'werkzeug'>): boolean {
  return def.ladungen?.inhalt === 'wasser' && def.werkzeug?.art === 'eimer';
}

/** Sips in a vessel stack [sips]: `daten.ladungen`; boiled water without it is full, a skin empty. */
export function vesselSips(stack: ItemStack, def: Pick<ItemDef, 'id' | 'ladungen'>): number {
  const n = stack.daten?.[CHARGES_KEY];
  if (typeof n === 'number') return n;
  return def.id === BOILED_WATER ? (def.ladungen?.max ?? 0) : 0;
}

/** Fever risk of the water in a vessel [probability] (0 for clean water). */
export function vesselFever(stack: ItemStack): number {
  const f = stack.daten?.[FEVER_KEY];
  return typeof f === 'number' ? f : 0;
}

/** A vessel with `sips` sips of water of fever risk `fever` (0: clean, the key is left out). */
export function withWater(stack: ItemStack, sips: number, fever: number): ItemStack {
  const daten: Record<string, string | number | boolean> = { ...(stack.daten ?? {}), [CHARGES_KEY]: sips };
  if (fever > 0) daten[FEVER_KEY] = fever;
  else delete daten[FEVER_KEY];
  return { ...stack, daten };
}

/**
 * Fever risk of a vessel after filling it with water of risk `fever` [probability]: the new water's risk when it was empty,
 * else the worse of both (a sip of river water spoils clean water).
 */
export function mixedFever(sipsBefore: number, feverBefore: number, fever: number): number {
  if (sipsBefore <= 0) return fever;
  return feverBefore > fever ? feverBefore : fever;
}
