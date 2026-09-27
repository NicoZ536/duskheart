/**
 * State of the hearth fires (MASTERPROMPT §16.5; M4-20) and its save form (participant `hearth`).
 *
 * - `hearths`: every hearth on the build grid – id, anchor tile (north-west tile of its 3 × 3 ring), layer, footprint,
 *   whether it burns (`lit`), the fuel piece burning now (`rest` ticks left of `voll`; 0 = none), the fuel store
 *   (`vorrat`: stacks in the order they burn, at most `BALANCE.hearth.storePieces` pieces), the six ember core niches
 *   (`kerne`: the core item set there, or `null`) and `bis`, the tick it is advanced to (exclusive).
 *   Hearths in active chunks burn every tick; frozen ones catch up from `bis` when their chunk activates
 *   (§16.5 "Brennstoffverbrauch holt in entladenen Chunks analytisch auf", M4-20).
 * - `nextId`: id of the next hearth (ids start at 1, never reused).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import type { Layer } from '../../world/model/coords';
import { copyStack } from '../inventory/snapshot';
import { itemStackSchema, type ItemStack } from '../items/stack';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
/** Number of ember core niches. */
export const CORE_NICHES = BALANCE.hearth.coreItems.length;
const SIDE_MAX = BALANCE.building.maxObjectSide;

/** A hearth fire. */
export interface Hearth {
  readonly id: number;
  readonly layer: Layer;
  /** Anchor tile: the north-west tile of the footprint. */
  readonly tx: number;
  readonly ty: number;
  /** Footprint [tiles]. */
  readonly w: number;
  readonly h: number;
  /** Whether it burns. */
  lit: boolean;
  /** Ticks left of the fuel piece burning now (0 = none). */
  rest: number;
  /** Ticks that piece gave (0 = none). */
  voll: number;
  /** The fuel store, in the order it burns. */
  readonly vorrat: ItemStack[];
  /** The ember core in each niche, or `null`. */
  readonly kerne: (string | null)[];
  /** Tick it is advanced to (exclusive). */
  bis: number;
}

/** State of the hearth system. */
export interface HearthState {
  readonly hearths: Hearth[];
  nextId: number;
}

/** An empty state. */
export function createHearthState(): HearthState {
  return { hearths: [], nextId: 1 };
}

const ticks = z.number().int().min(0);
const side = z.number().int().min(1).max(SIDE_MAX);

/** Saved form of the hearth state. */
export const hearthSnapshotSchema = z
  .object({
    hearths: z.array(
      z
        .object({
          id: z.number().int().min(1),
          layer: z.number().int().min(LAYER_MIN).max(0),
          tx: z.number().int().min(0),
          ty: z.number().int().min(0),
          w: side,
          h: side,
          lit: z.boolean(),
          rest: ticks,
          voll: ticks,
          vorrat: z.array(itemStackSchema).max(BALANCE.hearth.storePieces),
          kerne: z.array(idSchema.nullable()).length(CORE_NICHES),
          bis: ticks,
        })
        .strict(),
    ),
    nextId: z.number().int().min(1),
  })
  .strict();

/** A deep copy. */
export function copyHearthState(s: HearthState): HearthState {
  return {
    hearths: s.hearths.map((h) => ({ ...h, vorrat: h.vorrat.map(copyStack), kerne: [...h.kerne] })),
    nextId: s.nextId,
  };
}
