/**
 * Pure formulas of harvesting (MASTERPROMPT §13.2, §14, §D; M3-11 … M3-14). Everything here is a
 * function of its arguments – no simulation, no random stream: the systems pass random numbers in.
 */
import { BALANCE, type SeasonId } from '../../content/balance';
import type { DropOccasion, WorldObjectDrop } from '../../content/worldObjects';
import { hash3, hashToUnit } from '../../engine/rng';
import { HOURS_PER_DAY, MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../engine/time';
import type { Layer } from '../../world/model/coords';

const HARVEST = BALANCE.harvest;

/**
 * Hits a resource takes (§D "Treffer = ⌈Ressourcen-HP / (Abbaukraft × (1 + Skillbonus))⌉"): `hp` hit
 * points [HP], `power` mining power of the tool (§13.2), `skillBonus` the skill's effect [fraction].
 * A Grünhain tree (HP 5) falls after 5 stone-axe hits (power 1) and 3 bronze-axe hits (power 2).
 */
export function hitsNeeded(hp: number, power: number, skillBonus = 0): number {
  if (!(power > 0)) throw new RangeError(`hitsNeeded: mining power must be positive, got ${power}`);
  if (hp <= 0) return 0;
  return Math.ceil(hp / (power * (1 + skillBonus)));
}

/** Damage one hit deals [HP]: the power scaled by the skill (§D). */
export function hitDamage(power: number, skillBonus = 0): number {
  return power * (1 + skillBonus);
}

/** Whether a tool of `power` opens a resource of `hardness` (§13.2 "Abbaukraft des Werkzeugs muss ≥ Härte der Ressource sein"). */
export function powerSuffices(power: number, hardness: number): boolean {
  return power >= hardness;
}

/** Hit points of the stump of a tree with `treeHp` [HP] (`BALANCE.harvest.stumpHpShare`, at least 1). */
export function stumpHp(treeHp: number): number {
  return Math.max(1, Math.ceil(treeHp * HARVEST.stumpHpShare));
}

/** Whether a drop falls in `season` (no season list = every season). */
export function dropInSeason(drop: WorldObjectDrop, season: SeasonId): boolean {
  return drop.jahreszeiten === undefined || drop.jahreszeiten.includes(season);
}

/**
 * Whether an object carries something for `occasion` in `season` (§14 "Beerensträucher (saisonal)"):
 * one of its seasonal drops is in season, or one of its drops without season falls every time. A berry
 * bush in winter only has the chance of a twig – it counts as bare; a hazel in winter still gives its twigs.
 */
export function isRipe(drops: readonly WorldObjectDrop[], occasion: DropOccasion, season: SeasonId): boolean {
  for (const d of drops) {
    if (d.anlass !== occasion) continue;
    if (d.jahreszeiten !== undefined ? d.jahreszeiten.includes(season) : (d.chance ?? 1) >= 1) return true;
  }
  return false;
}

/** Whether an object has any drop for `occasion`. */
export function hasDrops(drops: readonly WorldObjectDrop[] | undefined, occasion: DropOccasion): boolean {
  return drops !== undefined && drops.some((d) => d.anlass === occasion);
}

/** One rolled yield. */
export interface RolledDrop {
  readonly item: string;
  readonly count: number;
}

/**
 * Rolls the drops of `occasion` in `season`: every drop in season rolls its `chance` once, then yields
 * `min`–`max` pieces. `random()` returns uniform numbers in [0, 1) (a simulation stream). Drops of the
 * same item add up. Returns the yields in drop order.
 */
export function rollDrops(drops: readonly WorldObjectDrop[], occasion: DropOccasion, season: SeasonId, random: () => number): RolledDrop[] {
  const out: RolledDrop[] = [];
  for (const d of drops) {
    if (d.anlass !== occasion || !dropInSeason(d, season)) continue;
    const chance = d.chance ?? 1;
    if (chance < 1 && random() >= chance) continue;
    const count = d.min + Math.floor(random() * (d.max - d.min + 1));
    const same = out.findIndex((o) => o.item === d.item);
    if (same >= 0) out[same] = { item: d.item, count: (out[same] as RolledDrop).count + count };
    else out.push({ item: d.item, count });
  }
  return out;
}

/** Hours of a daily window [fromHour, toHour) that may wrap past midnight. */
export interface HourWindow {
  readonly fromHour: number;
  readonly toHour: number;
}

/** Whether `minuteOfDay` (0–1439) lies in `window`. */
export function inHourWindow(minuteOfDay: number, window: HourWindow): boolean {
  const from = window.fromHour * MINUTES_PER_HOUR;
  const to = window.toHour * MINUTES_PER_HOUR;
  return from <= to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

/**
 * Tick at which a harvested object is back (§14 "nachwachsend"): `days` game days after `nowTick`; with a
 * time window (mushrooms: "Pilze (Ort und Tageszeit)") the first tick from then on whose hour lies in the
 * window. `minuteOfDayNow` is the clock's minute of day at `nowTick`, `ticksPerDay` the length of a day.
 */
export function regrowTick(nowTick: number, days: number, ticksPerDay: number, minuteOfDayNow: number, window: HourWindow | null = null): number {
  const due = nowTick + Math.round(days * ticksPerDay);
  if (window === null) return due;
  const ticksPerMinute = ticksPerDay / MINUTES_PER_DAY;
  // Minute of day at `due` (whole days keep the minute; a fractional day shifts it).
  const dueMinute = (((minuteOfDayNow + (due - nowTick) / ticksPerMinute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (inHourWindow(Math.floor(dueMinute), window)) return due;
  const from = window.fromHour * MINUTES_PER_HOUR;
  const wait = (from - dueMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return due + Math.ceil(wait * ticksPerMinute);
}

/** Direction a felled tree falls (§14 "Der Baum fällt vom Spieler weg"), named like the trunk sprites (M3-11 art). */
export type FallDirection = 'rechts' | 'links' | 'nord' | 'sued';

/** Unit vector of each fall direction (tile axes, +y south). */
export const FALL_VECTORS: Readonly<Record<FallDirection, { readonly x: number; readonly y: number }>> = {
  rechts: { x: 1, y: 0 },
  links: { x: -1, y: 0 },
  nord: { x: 0, y: -1 },
  sued: { x: 0, y: 1 },
};

/**
 * Direction a tree falls when felled from (dx, dy) = tree − player: straight away from the player along
 * the larger axis; on an exact diagonal horizontally (the side views read best), from the tree's own
 * position (dx = dy = 0) to the east.
 */
export function fallDirection(dx: number, dy: number): FallDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'links' : 'rechts';
  return dy < 0 ? 'nord' : 'sued';
}

/** Salt of the dig spot hash (independent of every other per-tile hash of the world). */
const DIG_SPOT_SALT = 0x5b1d_d16c;

/**
 * Whether tile (tx, ty) of `layer` hides a dig spot in the world of `seed` (§14 "versteckte
 * Buddelstellen"): a hash of seed and tile below `BALANCE.harvest.dig.spotChance`. Only the surface has
 * them. Pure: spots are never stored.
 */
export function isDigSpot(seed: number, layer: Layer, tx: number, ty: number): boolean {
  if (layer !== 0) return false;
  return hashToUnit(hash3(tx, ty, DIG_SPOT_SALT, seed)) < HARVEST.dig.spotChance;
}

/** Ticks of a duration in seconds at `tickHz`, at least one tick. */
export function secondsToTicks(seconds: number, tickHz: number): number {
  return Math.max(1, Math.round(seconds * tickHz));
}

/** The game hour of a minute of the day. */
export function hourOfMinute(minuteOfDay: number): number {
  return Math.floor(minuteOfDay / MINUTES_PER_HOUR) % HOURS_PER_DAY;
}
