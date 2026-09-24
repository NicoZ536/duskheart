/**
 * Item schema (MASTERPROMPT §13.1, §2.2, §31.4; docs/SPIEL.md §2).
 *
 * An `ItemDef` is the static description of one item; stacks in bags are runtime data
 * (src/game/items/stack.ts). Fields:
 * - `id` (snake_case), `name`/`beschreibung` (LocalizedText, the tooltip), `kategorie`, `stufe` (T0–T7),
 *   `raritaet` (§4.5 colours: src/generated/palette.ts `RARITY_REFS`).
 * - `stapel`: stack size; always the value of the category in `BALANCE.items.stack` (§13.1).
 * - `haltbarkeit`: durability of tools, weapons, armour and shields [uses] (§13.1, §D); such items
 *   never stack. Broken items stay in the bags and are unusable until repaired.
 * - `werte`: stats the item contributes while equipped (see `ITEM_STATS` for units).
 * - `frische`: shelf life [game days] (§18); stacks carry their freshness 0–100.
 * - `brennwert`: burn time as fuel [real seconds] (§15.4). `tauschwert`: value in trade points
 *   (1 = one piece of wood) for the trader (§22.3).
 * - `quellen`: declared sources `<art>:<id>` (see `ITEM_SOURCE_KINDS`). Sources that other data already
 *   states – world object drops – are derived automatically (src/content/items/usage.ts); declare only
 *   what no other record says.
 * - Uses are never declared: they are derived from the item's own data (`essbar`, `brennwert`,
 *   equipment, `werkzeug`, `pflanzt`) and from every reference other collections make to the item
 *   (recipes, build costs … – src/content/items/relations.ts). `endprodukt: true` marks an item that is
 *   an end in itself and needs no use (§31.4 "außer Endprodukten").
 * - Icon and sprite follow conventions and are checked by the validator: every item has the 16×16
 *   sprite `icon_<id>` (also the world drop); items shown on the figure have `ausruestung_<id>`.
 * - `sounds`: SFX ids (`sfx_<bereich>_<name>`) of the item's own actions.
 */
import { z } from 'zod';
import { BALANCE } from '../balance';
import { ARMOR_WEIGHTS } from '../balance/player';
import { idSchema, localizedTextSchema, raritySchema, refSchema, tierSchema } from './common';

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

/**
 * Item categories. They decide stack size (`BALANCE.items.stack`), where an item may go (equipment,
 * belt, backpack slot), the sort order of the bags (this order) and the §C count categories.
 */
export const ITEM_CATEGORIES = [
  'rohstoff',
  'saatgut',
  'barren',
  'nahrung',
  'gericht',
  'trank',
  'medizin',
  'munition',
  'werkzeug',
  'waffe',
  'ruestung',
  'schild',
  'licht',
  'schmuck',
  'rucksack',
  'platzierbar',
  'bauteil',
] as const;
/** One item category. */
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const itemCategorySchema = z.enum(ITEM_CATEGORIES);

/** Consumables that fit into the belt's quick-use slots (§13.1 "Gürtel (3 Schnellverbrauch-Plätze)"). */
export const CONSUMABLE_CATEGORIES = ['nahrung', 'gericht', 'trank', 'medizin'] as const satisfies readonly ItemCategory[];
/** Categories that carry durability (§13.1 "Haltbarkeit für Werkzeuge, Waffen, Rüstung"; shields are armour). */
export const DURABLE_CATEGORIES = ['werkzeug', 'waffe', 'ruestung', 'schild'] as const satisfies readonly ItemCategory[];

/** Equipment slot kinds an item can be worn in (§13.1: Kopf, Brust, Beine, Füße, Rücken, Nebenhand, Schmuck). */
export const EQUIPMENT_SLOT_KINDS = ['kopf', 'brust', 'beine', 'fuesse', 'ruecken', 'nebenhand', 'schmuck'] as const;
/** One equipment slot kind. */
export type EquipmentSlotKind = (typeof EQUIPMENT_SLOT_KINDS)[number];
/** Slot kinds of armour pieces (a cloak goes on the back). */
export const ARMOR_SLOT_KINDS = ['kopf', 'brust', 'beine', 'fuesse', 'ruecken'] as const satisfies readonly EquipmentSlotKind[];

/** Armour weight classes (§11.4 "Rüstungsgewicht: leicht 0 %, mittel −5 %, schwer −10 % Tempo"). */
export const ARMOR_WEIGHT_CLASSES = ARMOR_WEIGHTS;
export type ArmorWeightClass = (typeof ARMOR_WEIGHT_CLASSES)[number];

/** Tool kinds (§14 "Werkzeuge"); the harvesting kinds match `TOOL_KINDS` of src/content/terrain.ts. */
export const ITEM_TOOL_KINDS = ['axt', 'spitzhacke', 'schaufel', 'hacke', 'sichel', 'hammer', 'messer', 'eimer', 'angel', 'netz', 'schere', 'giesskanne'] as const;
/** One tool kind. */
export type ItemToolKind = (typeof ITEM_TOOL_KINDS)[number];

