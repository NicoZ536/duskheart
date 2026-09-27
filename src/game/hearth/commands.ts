/**
 * Hearth commands (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)"; M4-20), aggregated by src/game/commands.ts; the hearth
 * screen of the UI and E on the hearth send them. A hearth is addressed by its id (`HearthSystem.hearths`,
 * `hearthAt`); the player works it within `BALANCE.hearth.reachTiles` of its footprint. The hearth itself is placed
 * and taken down on the build grid (`build.place`, `build.remove` of the item `herdfeuer`).
 *
 * - `hearth.use {hearth}`: opens the hearth screen (store, cores, the overview of the base's chests).
 * - `hearth.fuel {hearth, from, count?}`: puts fuel from bag slot `from` into the store (§16.5 "Vorratsfach 40":
 *   logs, charcoal).
 * - `hearth.take {hearth, index, count?}`: takes stack `index` of the store back into the bags.
 * - `hearth.ignite {hearth}`: lights it (it needs fuel); `hearth.douse {hearth}`: puts it out (the piece burning now
 *   keeps what is left of it).
 * - `hearth.core {hearth, from}`: sets the ember core in bag slot `from` into its niche (§16.5 "mit Glutkernen … bis
 *   40 Tiles"); `hearth.uncore {hearth, index}`: takes the core of niche `index` back.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { slotRefSchema } from '../inventory/commands';
import { CORE_NICHES } from './state';

const hearthId = z.number().int().min(1);
const count = z.number().int().min(1);

export const hearthUseCommandSchema = z.object({ type: z.literal('hearth.use'), hearth: hearthId }).strict();
export const hearthFuelCommandSchema = z.object({ type: z.literal('hearth.fuel'), hearth: hearthId, from: slotRefSchema, count: count.optional() }).strict();
export const hearthTakeCommandSchema = z
  .object({
    type: z.literal('hearth.take'),
    hearth: hearthId,
    index: z
      .number()
      .int()
      .min(0)
      .max(BALANCE.hearth.storePieces - 1),
    count: count.optional(),
  })
  .strict();
export const hearthIgniteCommandSchema = z.object({ type: z.literal('hearth.ignite'), hearth: hearthId }).strict();
export const hearthDouseCommandSchema = z.object({ type: z.literal('hearth.douse'), hearth: hearthId }).strict();
export const hearthCoreCommandSchema = z.object({ type: z.literal('hearth.core'), hearth: hearthId, from: slotRefSchema }).strict();
export const hearthUncoreCommandSchema = z
  .object({
    type: z.literal('hearth.uncore'),
    hearth: hearthId,
    index: z
      .number()
      .int()
      .min(0)
      .max(CORE_NICHES - 1),
  })
  .strict();

/** Schemas of the hearth commands (aggregated by `gameCommandSchema`). */
export const HEARTH_COMMAND_SCHEMAS = [
  hearthUseCommandSchema,
  hearthFuelCommandSchema,
  hearthTakeCommandSchema,
  hearthIgniteCommandSchema,
  hearthDouseCommandSchema,
  hearthCoreCommandSchema,
  hearthUncoreCommandSchema,
] as const;
