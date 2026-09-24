/**
 * World objects (docs/WORLD.md §3, §7; MASTERPROMPT §9.2 step 7, §14, §D).
 *
 * Everything that stands on a tile's `object` field: trees `baum_<art>` (the 14 species of §14,
 * counted as §C "Baumarten"), bushes `busch_<art>`, rocks `fels_<groesse>_<biom>`, crystals
 * `kristall_<art>`, ore nodes `erz_<ore>` (one per ore), ground scatter `deko_<typ>` and wild plants
 * `pflanze_<art>`. Gameplay data only: the sprite carries the same id (WORLD.md §7).
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
 * - `drops` (M3-04, docs/SPIEL.md §6 "Welt-Drops"): the items the object yields. `anlass` says when:
 *   `abbau` when it is felled, mined or picked (the main harvest), `roden` when a tree's stump is
 *   cleared, `ernte` when a fruit tree is harvested without felling it. Every drop rolls its `chance`
 *   once and then yields `min`–`max` pieces; `jahreszeiten` limits it to seasons (berries, fruit,
 *   herbs, mushrooms, flowers). These drops are the world sources of the items (src/content/items/usage.ts).
 *   Objects of later tiers get their drops with the items of their tier.
 */
import { z } from 'zod';
import { BALANCE, SEASON_IDS } from './balance';
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

/** When a drop falls (see module comment). */
export const DROP_OCCASIONS = ['abbau', 'roden', 'ernte'] as const;
/** One drop occasion. */
export type DropOccasion = (typeof DROP_OCCASIONS)[number];

/** One item drop of a world object. */
export const worldObjectDropSchema = z
  .object({
    item: refSchema,
    /** Pieces per successful roll [items]. */
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    /** Probability of the roll [0–1]; 1 when omitted. */
    chance: z.number().gt(0).max(1).optional(),
    anlass: z.enum(DROP_OCCASIONS).default('abbau'),
    /** Seasons in which the drop falls; all seasons when omitted. */
    jahreszeiten: z.array(z.enum(SEASON_IDS)).min(1).optional(),
  })
  .strict()
  .refine((d) => d.max >= d.min, { message: 'max must not be below min', path: ['max'] })
  .refine((d) => d.jahreszeiten === undefined || new Set(d.jahreszeiten).size === d.jahreszeiten.length, { message: 'seasons must be unique', path: ['jahreszeiten'] });
/** One drop (validated). */
export type WorldObjectDrop = z.output<typeof worldObjectDropSchema>;

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
    /** Items the object yields (see module comment). */
    drops: z.array(worldObjectDropSchema).min(1).optional(),
  })
  .strict()
  .refine((o) => o.id.startsWith(`${o.kind}_`), { message: 'id must start with the kind prefix (WORLD.md §7)', path: ['id'] })
  .refine((o) => (o.ore !== undefined) === (o.kind === 'erz'), { message: 'exactly the erz_<ore> nodes reference an ore', path: ['ore'] })
  .refine((o) => (o.tool === 'hand') === (o.hardness === 0), { message: 'hand-picked objects have hardness 0, tool-harvested objects a hardness ≥ 1', path: ['hardness'] })
  .refine((o) => o.kind === 'baum' || (o.drops ?? []).every((d) => d.anlass === 'abbau'), { message: 'only trees have stumps to clear and fruit to harvest (anlass roden/ernte)', path: ['drops'] });

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

// ---------------------------------------------------------------------------------------------
// Item drops (M3-04, docs/SPIEL.md §6 "Welt-Drops"; MASTERPROMPT §14). Counts are pieces per harvest:
// a Grünhain tree (5 axe hits, §D) is worth a small bundle of wood, a rock a handful of stones, a
// plant or bush a few pieces – so the T0 tools and a first fire cost a few trees, rocks and plants
// ("komplette Ausrüstung einer Stufe ≈ 2–3 Spielstunden Sammeln", §D).
// ---------------------------------------------------------------------------------------------

type DropInput = z.input<typeof worldObjectDropSchema>;

const SAPLING_CHANCE = BALANCE.items.drops.saplingChance;

/** Felling a broadleaf tree: logs, twigs, bark and leaves. */
const BROADLEAF_FELLING: readonly DropInput[] = [
  { item: 'holz', min: 3, max: 5 },
  { item: 'zweig', min: 1, max: 3 },
  { item: 'rinde', min: 1, max: 2 },
  { item: 'laub', min: 1, max: 3 },
];
/** Felling a conifer: the same plus resin (docs/SPIEL.md §6 "Kiefer/Tanne → zusätzlich harz"). */
const CONIFER_FELLING: readonly DropInput[] = [...BROADLEAF_FELLING, { item: 'harz', min: 1, max: 2 }];

