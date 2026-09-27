/**
 * Build parts (MASTERPROMPT §16.1 "Raster & Ebenen", §16.2 "Materialien", §16.3 "Statik", §16.4 "Räume";
 * docs/SPIEL.md §8 "Bauteile (M4-12)"; M4-11, M4-12).
 *
 * A build part record says how an item is placed on the build grid (src/game/building): its `id` is the item
 * that is placed (the part items of src/content/items/bauteile.ts, placeable furniture and beds). Placing costs
 * one piece of that item from the bags (a blueprint costs nothing until it is finished, §16.6).
 *
 * - `art`: what kind of part it is. The kind decides the build layer (§16.1 "Boden · Struktur · Objekte ·
 *   Wandobjekte · Dach", `PART_KIND_LAYER`), how it collides, whether it closes a room (walls, doors, gates,
 *   windows, §16.4), whether it carries a roof (walls, doors, gates, windows, pillars, §16.3) and whether it
 *   opens (doors, gates, trapdoors). A pile floor (`steg`) stands in water (§16.1 "Wasserbauten … auf
 *   Pfählen"); a ladder leans against a cliff face, stairs lead up a step of one height level.
 * - `material`: the §16.2 material – hit points (× the kind's factor), flammability, insulation, and for roofs
 *   the reach to the next support (`BALANCE.building.materials`).
 * - `groesse`: footprint in tiles, width × depth when not rotated (default 1 × 1): furniture up to 4 × 4
 *   (§16.1 "Objekte (1×1 bis 4×4)"), the gate is two tiles wide.
 * - `kategorie`: what a piece of furniture is for the room (§16.4: unique categories give comfort; beds,
 *   lights, tables, seats, stations, chests … make room types, src/content/roomTypes.ts).
 * - `blockiert`: whether a piece of furniture stands in the way (default yes; a carpet does not).
 * - `schlafplatz`: a bed – the kind of sleeping place it is (`BALANCE.sleep.places`).
 * - `daemmung`: insulation of a window that differs from its material (the open window hole: none).
 * - `hpFaktor`: hit points relative to a plain part of its kind and material (the reinforced door).
 * - `ausbau`: the finish of a part within its material and tier, 1 and up (default 0): a part may be upgraded in
 *   place only to a better one of the same kind, footprint and furniture category – a higher material rank
 *   (`BALANCE.building.materials.*.upgradeRank`), else a higher item tier, else a higher `ausbau` (§16.2 "Fenster
 *   (Öffnung, Glas, Buntglas)"; `isUpgrade`, src/world/structures/catalog.ts).
 *
 * Registry collection `buildParts` (src/content/index.ts): every record places the item of its id, which is a
 * use of that item (`baukosten`, src/content/items/relations.ts). Records count nothing themselves – the part
 * items count as `items` and `buildParts` (ADR-0006).
 */
import { z } from 'zod';
import { BUILD_MATERIALS, BUILDING_BALANCE } from './balance/building';
import { SLEEP_BALANCE } from './balance/sleep';
import { deepFreeze } from './freeze';
import { idSchema } from './schema/common';

/** Build layers of a tile (§16.1), bottom to top. */
export const BUILD_LAYERS = ['boden', 'struktur', 'objekt', 'wandobjekt', 'dach'] as const;
/** One build layer. */
export type BuildLayer = (typeof BUILD_LAYERS)[number];

/** Kinds of build parts. */
export const PART_KINDS = ['boden', 'steg', 'falltuer', 'wand', 'tuer', 'tor', 'fenster', 'saeule', 'zaun', 'leiter', 'treppe', 'dach', 'moebel', 'wandmoebel'] as const;
/** One kind of build part. */
export type PartKind = (typeof PART_KINDS)[number];

/** The build layer of each kind. */
export const PART_KIND_LAYER: Readonly<Record<PartKind, BuildLayer>> = {
  boden: 'boden',
  steg: 'boden',
  falltuer: 'boden',
  wand: 'struktur',
  tuer: 'struktur',
  tor: 'struktur',
  fenster: 'struktur',
  saeule: 'struktur',
  zaun: 'struktur',
  leiter: 'struktur',
  treppe: 'struktur',
  dach: 'dach',
  moebel: 'objekt',
  wandmoebel: 'wandobjekt',
};

/** Kinds that close a room (§16.4 "geschlossen durch Wände, Türen, Fenster"). */
export const ROOM_CLOSING_KINDS: readonly PartKind[] = ['wand', 'tuer', 'tor', 'fenster'];
/** Kinds that carry a roof (§16.3 "Stütze (Wand oder Säule)"; door, gate and window frames are part of their wall). */
export const SUPPORT_KINDS: readonly PartKind[] = ['wand', 'tuer', 'tor', 'fenster', 'saeule'];
/** Kinds that open and close. */
export const OPENABLE_KINDS: readonly PartKind[] = ['tuer', 'tor', 'falltuer'];

