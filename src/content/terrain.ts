/**
 * Terrain types (docs/WORLD.md §3, §7; MASTERPROMPT §9, §14).
 *
 * Two kinds share one id space (and one runtime id table, WORLD.md §4):
 * - `boden`: what a tile's `ground` field shows – surface ground (`gras` … `lava`) and cave floors
 *   (`hoehlenboden`, `wurzelboden`, `obsidianboden`).
 * - `fest`: solid material in a tile's `solid` field (underground rock `fels`, `tiefenfels`,
 *   `glutfels` and the ore veins `ader_<ore>`); 0 in that field means open.
 * Cliff walls come from height differences and water from the `water` field, so neither is a type.
 *
 * The tileset sprite of a ground type is `tileset_<id>` by convention (WORLD.md §7); `tileset` holds
 * how its full-tile variants (frames 47+) are scattered: weights (calm variants often, striking ones
 * rarely, docs/ART.md §3) and whether they may be mirrored.
 * `dig` describes what a shovel or pickaxe does to the tile: required tool, hardness ("Abbaukraft
 * ≥ Härte", §13.2) and the terrain written into the same field afterwards (`null` = the field is
 * cleared, only for solid material). The dug ground additionally gets the `gegraben` tile flag.
 * Item drops are added with the items (M3).
 */
import { z } from 'zod';
import { ORES } from './ores';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';

/** Tool kinds that harvest or dig world content (§14 "Werkzeuge"); `hand` needs no tool. */
export const TOOL_KINDS = ['hand', 'axt', 'spitzhacke', 'schaufel', 'sichel'] as const;
/** One tool kind. */
export type ToolKind = (typeof TOOL_KINDS)[number];
export const toolKindSchema = z.enum(TOOL_KINDS);

/** Footstep sound families of walkable ground (§27 material specific sounds). */
export const FOOTSTEP_MATERIALS = ['gras', 'erde', 'sand', 'schnee', 'asche', 'kristall', 'schlamm', 'stein', 'eis', 'wurzel'] as const;
/** One footstep material. */
export type FootstepMaterial = (typeof FOOTSTEP_MATERIALS)[number];
export const footstepMaterialSchema = z.enum(FOOTSTEP_MATERIALS);

/** Terrain kinds (see module comment). */
export const TERRAIN_KINDS = ['boden', 'fest'] as const;
/** One terrain kind. */
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** Highest hardness of any diggable terrain (T6 tools have mining power 7, §13.2). */
export const TERRAIN_HARDNESS_MAX = 7;
/** Upper bound of terrain speed factors relative to normal walking (the Builder road is the fastest ground at 1.1). */
export const TERRAIN_SPEED_FACTOR_MAX = 1.5;

/** Id prefix of ore veins (WORLD.md §7 `ader_<erz>`). */
export const VEIN_PREFIX = 'ader_';

/** Id of the vein terrain of an ore. */
export function veinTerrainId(oreId: string): string {
  return `${VEIN_PREFIX}${oreId}`;
}

/** Most full-tile variants a tileset has (frames 47+, docs/WORLD.md §7 "3–4"). */
export const TILESET_VARIANTS_MAX = 4;

/** How a ground tileset scatters its full-tile variants. */
export const terrainTilesetSchema = z
  .object({
    /** Relative weight per full-tile variant, in frame order (length = number of variants). */
    variantWeights: z.array(z.number().int().min(1)).min(1).max(TILESET_VARIANTS_MAX),
    /** Whether variants may be mirrored horizontally (not for patterns with fixed joints such as paving). */
    mirror: z.boolean(),
  })
  .strict();

/** What digging a tile does. */
export const terrainDigSchema = z
  .object({
    tool: z.enum(['schaufel', 'spitzhacke']),
    /** Required mining power of the tool (§13.2). */
    hardness: z.number().int().min(1).max(TERRAIN_HARDNESS_MAX),
    /** Terrain written into the same field after digging; `null` clears it (solid material only). */
    becomes: refSchema.nullable(),
  })
  .strict();

