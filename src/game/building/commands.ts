/**
 * Commands of building (MASTERPROMPT §16.1, §16.3, §16.6; M4-11 … M4-14; the build mode of M4-22 sends them),
 * aggregated by src/game/commands.ts. Every command acts on the player's layer; tiles are world tiles.
 *
 * - `build.place {part, tx, ty, rot?, mirror?}`: places one piece of the part item from the bags with its anchor
 *   (the north-west tile of the rotated footprint) on (tx, ty). Refused with the reason the ghost preview shows
 *   (§16.6: "Keine Stütze in Reichweite", "Blockiert", "Zu weit" …, `BuildRejectReason`).
 * - `build.blueprint {part, tx, ty, rot?, mirror?}`: the same as a plan without material (§16.6 "Blaupausen:
 *   Pläne ohne Material platzieren") – it neither collides nor carries nor closes a room until it is finished.
 * - `build.complete {tx, ty, ebene?}`: finishes the blueprint on the tile with a hammer in the hand, taking the part
 *   item from the bags or a chest near the blueprint (§16.6 "mit Hammer … fertigstellen, Material kommt aus Kisten im
 *   Umkreis", M4-24).
 * - `build.remove {tx, ty, ebene?}`: dismantles the part on the tile (§16.6 "Abbauen (100 % zurück in den ersten
 *   30 s, danach 60 %)"); without `ebene` the topmost thing the player would grab: wall object, object, structure,
 *   roof, floor. Roof tiles no longer carried collapse (§16.3).
 * - `build.upgrade {tx, ty, part}`: replaces the part on the tile by another of the same kind and footprint in place
 *   (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein)"): the new piece comes from the bags or a chest near the part,
 *   the old one is given back like dismantling it.
 * - `build.door {tx, ty, open?}`: opens or closes (toggles without `open`) the door, gate or trapdoor on the tile.
 * - `build.repair {tx0, ty0, tx1, ty1}`: mends every damaged part in the tile rectangle within build reach with a
 *   hammer in the hand (§16.6 "Flächenreparatur", M4-25), paying a share of each part's materials from the bags and
 *   the chests near it.
 */
import { z } from 'zod';
import { BUILD_LAYERS } from '../../content/buildParts';
import { idSchema } from '../../content/schema/common';
import { ROTATIONS } from '../../world/structures/cells';

const tile = z.number().int();
const rot = z
  .number()
  .int()
  .min(0)
  .max(ROTATIONS - 1);
const ebene = z.enum(BUILD_LAYERS);

export const buildPlaceCommandSchema = z.object({ type: z.literal('build.place'), part: idSchema, tx: tile, ty: tile, rot: rot.optional(), mirror: z.boolean().optional() }).strict();
export const buildBlueprintCommandSchema = z.object({ type: z.literal('build.blueprint'), part: idSchema, tx: tile, ty: tile, rot: rot.optional(), mirror: z.boolean().optional() }).strict();
export const buildCompleteCommandSchema = z.object({ type: z.literal('build.complete'), tx: tile, ty: tile, ebene: ebene.optional() }).strict();
export const buildRemoveCommandSchema = z.object({ type: z.literal('build.remove'), tx: tile, ty: tile, ebene: ebene.optional() }).strict();
export const buildUpgradeCommandSchema = z.object({ type: z.literal('build.upgrade'), tx: tile, ty: tile, part: idSchema }).strict();
export const buildDoorCommandSchema = z.object({ type: z.literal('build.door'), tx: tile, ty: tile, open: z.boolean().optional() }).strict();
export const buildRepairCommandSchema = z.object({ type: z.literal('build.repair'), tx0: tile, ty0: tile, tx1: tile, ty1: tile }).strict();

/** The building commands, in declaration order. */
export const BUILD_COMMAND_SCHEMAS = [buildPlaceCommandSchema, buildBlueprintCommandSchema, buildCompleteCommandSchema, buildRemoveCommandSchema, buildUpgradeCommandSchema, buildDoorCommandSchema, buildRepairCommandSchema] as const;