/**
 * Furniture categories (§16.4): what a piece of furniture is for its room. Unique categories give comfort;
 * the room types count them (a bed and a light make a bedroom, three stations a workshop …).
 * - `bett` sleeping place · `sitz` chair, stool, bench · `tisch` table, desk · `lager` chest, crate, barrel,
 *   storage shelf (the store room's "Kisten") · `schrank` wardrobe, shelf · `licht` lamp, candle holder,
 *   lantern · `kamin` fireplace (heat) · `kochstelle` kettle, cooking place (kitchen) · `station` crafting or
 *   processing station · `deko` decoration · `teppich` carpet · `bild` picture, sign · `pflanze` potted plant ·
 *   `trophaee` trophy · `beet` garden bed (greenhouse) · `trog` feeding trough (stable).
 */
export const FURNITURE_CATEGORIES = ['bett', 'sitz', 'tisch', 'lager', 'schrank', 'licht', 'kamin', 'kochstelle', 'station', 'deko', 'teppich', 'bild', 'pflanze', 'trophaee', 'beet', 'trog'] as const;
/** One furniture category. */
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];
/** Categories that count as decoration (§16.4 "Deko"). */
export const DECORATION_CATEGORIES: readonly FurnitureCategory[] = ['deko', 'teppich', 'bild', 'pflanze', 'trophaee'];

/** Kinds whose parts are drawn as objects (`obj_<id>`, like stations) rather than as modular structure (`bau_<id>`). */
export const OBJECT_SPRITE_KINDS: readonly PartKind[] = ['moebel', 'wandmoebel'];

/**
 * Sprite of a placed build part (docs/SPIEL.md §8 "Sprites"): modular structure parts `bau_<id>` (walls, floors,
 * roofs, doors, windows, pillars, fences, ways up, the jetty), standing and wall furniture – beds, chests, the
 * hearth, lamps, decoration – `obj_<id>`. The game view resolves a part's sprite by this name
 * (src/render/game/building.ts), so the validator counts these sprites as used (tools/validator/checks.ts).
 */
export function buildPartSpriteId(id: string, art: PartKind): string {
  return OBJECT_SPRITE_KINDS.includes(art) ? `obj_${id}` : `bau_${id}`;
}

/**
 * The second sprite of a placed build part, or `null`: the two-tile gate standing in a north–south wall
 * (`bau_<id>_seite`), the raised flap of an open trapdoor (`bau_<id>_klappe`; assets-src/sprites/bau/tueren.ts).
 */
export function buildPartSecondSpriteId(id: string, art: PartKind): string | null {
  if (art === 'tor') return `bau_${id}_seite`;
  if (art === 'falltuer') return `bau_${id}_klappe`;
  return null;
}

/** Kinds of sleeping places (`BALANCE.sleep.places`). */
const SLEEP_KINDS = Object.keys(SLEEP_BALANCE.places) as [string, ...string[]];
const side = z.number().int().min(1).max(BUILDING_BALANCE.maxObjectSide);

/** Schema of one build part. */
export const buildPartSchema = z
  .object({
    /** The item that is placed. */
    id: idSchema,
    art: z.enum(PART_KINDS),
    material: z.enum(BUILD_MATERIALS),
    /** Footprint [tiles], width × depth when not rotated. */
    groesse: z.object({ b: side, t: side }).strict().optional(),
    kategorie: z.enum(FURNITURE_CATEGORIES).optional(),
    blockiert: z.boolean().optional(),
    schlafplatz: z.enum(SLEEP_KINDS).optional(),
    /** Insulation [0–1] instead of the material's. */
    daemmung: z.number().min(0).max(1).optional(),
    /** Hit points relative to a plain part of its kind and material [factor]. */
    hpFaktor: z.number().positive().optional(),
    /** Finish within its material and tier (upgrading in place goes up), default 0. */
    ausbau: z.number().int().min(1).max(BUILDING_BALANCE.maxFinish).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const furniture = p.art === 'moebel' || p.art === 'wandmoebel';
    const b = p.groesse?.b ?? 1;
    const t = p.groesse?.t ?? 1;
    if (p.art === 'tor' && (b !== 2 || t !== 1)) issue('groesse', 'a gate is two tiles wide and one deep');
    if (p.art !== 'tor' && p.art !== 'moebel' && (b !== 1 || t !== 1)) issue('groesse', `a ${p.art} covers one tile`);
    if (furniture !== (p.kategorie !== undefined)) issue('kategorie', 'exactly the furniture has a furniture category');
    if (p.blockiert !== undefined && p.art !== 'moebel') issue('blockiert', 'only standing furniture can be walked around');
    if (p.schlafplatz !== undefined && p.kategorie !== 'bett') issue('schlafplatz', 'only beds are sleeping places');
    if (p.kategorie === 'bett' && p.schlafplatz === undefined) issue('schlafplatz', 'a bed names its kind of sleeping place');
    if (p.daemmung !== undefined && p.art !== 'fenster') issue('daemmung', 'only windows insulate differently from their material');
  });

