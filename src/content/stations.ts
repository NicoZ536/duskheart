/**
 * Stations (MASTERPROMPT §15.1, §15.2 "Stationen (mindestens 30)", §15.4; docs/SPIEL.md §8 "Stationen T0 (M4-05)
 * … T1 (M4-06)"; M4-03 … M4-06, M4-09).
 *
 * A station is a placeable item (`id` = the item's id, src/content/items/stationen.ts; the campfire and the
 * workbench are basics, src/content/items/grundlagen.ts) that recipes name as their `station`. This record
 * says how it works:
 * - `linie` and `stufe`: stations of one line are its stages (Werkbank I = `werkbank` stage 1, Werkbank II =
 *   `werkbank_2` stage 2). A recipe of a lower stage can be made at every higher stage of the line (§15.1
 *   "Stationsstufen erhöhen … verfügbare Rezepte"); tempo and quality points of each stage are balance
 *   values (`BALANCE.stations.stages`, §15.1 "… Qualität, Tempo"). The next stage is an upgrade recipe at
 *   the station (`aufwerten`, docs/SPIEL.md §8).
 * - `nurAufwerten`: the stage arises only by upgrading the stage below in place – no recipe makes its item and taking
 *   it down never gives it back whole (src/game/stations/system.ts), so the build menu does not offer it as a station
 *   to set up (Werkbank II).
 * - `art`: `handwerk` – the player's crafting queue runs while the player stands at it (§15.1) –, or
 *   `verarbeitung` – the station has input, fuel and output slots and runs its batches on its own, catching
 *   up by timestamp in unloaded chunks (§15.1 "Verarbeitungsstationen"). `verarbeitung` gives the slot
 *   counts and whether it burns fuel (its fuel rules: `BALANCE.stations.fuel`).
 * - `brennt`: it only works while it burns (the campfire: a lit fire in reach, src/game/stations/campfire.ts).
 * - `groesse`: footprint in tiles (width × depth) for the build grid (§16.1 "Objekte (1×1 bis 4×4)").
 * - `reparatur`: which durable categories up to which tier it mends (§13.1 "Reparatur an Werkbank, Amboss
 *   oder Schleifstein (anteilige Materialkosten)", src/game/repair).
 * - `sounds`: how it sounds (§27 "Crafting, Bauen") – its body set up and taken down (`koerper`, a sound material of
 *   src/content/sfx/materials.ts), the loop while it works (`laeuft`: a batch, or the crafting queue at a hand
 *   station) and a finished piece or batch (`fertig`). Every stage of a line sounds like its line. This is the only
 *   table of station sounds: the audio plays what it says (src/audio/eventMap.ts, src/audio/loopSources.ts).
 * - `erfahrung`: an experience source of src/content/skills.ts the work at it gives besides Handwerk (§23.2
 *   "Learning by Doing"): a piece finished at a hand station, a product taken out of a processing station
 *   (the anvil: `metall_geschmiedet`, the smelting furnace: `barren_geschmolzen`).
 * - `licht`: the light a fired processing station gives while a fuel piece burns in it (§12.2 "Feuerschale/Kohlebecken",
 *   M5-35) – radius [tiles], brightness at the source [light level], flicker [0–1], how far the fire sits behind the
 *   middle of the station's front edge [px] – inside its body, which it lights only through its openings (the sprite's
 *   glow) – and how high above the ground it burns [px], the palette reference of its colour (docs/RENDER.md §1). It joins the light source list of §12.1 (src/game/stations/light.ts): light map, fear and renderer.
 *
 * The stations count towards §C "Stationen" (registry collection `stations`, src/content/index.ts); the
 * placed station is drawn with the sprite `obj_<id>` (docs/SPIEL.md §8), its icon is the item's `icon_<id>`.
 */
import { z } from 'zod';
import { BALANCE } from './balance';
import { deepFreeze } from './freeze';
import { DURABLE_CATEGORIES } from './schema/item';
import { idSchema, tierSchema } from './schema/common';
import { paletteRefSchema } from './biomes';
import { sfxIdSchema } from './schema/item';
import { SOUND_MATERIALS } from './sfx/materials';

/** How a station works. */
export const STATION_KINDS = ['handwerk', 'verarbeitung'] as const;
/** One station kind. */
export type StationKind = (typeof STATION_KINDS)[number];

