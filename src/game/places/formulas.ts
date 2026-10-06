/**
 * Pure rules of the places (docs/SPIEL.md §18, MASTERPROMPT §21; M7-07): the discovery radius, the guards that come back,
 * and the loot of a chest or a dig site – drawn from `hash(seed, place, key)`, so the same chest of the same world yields the
 * same loot whenever it is opened (docs/SPIEL.md §28 "Beute von Orts- und Gewölbetruhen").
 */
import { BALANCE } from '../../content/balance';
import type { PlaceLootDef } from '../../content/places/schema';
import { hashCombine, hashString, Rng } from '../../engine/rng';

const P = BALANCE.places;

/** Salt of the chest loot draws. */
const LOOT_SALT = hashString('ort.beute');

/** Discovery radius of a place [tiles]: the location type's, else the slot's radius plus `BALANCE.places.discoverExtraTiles`. */
export function discoveryRadius(entdeckungTiles: number | undefined, slotRadius: number): number {
  return entdeckungTiles ?? slotRadius + P.discoverExtraTiles;
}

/** Guards that come back after the cleansing (§21 "teilweise"): `returnShare` of all, rounded up, at least one of a guarded place. */
export function returningGuards(total: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(P.returnShare * total));
}

/** Tick from which guards come back after a cleansing at `cleansedTick` [ticks]. */
export function returnTickOf(cleansedTick: number, ticksPerDay: number): number {
  return cleansedTick + P.returnDays * ticksPerDay;
}

/** The random generator of one loot draw of a place: seeded from (world seed, place, key) only. */
export function lootRng(seed: number, place: number, key: number): Rng {
  return new Rng(hashCombine(hashCombine(hashCombine(seed >>> 0, LOOT_SALT), place), key));
}

/** Uniform integer in [min, max]. */
function inRange(rng: Rng, range: readonly [number, number]): number {
  return range[0] === range[1] ? range[0] : rng.int(range[0], range[1] + 1);
}

/** One piece of place loot. */
export interface PlaceLootDrop {
  item: string;
  count: number;
}

/**
 * The loot of a place's chest or cache: the guaranteed pieces, then `ziehungen` weighted draws among the entries (each with a
 * count in its range); the same item twice adds up. Appends to `out` and returns it.
 */
export function drawPlaceLoot(table: PlaceLootDef, rng: Rng, out: PlaceLootDrop[] = []): PlaceLootDrop[] {
  const add = (item: string, count: number): void => {
    const have = out.find((o) => o.item === item);
    if (have === undefined) out.push({ item, count });
    else have.count += count;
  };
  for (const g of table.garantiert ?? []) add(g.item, g.anzahl);
  const draws = inRange(rng, table.ziehungen);
  for (let d = 0; d < draws; d++) {
    const e = rng.weighted(table.beute, (x) => x.gewicht);
    add(e.item, inRange(rng, e.anzahl));
  }
  return out;
}

/** Loot table id of a place's chest or cache of tier `stufe` (`ort_<ortstyp>_<stufe>`, docs/SPIEL.md §29). */
export function placeLootId(ortstyp: string, stufe: number): string {
  return `ort_${ortstyp}_${stufe}`;
}

/** Tier of a chest or cache from its mark data (`'1'` … `'3'`); 1 without. */
export function markTier(data: string): number {
  const n = Number.parseInt(data, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
