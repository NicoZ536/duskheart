/**
 * Content entry point: the game's content registry plus the shared schemas and balance table.
 * Collections are defined here in dependency order; the validator (`npm run validate:content`)
 * loads `CONTENT` and checks schemas, references, texts and the §C counts.
 */
import { BIOMES, biomeSchema } from './biomes';
import { buildPartSchema } from './buildParts';
import { ALL_BUILD_PARTS } from './buildPartsAlle';
import { CONDITIONS, conditionSchema } from './conditions';
import { ITEMS, itemCountCategories } from './items/index';
import { INGREDIENT_GROUPS, ingredientGroupSchema, RECIPES, recipeSchema } from './recipes/index';
import { ORES, oreSchema } from './ores';
import { ContentRegistry } from './registry';
import { ROOM_TYPES, roomTypeSchema } from './roomTypes';
import { ref } from './schema/common';
import { SFX_PRESETS, sfxPresetSchema } from './sfx/index';
import { PARTICLE_EMITTERS, PARTICLE_KINDS, particleEmitterSchema, particleKindSchema } from './particles/index';
import { SKILLS, skillSchema } from './skills';
import { STATIONS, stationSchema } from './stations';
import { itemSchema } from './schema/item';
import { TERRAIN, terrainSchema } from './terrain';
import { WORLD_OBJECTS, worldObjectSchema } from './worldObjects';
import { armorSetSchema, RUESTUNGSSETS } from './ruestungssets';
import { PERKS, perkSchema } from './perks';
import { AI_PROFILES, CREATURES, LOOT_TABLES, SPAWN_TABLES, TRAPS, aiProfileSchema, creatureCountCategories, creatureSchema, lootTableSchema, spawnTableSchema, trapSchema } from './creatures/index';
import { PLACE_LAYOUTS, PLACE_LOOT, PLACE_TYPES } from './places/index';
import { placeDefSchema, placeLayoutSchema, placeLootSchema } from './places/schema';
import { WORLD_EVENTS } from './worldEvents/index';
import { worldEventSchema } from './worldEvents/schema';
import { MILESTONES, STAT_SOURCES, STATS } from './stats/index';
import { milestoneSchema, statSchema, statSourceSchema } from './stats/schema';
import { CHRONICLE_RULES } from './chronik/index';
import { chronicleRuleSchema, knowledgeSchema } from './chronik/schema';
import { KNOWLEDGE } from './wissen/index';
import { GUIDE_HINTS } from './guide/index';
import { guideHintSchema } from './guide/schema';
import { MECHANICS } from './vermittlung/index';
import { mechanicSchema } from './vermittlung/schema';
import { MUSIC_PIECES, SONGS, STINGERS, WAVETABLES, musicPieceSchema, songSchema, stingerSchema, wavetableSchema } from './music/index';
import { BOSSES, bossSchema } from './bosses/index';
import { BEACONS, VISIONS, beaconSchema, visionSchema } from './beacons/index';
import { UNLOCKS, unlockSchema } from './unlocks/index';
import { CROPS, cropSchema } from './farming/index';
import { FISH, fishSchema } from './fishing/index';
import { TIPS, tipSchema } from './tipps';

