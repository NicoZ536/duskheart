/**
 * World objects (docs/WORLD.md §3, §7; MASTERPROMPT §9.2 step 7, §14, §D).
 *
 * Everything that stands on a tile's `object` field: trees `baum_<art>` (the 14 species of §14,
 * counted as §C "Baumarten"), bushes `busch_<art>`, rocks `fels_<groesse>_<biom>`, crystals
 * `kristall_<art>`, ore nodes `erz_<ore>` (one per ore), ground scatter `deko_<typ>` and wild plants
 * `pflanze_<art>`. Gameplay data only: the sprite carries the same id (WORLD.md §7), item drops are
 * added with the items (M3).
 *
 * Numbers follow the spec:
 * - `hardness`: required mining/chopping power ("Abbaukraft ≥ Härte", §13.2). Resource nodes take the
 *   tier of their biome or ore; hand-picked objects have hardness 0.
 * - `hp`: hit points against a tool of matching tier. §D "Treffer = ⌈HP / Abbaukraft⌉; Grünhain-Baum:
 *   5 Treffer mit Steinaxt, 3 mit Bronzeaxt" ⇒ HP = `BALANCE.gathering.hitsWithTierTool` × hardness,
 *   large rocks take twice the hits. Picking by hand is a single action (HP 1).
 * - `regrowDays`: game days until the object is back after harvesting (§14); `null` = never (cave
 *   nodes, scatter). Surface stone and ore nodes regrow after 7 days (§14).
 * - `footprint`: blocking base in tiles, anchored at the object's tile and extending east (+x) and
 *   north (−y); `blocking` says whether it stops movement.
 */
import { z } from 'zod';
import { BALANCE } from './balance';
import { BIOMES } from './biomes';
import { ORES } from './ores';
import { toolKindSchema } from './terrain';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';

/** Object kinds with their id prefixes (WORLD.md §7). */
export const WORLD_OBJECT_KINDS = ['baum', 'busch', 'fels', 'kristall', 'erz', 'deko', 'pflanze'] as const;
/** One world object kind. */
export type WorldObjectKind = (typeof WORLD_OBJECT_KINDS)[number];

/** Highest hardness of any world object (Nachtherz, T6 tools with power 7, §13.2). */
export const WORLD_OBJECT_HARDNESS_MAX = 7;
/** Largest footprint edge [tiles] (32×32 rocks and 64×96 trees stand on at most 2 tiles). */
export const FOOTPRINT_MAX_TILES = 2;

/** Schema of one world object. */
export const worldObjectSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    kind: z.enum(WORLD_OBJECT_KINDS),
    /** Biomes the object grows or lies in. */
    biomes: z.array(refSchema).min(1),
    /** Hit points (see module comment). */
    hp: z.number().int().min(1),
    /** Required tool power; 0 = no requirement. */
    hardness: z.number().int().min(0).max(WORLD_OBJECT_HARDNESS_MAX),
    /** Tool that harvests it. */
    tool: toolKindSchema,
    /** Game days until it is back after harvesting; `null` = never. */
    regrowDays: z.number().int().min(1).nullable(),
    footprint: z.object({ w: z.number().int().min(1).max(FOOTPRINT_MAX_TILES), h: z.number().int().min(1).max(FOOTPRINT_MAX_TILES) }).strict(),
    /** Whether the object blocks movement. */
    blocking: z.boolean(),
    /** Ore of an ore node (`erz_<ore>` only). */
    ore: refSchema.optional(),
  })
  .strict()
  .refine((o) => o.id.startsWith(`${o.kind}_`), { message: 'id must start with the kind prefix (WORLD.md §7)', path: ['id'] })
  .refine((o) => (o.ore !== undefined) === (o.kind === 'erz'), { message: 'exactly the erz_<ore> nodes reference an ore', path: ['ore'] })
  .refine((o) => (o.tool === 'hand') === (o.hardness === 0), { message: 'hand-picked objects have hardness 0, tool-harvested objects a hardness ≥ 1', path: ['hardness'] });

/** One world object record. */
export type WorldObject = z.output<typeof worldObjectSchema>;
type WorldObjectInput = z.input<typeof worldObjectSchema>;

