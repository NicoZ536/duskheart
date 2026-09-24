/**
 * Skills (MASTERPROMPT §23.2 "Learning by Doing", M3-32): the twelve skills as content data. The skill
 * system (src/game/skills) keeps the levels; the numbers of the level curve are in `BALANCE.skills`.
 *
 * - `name`, `beschreibung` (tooltip), `wirkung` (what "+0,5 % Wirkung je Stufe" improves in this skill's
 *   area, LocalizedText).
 * - `quellen`: the actions that give experience in this skill, each with its points [XP per action or,
 *   for `proSekunde` sources, per second]. Systems report an action with its source id
 *   (`SkillsSystem.award`); an id belongs to exactly one skill. Sources whose system comes later
 *   (smithing, cooking, farming, combat, Lumen) are listed with it, so every skill has its sources as
 *   data from the start.
 * - Perks: at the levels of `BALANCE.skills.perkLevels` the player chooses one of two perks; the perk
 *   content of each skill follows with its milestone (§23.2 "72 Perks").
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema } from './schema/common';

/** Largest XP of one source [XP]. */
const MAX_SOURCE_XP = 1000;

/** One experience source of a skill. */
export const skillSourceSchema = z
  .object({
    id: idSchema,
    /** Experience per action [XP], or per second when `proSekunde`. */
    ep: z.number().positive().max(MAX_SOURCE_XP),
    proSekunde: z.literal(true).optional(),
  })
  .strict();
/** One experience source. */
export type SkillSource = z.output<typeof skillSourceSchema>;

/** Schema of one skill. */
export const skillSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    beschreibung: localizedTextSchema,
    /** What each level improves (+0,5 % per level, §23.2). */
    wirkung: localizedTextSchema,
    quellen: z.array(skillSourceSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.quellen.map((q) => q.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['quellen'], message: 'source ids must be unique' });
  });

/** One skill (validated). */
export type SkillDef = z.output<typeof skillSchema>;
/** Skill data as written below. */
export type SkillInput = z.input<typeof skillSchema>;