/** Schema of one terrain type. */
export const terrainSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    kind: z.enum(TERRAIN_KINDS),
    /** Whether creatures can walk on it (solid material and lava are never walkable). */
    walkable: z.boolean(),
    /** Movement speed multiplier while walking on it (0 when not walkable). */
    speedFactor: z.number().min(0).max(TERRAIN_SPEED_FACTOR_MAX),
    /** Footstep sound family; `null` when not walkable. */
    footstep: footstepMaterialSchema.nullable(),
    /** Digging/mining result; `null` = cannot be dug. */
    dig: terrainDigSchema.nullable(),
    /** Ore of a vein (`ader_<ore>` only). */
    ore: refSchema.optional(),
    /** Tileset variant scattering (ground types only; solid material has no tileset). */
    tileset: terrainTilesetSchema.nullable(),
  })
  .strict()
  .refine((t) => t.walkable === (t.speedFactor > 0) && t.walkable === (t.footstep !== null), {
    message: 'walkable terrain needs a speed factor > 0 and a footstep material, non-walkable terrain neither',
    path: ['walkable'],
  })
  .refine((t) => t.kind === 'boden' || !t.walkable, { message: 'solid material is never walkable', path: ['walkable'] })
  .refine((t) => t.dig === null || (t.dig.becomes === null) === (t.kind === 'fest'), {
    message: 'dug ground turns into another ground type; dug solid material is cleared (becomes: null)',
    path: ['dig', 'becomes'],
  })
  .refine((t) => (t.ore !== undefined) === t.id.startsWith(VEIN_PREFIX), { message: 'exactly the ader_<ore> types reference an ore', path: ['ore'] })
  .refine((t) => (t.tileset !== null) === (t.kind === 'boden'), { message: 'exactly the ground types have a tileset', path: ['tileset'] });

/** One terrain record. */
export type Terrain = z.output<typeof terrainSchema>;