const HITS = BALANCE.gathering.hitsWithTierTool;
/** Large rocks take twice the hits of small ones. */
const LARGE_ROCK_HIT_FACTOR = 2;
const SINGLE = { w: 1, h: 1 } as const;
const WIDE = { w: 2, h: 1 } as const;

/** Surface biomes: only there do nodes regrow (§14 "Oberflächenknoten"). */
const SURFACE_BIOMES: ReadonlySet<string> = new Set(BIOMES.filter((b) => b.layer === 0).map((b) => b.id));

/** Node regrow time: surface nodes regrow, cave-only nodes do not. */
function nodeRegrow(biomes: readonly string[]): number | null {
  return biomes.some((b) => SURFACE_BIOMES.has(b)) ? BALANCE.gathering.nodeRegrowDays : null;
}

/** A tree: chopped with an axe, HP from the tier rule of §D. */
function tree(art: string, de: string, en: string, biomes: readonly string[], hardness: number, footprint: { w: number; h: number } = SINGLE): WorldObjectInput {
  return { id: `baum_${art}`, name: { de, en }, kind: 'baum', biomes: [...biomes], hp: HITS * hardness, hardness, tool: 'axt', regrowDays: BALANCE.gathering.treeRegrowDays, footprint, blocking: true };
}

/** A hand-picked, regrowing bush. */
function pickedBush(art: string, de: string, en: string, biomes: readonly string[]): WorldObjectInput {
  return { id: `busch_${art}`, name: { de, en }, kind: 'busch', biomes: [...biomes], hp: 1, hardness: 0, tool: 'hand', regrowDays: BALANCE.gathering.bushRegrowDays, footprint: SINGLE, blocking: true };
}

/** A thorny or woody bush that needs a tool of the biome's tier. */
function cutBush(art: string, de: string, en: string, biomes: readonly string[], tool: 'axt' | 'sichel', hardness: number): WorldObjectInput {
  return { id: `busch_${art}`, name: { de, en }, kind: 'busch', biomes: [...biomes], hp: HITS * hardness, hardness, tool, regrowDays: BALANCE.gathering.bushRegrowDays, footprint: SINGLE, blocking: true };
}

/** A wild plant: picked by hand in one action unless a tool is named (then HP by the tier rule, or `hp`). */
function plant(
  art: string,
  de: string,
  en: string,
  biomes: readonly string[],
  opts: { tool?: 'hand' | 'axt' | 'sichel'; hardness?: number; hp?: number; blocking?: boolean } = {},
): WorldObjectInput {
  const tool = opts.tool ?? 'hand';
  const hardness = tool === 'hand' ? 0 : (opts.hardness ?? 1);
  return {
    id: `pflanze_${art}`,
    name: { de, en },
    kind: 'pflanze',
    biomes: [...biomes],
    hp: opts.hp ?? (tool === 'hand' ? 1 : HITS * hardness),
    hardness,
    tool,
    regrowDays: BALANCE.gathering.plantRegrowDays,
    footprint: SINGLE,
    blocking: opts.blocking ?? false,
  };
}

/** A crystal node (pickaxe). */
function crystal(art: string, de: string, en: string, biomes: readonly string[], hardness: number): WorldObjectInput {
  return { id: `kristall_${art}`, name: { de, en }, kind: 'kristall', biomes: [...biomes], hp: HITS * hardness, hardness, tool: 'spitzhacke', regrowDays: nodeRegrow(biomes), footprint: SINGLE, blocking: true };
}

/** Ground scatter: picked up by hand, never regrows, never blocks. */
function deko(typ: string, de: string, en: string, biomes: readonly string[]): WorldObjectInput {
  return { id: `deko_${typ}`, name: { de, en }, kind: 'deko', biomes: [...biomes], hp: 1, hardness: 0, tool: 'hand', regrowDays: null, footprint: SINGLE, blocking: false };
}

// ---------------------------------------------------------------------------------------------
// Trees (§14, WORLD.md §7: 14 species). Hardness = tier of the biome's tools (§13.2).
// ---------------------------------------------------------------------------------------------

