/**
 * Commands of the light sources (MASTERPROMPT §12.2, §26 "F Licht an/aus"; M3-22), aggregated by
 * src/game/commands.ts:
 * - `light.toggle`: F – lights or snuffs the carried torch (off hand, or on the belt).
 * - `light.place {from, tx, ty}`: sets up the light item of a bag slot on a tile – a torch burns on its
 *   stake (or on the wall face north of the tile), a camp fire stands cold and empty.
 * - `light.fuel {light, from, count?}`: puts fuel (items with `brennwert`, §15.4) from a slot on a fire, as
 *   many pieces as fit (default: the whole stack).
 * - `light.ignite {tx, ty}`: lights the placed light on the tile; on any other tile a burning torch in hand
 *   sets flammable things alight (the hook `addFlammables`).
 * - `light.douse {light}`: puts a placed light out.
 * - `light.take {light}`: takes a placed torch back into the bags (with its remaining burn time).
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';

const lightId = z.number().int().min(1);
const tile = z.number().int();

export const lightToggleCommandSchema = z.object({ type: z.literal('light.toggle') }).strict();
export const lightPlaceCommandSchema = z.object({ type: z.literal('light.place'), from: slotRefSchema, tx: tile, ty: tile }).strict();
export const lightFuelCommandSchema = z.object({ type: z.literal('light.fuel'), light: lightId, from: slotRefSchema, count: z.number().int().min(1).optional() }).strict();
export const lightIgniteCommandSchema = z.object({ type: z.literal('light.ignite'), tx: tile, ty: tile }).strict();
export const lightDouseCommandSchema = z.object({ type: z.literal('light.douse'), light: lightId }).strict();
export const lightTakeCommandSchema = z.object({ type: z.literal('light.take'), light: lightId }).strict();

/** The light commands, in declaration order. */
export const LIGHT_COMMAND_SCHEMAS = [lightToggleCommandSchema, lightPlaceCommandSchema, lightFuelCommandSchema, lightIgniteCommandSchema, lightDouseCommandSchema, lightTakeCommandSchema] as const;
