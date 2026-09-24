/**
 * What the player is doing besides moving (MASTERPROMPT §11.4 "Aktionen"): eating or drinking in progress,
 * sitting on a seat, pieces thrown and still in the air. Saved by the participant `actions`.
 */
import { z } from 'zod';
import { idSchema } from '../../content/schema/common';
import { isEntityHandle, type Entity } from '../../engine/ecs';
import { itemStackSchema, type ItemStack } from '../items/stack';
import { slotRefSchema } from '../inventory/commands';
import type { SlotRef } from '../items/slots';
import { WATER_SOURCES, type WaterSource } from './formulas';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** Eating a piece or taking a sip. */
export interface Consumption {
  readonly kind: 'essen' | 'trinken';
  /** The eaten item (eating) or `null` (a sip of water). */
  readonly item: string | null;
  /** Slot the piece is taken from (eating). */
  readonly from: SlotRef | null;
  /** Water drunk from (drinking). */
  readonly water: WaterSource | null;
  /** Biome of that water (its fever risk, §18). */
  readonly biome: string | null;
  /** Ticks until it is done. */
  ticksLeft: number;
  readonly totalTicks: number;
}

/** A seat the player sits on (tree stumps, chairs; §11.4 "Sitzen"). */
export interface Seat {
  /** Position [world px]. */
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

/** A thrown piece in the air (an ECS entity with a position). */
export interface Throw {
  readonly entity: Entity;
  readonly stack: ItemStack;
  readonly layer: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** Elapsed and total flight [ticks]. */
  ticks: number;
  readonly totalTicks: number;
}

/** State of the actions. */
export interface ActionsState {
  consumption: Consumption | null;
  seat: Seat | null;
  throws: Throw[];
}

const layer = z.number().int().min(LAYER_MIN).max(0);
const ticks = z.number().int().min(0);

/** Saved actions (participant `actions`, version 1). */
export const actionsStateSchema = z
  .object({
    consumption: z
      .object({
        kind: z.enum(['essen', 'trinken']),
        item: idSchema.nullable(),
        from: slotRefSchema.nullable(),
        water: z.enum(WATER_SOURCES).nullable(),
        biome: idSchema.nullable(),
        ticksLeft: ticks,
        totalTicks: ticks.min(1),
      })
      .strict()
      .nullable(),
    seat: z.object({ x: z.number(), y: z.number(), layer }).strict().nullable(),
    throws: z.array(
      z
        .object({
          entity: z.number().int().refine(isEntityHandle, { message: 'must be an entity handle' }),
          stack: itemStackSchema,
          layer,
          fromX: z.number(),
          fromY: z.number(),
          toX: z.number(),
          toY: z.number(),
          ticks,
          totalTicks: ticks.min(1),
        })
        .strict(),
    ),
  })
  .strict();

/** Copy of the actions state (saves must not share the live objects). */
export function copyActionsState(s: ActionsState): ActionsState {
  return {
    consumption: s.consumption === null ? null : { ...s.consumption, from: s.consumption.from === null ? null : { ...s.consumption.from } },
    seat: s.seat === null ? null : { ...s.seat },
    throws: s.throws.map((t) => ({ ...t })),
  };
}