const TREES: readonly WorldObjectInput[] = [
  tree('eiche', 'Eiche', 'Oak', ['gruenhain'], 1, WIDE),
  tree('birke', 'Birke', 'Birch', ['gruenhain'], 1),
  tree('buche', 'Buche', 'Beech', ['gruenhain'], 1, WIDE),
  tree('kiefer', 'Kiefer', 'Pine', ['gruenhain', 'salzkueste', 'frostkamm'], 1),
  tree('weide', 'Weide', 'Willow', ['gruenhain', 'nebelmoor'], 1, WIDE),
  tree('mangrove', 'Mangrove', 'Mangrove', ['nebelmoor'], 2, WIDE),
  tree('tanne', 'Tanne', 'Fir', ['frostkamm'], 3),
  tree('dattelpalme', 'Dattelpalme', 'Date Palm', ['glutsand'], 4),
  tree('aschebaum', 'Aschebaum', 'Ash Tree', ['aschenschlund'], 5),
  tree('lichtbaum', 'Lichtbaum', 'Lighttree', ['scherbenhain'], 6, WIDE),
  tree('apfelbaum', 'Apfelbaum', 'Apple Tree', ['gruenhain'], 1),
  tree('kirschbaum', 'Kirschbaum', 'Cherry Tree', ['gruenhain'], 1),
  tree('birnbaum', 'Birnbaum', 'Pear Tree', ['gruenhain'], 1),
  tree('walnussbaum', 'Walnussbaum', 'Walnut Tree', ['gruenhain'], 1, WIDE),
];

// ---------------------------------------------------------------------------------------------
// Bushes and wild plants (§9.3 resources, §14 "Pflanzen")
// ---------------------------------------------------------------------------------------------

const BUSHES: readonly WorldObjectInput[] = [
  pickedBush('beeren', 'Beerenstrauch', 'Berry Bush', ['gruenhain']),
  pickedBush('hasel', 'Haselstrauch', 'Hazel Bush', ['gruenhain']),
  pickedBush('sanddorn', 'Sanddorn', 'Sea Buckthorn', ['salzkueste']),
  pickedBush('moorbeere', 'Moorbeerenstrauch', 'Bogberry Bush', ['nebelmoor']),
  pickedBush('frostbeere', 'Frostbeerenstrauch', 'Frostberry Bush', ['frostkamm']),
  pickedBush('wacholder', 'Wacholder', 'Juniper', ['frostkamm']),
  pickedBush('baumwolle', 'Wilde Baumwolle', 'Wild Cotton', ['glutsand']),
  cutBush('dornbusch', 'Dornbusch', 'Thornbush', ['glutsand'], 'sichel', 4),
  cutBush('glutdorn', 'Glutdorn', 'Emberthorn', ['aschenschlund'], 'sichel', 5),
  cutBush('kristallstrauch', 'Kristallstrauch', 'Crystal Shrub', ['scherbenhain'], 'sichel', 6),
  cutBush('dornenranke', 'Dornenranke', 'Thorn Vine', ['nachtherz'], 'sichel', 7),
  cutBush('wurzelgeflecht', 'Wurzelgeflecht', 'Root Tangle', ['wurzelhoehlen'], 'axt', 1),
];

const PLANTS: readonly WorldObjectInput[] = [
  // The Salzküste dunes grow marram grass instead (§9.3; the Grünhain-tinted fibre grass read as blue agaves there, M2-31).
  plant('fasergras', 'Fasergras', 'Fibre Grass', ['gruenhain', 'nebelmoor', 'frostkamm']),
  plant('kraeuter', 'Wildkräuter', 'Wild Herbs', ['gruenhain']),
  plant('steinpilz', 'Steinpilz', 'Porcini', ['gruenhain', 'nebelmoor']),
  plant('strandhafer', 'Strandhafer', 'Marram Grass', ['salzkueste']),
  plant('schilf', 'Schilf', 'Reed', ['nebelmoor'], { tool: 'sichel', hardness: 1, hp: 1 }),
  plant('bergtee', 'Bergtee', 'Mountain Tea', ['frostkamm']),
  plant('kaktus', 'Kaktus', 'Cactus', ['glutsand'], { tool: 'axt', hardness: 1, blocking: true }),
  plant('feuerwurz', 'Feuerwurz', 'Firewort', ['aschenschlund']),
  plant('prismenbluete', 'Prismenblüte', 'Prism Blossom', ['scherbenhain']),
  plant('schattenkraut', 'Schattenkraut', 'Shadewort', ['nachtherz']),
  plant('leuchtpilz', 'Leuchtpilz', 'Glowcap', ['wurzelhoehlen']),
  plant('kristallmoos', 'Kristallmoos', 'Crystal Moss', ['tiefgrund']),
  plant('glutmoos', 'Glutmoos', 'Embermoss', ['glutadern']),
];

