/**
 * Ores (MASTERPROMPT §9.3, §13.2, §14; docs/WORLD.md §7 "Erze").
 *
 * Every ore exists as a surface/cave node `erz_<ore>` (src/content/worldObjects.ts); ores of the
 * underground biomes additionally form veins `ader_<ore>` as solid tile material
 * (src/content/terrain.ts, §14 "Im Untergrund Erzadern als grabbares Tile-Material").
 *
 * Hardness follows the tier table of §13.2 ("Abbaukraft ≥ Härte"): T0 tools (power 1) open copper
 * and tin, T1 (2) bog iron and iron ore, T2 (3) coal and silver, T3 (4) gold and clear quartz, T4 (5)
 * obsidian, magmite and sulfur, T5 (6) lumenite and prism quartz, T6 (7) nightsteel ore. Saltpetre
 * (Wurzelhöhlen T1–2) and gemstones (Tiefgrund T2–4) are not in that table and take the hardness of
 * the tier that opens their biome's deeper resources. Item drops are added with the items (M3).
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';

/** Lowest ore hardness (T0 tools, §13.2). */
export const ORE_HARDNESS_MIN = 1;
/** Highest ore hardness (nightsteel ore, T6 tools, §13.2). */
export const ORE_HARDNESS_MAX = 7;

/** Schema of one ore. */
export const oreSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** Required mining power (§13.2). */
    hardness: z.number().int().min(ORE_HARDNESS_MIN).max(ORE_HARDNESS_MAX),
    /** Biomes where nodes or veins of this ore occur (§9.3 resource column). */
    biomes: z.array(refSchema).min(1),
    /** Whether the ore forms `ader_<ore>` veins in the underground (terrain type exists). */
    vein: z.boolean(),
  })
  .strict();

/** One ore record. */
export type Ore = z.output<typeof oreSchema>;

/** The 16 ores of WORLD.md §7 in tier order. */
export const ORES: ReadonlyArray<z.input<typeof oreSchema>> = [
  { id: 'kupfer', name: { de: 'Kupfererz', en: 'Copper Ore' }, hardness: 1, biomes: ['gruenhain', 'wurzelhoehlen'], vein: true },
  { id: 'zinn', name: { de: 'Zinnerz', en: 'Tin Ore' }, hardness: 1, biomes: ['gruenhain', 'wurzelhoehlen'], vein: true },
  { id: 'raseneisen', name: { de: 'Raseneisenerz', en: 'Bog Iron Ore' }, hardness: 2, biomes: ['nebelmoor'], vein: false },
  { id: 'eisen', name: { de: 'Eisenerz', en: 'Iron Ore' }, hardness: 2, biomes: ['tiefgrund'], vein: true },
  { id: 'salpeter', name: { de: 'Salpeter', en: 'Saltpetre' }, hardness: 2, biomes: ['wurzelhoehlen'], vein: true },
  { id: 'kohle', name: { de: 'Steinkohle', en: 'Coal' }, hardness: 3, biomes: ['frostkamm'], vein: false },
  { id: 'silber', name: { de: 'Silbererz', en: 'Silver Ore' }, hardness: 3, biomes: ['frostkamm', 'tiefgrund'], vein: true },
  { id: 'gold', name: { de: 'Golderz', en: 'Gold Ore' }, hardness: 4, biomes: ['glutsand', 'tiefgrund'], vein: true },
  { id: 'klarquarz', name: { de: 'Klarquarz', en: 'Clear Quartz' }, hardness: 4, biomes: ['glutsand', 'tiefgrund'], vein: true },
  { id: 'edelstein', name: { de: 'Edelstein', en: 'Gemstone' }, hardness: 4, biomes: ['tiefgrund'], vein: true },
  { id: 'obsidian', name: { de: 'Obsidian', en: 'Obsidian' }, hardness: 5, biomes: ['aschenschlund', 'glutadern'], vein: true },
  { id: 'schwefel', name: { de: 'Schwefel', en: 'Sulfur' }, hardness: 5, biomes: ['aschenschlund'], vein: false },
  { id: 'magmit', name: { de: 'Magmit', en: 'Magmite' }, hardness: 5, biomes: ['aschenschlund', 'glutadern'], vein: true },
  { id: 'lumenit', name: { de: 'Lumenit', en: 'Lumenite' }, hardness: 6, biomes: ['scherbenhain', 'glutadern'], vein: true },
  { id: 'prismenquarz', name: { de: 'Prismenquarz', en: 'Prism Quartz' }, hardness: 6, biomes: ['scherbenhain'], vein: false },
  { id: 'nachtstahl', name: { de: 'Nachtstahl-Erz', en: 'Nightsteel Ore' }, hardness: 7, biomes: ['nachtherz'], vein: false },
];