/** Hand written terrain types (surface, cave floors, host rock). */
const BASE_TERRAIN: ReadonlyArray<z.input<typeof terrainSchema>> = [
  // Surface ground (layer 0).
  { id: 'gras', name: { de: 'Gras', en: 'Grass' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'gras', dig: { tool: 'schaufel', hardness: 1, becomes: 'erde' }, tileset: { variantWeights: [3, 3, 3, 1], mirror: true } },
  { id: 'erde', name: { de: 'Erde', en: 'Dirt' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'erde', dig: { tool: 'schaufel', hardness: 1, becomes: 'erde' }, tileset: { variantWeights: [3, 3, 4, 1], mirror: true } },
  { id: 'sand', name: { de: 'Sand', en: 'Sand' }, kind: 'boden', walkable: true, speedFactor: 0.9, footstep: 'sand', dig: { tool: 'schaufel', hardness: 1, becomes: 'sand' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  // Salzküste dunes behind the beach (§9.3 "Strände"): sand held by tufts of dune grass; the shovel digs the tufts out.
  { id: 'duenengras', name: { de: 'Dünengras', en: 'Dune Grass' }, kind: 'boden', walkable: true, speedFactor: 0.95, footstep: 'sand', dig: { tool: 'schaufel', hardness: 1, becomes: 'sand' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'schnee', name: { de: 'Schnee', en: 'Snow' }, kind: 'boden', walkable: true, speedFactor: 0.8, footstep: 'schnee', dig: { tool: 'schaufel', hardness: 1, becomes: 'erde' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'asche', name: { de: 'Asche', en: 'Ash' }, kind: 'boden', walkable: true, speedFactor: 0.9, footstep: 'asche', dig: { tool: 'schaufel', hardness: 1, becomes: 'asche' }, tileset: { variantWeights: [4, 4, 3, 1], mirror: true } },
  { id: 'kristallboden', name: { de: 'Kristallboden', en: 'Crystal Ground' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'kristall', dig: null, tileset: { variantWeights: [4, 2, 3, 1], mirror: true } },
  { id: 'moorschlamm', name: { de: 'Moorschlamm', en: 'Bog Mud' }, kind: 'boden', walkable: true, speedFactor: 0.6, footstep: 'schlamm', dig: null, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  // §13.2: T1 tools (mining power 2) open peat.
  { id: 'torf', name: { de: 'Torf', en: 'Peat' }, kind: 'boden', walkable: true, speedFactor: 0.85, footstep: 'erde', dig: { tool: 'schaufel', hardness: 2, becomes: 'erde' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'meeresgrund', name: { de: 'Meeresgrund', en: 'Seabed' }, kind: 'boden', walkable: true, speedFactor: 0.85, footstep: 'sand', dig: null, tileset: { variantWeights: [4, 2, 3, 1], mirror: true } },
  // Builder pavement: faster than open ground so the roads work as guidance (§9.2 step 8); indestructible.
  { id: 'strasse', name: { de: 'Erbauer-Pflaster', en: 'Builder Paving' }, kind: 'boden', walkable: true, speedFactor: 1.1, footstep: 'stein', dig: null, tileset: { variantWeights: [3, 3, 3, 1], mirror: false } },
  // Glacier ice (Frostkamm resource "Eis", §9.3): T2 pickaxe, leaves packed snow.
  { id: 'eis', name: { de: 'Gletschereis', en: 'Glacier Ice' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'eis', dig: { tool: 'spitzhacke', hardness: 3, becomes: 'schnee' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'lava', name: { de: 'Lava', en: 'Lava' }, kind: 'boden', walkable: false, speedFactor: 0, footstep: null, dig: null, tileset: { variantWeights: [4, 2, 3, 1], mirror: true } },
  // Cave floors (layers −1 … −3).
  { id: 'hoehlenboden', name: { de: 'Höhlenboden', en: 'Cave Floor' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'stein', dig: null, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'wurzelboden', name: { de: 'Wurzelboden', en: 'Root Floor' }, kind: 'boden', walkable: true, speedFactor: 0.9, footstep: 'wurzel', dig: { tool: 'schaufel', hardness: 1, becomes: 'hoehlenboden' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  // Clay pockets of the Wurzelhöhlen (§9.3 resource "Lehm"; §14 "Graben (Schaufel): … Lehm"): a T0 shovel digs them out down to the cave floor.
  { id: 'lehm', name: { de: 'Lehm', en: 'Clay' }, kind: 'boden', walkable: true, speedFactor: 0.9, footstep: 'erde', dig: { tool: 'schaufel', hardness: 1, becomes: 'hoehlenboden' }, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  { id: 'obsidianboden', name: { de: 'Obsidianboden', en: 'Obsidian Floor' }, kind: 'boden', walkable: true, speedFactor: 1, footstep: 'stein', dig: null, tileset: { variantWeights: [4, 3, 2, 1], mirror: true } },
  // Host rock of the three underground layers; hardness = tier that opens the layer (§13.2).
  { id: 'fels', name: { de: 'Fels', en: 'Rock' }, kind: 'fest', walkable: false, speedFactor: 0, footstep: null, dig: { tool: 'spitzhacke', hardness: 1, becomes: null }, tileset: null },
  { id: 'tiefenfels', name: { de: 'Tiefenfels', en: 'Deep Rock' }, kind: 'fest', walkable: false, speedFactor: 0, footstep: null, dig: { tool: 'spitzhacke', hardness: 2, becomes: null }, tileset: null },
  { id: 'glutfels', name: { de: 'Glutfels', en: 'Ember Rock' }, kind: 'fest', walkable: false, speedFactor: 0, footstep: null, dig: { tool: 'spitzhacke', hardness: 5, becomes: null }, tileset: null },
];

/** Ore veins `ader_<ore>` for every ore that forms veins (src/content/ores.ts `vein`). */
const VEIN_TERRAIN: ReadonlyArray<z.input<typeof terrainSchema>> = ORES.filter((o) => o.vein).map((o) => ({
  id: veinTerrainId(o.id),
  name: { de: `${o.name.de}-Ader`, en: `${o.name.en} Vein` },
  kind: 'fest' as const,
  walkable: false,
  speedFactor: 0,
  footstep: null,
  dig: { tool: 'spitzhacke' as const, hardness: o.hardness, becomes: null },
  ore: o.id,
  tileset: null,
}));

/** All terrain types (WORLD.md §7). */
export const TERRAIN: ReadonlyArray<z.input<typeof terrainSchema>> = [...BASE_TERRAIN, ...VEIN_TERRAIN];
