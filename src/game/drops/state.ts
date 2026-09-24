/**
 * The `drop` component (docs/SPIEL.md §3 "nur bewegliche/aktive Dinge (Drops …) sind ECS-Entitäten"):
 * an item stack lying in (or flying through) the world. Its position lives in the component itself –
 * drops never walk, the motion system does not move them. Saved by the participant `drops`.
 */
import { z } from 'zod';
import { itemStackSchema, type ItemStack } from '../items/stack';
import type { Layer } from '../../world/model/coords';

/** ECS component name of dropped items. */
export const DROP_COMPONENT = 'drop';

/** One dropped stack. */
export interface DropState {
  stack: ItemStack;
  layer: Layer;
  /** Position [world px] after the last tick and at its start (the presentation interpolates). */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** Flight from the source to the landing spot [world px]; `flightTotal` 0 = on the ground. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  flightTicks: number;
  flightTotal: number;
  /** Ticks the landed drop still lies still before the magnet may take it. */
  settleTicks: number;
  /** Tick at which an untouched drop disappears. */
  expiresAtTick: number;
  /** The magnet pulls it towards the player. */
  pulled: boolean;
  /** "Bags full" was reported while the player stood in its magnet radius (reported once per approach). */
  blocked: boolean;
}

const ticks = z.number().int().min(0);
/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** Saved form of a drop (participant `drops`, version 1). */
export const dropStateSchema = z
  .object({
    stack: itemStackSchema,
    layer: z.number().int().min(LAYER_MIN).max(0),
    x: z.number(),
    y: z.number(),
    prevX: z.number(),
    prevY: z.number(),
    fromX: z.number(),
    fromY: z.number(),
    toX: z.number(),
    toY: z.number(),
    flightTicks: ticks,
    flightTotal: ticks,
    settleTicks: ticks,
    expiresAtTick: ticks,
    pulled: z.boolean(),
    blocked: z.boolean(),
  })
  .strict()
  .refine((d) => d.flightTicks <= d.flightTotal, { message: 'flightTicks must not exceed flightTotal', path: ['flightTicks'] });

/** Whether the drop is still in the air. */
export function isFlying(d: DropState): boolean {
  return d.flightTicks < d.flightTotal;
}
