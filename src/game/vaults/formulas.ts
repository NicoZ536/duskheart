/**
 * Pure rules of the vaults at runtime (docs/SPIEL.md §19; M7-14, M7-16): the traps' timing and reach, the damage they deal, the
 * chests' loot draw, the unique blueprints of the end chests and the way a crate is pushed. No state, no simulation.
 */
import { BALANCE } from '../../content/balance';
import type { VaultTrapDef } from '../../content/dungeons/schema';
import type { Rng } from '../../engine/rng';
import type { VaultPlan, VaultTrapPlan } from '../../world/gen/vaults/types';
import { armorReduction, resistFactor, secondsToTicks } from '../combat/formulas';
import { lootRng } from '../places/formulas';

/** x, y steps of the four directions (0 north, 1 east, 2 south, 3 west) – the plan's `dir`, a push's direction. */
export const DIR_DX: readonly number[] = [0, 1, 0, -1];
export const DIR_DY: readonly number[] = [-1, 0, 1, 0];
const DIRECTIONS = DIR_DX.length;

/** Ticks a trap warns before it strikes (§4.6: at least `TRAP_TELEGRAPH_MIN` seconds, content-checked). */
export function trapWarnTicks(def: VaultTrapDef): number {
  return secondsToTicks(def.telegraphSekunden, 1);
}

/** Ticks after a strike until the trap can be triggered again: its cooldown, a boulder's way back (`resetSekunden`). */
export function trapRearmTicks(def: VaultTrapDef): number {
  return secondsToTicks(def.resetSekunden ?? def.abklingSekunden, 1);
}

/** Beat of a swinging trap (`takt`): warning and cooldown in turn [ticks]. */
export function trapBeatTicks(def: VaultTrapDef): number {
  return trapWarnTicks(def) + secondsToTicks(def.abklingSekunden, 1);
}

/** Phase of a swinging trap at `tick` [ticks into its beat]: its offset spreads neighbouring blades (a pure function of the tick). */
export function trapBeatPhase(tick: number, vault: number, trap: number, beat: number): number {
  const offset = (vault * BEAT_SPREAD_VAULT + trap * BEAT_SPREAD_TRAP) % beat;
  return (tick + offset) % beat;
}
/** Offsets of the beat per vault and per trap [ticks]: primes, so no two blades of a vault swing in step. */
const BEAT_SPREAD_VAULT = 13;
const BEAT_SPREAD_TRAP = 37;

/**
 * The tiles a trap senses (where a body triggers it): a plate (`platte`) its own tile; a dart thrower or a boulder (`naehe`) the
 * lane in its direction up to its reach; a blade (`takt`) none – it swings on its beat. Appended to `out` as tx, ty pairs.
 */
export function trapSenseTiles(def: VaultTrapDef, trap: VaultTrapPlan, out: number[]): void {
  out.length = 0;
  if (def.ausloeser === 'platte') out.push(trap.tx, trap.ty);
  else if (def.ausloeser === 'naehe') laneTiles(trap, out);
}

/**
 * The tiles a trap strikes: a plate trap its own tile; a dart thrower the lane (the dart stops at the first body); a boulder its
 * own tile and the lane it rolls down; a blade the three tiles of its arc across the lane. Appended to `out` as tx, ty pairs, in
 * the order a dart meets them.
 */
export function trapStrikeTiles(def: VaultTrapDef, trap: VaultTrapPlan, out: number[]): void {
  out.length = 0;
  if (def.ausloeser === 'platte') {
    out.push(trap.tx, trap.ty);
    return;
  }
  if (def.ausloeser === 'takt') {
    // Across the lane: the blade's arc swings over the trap's tile and its two neighbours.
    const across = (trap.dir + 1) % DIRECTIONS;
    const dx = DIR_DX[across] as number;
    const dy = DIR_DY[across] as number;
    out.push(trap.tx - dx, trap.ty - dy, trap.tx, trap.ty, trap.tx + dx, trap.ty + dy);
    return;
  }
  if (def.id === BOULDER) out.push(trap.tx, trap.ty);
  laneTiles(trap, out, false);
}
/** The trap whose strike rolls down the whole lane (its own tile included). */
const BOULDER = 'rollstein';

function laneTiles(trap: VaultTrapPlan, out: number[], clear = true): void {
  if (clear) out.length = 0;
  const dx = DIR_DX[trap.dir] as number;
  const dy = DIR_DY[trap.dir] as number;
  const reach = Math.min(trap.reach, BALANCE.vaults.trapLaneMaxTiles);
  for (let k = 1; k <= reach; k++) out.push(trap.tx + dx * k, trap.ty + dy * k);
}

/** Whether a trap's strike stops at the first body it meets (a dart). */
export function trapStopsAtFirst(def: VaultTrapDef): boolean {
  return def.ausloeser === 'naehe' && def.id !== BOULDER;
}

/** Damage of a trap on the player [HP]: its damage times the world's enemy damage factor (difficulty, §25). */
export function trapPlayerDamage(def: VaultTrapDef, enemyDamage: number): number {
  return def.schaden * enemyDamage;
}

/** Damage of a trap on a creature [HP] (§19.3: × (1 − resistance) × (1 − armour reduction)). */
export function trapCreatureDamage(def: VaultTrapDef, resist: number, armor: number): number {
  return def.schaden * resistFactor(resist) * (1 - armorReduction(armor));
}

/** Key of a vault chest in the loot draw (`hash(seed, vault, key)`, beside the places' chests 0 … and the dig site 1 000). */
export function vaultChestKey(chest: number): number {
  return VAULT_CHEST_KEY_BASE + chest;
}
const VAULT_CHEST_KEY_BASE = 2_000;

/** The loot stream of a vault chest. */
export function vaultChestRng(seed: number, vault: number, chest: number): Rng {
  return lootRng(seed, vault, vaultChestKey(chest));
}

/**
 * The unique blueprint of a vault's end chest (§21 "einzigartige Baupläne"): the blueprints of the list go to the planned vaults
 * in slot order, one each – every blueprint lies once in the world; vaults beyond the list hold none.
 */
export function uniqueBlueprintOf(plans: readonly VaultPlan[], slot: number, blueprints: readonly string[]): string | null {
  const order = plans.map((p) => p.slot).sort((a, b) => a - b);
  const k = order.indexOf(slot);
  return k < 0 ? null : (blueprints[k] ?? null);
}

/**
 * Direction of a push (0 north … 3 west) from the player's tile to the crate's tile: the player stands on one of its four
 * neighbours and pushes away from himself; −1 when he does not stand beside it.
 */
export function pushDirection(px: number, py: number, cx: number, cy: number): number {
  for (let d = 0; d < DIRECTIONS; d++) if (cx - px === DIR_DX[d] && cy - py === DIR_DY[d]) return d;
  return -1;
}