/** Clearing the stump of a tree (§14 "roden: Harz/Holz; 40 % Chance auf Setzling"); `sapling` = species with a sapling item. */
function stumpDrops(sapling: string | null, conifer: boolean): DropInput[] {
  const out: DropInput[] = [{ item: 'holz', min: 1, max: 2, anlass: 'roden' }];
  if (conifer) out.push({ item: 'harz', min: 1, max: 2, anlass: 'roden' });
  if (sapling !== null) out.push({ item: `setzling_${sapling}`, min: 1, max: 1, chance: SAPLING_CHANCE, anlass: 'roden' });
  return out;
}

/** Seasonal fruit of a fruit tree, picked without felling it (§14 "Obstbäume", §17 "saisonale Ernte"). */
function fruit(item: string, min: number, max: number, jahreszeiten: DropInput['jahreszeiten']): DropInput {
  return { item, min, max, anlass: 'ernte', jahreszeiten };
}

/** Breaking a small rock with a pickaxe: stones, now and then flint and gravel. */
const SMALL_ROCK: readonly DropInput[] = [
  { item: 'stein', min: 2, max: 3 },
  { item: 'feuerstein', min: 1, max: 1, chance: 0.3 },
  { item: 'kies', min: 1, max: 2, chance: 0.5 },
];
/** Breaking a large rock (twice the hits): about twice the yield. */
const LARGE_ROCK: readonly DropInput[] = [
  { item: 'stein', min: 4, max: 6 },
  { item: 'feuerstein', min: 1, max: 2, chance: 0.5 },
  { item: 'kies', min: 1, max: 3, chance: 0.6 },
];