/** Lowest and highest mining power (§13.2: T0 1 … T7 8). */
export const MINING_POWER_MIN = 1;
export const MINING_POWER_MAX = 8;

/**
 * Stats an equipped item contributes (`werte`), with their units:
 * `ruestung` armour value [points, §D] · `isolation` [points 0–40, §11.2] · `kuehlung` [points 0–15,
 * §11.2] · `maxLeben` [HP] · `maxAusdauer` [stamina points] · `lichtradius` [tiles, §12.2] ·
 * `magnetradius` pick-up radius bonus [tiles, §11.4] · `tempo` movement speed bonus [fraction] ·
 * `schaden` damage [HP, §D] · `blockkraft` share of blocked damage [fraction, §19.2] · `kritchance`
 * [fraction] · `schleichen` noise reduction [fraction] · `giftresistenz`, `frostresistenz`,
 * `feuerresistenz`, `furchtresistenz` [fraction].
 */
export const ITEM_STATS = [
  'ruestung',
  'isolation',
  'kuehlung',
  'maxLeben',
  'maxAusdauer',
  'lichtradius',
  'magnetradius',
  'tempo',
  'schaden',
  'blockkraft',
  'kritchance',
  'schleichen',
  'giftresistenz',
  'frostresistenz',
  'feuerresistenz',
  'furchtresistenz',
] as const;
/** One item stat. */
export type ItemStat = (typeof ITEM_STATS)[number];

// ---------------------------------------------------------------------------------------------
// Sources and sounds
// ---------------------------------------------------------------------------------------------

/**
 * Kinds of declared item sources and the collection their id points into (`null` = no id):
 * `welt:<objekt>` world object (usually derived from its `drops`), `graben:<terrain>` digging a
 * terrain type, `drop:<kreatur>` creature loot, `rezept:<rezept>` recipe output, `ort:<ortstyp>` loot
 * of a location type, `haendlerin` the wandering trader (§22.3).
 */
export const ITEM_SOURCE_KINDS = {
  welt: 'worldObjects',
  graben: 'terrain',
  drop: 'creatures',
  rezept: 'recipes',
  ort: 'locationTypes',
  haendlerin: null,
} as const;
/** One source kind. */
export type ItemSourceKind = keyof typeof ITEM_SOURCE_KINDS;

const SOURCE_KIND_NAMES = Object.keys(ITEM_SOURCE_KINDS) as ItemSourceKind[];
const ID_PART = '[a-z][a-z0-9]*(?:_[a-z0-9]+)*';
/** Source syntax: `<art>:<id>` for kinds with a collection, the bare kind otherwise. */
export const ITEM_SOURCE_PATTERN = new RegExp(
  `^(?:(?:${SOURCE_KIND_NAMES.filter((k) => ITEM_SOURCE_KINDS[k] !== null).join('|')}):${ID_PART}|${SOURCE_KIND_NAMES.filter((k) => ITEM_SOURCE_KINDS[k] === null).join('|')})$`,
);
export const itemSourceSchema = z.string().regex(ITEM_SOURCE_PATTERN, { message: 'source must be <art>:<id> (welt, graben, drop, rezept, ort) or haendlerin' });

/** A parsed item source. */
export interface ItemSource {
  readonly kind: ItemSourceKind;
  /** Id in the kind's collection (`null` for kinds without one). */
  readonly id: string | null;
}

/** Splits a source string (`welt:baum_eiche`); returns `null` when it is malformed. */
export function parseItemSource(source: string): ItemSource | null {
  if (!ITEM_SOURCE_PATTERN.test(source)) return null;
  const sep = source.indexOf(':');
  if (sep < 0) return { kind: source as ItemSourceKind, id: null };
  return { kind: source.slice(0, sep) as ItemSourceKind, id: source.slice(sep + 1) };
}

/** Formats a source (`welt` + `baum_eiche` → `welt:baum_eiche`). */
export function formatItemSource(kind: ItemSourceKind, id: string | null): string {
  return id === null ? kind : `${kind}:${id}`;
}

/** SFX ids: `sfx_<bereich>_<name>` (docs/SPIEL.md §5). */
export const SFX_ID_PATTERN = /^sfx_[a-z0-9]+(?:_[a-z0-9]+)+$/;
export const sfxIdSchema = z.string().regex(SFX_ID_PATTERN, { message: 'SFX id must look like sfx_<bereich>_<name>' });

// ---------------------------------------------------------------------------------------------
// Item schema
// ---------------------------------------------------------------------------------------------

/** Largest |change| a food can make to a survival meter [points of 100]. */
const FOOD_VALUE_LIMIT = 100;

const foodValue = z.number().min(-FOOD_VALUE_LIMIT).max(FOOD_VALUE_LIMIT);

/** Stats of an item; only the stats it changes are listed. */
export const itemStatsSchema = z.partialRecord(z.enum(ITEM_STATS), z.number());

