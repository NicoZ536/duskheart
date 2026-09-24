/**
 * Pure formulas of the light sources (MASTERPROMPT §12.2, §10 Wetterwirkung, §15.4; M3-22).
 *
 * - **Torches** burn `burnGameHours` game hours at normal speed, twice as fast in rain; in heavy rain every
 *   full minute of burning rolls the 5 % chance to go out (`advanceTorch`). The roll of the k-th
 *   heavy-rain minute of a torch is a hash of (world seed, torch, k) – no random stream, so a torch in a
 *   frozen chunk that catches up rolls exactly what a ticking one rolled.
 * - **Fires** burn their fuel (§15.4, at most 6 minutes), then glow as embers, then are ash
 *   (`advanceFire`); their visible state picks the sprite clip (`fireClip`).
 * - **Nebenhand rule** (§12.2): the light in the off hand hangs on the belt with a two-handed weapon in the
 *   main hand; with a shield in the off hand the first torch of the hotbar hangs there (`findCarriedLight`);
 *   on the belt the radius is 60 % (`carriedRadiusPx`).
 * Integer tick arithmetic wherever state changes, so advancing in one step or in many gives the same state.
 */
import { BALANCE } from '../../content/balance';
import { lightKindOfItem, type FireClip, type LightKind } from '../../content/lights';
import type { ItemDef } from '../../content/schema/item';
import { hash3, hashToUnit } from '../../engine/rng';
import { TILE_PX } from '../../world/model/coords';
import type { BagsState } from '../inventory/bags';
import type { ItemCatalog } from '../items/catalog';
import { equipmentRef, type SlotRef } from '../items/slots';
import type { ItemStack } from '../items/stack';
import type { Facing } from '../player/state';
import type { CarryMode, FireBurn, RainClass, TorchBurn } from './state';

const L = BALANCE.light;
const TICK_HZ = BALANCE.time.tickHz;

/** Stack data key of a torch's remaining burn time [ticks at normal speed]; absent on a fresh torch. */
export const BURN_REST_KEY = 'brennrest';

// ---------------------------------------------------------------------------------------------
// Torches
// ---------------------------------------------------------------------------------------------

/** Burn time of a fresh torch [ticks] in a world whose game hour lasts `ticksPerGameHour` ticks (§12.2 "4 Spielstunden"). */
export function torchBurnTicks(ticksPerGameHour: number): number {
  return Math.round(L.torch.burnGameHours * ticksPerGameHour);
}

/** Rain class of falling rain with precipitation `p` [0–1] (snow and ash do not douse: pass 0). */
export function rainClass(p: number): RainClass {
  if (p >= L.torch.heavyRainFromPrecipitation) return 'starkregen';
  return p >= L.torch.rainFromPrecipitation ? 'regen' : 'trocken';
}

/** Burn speed of a torch [burn ticks per tick]: 1 dry, 2 in rain (§10 "Regen halbiert die Brenndauer"). */
export function torchBurnRate(rain: RainClass): number {
  return rain === 'trocken' ? 1 : L.torch.rainBurnFactor;
}

/** Heavy-rain ticks between two rolls [ticks] (§10 "5 % … pro Minute"). */
export const HEAVY_RAIN_ROLL_TICKS = Math.round(L.torch.heavyRainRollSeconds * TICK_HZ);

/** Whether the `k`-th heavy-rain minute (k ≥ 1) of torch (`key`, `serial`) puts it out, for world seed `seed`. */
export function heavyRainPutsOut(seed: number, key: number, serial: number, k: number): boolean {
  return hashToUnit(hash3(key, serial, k, seed)) < L.torch.heavyRainExtinguishChance;
}

/** Why a light went out while it was advanced. */
export type BurnEndReason = 'abgebrannt' | 'regen';

/** The end of a torch or fire inside an advanced interval. */
export interface BurnEnd {
  readonly reason: BurnEndReason;
  /** Tick it went out. */
  readonly tick: number;
}

/**
 * Advances a torch to tick `to` (mutates `b`): a lit torch burns `torchBurnRate(rain)` burn ticks per
 * tick; in heavy rain every full `rollTicks` of burning asks `putsOut(k)` for the k-th roll. Returns how
 * and when it went out inside the interval, or `null`. Linear: advancing a → c equals a → b → c.
 */
