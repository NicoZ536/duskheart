/**
 * Commands of the map (docs/SPIEL.md §18 "Befehle `map.mark`, `map.unmark`, `map.rename`; Debug `map.reveal {layer?}`"; M7-49),
 * aggregated by src/game/commands.ts. The map screen issues the marker commands; the console's `reveal` uncovers a layer.
 *
 * - `map.mark {symbol, name, layer, tx, ty}`: sets an own marker (name ≤ `BALANCE.map.markerNameMax` characters, trimmed).
 * - `map.unmark {id}`: removes own marker `id`. `map.rename {id, name}`: names it anew.
 * - `map.reveal {layer?}` (debug): reveals the whole of `layer`, or of every layer.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { DEEPEST_LAYER, SURFACE_LAYER } from '../../world/model/coords';
import { MAP_MARKER_SYMBOLS } from './types';

const layerSchema = z.number().int().min(DEEPEST_LAYER).max(SURFACE_LAYER);
const nameSchema = z.string().max(BALANCE.map.markerNameMax);
const idSchema = z.number().int().min(0);
const tileSchema = z.number().int();

export const mapMarkCommandSchema = z
  .object({ type: z.literal('map.mark'), symbol: z.enum(MAP_MARKER_SYMBOLS), name: nameSchema, layer: layerSchema, tx: tileSchema, ty: tileSchema })
  .strict();
export const mapUnmarkCommandSchema = z.object({ type: z.literal('map.unmark'), id: idSchema }).strict();
export const mapRenameCommandSchema = z.object({ type: z.literal('map.rename'), id: idSchema, name: nameSchema }).strict();
export const mapRevealCommandSchema = z.object({ type: z.literal('map.reveal'), layer: layerSchema.optional() }).strict();

/** Schemas of the map commands (aggregated by `gameCommandSchema`). */
export const MAP_COMMAND_SCHEMAS = [mapMarkCommandSchema, mapUnmarkCommandSchema, mapRenameCommandSchema, mapRevealCommandSchema] as const;
