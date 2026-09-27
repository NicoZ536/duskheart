/**
 * Pure rules of the hearth fire (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)"; M4-20): how long its fuel burns, how far
 * its base reaches with its ember cores, and how it burns from one tick to another – exactly, in whole ticks, so
 * advancing a → c equals a → b, then b → c (§16.5 "Brennstoffverbrauch holt in entladenen Chunks analytisch auf").
 */
import { BALANCE } from '../../content/balance';
import { TILE_PX } from '../../world/model/coords';
import { withCount, type ItemStack } from '../items/stack';
import type { Hearth } from './state';

const H = BALANCE.hearth;

/** Burn time of one piece of `item` in a world whose game hour lasts `ticksPerGameHour` ticks [ticks]; 0 when it is no hearth fuel. */
export function hearthFuelTicks(item: string, ticksPerGameHour: number): number {
  const hours = H.fuelGameHours[item];
  return hours === undefined ? 0 : Math.round(hours * ticksPerGameHour);
}

/** Pieces in the fuel store [pieces]. */
export function storedPieces(vorrat: readonly ItemStack[]): number {
  let n = 0;
  for (const s of vorrat) n += s.count;
  return n;
}

/** Radius of the base with `cores` ember cores set [tiles] (§16.5 "Radius 12 … bis 40"). */
export function radiusForCores(cores: number): number {
  const table = H.radiusByCores;
  return table[Math.max(0, Math.min(cores, table.length - 1))] as number;
}

/** Ember cores set in the niches. */
export function coreCount(kerne: readonly (string | null)[]): number {
  let n = 0;
  for (const k of kerne) if (k !== null) n++;
  return n;
}

/** Centre of a hearth's footprint [world px] into `out`. */
export function hearthCentre(h: Pick<Hearth, 'tx' | 'ty' | 'w' | 'h'>, out: { x: number; y: number }): { x: number; y: number } {
  out.x = (h.tx + h.w / 2) * TILE_PX;
  out.y = (h.ty + h.h / 2) * TILE_PX;
  return out;
}

/** Ticks of burning left in a hearth: the piece burning now plus the whole store [ticks]. */
export function burnLeft(h: Pick<Hearth, 'rest' | 'vorrat'>, fuelTicks: (item: string) => number): number {
  let t = h.rest;
  for (const s of h.vorrat) t += s.count * fuelTicks(s.item);
  return t;
}

/**
 * Whether the hearth burns at tick `tick` (≥ its `bis`), without advancing it: lit, and the fuel it holds outlasts
 * the ticks since `bis`. A frozen hearth answers what it would be after catching up.
 */
export function litAt(h: Pick<Hearth, 'lit' | 'rest' | 'vorrat' | 'bis'>, tick: number, fuelTicks: (item: string) => number): boolean {
  return h.lit && tick - h.bis < burnLeft(h, fuelTicks);
}

/** Takes the next fuel piece out of the store into the fire; false when the store is empty. */
export function takePiece(h: Hearth, fuelTicks: (item: string) => number): boolean {
  const first = h.vorrat[0];
  if (first === undefined) return false;
  if (first.count > 1) h.vorrat[0] = withCount(first, first.count - 1);
  else h.vorrat.shift();
  h.rest = fuelTicks(first.item);
  h.voll = h.rest;
  return true;
}

/** Hears a loudly advanced hearth go out (its fuel ran out) at tick `tick`. */
export type HearthOutListener = (tick: number) => void;

/**
 * Advances hearth `h` to tick `to` (mutates it): a lit hearth burns its piece tick by tick and takes the next one from
 * the store the moment it is used up; with an empty store it goes out (`onOut` with the tick). Linear in the pieces
 * burned, exact in ticks: a → c equals a → b → c.
 */
export function advanceHearth(h: Hearth, to: number, fuelTicks: (item: string) => number, onOut?: HearthOutListener): void {
  let n = to - h.bis;
  if (n <= 0) return;
  h.bis = to;
  for (;;) {
    if (!h.lit) return;
    if (h.rest === 0 && !takePiece(h, fuelTicks)) {
      h.lit = false;
      h.voll = 0;
      onOut?.(to - n);
      return;
    }
    if (n === 0) return;
    const d = Math.min(n, h.rest);
    h.rest -= d;
    n -= d;
  }
}