export function advanceTorch(b: TorchBurn, to: number, putsOut: (k: number) => boolean, rollTicks: number = HEAVY_RAIN_ROLL_TICKS): BurnEnd | null {
  if (to <= b.at) return null;
  if (!b.lit) {
    b.at = to;
    return null;
  }
  const rate = torchBurnRate(b.rain);
  const heavy = b.rain === 'starkregen';
  while (b.at < to) {
    let n = to - b.at;
    const untilOut = Math.ceil(b.rest / rate);
    if (untilOut < n) n = untilOut;
    if (heavy) {
      const untilRoll = rollTicks - (b.heavyTicks % rollTicks);
      if (untilRoll < n) n = untilRoll;
    }
    b.rest = Math.max(0, b.rest - n * rate);
    b.at += n;
    if (heavy) b.heavyTicks += n;
    if (b.rest <= 0) return endTorch(b, to, 'abgebrannt');
    if (heavy && b.heavyTicks % rollTicks === 0 && putsOut(b.heavyTicks / rollTicks)) return endTorch(b, to, 'regen');
  }
  return null;
}

function endTorch(b: TorchBurn, to: number, reason: BurnEndReason): BurnEnd {
  const tick = b.at;
  b.lit = false;
  b.at = to;
  return { reason, tick };
}

/** Remaining burn time of a torch [s of normal burning] (display: the HUD's off-hand timer). */
export function torchRestSeconds(b: TorchBurn): number {
  return b.rest / TICK_HZ;
}

// ---------------------------------------------------------------------------------------------
// Fires
// ---------------------------------------------------------------------------------------------

/** Most fuel a camp fire holds [ticks] (§15.4 "höchstens 6 Minuten"). */
export const FIRE_MAX_FUEL_TICKS = Math.round(L.campfire.maxFuelSeconds * TICK_HZ);
/** Embers after the fuel ran out [ticks]. */
export const FIRE_EMBER_TICKS = Math.round(L.campfire.emberSeconds * TICK_HZ);
/** Fuel below which a fire burns low [ticks]. */
export const FIRE_WEAK_TICKS = Math.round(L.campfire.weakBelowSeconds * TICK_HZ);

/** What happened to a fire inside an advanced interval (the last change). */
export type FireChange = 'none' | 'embers' | 'ash';

/**
 * Advances a fire to tick `to` (mutates `f`): a lit fire burns one tick of fuel per tick; out of fuel it
 * glows `emberTicks` as embers, then it is ash. Returns the last change inside the interval. Linear.
 */
export function advanceFire(f: FireBurn, to: number, emberTicks: number = FIRE_EMBER_TICKS): FireChange {
  if (to <= f.at) return 'none';
  let n = to - f.at;
  let change: FireChange = 'none';
  if (f.lit) {
    if (f.fuel > n) {
      f.fuel -= n;
      f.at = to;
      return 'none';
    }
    n -= f.fuel;
    f.fuel = 0;
    f.lit = false;
    f.embers = emberTicks;
    change = 'embers';
  }
  if (f.embers > 0) {
    if (f.embers > n) f.embers -= n;
    else {
      f.embers = 0;
      change = 'ash';
    }
  }
  f.at = to;
  return change;
}

/** Visible state of a fire (the sprite clip of `lagerfeuer`). */
export function fireClip(f: FireBurn): FireClip {
  if (f.lit) return f.fuel >= FIRE_WEAK_TICKS ? 'brennt' : 'schwach';
  if (f.embers > 0) return 'glut';
  return f.burned ? 'asche' : 'aus';
}

/** Items of burn time `burnTicks` each that fit into a fire holding `fuel` ticks, at most `wanted` [items]. */
export function fuelItemsThatFit(fuel: number, burnTicks: number, wanted: number, max: number = FIRE_MAX_FUEL_TICKS): number {
  if (!(burnTicks > 0) || wanted < 1) return 0;
  const room = Math.floor((max - fuel) / burnTicks);
  return room < 0 ? 0 : Math.min(room, wanted);
}

/** Burn time of one fuel item with brennwert `seconds` [ticks] (§15.4 real seconds). */
export function fuelTicks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** Light of a fire in its state: radius [px], brightness and flicker – or `null` when it gives none (cold, ash). */
export interface FireLightParams {
  readonly radiusPx: number;
  readonly intensity: number;
  readonly flicker: number;
}

const FIRE_FULL: FireLightParams = { radiusPx: L.campfire.radiusTiles * TILE_PX, intensity: L.campfire.intensity, flicker: L.campfire.flicker };
const FIRE_WEAK: FireLightParams = {
  radiusPx: L.campfire.radiusTiles * TILE_PX * L.campfire.weakRadiusFactor,
  intensity: L.campfire.intensity * L.campfire.weakIntensityFactor,
  flicker: L.campfire.flicker,
};
const FIRE_EMBERS: FireLightParams = { radiusPx: L.campfire.emberRadiusTiles * TILE_PX, intensity: L.campfire.emberIntensity, flicker: L.campfire.emberFlicker };

