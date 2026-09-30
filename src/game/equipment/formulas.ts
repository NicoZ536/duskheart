/**
 * Pure equipment formulas (M3-03; MASTERPROMPT §11.2, §11.4, §13.1; tests/unit/game/ausruestung.test.ts).
 *
 * - Stat aggregation: every worn piece that is not broken adds its `werte` × quality factor (§13.1
 *   "+10 % bzw. +20 % auf Werte"); sums are clamped to `BALANCE.items.statLimits` (§11.2 isolation
 *   0–40, cooling 0–15; resistances at most 1).
 * - Armour weight: the heaviest worn armour piece decides (§11.4) – broken armour gives no stats but
 *   still weighs.
 * - Durability: a use costs durability; at 0 the piece is broken – unusable until repaired, never
 *   destroyed (§13.1 "Kaputt = unbenutzbar, nie zerstört").
 * - Set bonuses (§13.1 "Rüstungssets mit Set-Boni", M6-12; sets src/content/ruestungssets.ts): every set whose worn,
 *   unbroken pieces reach a bonus's `teile` adds that bonus's `werte` (bonuses stack up to the pieces worn) – before
 *   the limits are applied; `sets` lists the sets with at least one piece worn, for the inventory's stat panel.
 */
import { BALANCE } from '../../content/balance';
import type { ArmorSetDef } from '../../content/ruestungssets';
import { ARMOR_WEIGHT_CLASSES, ITEM_STATS, type ArmorWeightClass, type ItemDef, type ItemStat } from '../../content/schema/item';
import { qualityFactor, wornDurability } from '../items/formulas';
import { stackQuality, type ItemStack } from '../items/stack';

/** A worn piece: its item and its stack. */
export interface EquippedPiece {
  readonly def: ItemDef;
  readonly stack: ItemStack;
}

/** A set of which pieces are worn: how many count (unbroken) and how many of its bonuses apply. */
export interface WornSet {
  readonly id: string;
  /** Worn, unbroken pieces of the set. */
  readonly teile: number;
  /** Bonuses that apply (the first `boni` of the set's list). */
  readonly boni: number;
}

/** Aggregated stats of the worn equipment. */
export interface EquipmentStats {
  /** Sum per stat (0 when nothing contributes), set bonuses included, clamped to its limits. */
  readonly werte: Readonly<Record<ItemStat, number>>;
  /** Weight class of the heaviest worn armour piece, `null` without armour. */
  readonly ruestungsgewicht: ArmorWeightClass | null;
  /** Sets with at least one piece worn (content order). */
  readonly sets: readonly WornSet[];
}

/** Limits of aggregated stats (`BALANCE.items.statLimits`). */
export type StatLimits = Readonly<Partial<Record<ItemStat, { readonly min: number; readonly max: number }>>>;

/** Whether a piece is broken (durability used up). */
export function isBroken(stack: ItemStack): boolean {
  return stack.haltbarkeit === 0;
}

/** Whether a piece can be used (tools, weapons) or counts (armour): everything that is not broken. */
export function isUsable(stack: ItemStack): boolean {
  return !isBroken(stack);
}

/** `stack` after `uses` more uses and whether it just broke; pieces without durability do not wear. */
export function wearStack(stack: ItemStack, uses: number): { stack: ItemStack; broke: boolean } {
  if (stack.haltbarkeit === undefined || stack.haltbarkeit === 0 || uses <= 0) return { stack, broke: false };
  const left = wornDurability(stack.haltbarkeit, uses);
  return { stack: { ...stack, haltbarkeit: left }, broke: left === 0 };
}

/** The heavier of two weight classes. */
export function heavierWeight(a: ArmorWeightClass, b: ArmorWeightClass): ArmorWeightClass {
  return ARMOR_WEIGHT_CLASSES.indexOf(b) > ARMOR_WEIGHT_CLASSES.indexOf(a) ? b : a;
}

/** Weight class of the heaviest armour piece among `pieces` (broken pieces included), `null` without armour. */
export function heaviestArmorWeight(pieces: readonly EquippedPiece[]): ArmorWeightClass | null {
  let heaviest: ArmorWeightClass | null = null;
  for (const { def } of pieces) {
    if (def.ruestungsgewicht === undefined) continue;
    heaviest = heaviest === null ? def.ruestungsgewicht : heavierWeight(heaviest, def.ruestungsgewicht);
  }
  return heaviest;
}

/** A record with every stat at 0. */
export function zeroStats(): Record<ItemStat, number> {
  const out = {} as Record<ItemStat, number>;
  for (const stat of ITEM_STATS) out[stat] = 0;
  return out;
}

/**
 * The sets among the worn `pieces` and their bonuses: per set with at least one worn, unbroken piece, the pieces that count
 * and the bonuses reached; adds the reached bonuses' stats to `werte` (unscaled: a set bonus has no quality).
 */
export function setBonusStats(pieces: readonly EquippedPiece[], sets: readonly ArmorSetDef[], werte: Record<ItemStat, number>): WornSet[] {
  const out: WornSet[] = [];
  for (const set of sets) {
    let teile = 0;
    for (const { def, stack } of pieces) if (!isBroken(stack) && set.teile.includes(def.id)) teile++;
    if (teile === 0) continue;
    let boni = 0;
    for (const bonus of set.boni) {
      if (teile < bonus.teile) break;
      boni++;
      for (const stat of ITEM_STATS) {
        const value = bonus.werte[stat];
        if (value !== undefined) werte[stat] += value;
      }
    }
    out.push({ id: set.id, teile, boni });
  }
  return out;
}

/** Aggregates the stats of the worn `pieces` with the bonuses of `sets` (see module comment). */
export function aggregateEquipmentStats(pieces: readonly EquippedPiece[], limits: StatLimits = BALANCE.items.statLimits, sets: readonly ArmorSetDef[] = []): EquipmentStats {
  const werte = zeroStats();
  for (const { def, stack } of pieces) {
    if (isBroken(stack) || def.werte === undefined) continue;
    const factor = qualityFactor(stackQuality(stack));
    for (const stat of ITEM_STATS) {
      const value = def.werte[stat];
      if (value !== undefined) werte[stat] += value * factor;
    }
  }
  const worn = setBonusStats(pieces, sets, werte);
  for (const stat of ITEM_STATS) {
    const limit = limits[stat];
    if (limit === undefined) continue;
    const v = werte[stat];
    werte[stat] = v < limit.min ? limit.min : v > limit.max ? limit.max : v;
  }
  return { werte, ruestungsgewicht: heaviestArmorWeight(pieces), sets: worn };
}