/** The registry holding every content collection of the game. */
export const CONTENT = new ContentRegistry()
  // World (M2, docs/WORLD.md §4/§7). Only trees count towards §C ("Baumarten", ADR-0006).
  .defineCollection('biomes', biomeSchema, BIOMES)
  .defineCollection('ores', oreSchema, ORES, { refs: [ref('biomes[]', 'biomes')] })
  .defineCollection('terrain', terrainSchema, TERRAIN, { refs: [ref('dig.becomes', 'terrain'), ref('dig.trench', 'terrain'), ref('ore', 'ores')] })
  .defineCollection('worldObjects', worldObjectSchema, WORLD_OBJECTS, {
    category: (o) => (o.kind === 'baum' ? ['trees'] : []),
    refs: [ref('biomes[]', 'biomes'), ref('ore', 'ores'), ref('drops[].item', 'items')],
  })
  // Items (M3, docs/SPIEL.md §2): one collection from all group files in src/content/items/; each item counts as `items` plus its specialist category (ADR-0006).
  // The M7 item blocks (src/content/schema/itemBlocks.ts, ADR-0207) name crops, fish, conditions, songs, unlocks and location types.
  .defineCollection('items', itemSchema, ITEMS, {
    category: itemCountCategories,
    refs: [
      ref('pflanzt', 'worldObjects'),
      ref('waffe.zustand.id', 'conditions'),
      ref('munition.zustand.id', 'conditions'),
      ref('saat.pflanze', 'crops'),
      ref('koeder.fische[]', 'fish'),
      ref('mahlzeit.zustaende[].id', 'conditions'),
      ref('trank.gibt[].id', 'conditions'),
      ref('trank.heilt[]', 'conditions'),
      ref('instrument.lieder[]', 'songs'),
      ref('bauplan.freischaltung', 'unlocks'),
      ref('ortskarte.ortstyp', 'locationTypes'),
    ],
  })
  // Recipes (M3-16, §15.1): products, ingredients and stations are items; each recipe counts once as `recipes` (ADR-0006).
  // Ingredient groups (M4-01, §15.1 "Zutaten … als Kategorie"): members are items; groups count nothing.
  .defineCollection('ingredientGroups', ingredientGroupSchema, INGREDIENT_GROUPS, { refs: [ref('items[]', 'items')] })
  .defineCollection('recipes', recipeSchema, RECIPES, {
    category: 'recipes',
    refs: [ref('ergebnis.item', 'items'), ref('zutaten[].item', 'items'), ref('zutaten[].gruppe', 'ingredientGroups'), ref('station', 'items'), ref('station', 'stations'), ref('freischaltung', 'unlocks')],
  })
  // Stations (M4-03 … M4-06, §15.2): each is a placeable item and counts as `stations` (§C).
  .defineCollection('stations', stationSchema, STATIONS, {
    category: 'stations',
    refs: [ref('id', 'items'), ref('sounds.laeuft', 'sfx'), ref('sounds.fertig', 'sfx')],
  })
  // Build parts (M4-11, M4-12, §16.1–§16.3): how an item is placed on the build grid; they count nothing themselves (the part items count as `items` and `buildParts`, ADR-0006).
  .defineCollection('buildParts', buildPartSchema, ALL_BUILD_PARTS, { refs: [ref('id', 'items')] })
  // Room types (M4-17, §16.4): count nothing (§C "Raumvorlagen" are the dungeon rooms of §21).
  .defineCollection('roomTypes', roomTypeSchema, ROOM_TYPES)
  // Player (M3-19, M3-32, docs/SPIEL.md §6): the conditions of §11.3 count as `statusEffects` (§C); the twelve skills of §23.2 count nothing (their perks will).
  .defineCollection('conditions', conditionSchema, CONDITIONS, { category: 'statusEffects' })
  .defineCollection('skills', skillSchema, SKILLS)
  // Armour sets (M6-12, §13.1 "Rüstungssets mit Set-Boni"): four armour items each; every set counts as `armorSets` (§C "12 Sets").
  .defineCollection('armorSets', armorSetSchema, RUESTUNGSSETS, { category: 'armorSets', refs: [ref('teile[]', 'items')] })
  // Perks (M6-34, §23.2): a skill's choice at 30/60/90 with its effects as data; each counts as `perks` (§C).
  .defineCollection('perks', perkSchema, PERKS, { category: 'perks', refs: [ref('fertigkeit', 'skills')] })
  // Audio (M3-33, docs/SPIEL.md §5): every SFX preset of src/content/sfx/ counts as `sfx` (§C "Soundeffekte").
  .defineCollection('sfx', sfxPresetSchema, SFX_PRESETS, { category: 'sfx', refs: [ref('schichten[].quelle.tabelle', 'wavetables')] })
  // Creatures (M6-13 … M6-32, docs/SPIEL.md §11, src/content/creatures/): AI profiles; loot tables (id = the creature, the
  // source `drop:<kreatur>` of their items); the creatures (§C `creatures` without variants, elites also `elites`); the
  // spawn tables of the biomes; the traps (id = the trap item, checked by the validator rule `kreatur`).
  .defineCollection('aiProfiles', aiProfileSchema, AI_PROFILES)
  .defineCollection('lootTables', lootTableSchema, LOOT_TABLES, { refs: [ref('beute[].item', 'items'), ref('zerlegen[].item', 'items')] })
  .defineCollection('creatures', creatureSchema, CREATURES, {
    category: creatureCountCategories,
    refs: [
      ref('biome[]', 'biomes'),
      ref('varianten[].biome[]', 'biomes'),
      ref('ki', 'aiProfiles'),
      ref('beute', 'lootTables'),
      ref('angriffe[].zustand.id', 'conditions'),
      ref('angriffe[].sound', 'sfx'),
      ref('sounds.laut', 'sfx'),
      ref('sounds.treffer', 'sfx'),
      ref('sounds.tod', 'sfx'),
    ],
  })
  .defineCollection('spawnTables', spawnTableSchema, SPAWN_TABLES, {
    refs: [ref('id', 'biomes'), ref('tag[].kreatur', 'creatures'), ref('nacht[].kreatur', 'creatures'), ref('tag[].ort.boden[]', 'terrain'), ref('nacht[].ort.boden[]', 'terrain')],
  })
  .defineCollection('traps', trapSchema, TRAPS)
  // Particles (M5-11, src/content/particles/): kinds and sources of the GPU particles; they count nothing towards §C.
  .defineCollection('particleKinds', particleKindSchema, PARTICLE_KINDS, { refs: [ref('spritzer', 'particleKinds')] })
  .defineCollection('particleEmitters', particleEmitterSchema, PARTICLE_EMITTERS, { refs: [ref('art', 'particleKinds')] })
  // M7 (docs/SPIEL.md §16–§30, ADR-0207). Places (§18, src/content/places/): the location types that fill the world's slots
  // (§C "Ortstypen" counts those with `zaehlt`), their layouts and their chest loot – aggregated from strands B, C and F.
  .defineCollection('locationTypes', placeDefSchema, PLACE_TYPES, {
    category: (p) => (p.zaehlt ? ['locationTypes'] : []),
    refs: [ref('waechter[].creature', 'creatures'), ref('segen.zustand', 'conditions'), ref('stinger', 'stingers')],
  })
  .defineCollection('placeLayouts', placeLayoutSchema, PLACE_LAYOUTS, {
    refs: [ref('ortstyp', 'locationTypes'), ref('biom', 'biomes'), ref('legende{}.boden', 'terrain'), ref('legende{}.objekt', 'worldObjects')],
  })
  .defineCollection('placeLoot', placeLootSchema, PLACE_LOOT, { refs: [ref('beute[].item', 'items'), ref('garantiert[].item', 'items')] })
  // World events (§10, src/content/worldEvents/, strand B): the register of all eleven; the validator rule `ereignisse` checks
  // the announcement, the chronicle text and the Funke hint of every event that runs.
  .defineCollection('worldEvents', worldEventSchema, WORLD_EVENTS, { refs: [ref('ankuendigung.klang', 'sfx')] })
  // The observers' tables (§17, §23): every strand adds what its events count, tell and explain – statistics and their
  // sources, milestones, chronicle rules, knowledge, Funke and context hints, the mechanics register. They count nothing.
  .defineCollection('stats', statSchema, STATS)
  .defineCollection('statSources', statSourceSchema, STAT_SOURCES, { refs: [ref('statistik', 'stats')] })
  .defineCollection('milestones', milestoneSchema, MILESTONES)
  .defineCollection('chronicleRules', chronicleRuleSchema, CHRONICLE_RULES)
  .defineCollection('knowledge', knowledgeSchema, KNOWLEDGE)
  .defineCollection('guideHints', guideHintSchema, GUIDE_HINTS)
  .defineCollection('mechanics', mechanicSchema, MECHANICS, { refs: [ref('wissen', 'knowledge')] })
  // Bosses, unlocks, beacons, visions (§22, strand F, M7-32 … M7-36): every boss counts as `bosses` (§C "Bosse"); the
  // registry of §23.1 and the six beacons in `BEACON_BIOMES` order count nothing. Item references of bosses and beacons
  // (loot, cores) are checked by the validator rule `boss` (tools/validator/boss.ts), the items declare them as sources.
  .defineCollection('bosses', bossSchema, BOSSES, { category: 'bosses', refs: [ref('biom', 'biomes'), ref('arena', 'placeLayouts'), ref('phasen[].angriffe[].kreatur', 'creatures')] })
  .defineCollection('unlocks', unlockSchema, UNLOCKS)
  .defineCollection('beacons', beaconSchema, BEACONS, { refs: [ref('biom', 'biomes'), ref('freischaltungen[]', 'unlocks')] })
  .defineCollection('visions', visionSchema, VISIONS)
  // Crops and fish (§20, strand D, M7-21 … M7-24): every crop counts as `crops` (§C "Nutzpflanzen"), every fish as `fish`
  // (§C "Fischarten"); their harvest and raw items, seeds and baits are checked by the validator rule `feld` (tools/validator/feld.ts).
  .defineCollection('crops', cropSchema, CROPS, { category: 'crops' })
  .defineCollection('fish', fishSchema, FISH, { category: 'fish', refs: [ref('biome[]', 'biomes')] })
  // Music (§24, strand A, M7-03 … M7-05, M7-31): the pieces in tracker notation (§C "Musikstücke" counts those with
  // `zaehlt` – not the stingers' and the songs'), their wavetables, the stingers over the music and the songs of the
  // player's instruments (the items' `instrument.lieder[]` name them; a song's `instrument` is checked by the validator
  // rule `musik` – an instrument is no source or use of an item, src/content/items/relations.ts).
  .defineCollection('wavetables', wavetableSchema, WAVETABLES)
  .defineCollection('music', musicPieceSchema, MUSIC_PIECES, { category: (p) => (p.zaehlt ? ['music'] : []), refs: [ref('instrumente[].tabelle', 'wavetables')] })
  .defineCollection('stingers', stingerSchema, STINGERS, { refs: [ref('stueck', 'music')] })
  .defineCollection('songs', songSchema, SONGS, { refs: [ref('stueck', 'music')] })
  // Tips and lore of the loading screen (M7-50, strand H; docs/SPIEL.md §25, §29 `tipp_<nn>`).
  .defineCollection('tips', tipSchema, TIPS);