/** Light parameters of a fire's clip. */
export function fireLight(clip: FireClip): FireLightParams | null {
  switch (clip) {
    case 'brennt':
      return FIRE_FULL;
    case 'schwach':
      return FIRE_WEAK;
    case 'glut':
      return FIRE_EMBERS;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The carried light (Nebenhand rule)
// ---------------------------------------------------------------------------------------------

/** A light the player carries. */
export interface CarriedSlot {
  readonly ref: SlotRef;
  readonly stack: ItemStack;
  readonly kind: LightKind;
  readonly mode: CarryMode;
}

/** The carryable light kind of an item, or `undefined`. */
export function carriedKind(item: string): LightKind | undefined {
  const k = lightKindOfItem(item);
  return k !== undefined && k.getragen ? k : undefined;
}

/**
 * The light the player carries (§12.2): the light in the off hand – on the belt when the main hand (the
 * selected hotbar slot) holds a two-handed weapon; with a shield in the off hand (or a two-hander and no
 * light in the off hand) the first carryable light of the hotbar, on the belt. `null`: no light.
 */
export function findCarriedLight(bags: BagsState, catalog: ItemCatalog, twoHanded: (def: ItemDef) => boolean): CarriedSlot | null {
  const offRef = equipmentRef('nebenhand');
  const off = bags.ausruestung[offRef.index] ?? null;
  const main = bags.schnellleiste[bags.auswahl] ?? null;
  const mainTwoHanded = main !== null && twoHanded(catalog.get(main.item));
  if (off !== null) {
    const kind = carriedKind(off.item);
    if (kind !== undefined) return { ref: offRef, stack: off, kind, mode: mainTwoHanded ? 'guertel' : 'hand' };
  }
  const shield = off !== null && catalog.get(off.item).kategorie === 'schild';
  if (!shield && !mainTwoHanded) return null;
  for (let index = 0; index < bags.schnellleiste.length; index++) {
    const s = bags.schnellleiste[index] ?? null;
    if (s === null) continue;
    const kind = carriedKind(s.item);
    if (kind !== undefined) return { ref: { bereich: 'schnellleiste', index }, stack: s, kind, mode: 'guertel' };
  }
  return null;
}

/** Remaining burn time a torch stack carries [ticks], or `null` for a fresh torch. */
export function burnRestOf(stack: ItemStack): number | null {
  const v = stack.daten?.[BURN_REST_KEY];
  return typeof v === 'number' ? v : null;
}

/** The torch stack with remaining burn time `rest` [ticks] (a full torch carries no data: it stacks with fresh ones). */
export function withBurnRest(stack: ItemStack, rest: number, full: number): ItemStack {
  const daten: Record<string, string | number | boolean> = { ...stack.daten };
  if (rest >= full) delete daten[BURN_REST_KEY];
  else daten[BURN_REST_KEY] = rest;
  const next: { -readonly [K in keyof ItemStack]: ItemStack[K] } = { ...stack };
  if (Object.keys(daten).length === 0) delete next.daten;
  else next.daten = daten;
  return next;
}

/** Radius of a carried torch [px] (§12.2: 6 tiles, on the belt −40 %). */
export function carriedRadiusPx(mode: CarryMode): number {
  return L.torch.radiusTiles * TILE_PX * (mode === 'guertel' ? L.offhand.beltRadiusFactor : 1);
}

/** Offset of the hand light from the feet [px] by facing: the off hand holds it a little in front of the body. */
export function handLightOffset(facing: Facing, out: { dx: number; dy: number }): { dx: number; dy: number } {
  const r = L.torch.handReachPx;
  out.dx = facing === 'left' ? -r : facing === 'right' ? r : 0;
  out.dy = facing === 'up' ? -r : facing === 'down' ? r : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------------------------

/** Whether tile (tx, ty) lies within `reachTiles` of world px (x, y), measured to the nearest point of the tile. */
export function tileInReach(x: number, y: number, tx: number, ty: number, reachTiles: number): boolean {
  const x0 = tx * TILE_PX;
  const y0 = ty * TILE_PX;
  const nx = x < x0 ? x0 : x > x0 + TILE_PX ? x0 + TILE_PX : x;
  const ny = y < y0 ? y0 : y > y0 + TILE_PX ? y0 + TILE_PX : y;
  const dx = x - nx;
  const dy = y - ny;
  const r = reachTiles * TILE_PX;
  return dx * dx + dy * dy <= r * r;
}
