/**
 * AI profiles, loot tables and the spawn entries of the shadow brood's base family (schattenbrut.ts; MASTERPROMPT §12.4,
 * §19.4, §20.1, §D "Lumen-Scherben ≈ 15–25 pro aktiver Nacht auf Stufe 1, ×1,4 je Stufe"; M6-26, M6-27).
 *
 * **Profiles** (docs/SPIEL.md §11 "KI"): all four hunt what they notice (`jaeger`), know no fear (`mut` 0) and hunt far
 * from where they appeared; they avoid tiles brighter than 0,5 (§12.4) – the light eater only the glaring ones (> 0,9: the
 * §12.4 exception, it goes where the light is).
 * - `schleicher` – keen eyes and ears; hunts in pairs that take slots around the prey, one going in at a time (M6-18).
 * - `kriecher` – half blind, hears well; slow, it waits in the dark beside the path.
 * - `speier` – keeps five tiles from its prey and backs off when it comes closer than half of that (§19.4 "Fernkämpfer
 *   halten Abstand").
 * - `lichtfresser` – sees light from afar (a carried torch doubles every sight range anyway, §12.2).
 *
 * **Loot** (§12.4 "Beute: Lumen-Scherben – Hauptquelle für Lumen", §D): one weighted draw of Lumen shards at the effective
 * tier of the kill (the biome's where it is higher, `effectiveTier`); every tier opens an entry ten times as likely as all
 * before it, so the mean rises by about ×1,4 per tier: 1,5 shards at tier 0, 2 at tier 1 – an active night of about ten
 * kills on tier 1 gives 15–25 (§D) –, 2,9 at tier 2 … 16 at tier 7. The light eater, full of the light it ate, gives two
 * draws. No carcass: shadow brood dissolves.
 *
 * **Spawn entries**: the night spawner (§12.4) brings the brood into every biome that has a table – the Grünhain and the
 * Salt Coast so far (the deeper biomes' tables come with their creatures and take the same entries then; their variants are
 * data already). Stalkers are the common sight, crawlers and spitters rarer, a light eater the rarest.
 */
import type { z } from 'zod';
import { defineCreatureRecords, defineSpawnAdditions } from './define';
import { aiProfileSchema, lootTableSchema, type LootTableDef } from './schema';

/** A shadow brood's profile: hunts, fearless, far from home, avoids light above `meidetLicht`. */
function brutProfil(id: string, p: { sicht: number; gehoer: number; meidetLicht: number; streifen: number; rudel?: { ringTiles: number; angreiferZugleich: number }; fernkampfAbstand?: number }): z.input<typeof aiProfileSchema> {
  return {
    id,
    haltung: 'jaeger',
    sicht: p.sicht,
    gehoer: p.gehoer,
    fluchtDistanz: 0,
    mut: 0,
    leine: 60,
    streifen: p.streifen,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 2 },
    untersuchen: 8,
    gedaechtnis: 12,
    ...(p.rudel === undefined ? {} : { rudel: p.rudel }),
    ...(p.fernkampfAbstand === undefined ? {} : { fernkampfAbstand: p.fernkampfAbstand }),
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: p.meidetLicht,
    unerbittlich: false,
  };
}

/** Light above which shadow brood turns away (§12.4 "Meidet Licht > 0,5"); the light eater only glaring light (§12.1 > 0,9). */
const MEIDET = 0.5;
const MEIDET_LICHTFRESSER = 0.9;

/** AI profiles of the shadow brood, validated and frozen. */
export const SCHATTENBRUT_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  brutProfil('schleicher', { sicht: 16, gehoer: 1.6, meidetLicht: MEIDET, streifen: 10, rudel: { ringTiles: 3, angreiferZugleich: 1 } }),
  brutProfil('kriecher', { sicht: 8, gehoer: 2, meidetLicht: MEIDET, streifen: 4 }),
  brutProfil('speier', { sicht: 16, gehoer: 1.4, meidetLicht: MEIDET, streifen: 8, fernkampfAbstand: 5 }),
  brutProfil('lichtfresser', { sicht: 18, gehoer: 1.2, meidetLicht: MEIDET_LICHTFRESSER, streifen: 10 }),
]);

/**
 * Lumen shards by tier (see module comment): tier `t` opens the count range `[t]` with the weight 10^t.
 * Means per draw: 1,5 · 1,96 · 2,90 · 4,34 · 5,83 · 8,23 · 11,17 · 15,97 shards at T0 … T7.
 */
const LUMEN_JE_STUFE: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 6],
  [5, 7],
  [7, 10],
  [10, 13],
  [15, 18],
];
/** Weight step per tier of the shard entries. */
const LUMEN_GEWICHT_JE_STUFE = 10;

/** The shard entries of a shadow brood's loot table. */
function lumenBeute(): LootTableDef['beute'] {
  return LUMEN_JE_STUFE.map(([lo, hi], t) => ({ item: 'lumen_scherbe', gewicht: LUMEN_GEWICHT_JE_STUFE ** t, anzahl: [lo, hi] as [number, number], ...(t === 0 ? {} : { stufeAb: t }) }));
}

/** Loot tables of the shadow brood, validated and frozen. */
export const SCHATTENBRUT_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  { id: 'schleicher', ziehungen: [1, 1], beute: lumenBeute(), zerlegen: [] },
  { id: 'kriecher', ziehungen: [1, 1], beute: lumenBeute(), zerlegen: [] },
  { id: 'speier', ziehungen: [1, 1], beute: lumenBeute(), zerlegen: [] },
  // Full of the light it ate: two draws.
  { id: 'lichtfresser', ziehungen: [2, 2], beute: lumenBeute(), zerlegen: [] },
]);

/** The brood's nights in every biome that has a table (all seasons). */
const NACHT = [
  { kreatur: 'schleicher', gewicht: 4, gruppe: [1, 2] as [number, number] },
  { kreatur: 'kriecher', gewicht: 2, gruppe: [1, 1] as [number, number] },
  { kreatur: 'speier', gewicht: 2, gruppe: [1, 1] as [number, number] },
  { kreatur: 'lichtfresser', gewicht: 1, gruppe: [1, 1] as [number, number] },
];

/** Spawn additions of the shadow brood, validated and frozen. */
export const SCHATTENBRUT_SPAWN = defineSpawnAdditions('schattenbrut', [
  { biom: 'gruenhain', nacht: NACHT },
  { biom: 'salzkueste', nacht: NACHT },
]);