// ---------------------------------------------------------------------------------------------
// Rocks `fels_<klein|gross>_<biom>`: one small (16×16) and one large (32×32) rock per biome.
// ---------------------------------------------------------------------------------------------

/** Rock of each biome: stone name (DE small/large with grammatical gender, EN) and hardness (§13.2 biome tier). */
const ROCK_STONES: ReadonlyArray<{ readonly biome: string; readonly small: string; readonly large: string; readonly en: string; readonly hardness: number }> = [
  { biome: 'gruenhain', small: 'Kleiner Feldstein', large: 'Großer Feldstein', en: 'Fieldstone', hardness: 1 },
  { biome: 'salzkueste', small: 'Kleiner Küstenfels', large: 'Großer Küstenfels', en: 'Coastal Rock', hardness: 1 },
  { biome: 'nebelmoor', small: 'Kleiner Moorstein', large: 'Großer Moorstein', en: 'Bogstone', hardness: 2 },
  { biome: 'frostkamm', small: 'Kleiner Granitblock', large: 'Großer Granitblock', en: 'Granite', hardness: 3 },
  { biome: 'glutsand', small: 'Kleiner Sandstein', large: 'Großer Sandstein', en: 'Sandstone', hardness: 4 },
  { biome: 'aschenschlund', small: 'Kleiner Basaltblock', large: 'Großer Basaltblock', en: 'Basalt', hardness: 5 },
  { biome: 'scherbenhain', small: 'Kleiner Scherbenstein', large: 'Großer Scherbenstein', en: 'Shardstone', hardness: 6 },
  { biome: 'nachtherz', small: 'Kleines Nachtgestein', large: 'Großes Nachtgestein', en: 'Nightrock', hardness: 7 },
  { biome: 'wurzelhoehlen', small: 'Kleiner Wurzelfels', large: 'Großer Wurzelfels', en: 'Rootrock', hardness: 1 },
  { biome: 'tiefgrund', small: 'Kleiner Tiefenstein', large: 'Großer Tiefenstein', en: 'Deepstone', hardness: 2 },
  { biome: 'glutadern', small: 'Kleiner Glutstein', large: 'Großer Glutstein', en: 'Emberstone', hardness: 5 },
];

const ROCKS: readonly WorldObjectInput[] = ROCK_STONES.flatMap((r) => {
  const biomes = [r.biome];
  const common = { kind: 'fels' as const, biomes, hardness: r.hardness, tool: 'spitzhacke' as const, regrowDays: nodeRegrow(biomes), blocking: true };
  return [
    { ...common, id: `fels_klein_${r.biome}`, name: { de: r.small, en: `Small ${r.en}` }, hp: HITS * r.hardness, footprint: SINGLE },
    { ...common, id: `fels_gross_${r.biome}`, name: { de: r.large, en: `Large ${r.en}` }, hp: HITS * LARGE_ROCK_HIT_FACTOR * r.hardness, footprint: WIDE },
  ];
});

// ---------------------------------------------------------------------------------------------
// Crystals and ore nodes
// ---------------------------------------------------------------------------------------------

const CRYSTALS: readonly WorldObjectInput[] = [
  crystal('eis', 'Eiskristall', 'Ice Crystal', ['frostkamm'], 3),
  crystal('glut', 'Glutkristall', 'Ember Crystal', ['aschenschlund', 'glutadern'], 5),
  crystal('lumen', 'Lumenkristall', 'Lumen Crystal', ['scherbenhain'], 6),
  crystal('prisma', 'Prismenkristall', 'Prism Crystal', ['scherbenhain'], 6),
  crystal('leere', 'Leerenkristall', 'Void Crystal', ['nachtherz'], 7),
  crystal('tiefen', 'Tiefenkristall', 'Deep Crystal', ['tiefgrund'], 2),
];

