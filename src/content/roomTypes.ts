/**
 * Room types (MASTERPROMPT §16.4 "Raumtypen (automatisch erkannt, im Baumodus angezeigt)"; M4-17).
 *
 * An interior room (closed, at most 400 tiles, at least 90 % under a roof – src/game/rooms) gets the first
 * type in `rang` order whose conditions its contents meet:
 * - `moebel`: at least so many pieces of each furniture category inside the room (src/content/buildParts.ts
 *   `FURNITURE_CATEGORIES`; wall furniture on the room's walls counts too);
 * - `licht`: at least so many lights – lamps placed as furniture plus burning torches and fires of the light
 *   system standing in the room;
 * - `unterC`: room temperature below this [°C];
 * - `dach`: at least the share `anteil` of the room's roof tiles is of `material`;
 * - `tiere`: at least so many animals in the room (the animals of M7 report themselves).
 * The more specific types come first (an ice cellar full of chests is an ice cellar, a bedroom with a table
 * and two chairs a bedroom).
 *
 * The effects (§16.4): Schlafraum – "Ausgeruht" lasts ×1,5 (`BALANCE.sleep.rested.bedroomFactor`); Werkstatt –
 * +15 % crafting tempo (`BALANCE.rooms.effects.workshopTempo`); Trophäenhalle – comfort
 * (`BALANCE.rooms.effects.trophyHallComfort`). Kitchen, store room, dining hall, greenhouse, stable and ice
 * cellar act through the systems of cooking, spoilage, farming and animals (M7, M8), which read the type of
 * the room they are in. `beschreibung` is the tooltip of the build mode's room overlay.
 *
 * Registry collection `roomTypes` (src/content/index.ts); room types count nothing (§C "Raumvorlagen" are
 * the dungeon room templates of §21).
 */
import { z } from 'zod';
import { BUILD_MATERIALS } from './balance/building';
import { FURNITURE_CATEGORIES } from './buildParts';
import { deepFreeze } from './freeze';
import { idSchema, localizedTextSchema } from './schema/common';

const count = z.number().int().min(1);

/** Schema of one room type. */
export const roomTypeSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** What makes the room this type and what it does (tooltip). */
    beschreibung: localizedTextSchema,
    /** Order of the check (lower first, unique). */
    rang: z.number().int().min(1),
    moebel: z.partialRecord(z.enum(FURNITURE_CATEGORIES), count).optional(),
    licht: count.optional(),
    unterC: z.number().optional(),
    dach: z.object({ material: z.enum(BUILD_MATERIALS), anteil: z.number().gt(0).max(1) }).strict().optional(),
    tiere: count.optional(),
  })
  .strict()
  .refine((t) => t.moebel !== undefined || t.licht !== undefined || t.unterC !== undefined || t.dach !== undefined || t.tiere !== undefined, { message: 'a room type needs at least one condition' });

/** One room type (validated). */
export type RoomTypeDef = z.output<typeof roomTypeSchema>;
/** Room type data as written here. */
export type RoomTypeInput = z.input<typeof roomTypeSchema>;

/** Error in the room types. */
export class RoomTypeError extends Error {
  override readonly name = 'RoomTypeError';
}