/** Schema of one item. */
export const itemSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** Tooltip text: what the item is, where it comes from, what it is good for. */
    beschreibung: localizedTextSchema,
    kategorie: itemCategorySchema,
    stufe: tierSchema,
    raritaet: raritySchema,
    /** Stack size [items per slot]; must equal `BALANCE.items.stack[kategorie]`. */
    stapel: z.number().int().min(1),
    /** Durability [uses]. */
    haltbarkeit: z.number().int().min(1).optional(),
    werte: itemStatsSchema.optional(),
    /** Shelf life [game days]. */
    frische: z.number().positive().optional(),
    /** Burn time as fuel [real seconds]. */
    brennwert: z.number().positive().optional(),
    /** Trade value [trade points; 1 = one piece of wood]. */
    tauschwert: z.number().int().min(0),
    /** Declared sources (see module comment). */
    quellen: z.array(itemSourceSchema).optional(),
    /** An end in itself: allowed to have no use (§31.4). */
    endprodukt: z.literal(true).optional(),
    /** Eating it changes the survival meters [points]; food and dishes are always edible. */
    essbar: z.object({ saettigung: foodValue, durst: foodValue }).strict().optional(),
    /** Tool data: kind and mining power (§13.2 "Abbaukraft des Werkzeugs muss ≥ Härte der Ressource sein"). */
    werkzeug: z
      .object({ art: z.enum(ITEM_TOOL_KINDS), abbaukraft: z.number().int().min(MINING_POWER_MIN).max(MINING_POWER_MAX) })
      .strict()
      .optional(),
    /** Equipment slot kind (armour, shields, lights, jewellery). */
    ausruestung: z.enum(EQUIPMENT_SLOT_KINDS).optional(),
    /** Armour weight class (armour only). */
    ruestungsgewicht: z.enum(ARMOR_WEIGHT_CLASSES).optional(),
    /** Backpack: extra slots it adds in the backpack slot. */
    rucksack: z.object({ plaetze: z.number().int().min(1) }).strict().optional(),
    /** Saplings and seeds: the world object that grows from it. */
    pflanzt: refSchema.optional(),
    sounds: z
      .object({
        /** Picking up, moving and dropping the item. */
        aufheben: sfxIdSchema,
        /** Using or consuming it (tools, food), when it has its own sound. */
        benutzen: sfxIdSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const cat = item.kategorie;
    const stack = BALANCE.items.stack[cat];
    if (item.stapel !== stack) issue('stapel', `stack size of category ${cat} is ${stack} (§13.1), got ${item.stapel}`);
    const durable = (DURABLE_CATEGORIES as readonly string[]).includes(cat);
    if (durable && item.haltbarkeit === undefined) issue('haltbarkeit', `${cat} needs a durability (§13.1)`);
    if (item.haltbarkeit !== undefined && item.stapel !== 1) issue('haltbarkeit', 'items with durability never stack (stapel 1)');
    if (cat === 'werkzeug' && item.werkzeug === undefined) issue('werkzeug', 'tools need tool data (kind, mining power)');
    if (item.werkzeug !== undefined && cat !== 'werkzeug' && cat !== 'waffe') issue('werkzeug', 'only tools and weapons carry tool data');
    const slot = item.ausruestung;
    if (cat === 'ruestung') {
      if (slot === undefined || !(ARMOR_SLOT_KINDS as readonly string[]).includes(slot)) issue('ausruestung', `armour goes to one of ${ARMOR_SLOT_KINDS.join(', ')}`);
      if (item.ruestungsgewicht === undefined) issue('ruestungsgewicht', 'armour needs a weight class (§11.4)');
    } else {
      if (item.ruestungsgewicht !== undefined) issue('ruestungsgewicht', 'only armour has a weight class');
      const expected = cat === 'schild' || cat === 'licht' ? 'nebenhand' : cat === 'schmuck' ? 'schmuck' : undefined;
      if (slot !== expected) issue('ausruestung', expected === undefined ? `${cat} is not worn` : `${cat} goes to the slot ${expected}`);
    }
    if ((cat === 'rucksack') !== (item.rucksack !== undefined)) issue('rucksack', 'exactly the backpacks carry backpack data');
    if (item.rucksack !== undefined && !BALANCE.items.bags.backpackSlots.includes(item.rucksack.plaetze)) {
      issue('rucksack', `a backpack adds ${BALANCE.items.bags.backpackSlots.join(', ')} slots (§13.1)`);
    }
    if ((cat === 'nahrung' || cat === 'gericht') && item.essbar === undefined) issue('essbar', `${cat} must be edible`);
    if (item.essbar !== undefined && !(CONSUMABLE_CATEGORIES as readonly string[]).includes(cat)) issue('essbar', 'only consumables are edible');
    if (item.essbar !== undefined && item.essbar.saettigung === 0 && item.essbar.durst === 0) issue('essbar', 'food must change satiation or thirst');
    if ((cat === 'saatgut') !== (item.pflanzt !== undefined)) issue('pflanzt', 'exactly the seeds and saplings say what they grow into');
    const sources = item.quellen ?? [];
    if (new Set(sources).size !== sources.length) issue('quellen', 'sources must be unique');
  });

/** One item definition (validated). */
export type ItemDef = z.output<typeof itemSchema>;
/** Item data as written in the content files. */
export type ItemInput = z.input<typeof itemSchema>;