/** One build part (validated). */
export type BuildPartDef = z.output<typeof buildPartSchema>;
/** Build part data as written in the content files. */
export type BuildPartInput = z.input<typeof buildPartSchema>;

/** Error in the build part content. */
export class BuildPartError extends Error {
  override readonly name = 'BuildPartError';
}

/** Validates one group of build parts (schema, unique ids) and freezes it. */
export function defineBuildParts(group: string, records: readonly BuildPartInput[]): readonly BuildPartDef[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = buildPartSchema.safeParse(raw);
    if (!r.success) throw new BuildPartError(`Build part group "${group}" [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(part)'}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new BuildPartError(`Build part group "${group}": duplicate id "${r.data.id}"`);
    seen.add(r.data.id);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/**
 * The structure parts of tiers T0–T1 (docs/SPIEL.md §8 "Bauteile (M4-12)"; their items: src/content/items/
 * bauteile.ts). Materials after §16.2: palisade and wood T0, timber frame, stone and glass T1; straw roofs T0,
 * shingles and glass T1 (glass from the clay oven, the precondition of the greenhouse, §16.4).
 */
export const STRUCTURE_PARTS = defineBuildParts('struktur', [
  // Walls (§16.2): palisade 150, wood 300, timber frame 450 (burns −70 %), stone 900.
  { id: 'wand_palisade', art: 'wand', material: 'palisade' },
  { id: 'wand_holz', art: 'wand', material: 'holz' },
  { id: 'wand_fachwerk', art: 'wand', material: 'fachwerk' },
  { id: 'wand_stein', art: 'wand', material: 'stein' },
  // Floors: planks, flagstones, rammed clay.
  { id: 'boden_holz', art: 'boden', material: 'holz' },
  { id: 'boden_stein', art: 'boden', material: 'stein' },
  { id: 'boden_lehm', art: 'boden', material: 'lehm' },
  // Roofs (§16.3 reach: straw 3, wood 5; glass lies in a timber frame).
  { id: 'dach_stroh', art: 'dach', material: 'stroh' },
  { id: 'dach_schindel', art: 'dach', material: 'holz' },
  { id: 'dach_glas', art: 'dach', material: 'glas' },
  // Doors and gates (§16.2 "Türen (Holz, verstärkt, … zweibreites Tor, Falltür)"): the reinforced door has
  // bronze bands and twice the hit points of a plain one.
  { id: 'tuer_holz', art: 'tuer', material: 'holz' },
  { id: 'tuer_verstaerkt', art: 'tuer', material: 'holz', hpFaktor: 2 },
  { id: 'tor_holz', art: 'tor', material: 'holz', groesse: { b: 2, t: 1 } },
  { id: 'falltuer_holz', art: 'falltuer', material: 'holz' },
  // Windows (§16.2 "Fenster (Öffnung, Glas, Buntglas …)"): the opening is a framed hole – it closes the room but
  // lets the air through; the glass window insulates like a pane; the stained-glass window is a glass window of
  // coloured panes in tin cames – the finer finish of the same glass (its coloured light on the floor: M5-05).
  { id: 'fenster_offen', art: 'fenster', material: 'holz', daemmung: 0 },
  { id: 'fenster_glas', art: 'fenster', material: 'glas' },
  { id: 'fenster_buntglas', art: 'fenster', material: 'glas', ausbau: 1 },
  // Pillars carry roofs where no wall stands (§16.3).
  { id: 'saeule_holz', art: 'saeule', material: 'holz' },
  { id: 'saeule_stein', art: 'saeule', material: 'stein' },
  // Fences stop walkers but close no room.
  { id: 'zaun_holz', art: 'zaun', material: 'holz' },
  { id: 'zaun_stein', art: 'zaun', material: 'stein' },
  // Ways up a cliff (§11.4 "hinauf nur über Rampen, Treppen, platzierte Leitern") and a jetty on piles (§16.1).
  { id: 'leiter_holz', art: 'leiter', material: 'holz' },
  { id: 'treppe_holz', art: 'treppe', material: 'holz' },
  { id: 'steg_holz', art: 'steg', material: 'holz' },
]);

/**
 * Placeable items of the first days that are no station (stations bring their footprint in
 * src/content/stations.ts): the grass bed of M3-16 – a sleeping place (§11.5, `BALANCE.sleep.places.grasbett`)
 * of straw on the ground, walked around like any bed.
 */
export const EARLY_PLACEABLES = defineBuildParts('platzierbar', [{ id: 'grasbett', art: 'moebel', material: 'stroh', groesse: { b: 1, t: 2 }, kategorie: 'bett', schlafplatz: 'grasbett' }]);

/** Every build part, in group order. */
export const BUILD_PARTS: readonly BuildPartDef[] = [...STRUCTURE_PARTS, ...EARLY_PLACEABLES];