/** Validates room types (schema, unique ids and ranks), sorts them by rank and freezes them. */
export function defineRoomTypes(records: readonly RoomTypeInput[]): readonly RoomTypeDef[] {
  const ids = new Set<string>();
  const ranks = new Set<number>();
  const parsed = records.map((raw, index) => {
    const r = roomTypeSchema.safeParse(raw);
    if (!r.success) throw new RoomTypeError(`Room type [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(type)'}: ${i.message}`).join('; ')}`);
    if (ids.has(r.data.id)) throw new RoomTypeError(`duplicate room type "${r.data.id}"`);
    if (ranks.has(r.data.rang)) throw new RoomTypeError(`room type "${r.data.id}": rank ${r.data.rang} is taken`);
    ids.add(r.data.id);
    ranks.add(r.data.rang);
    return r.data;
  });
  parsed.sort((a, b) => a.rang - b.rang);
  deepFreeze(parsed);
  return parsed;
}

/** Ice cellar: below this room temperature spoilage slows (§16.4 "Eiskeller (< 4 °C: Verderb ×0,2)") [°C]. */
export const ICE_CELLAR_BELOW_C = 4;

/** The nine room types of §16.4. */
export const ROOM_TYPES = defineRoomTypes([
  {
    id: 'eiskeller',
    name: { de: 'Eiskeller', en: 'Ice Cellar' },
    beschreibung: {
      de: 'Ein Raum unter 4 °C: Vorräte verderben hier nur ein Fünftel so schnell.',
      en: 'A room below 4 °C: supplies spoil only a fifth as fast here.',
    },
    rang: 1,
    unterC: ICE_CELLAR_BELOW_C,
  },
  {
    id: 'gewaechshaus',
    name: { de: 'Gewächshaus', en: 'Greenhouse' },
    beschreibung: {
      de: 'Ein Raum unter einem Glasdach mit Beeten: Pflanzen wachsen hier das ganze Jahr.',
      en: 'A room under a glass roof with garden beds: plants grow here all year round.',
    },
    rang: 2,
    moebel: { beet: 1 },
    dach: { material: 'glas', anteil: 0.5 },
  },
  {
    id: 'stall',
    name: { de: 'Stall', en: 'Stable' },
    beschreibung: {
      de: 'Ein Raum mit Futtertrog und Tieren: die Tiere bleiben hier und gedeihen.',
      en: 'A room with a feeding trough and animals: the animals stay here and thrive.',
    },
    rang: 3,
    moebel: { trog: 1 },
    tiere: 1,
  },
  {
    id: 'kueche',
    name: { de: 'Küche', en: 'Kitchen' },
    beschreibung: {
      de: 'Ein Raum mit Kochstelle, Vorrat und Tisch: 20 % schneller kochen, Mahlzeiten wirken 10 % stärker.',
      en: 'A room with a cooking place, supplies and a table: cooking is 20% faster, meals work 10% better.',
    },
    rang: 4,
    moebel: { kochstelle: 1, lager: 1, tisch: 1 },
  },
  {
    id: 'schlafraum',
    name: { de: 'Schlafraum', en: 'Bedroom' },
    beschreibung: {
      de: 'Ein Raum mit Bett und Licht: „Ausgeruht“ hält nach dem Schlaf anderthalbmal so lange.',
      en: 'A room with a bed and a light: “Rested” lasts one and a half times as long after sleep.',
    },
    rang: 5,
    moebel: { bett: 1 },
    licht: 1,
  },
  {
    id: 'werkstatt',
    name: { de: 'Werkstatt', en: 'Workshop' },
    beschreibung: {
      de: 'Ein Raum mit mindestens drei Stationen: hier stellst du 15 % schneller her.',
      en: 'A room with at least three stations: you craft 15% faster here.',
    },
    rang: 6,
    moebel: { station: 3 },
  },
  {
    id: 'speisesaal',
    name: { de: 'Speisesaal', en: 'Dining Hall' },
    beschreibung: {
      de: 'Ein Raum mit Tisch und mindestens zwei Stühlen: Essen hier lindert zusätzlich die Furcht.',
      en: 'A room with a table and at least two chairs: eating here also eases fear.',
    },
    rang: 7,
    moebel: { tisch: 1, sitz: 2 },
  },
  {
    id: 'trophaeenhalle',
    name: { de: 'Trophäenhalle', en: 'Trophy Hall' },
    beschreibung: {
      de: 'Ein Raum mit mindestens drei Trophäen: der Stolz auf deine Jagden macht ihn behaglicher.',
      en: 'A room with at least three trophies: pride in your hunts makes it cosier.',
    },
    rang: 8,
    moebel: { trophaee: 3 },
  },
  {
    id: 'lager',
    name: { de: 'Lager', en: 'Store Room' },
    beschreibung: {
      de: 'Ein Raum mit mindestens vier Kisten: Vorräte verderben hier 10 % langsamer.',
      en: 'A room with at least four chests: supplies spoil 10% slower here.',
    },
    rang: 9,
    moebel: { lager: 4 },
  },
]);