/** Drops per world object id. */
const DROPS: Readonly<Record<string, readonly DropInput[]>> = {
  baum_eiche: [...BROADLEAF_FELLING, ...stumpDrops('eiche', false)],
  baum_birke: [...BROADLEAF_FELLING, ...stumpDrops('birke', false)],
  baum_buche: [...BROADLEAF_FELLING, ...stumpDrops('buche', false)],
  baum_kiefer: [...CONIFER_FELLING, ...stumpDrops('kiefer', true)],
  baum_weide: [...BROADLEAF_FELLING, ...stumpDrops('weide', false)],
  baum_mangrove: [...BROADLEAF_FELLING, ...stumpDrops(null, false)],
  baum_tanne: [...CONIFER_FELLING, ...stumpDrops(null, true)],
  baum_apfelbaum: [...BROADLEAF_FELLING, ...stumpDrops('apfelbaum', false), fruit('apfel', 2, 4, ['herbst'])],
  baum_kirschbaum: [...BROADLEAF_FELLING, ...stumpDrops('kirschbaum', false), fruit('kirsche', 3, 5, ['sommer'])],
  baum_birnbaum: [...BROADLEAF_FELLING, ...stumpDrops('birnbaum', false), fruit('birne', 2, 4, ['herbst'])],
  baum_walnussbaum: [...BROADLEAF_FELLING, ...stumpDrops('walnussbaum', false), fruit('walnuss', 3, 5, ['herbst'])],
  // One berry bush, three berries through the year; a twig now and then in every season.
  busch_beeren: [
    { item: 'walderdbeeren', min: 2, max: 4, jahreszeiten: ['fruehling'] },
    { item: 'himbeeren', min: 2, max: 4, jahreszeiten: ['sommer'] },
    { item: 'blaubeeren', min: 2, max: 4, jahreszeiten: ['sommer', 'herbst'] },
    { item: 'zweig', min: 1, max: 1, chance: 0.3 },
  ],
  busch_hasel: [
    { item: 'zweig', min: 1, max: 3 },
    { item: 'laub', min: 1, max: 2, jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
  ],
  busch_sanddorn: [{ item: 'zweig', min: 1, max: 2 }],
  pflanze_fasergras: [{ item: 'fasern', min: 1, max: 3 }],
  pflanze_strandhafer: [{ item: 'fasern', min: 1, max: 2 }],
  pflanze_kraeuter: [
    { item: 'schafgarbe', min: 1, max: 2, chance: 0.6, jahreszeiten: ['sommer', 'herbst'] },
    { item: 'wegerich', min: 1, max: 2, chance: 0.6, jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
    { item: 'baerlauch', min: 2, max: 3, jahreszeiten: ['fruehling'] },
  ],
  pflanze_steinpilz: [{ item: 'steinpilz', min: 1, max: 2, jahreszeiten: ['sommer', 'herbst'] }],
  pflanze_leuchtpilz: [{ item: 'leuchtpilz', min: 1, max: 2 }],
  fels_klein_gruenhain: SMALL_ROCK,
  fels_gross_gruenhain: LARGE_ROCK,
  fels_klein_wurzelhoehlen: SMALL_ROCK,
  fels_gross_wurzelhoehlen: LARGE_ROCK,
  // Salt crust on the coastal rocks (docs/SPIEL.md §6 "salz (Salzkruste)").
  fels_klein_salzkueste: [...SMALL_ROCK, { item: 'salz', min: 1, max: 2, chance: 0.5 }],
  fels_gross_salzkueste: [...LARGE_ROCK, { item: 'salz', min: 1, max: 3, chance: 0.6 }],
  erz_kupfer: [{ item: 'kupfererz', min: 2, max: 3 }],
  erz_zinn: [{ item: 'zinnerz', min: 2, max: 3 }],
  erz_salpeter: [{ item: 'salpeter', min: 1, max: 3 }],
  // Ground scatter picked up by hand: the first stones, flint, twigs and fibres come from here before any tool exists.
  deko_steinchen: [
    { item: 'stein', min: 1, max: 2 },
    { item: 'feuerstein', min: 1, max: 1, chance: 0.25 },
    { item: 'kies', min: 1, max: 1, chance: 0.5 },
  ],
  deko_laub: [
    { item: 'laub', min: 1, max: 2 },
    { item: 'zweig', min: 1, max: 1, chance: 0.6 },
  ],
  deko_graeser: [{ item: 'fasern', min: 1, max: 1 }],
  deko_blumen: [
    { item: 'blume_gelb', min: 1, max: 2, jahreszeiten: ['fruehling', 'sommer'] },
    { item: 'blume_rot', min: 1, max: 2, jahreszeiten: ['sommer'] },
    { item: 'blume_blau', min: 1, max: 2, jahreszeiten: ['sommer', 'herbst'] },
  ],
  deko_pilze: [
    { item: 'pfifferling', min: 1, max: 2, chance: 0.6, jahreszeiten: ['sommer', 'herbst'] },
    { item: 'fliegenpilz', min: 1, max: 1, chance: 0.4, jahreszeiten: ['sommer', 'herbst'] },
  ],
  deko_muscheln: [{ item: 'muschel', min: 1, max: 3 }],
  deko_treibholz: [{ item: 'treibholz', min: 1, max: 2 }],
  deko_tang: [{ item: 'tang', min: 1, max: 3 }],
};

/** Ids of the world objects that have drops (checked against the objects in tests/unit/content/items-drops.test.ts). */
export const WORLD_OBJECT_DROP_IDS: readonly string[] = Object.keys(DROPS);

/** All world objects (WORLD.md §7), with their drops. */
export const WORLD_OBJECTS: readonly WorldObjectInput[] = [...TREES, ...BUSHES, ...PLANTS, ...ROCKS, ...CRYSTALS, ...ORE_NODES, ...SCATTER].map((o) => {
  const drops = DROPS[o.id];
  return drops === undefined ? o : { ...o, drops: [...drops] };
});

// ---------------------------------------------------------------------------------------------
// Sprites of felled trees (naming convention of the M2-20 and M3-11 art; the validator counts them as used)
// ---------------------------------------------------------------------------------------------

/** Prefix of the tree ids (`baum_<art>`). */
const TREE_PREFIX = 'baum_';

/** Sprite of the stump a felled tree leaves: `<treeId>_stumpf` (M2-20 art, M3-11). */
export function treeStumpSpriteId(treeId: string): string {
  return `${treeId}_stumpf`;
}

/** Directions a felled trunk lies in (§14 "Der Baum fällt vom Spieler weg"): east/west share one sprite (mirrored for west). */
export const TRUNK_SPRITE_DIRECTIONS = ['seite', 'nord', 'sued'] as const;
/** One of them. */
export type TrunkSpriteDirection = (typeof TRUNK_SPRITE_DIRECTIONS)[number];

/** Sprite of a felled tree's lying trunk (M3-11 art): `baum_stamm_<art>` lying east (mirrored west), `…_nord`, `…_sued`. */
export function treeTrunkSpriteId(treeId: string, direction: TrunkSpriteDirection): string {
  const art = treeId.startsWith(TREE_PREFIX) ? treeId.slice(TREE_PREFIX.length) : treeId;
  return direction === 'seite' ? `baum_stamm_${art}` : `baum_stamm_${art}_${direction}`;
}