/** The twelve skills of §23.2 in its order. */
export const SKILLS: readonly SkillInput[] = [
  {
    id: 'holzfaellen',
    name: { de: 'Holzfällen', en: 'Woodcutting' },
    beschreibung: { de: 'Bäume fällen und Stümpfe roden.', en: 'Felling trees and clearing stumps.' },
    wirkung: { de: 'Mehr Wirkung je Axthieb an Bäumen.', en: 'More effect per axe blow on trees.' },
    quellen: [
      { id: 'baum_treffer', ep: 1 },
      { id: 'baum_gefaellt', ep: 8 },
      { id: 'stumpf_gerodet', ep: 4 },
    ],
  },
  {
    id: 'bergbau',
    name: { de: 'Bergbau', en: 'Mining' },
    beschreibung: { de: 'Steine, Erze und Kristalle abbauen.', en: 'Mining stone, ore and crystals.' },
    wirkung: { de: 'Mehr Wirkung je Spitzhackenschlag.', en: 'More effect per pickaxe strike.' },
    quellen: [
      { id: 'gestein_treffer', ep: 1 },
      { id: 'gestein_abgebaut', ep: 6 },
      { id: 'erz_abgebaut', ep: 10 },
    ],
  },
  {
    id: 'sammeln',
    name: { de: 'Sammeln & Kräuter', en: 'Foraging & Herbs' },
    beschreibung: { de: 'Beeren, Pilze, Kräuter, Fasern und Blumen sammeln, graben.', en: 'Gathering berries, mushrooms, herbs, fibres and flowers, digging.' },
    wirkung: { de: 'Schnelleres Sammeln und Graben.', en: 'Faster gathering and digging.' },
    quellen: [
      { id: 'pflanze_gesammelt', ep: 2 },
      { id: 'kraut_gesammelt', ep: 3 },
      { id: 'boden_gegraben', ep: 1 },
    ],
  },
  {
    id: 'handwerk',
    name: { de: 'Handwerk', en: 'Crafting' },
    beschreibung: { de: 'Werkzeuge, Ausrüstung und Bauteile herstellen.', en: 'Making tools, equipment and building parts.' },
    wirkung: { de: 'Schnelleres Herstellen.', en: 'Faster crafting.' },
    quellen: [
      { id: 'gegenstand_hergestellt', ep: 5 },
      { id: 'station_gebaut', ep: 15 },
    ],
  },
  {
    id: 'schmieden',
    name: { de: 'Schmieden', en: 'Smithing' },
    beschreibung: { de: 'Erz schmelzen und Metall schmieden.', en: 'Smelting ore and forging metal.' },
    wirkung: { de: 'Schnelleres Schmelzen und Schmieden.', en: 'Faster smelting and forging.' },
    quellen: [
      { id: 'barren_geschmolzen', ep: 6 },
      { id: 'metall_geschmiedet', ep: 12 },
    ],
  },
  {
    id: 'kochen',
    name: { de: 'Kochen & Brauen', en: 'Cooking & Brewing' },
    beschreibung: { de: 'Gerichte kochen, Getränke und Tränke brauen.', en: 'Cooking dishes, brewing drinks and potions.' },
    wirkung: { de: 'Stärkere Mahlzeit- und Trankwirkung.', en: 'Stronger meal and potion effects.' },
    quellen: [
      { id: 'gericht_gekocht', ep: 8 },
      { id: 'trank_gebraut', ep: 10 },
    ],
  },
  {
    id: 'landwirtschaft',
    name: { de: 'Landwirtschaft & Tierzucht', en: 'Farming & Husbandry' },
    beschreibung: { de: 'Säen, ernten und Tiere halten.', en: 'Sowing, harvesting and keeping animals.' },
    wirkung: { de: 'Schnelleres Wachstum und mehr Ertrag.', en: 'Faster growth and larger yields.' },
    quellen: [
      { id: 'saat_gepflanzt', ep: 2 },
      { id: 'feld_geerntet', ep: 4 },
      { id: 'tier_versorgt', ep: 3 },
    ],
  },
  {
    id: 'nahkampf',
    name: { de: 'Nahkampf', en: 'Melee' },
    beschreibung: { de: 'Kämpfen mit Schwert, Axt, Keule, Speer und Dolch.', en: 'Fighting with sword, axe, club, spear and dagger.' },
    wirkung: { de: 'Mehr Nahkampfschaden.', en: 'More melee damage.' },
    quellen: [
      { id: 'nahkampf_treffer', ep: 2 },
      { id: 'nahkampf_sieg', ep: 10 },
    ],
  },
  {
    id: 'fernkampf',
    name: { de: 'Fernkampf', en: 'Ranged' },
    beschreibung: { de: 'Kämpfen mit Bogen, Armbrust, Schleuder und Wurfwaffen.', en: 'Fighting with bow, crossbow, sling and throwing weapons.' },
    wirkung: { de: 'Mehr Fernkampfschaden.', en: 'More ranged damage.' },
    quellen: [
      { id: 'fernkampf_treffer', ep: 2 },
      { id: 'fernkampf_sieg', ep: 10 },
    ],
  },
  {
    id: 'verteidigung',
    name: { de: 'Verteidigung', en: 'Defence' },
    beschreibung: { de: 'Blocken, Parieren und Ausweichen.', en: 'Blocking, parrying and dodging.' },
    wirkung: { de: 'Weniger Schaden beim Blocken.', en: 'Less damage while blocking.' },
    quellen: [
      { id: 'treffer_geblockt', ep: 3 },
      { id: 'parade', ep: 8 },
      { id: 'ausweichrolle', ep: 1 },
    ],
  },
  {
    id: 'ueberleben',
    name: { de: 'Überleben', en: 'Survival' },
    beschreibung: {
      de: 'Schleichen, Schwimmen, Kälte und Hitze ertragen, Nächte überstehen.',
      en: 'Sneaking, swimming, enduring cold and heat, getting through the nights.',
    },
    wirkung: { de: 'Hunger, Durst und Temperatur setzen dir weniger zu.', en: 'Hunger, thirst and temperature wear on you less.' },
    quellen: [
      { id: 'schleichen', ep: 0.2, proSekunde: true },
      { id: 'schwimmen', ep: 0.3, proSekunde: true },
      { id: 'temperatur_ertragen', ep: 0.2, proSekunde: true },
      { id: 'nacht_ueberstanden', ep: 25 },
    ],
  },
  {
    id: 'lumenkunde',
    name: { de: 'Lumenkunde', en: 'Lumen Lore' },
    beschreibung: { de: 'Lumen-Scherben sammeln, Lumen-Geräte bauen und laden.', en: 'Collecting Lumen shards, building and charging Lumen devices.' },
    wirkung: { de: 'Mehr Lumen je Ladung.', en: 'More Lumen per charge.' },
    quellen: [
      { id: 'lumen_gesammelt', ep: 2 },
      { id: 'lumen_geraet_gebaut', ep: 15 },
    ],
  },
];