/** One node `erz_<ore>` per ore (§14 "Knoten mit Treffer-HP"), hardness from the ore (§13.2). */
const ORE_NODES: readonly WorldObjectInput[] = ORES.map((o) => ({
  id: `erz_${o.id}`,
  name: { de: `${o.name.de}-Vorkommen`, en: `${o.name.en} Deposit` },
  kind: 'erz' as const,
  biomes: [...o.biomes],
  hp: HITS * o.hardness,
  hardness: o.hardness,
  tool: 'spitzhacke' as const,
  regrowDays: nodeRegrow(o.biomes),
  footprint: SINGLE,
  blocking: true,
  ore: o.id,
}));

// ---------------------------------------------------------------------------------------------
// Ground scatter (§9.2 step 7 "Streudeko"; M2-19: at least 4 types per biome)
// ---------------------------------------------------------------------------------------------

const SCATTER: readonly WorldObjectInput[] = [
  deko('steinchen', 'Steinchen', 'Pebbles', ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'wurzelhoehlen', 'tiefgrund', 'glutadern']),
  deko('blumen', 'Wildblumen', 'Wildflowers', ['gruenhain', 'scherbenhain']),
  deko('pilze', 'Pilzgruppe', 'Mushroom Cluster', ['gruenhain', 'nebelmoor', 'wurzelhoehlen']),
  deko('laub', 'Falllaub', 'Fallen Leaves', ['gruenhain']),
  // Not on the Salzküste: its dune grass ground carries its own tufts (M2-31).
  deko('graeser', 'Grasbüschel', 'Grass Tufts', ['gruenhain', 'frostkamm']),
  deko('moos', 'Moospolster', 'Moss Cushion', ['gruenhain', 'nebelmoor', 'wurzelhoehlen']),
  deko('muscheln', 'Muscheln', 'Seashells', ['salzkueste']),
  deko('treibholz', 'Treibholz', 'Driftwood', ['salzkueste']),
  deko('tang', 'Angespülter Tang', 'Washed-up Kelp', ['salzkueste']),
  deko('moorgras', 'Moorgras', 'Bog Grass', ['nebelmoor']),
  deko('knochen', 'Knochen', 'Bones', ['frostkamm', 'glutsand', 'aschenschlund', 'nachtherz', 'tiefgrund', 'glutadern']),
  deko('eisbrocken', 'Eisbrocken', 'Ice Chunks', ['frostkamm']),
  deko('zapfen', 'Zapfen', 'Pine Cones', ['frostkamm']),
  deko('trockengras', 'Trockengras', 'Dry Grass', ['glutsand']),
  deko('tonscherben', 'Tonscherben', 'Pottery Shards', ['glutsand', 'tiefgrund']),
  deko('ruinenbrocken', 'Ruinenbrocken', 'Ruin Rubble', ['glutsand', 'tiefgrund']),
  deko('aschehaufen', 'Aschehäufchen', 'Ash Mound', ['aschenschlund', 'glutadern']),
  deko('schwefelkruste', 'Schwefelkruste', 'Sulfur Crust', ['aschenschlund']),
  deko('glutsteine', 'Glutsteine', 'Ember Stones', ['aschenschlund', 'glutadern']),
  deko('obsidiansplitter', 'Obsidiansplitter', 'Obsidian Chips', ['aschenschlund', 'glutadern']),
  deko('kristallsplitter', 'Kristallsplitter', 'Crystal Splinters', ['scherbenhain', 'tiefgrund']),
  deko('kristallgras', 'Kristallgras', 'Crystal Grass', ['scherbenhain']),
  deko('glasscherben', 'Glasscherben', 'Glass Shards', ['scherbenhain', 'nachtherz']),
  deko('verderbnisranken', 'Verderbnisranken', 'Corruption Tendrils', ['nachtherz']),
  deko('kratersteine', 'Kratersteine', 'Crater Stones', ['nachtherz']),
  deko('wurzelstraenge', 'Wurzelstränge', 'Root Strands', ['wurzelhoehlen']),
  deko('leuchtmoos', 'Leuchtmoos', 'Glowmoss', ['wurzelhoehlen']),
  deko('flechten', 'Tiefenflechten', 'Deep Lichen', ['tiefgrund']),
];

/** All world objects (WORLD.md §7). */
export const WORLD_OBJECTS: readonly WorldObjectInput[] = [...TREES, ...BUSHES, ...PLANTS, ...ROCKS, ...CRYSTALS, ...ORE_NODES, ...SCATTER];