export { BALANCE, SEASON_IDS, type Balance, type SeasonId, type WorldSizePreset } from './balance';
export { BIOMES, MAX_DAY_AMPLITUDE_C, PALETTE_RAMP_NAMES, WORLD_LAYERS, biomeSchema, paletteRefSchema, worldLayerSchema, type Biome, type WorldLayer } from './biomes';
export { CONTENT_CATEGORIES, contentCategorySchema, isContentCategory, type ContentCategory } from './categories';
export { deepFreeze, type DeepReadonly } from './freeze';
export { ORES, ORE_HARDNESS_MAX, ORE_HARDNESS_MIN, oreSchema, type Ore } from './ores';
export {
  COLLECTION_NAME_PATTERN,
  ContentError,
  ContentRegistry,
  type CategoryMapping,
  type CollectionMap,
  type CollectionOptions,
  type ContentCollection,
  type ContentRecord,
  type ContentRegistryView,
  type ReferenceUse,
} from './registry';
export * from './schema/common';
export {
  FOOTSTEP_MATERIALS,
  TERRAIN,
  TERRAIN_KINDS,
  TILESET_VARIANTS_MAX,
  TOOL_KINDS,
  VEIN_PREFIX,
  terrainSchema,
  terrainTilesetSchema,
  veinTerrainId,
  type FootstepMaterial,
  type Terrain,
  type TerrainKind,
  type ToolKind,
} from './terrain';
export {
  DROP_OCCASIONS,
  WORLD_OBJECT_DROP_IDS,
  WORLD_OBJECTS,
  WORLD_OBJECT_KINDS,
  worldObjectDropSchema,
  worldObjectSchema,
  type DropOccasion,
  type WorldObject,
  type WorldObjectDrop,
  type WorldObjectKind,
} from './worldObjects';
export * from './items/index';
export * from './recipes/index';
export * from './schema/item';
export * from './conditions';
export * from './skills';
export * from './stations';
export * from './ruestungssets';
export * from './perks';