/** Highest stage of a station line (Schmelzofen I–III, Amboss Bronze … Magmit: §15.2). */
export const STATION_STAGE_MAX = 5;
/** Largest light radius of a station [tiles] (§12.2: the brightest fires reach 8–10 tiles). */
export const STATION_LIGHT_RADIUS_MAX = 12;
/** Largest brightness of a station's light at the source [light level]. */
export const STATION_LIGHT_INTENSITY_MAX = 3;
/** Highest glow of a station above its ground point [px] (the G-buffer's height range). */
export const STATION_LIGHT_HEIGHT_MAX = 64;
/** Deepest fire behind a station's front edge [px]: within its front row of tiles (a tile is 16 px). */
export const STATION_LIGHT_DEPTH_MAX = 12;
/** Largest side of a station's footprint [tiles] (§16.1 "Objekte (1×1 bis 4×4)"). */
export const STATION_SIDE_MAX = 4;
/** Most input or output slots of a processing station [slots]. */
export const STATION_SLOTS_MAX = 4;

const side = z.number().int().min(1).max(STATION_SIDE_MAX);
const slots = z.number().int().min(1).max(STATION_SLOTS_MAX);

/** Schema of one station. */
export const stationSchema = z
  .object({
    /** The placeable item this station is. */
    id: idSchema,
    /** Station line: the id of its first stage. */
    linie: idSchema,
    /** Stage in its line (1 = first). */
    stufe: z.number().int().min(1).max(STATION_STAGE_MAX),
    art: z.enum(STATION_KINDS),
    /** Footprint [tiles]. */
    groesse: z.object({ b: side, t: side }).strict(),
    /** Works only while it burns (a lit campfire). */
    brennt: z.literal(true).optional(),
    /** Arises only by upgrading the stage below in place; never set up from an item (not offered in the build menu). */
    nurAufwerten: z.literal(true).optional(),
    /** Slots of a processing station; `brennstoff`: it has a fuel slot. */
    verarbeitung: z.object({ eingang: slots, ausgang: slots, brennstoff: z.boolean() }).strict().optional(),
    /** Mending: the durable categories it repairs up to tier `bisStufe`. */
    reparatur: z
      .object({ kategorien: z.array(z.enum(DURABLE_CATEGORIES)).min(1), bisStufe: tierSchema })
      .strict()
      .optional(),
    /** Body set up and taken down, loop while it works, a finished piece or batch. */
    sounds: z.object({ koerper: z.enum(SOUND_MATERIALS), laeuft: sfxIdSchema, fertig: sfxIdSchema }).strict(),
    /** Experience source of the work at it (src/content/skills.ts). */
    erfahrung: idSchema.optional(),
    /** Light while its fuel burns: radius [tiles], brightness, flicker, depth behind the front edge and height of the fire [px], colour. */
    licht: z
      .object({
        radiusTiles: z.number().positive().max(STATION_LIGHT_RADIUS_MAX),
        intensitaet: z.number().positive().max(STATION_LIGHT_INTENSITY_MAX),
        flackern: z.number().min(0).max(1),
        tiefePx: z.number().min(0).max(STATION_LIGHT_DEPTH_MAX),
        hoehePx: z.number().min(0).max(STATION_LIGHT_HEIGHT_MAX),
        farbe: paletteRefSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if ((s.art === 'verarbeitung') !== (s.verarbeitung !== undefined)) issue('verarbeitung', 'exactly the processing stations have slots');
    if (s.stufe === 1 && s.linie !== s.id) issue('linie', 'the first stage of a line names the line');
    if (s.stufe > 1 && s.linie === s.id) issue('linie', 'a higher stage belongs to the line of its first stage');
    if (s.nurAufwerten === true && s.stufe === 1) issue('nurAufwerten', 'only a higher stage arises by upgrading the stage below');
    if (!Object.hasOwn(BALANCE.stations.stages, s.id)) issue('id', `no stage values in BALANCE.stations.stages for "${s.id}"`);
    const fuel = s.verarbeitung?.brennstoff === true;
    if (fuel !== Object.hasOwn(BALANCE.stations.fuel, s.id)) issue('verarbeitung', `fuel rules in BALANCE.stations.fuel exactly for stations with a fuel slot ("${s.id}")`);
    if (s.reparatur !== undefined && new Set(s.reparatur.kategorien).size !== s.reparatur.kategorien.length) issue('reparatur', 'categories must be unique');
    if (s.licht !== undefined && !fuel) issue('licht', 'only a station that burns fuel gives light');
  });

/** One station (validated). */
export type StationDef = z.output<typeof stationSchema>;
/** Station data as written here. */
export type StationInput = z.input<typeof stationSchema>;

/** Error in the station content. */
export class StationContentError extends Error {
  override readonly name = 'StationContentError';
}

/** Validates the stations (schema, unique ids, each line with consecutive stages from 1) and freezes them. */
export function defineStations(records: readonly StationInput[]): readonly StationDef[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = stationSchema.safeParse(raw);
    if (!r.success) throw new StationContentError(`Station [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new StationContentError(`duplicate station "${r.data.id}"`);
    seen.add(r.data.id);
    return r.data;
  });
  const lines = new Map<string, number[]>();
  for (const s of parsed) lines.set(s.linie, [...(lines.get(s.linie) ?? []), s.stufe]);
  for (const [line, stages] of lines) {
    const sorted = [...stages].sort((a, b) => a - b);
    if (sorted.some((st, i) => st !== i + 1)) throw new StationContentError(`station line "${line}" must have the stages 1 … ${sorted.length} once each, has ${stages.join(', ')}`);
  }
  deepFreeze(parsed);
  return parsed;
}

/** Durable categories a smith or bench mends (§13.1 "Haltbarkeit für Werkzeuge, Waffen, Rüstung"). */
const ALL_DURABLE = [...DURABLE_CATEGORIES];
/** Tools and weapons: what a grindstone sharpens. */
const EDGES = ['werkzeug', 'waffe'] as const;

/** The workbench, both stages: planing and knocking on wood, a finished piece set down on the bench. */
const WERKBANK_SOUNDS = { koerper: 'holz', laeuft: 'sfx_station_werkbank', fertig: 'sfx_station_werkbank_fertig' } as const;

/** The stations T0 and T1 (docs/SPIEL.md §8). */
export const STATIONS = defineStations([
  // ---- T0 (M4-05) ----
  // The campfire: roasts and chars at a lit fire (the light system keeps the placed fire and its fuel).
  { id: 'lagerfeuer', linie: 'lagerfeuer', stufe: 1, art: 'handwerk', groesse: { b: 1, t: 1 }, brennt: true, sounds: { koerper: 'holz', laeuft: 'sfx_station_brutzeln', fertig: 'sfx_station_brutzeln_fertig' } },
  // Werkbank I: the first bench; mends the stone tools and the spear.
  { id: 'werkbank', linie: 'werkbank', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, reparatur: { kategorien: ALL_DURABLE, bisStufe: 0 }, sounds: WERKBANK_SOUNDS },
  { id: 'saegebock', linie: 'saegebock', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, sounds: { koerper: 'holz', laeuft: 'sfx_station_saege', fertig: 'sfx_station_saege_fertig' } },
  { id: 'steinmetzbank', linie: 'steinmetzbank', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, sounds: { koerper: 'stein', laeuft: 'sfx_station_meissel', fertig: 'sfx_station_meissel_fertig' } },
  // Drying in the wind needs no fuel.
  { id: 'trockengestell', linie: 'trockengestell', stufe: 1, art: 'verarbeitung', groesse: { b: 2, t: 1 }, verarbeitung: { eingang: 2, ausgang: 2, brennstoff: false }, sounds: { koerper: 'holz', laeuft: 'sfx_station_trocknen', fertig: 'sfx_station_trocknen_fertig' } },
  // The kiln smoulders under its earth: a low red glow from its vents, steady – it lights the ground around it a
  // little, far less than an open fire (§12.2 "Lagerfeuer 8"). Its fire sits in the middle of the mound.
  {
    id: 'koehlermeiler',
    linie: 'koehlermeiler',
    stufe: 1,
    art: 'verarbeitung',
    groesse: { b: 2, t: 2 },
    verarbeitung: { eingang: 1, ausgang: 1, brennstoff: true },
    sounds: { koerper: 'lehm', laeuft: 'sfx_station_meiler', fertig: 'sfx_station_meiler_fertig' },
    licht: { radiusTiles: 3, intensitaet: 0.6, flackern: 0.1, tiefePx: 4, hoehePx: 8, farbe: 'feuer.2' },
  },
  // The clay oven glows through its fire mouth at the foot of its dome; the fire burns in the dome's middle.
  {
    id: 'lehmofen',
    linie: 'lehmofen',
    stufe: 1,
    art: 'verarbeitung',
    groesse: { b: 2, t: 2 },
    verarbeitung: { eingang: 2, ausgang: 2, brennstoff: true },
    sounds: { koerper: 'lehm', laeuft: 'sfx_station_ofen', fertig: 'sfx_station_ofen_fertig' },
    licht: { radiusTiles: 4, intensitaet: 0.9, flackern: 0.2, tiefePx: 4, hoehePx: 5, farbe: 'feuer.3' },
  },
  // ---- T1 (M4-06) ----
  // Werkbank II with tool wall and planing bench: a quarter faster, better pieces, mends bronze.
  { id: 'werkbank_2', linie: 'werkbank', stufe: 2, art: 'handwerk', groesse: { b: 2, t: 1 }, nurAufwerten: true, reparatur: { kategorien: ALL_DURABLE, bisStufe: 1 }, sounds: WERKBANK_SOUNDS },
  // The smelting furnace burns hottest: yellow-white light from its open top and its mouth, the farthest of the three
  // (still short of the camp fire's 8 tiles: its fire burns inside the shaft).
  {
    id: 'schmelzofen',
    linie: 'schmelzofen',
    stufe: 1,
    art: 'verarbeitung',
    groesse: { b: 2, t: 2 },
    verarbeitung: { eingang: 2, ausgang: 2, brennstoff: true },
    sounds: { koerper: 'stein', laeuft: 'sfx_station_blasebalg', fertig: 'sfx_station_schmelzen_fertig' },
    erfahrung: 'barren_geschmolzen',
    licht: { radiusTiles: 6, intensitaet: 1.2, flackern: 0.25, tiefePx: 6, hoehePx: 16, farbe: 'feuer.4' },
  },
  { id: 'amboss_bronze', linie: 'amboss_bronze', stufe: 1, art: 'handwerk', groesse: { b: 1, t: 1 }, reparatur: { kategorien: ALL_DURABLE, bisStufe: 1 }, sounds: { koerper: 'metall', laeuft: 'sfx_station_amboss', fertig: 'sfx_station_amboss_fertig' }, erfahrung: 'metall_geschmiedet' },
  { id: 'schleifstein', linie: 'schleifstein', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, reparatur: { kategorien: [...EDGES], bisStufe: 1 }, sounds: { koerper: 'stein', laeuft: 'sfx_station_schleifstein', fertig: 'sfx_station_schleifstein_fertig' } },
  { id: 'spinnrad', linie: 'spinnrad', stufe: 1, art: 'handwerk', groesse: { b: 1, t: 1 }, sounds: { koerper: 'holz', laeuft: 'sfx_station_spinnrad', fertig: 'sfx_station_spinnrad_fertig' } },
  // ---- The armoury (M6-12, M6-31; items src/content/items/ruestung.ts, recipes src/content/recipes/ruestung.ts) ----
  // The loom: the shuttle clacks through the warp, the beater thumps the weft home.
  { id: 'webstuhl', linie: 'webstuhl', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, sounds: { koerper: 'holz', laeuft: 'sfx_station_webstuhl', fertig: 'sfx_station_webstuhl_fertig' } },
  // The tailor's table: shears and a needle through cloth and leather.
  { id: 'schneidertisch', linie: 'schneidertisch', stufe: 1, art: 'handwerk', groesse: { b: 2, t: 1 }, sounds: { koerper: 'holz', laeuft: 'sfx_station_schneidern', fertig: 'sfx_station_schneidern_fertig' } },
  // The tanning frame cures hides without fuel, like the drying rack: two hides and their bark at once, two pieces of leather out.
  { id: 'gerbrahmen', linie: 'gerbrahmen', stufe: 1, art: 'verarbeitung', groesse: { b: 2, t: 1 }, verarbeitung: { eingang: 2, ausgang: 2, brennstoff: false }, sounds: { koerper: 'holz', laeuft: 'sfx_station_gerben', fertig: 'sfx_station_gerben_fertig' } },
  // ---- Strand F (M7-36): the Lumen workbench of the first beacon (unlock `lf1_lumen_werkbank`; items src/content/items/stationen.ts,
  // recipes src/content/recipes/lumen.ts). Its Lumen glass glows faintly, a cold light without fuel: it is not a fire.
  {
    id: 'lumen_werkbank',
    linie: 'lumen_werkbank',
    stufe: 1,
    art: 'handwerk',
    groesse: { b: 2, t: 1 },
    sounds: { koerper: 'holz', laeuft: 'sfx_station_lumen', fertig: 'sfx_station_lumen_fertig' },
  },
  // ---- Strand D (M7-20): the compost box rots garden waste (group `kompostgut`) into compost without fuel, over a day; frozen
  // chunks catch up like every processing station (docs/SPIEL.md §28). Its loop is the soft rustle of settling leaves.
  { id: 'kompostkiste', linie: 'kompostkiste', stufe: 1, art: 'verarbeitung', groesse: { b: 1, t: 1 }, verarbeitung: { eingang: 2, ausgang: 2, brennstoff: false }, sounds: { koerper: 'holz', laeuft: 'sfx_station_kompost', fertig: 'sfx_station_kompost_fertig' } },
]);

/** Sprite of a placed station (docs/SPIEL.md §8 "Möbel/Deko/Stationen `obj_<id>`"). */
export function stationSpriteId(id: string): string {
  return `obj_${id}`;
}
