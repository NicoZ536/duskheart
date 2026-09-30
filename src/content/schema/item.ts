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
 * - Combat (M6, docs/SPIEL.md §10): `waffe` – how a weapon attacks (class, damage type and damage, reach, swing, tempo,
 *   stamina, stagger, impact, combo, heavy attack, condition; ranged classes their `geschoss`, thrown weapons their
 *   `wurf`); `munition` – what an arrow, bolt or sling stone adds to its weapon's shot; `schild` – block power, stamina
 *   per blocked point and the walking tempo while blocking. Formulas: src/game/combat/formulas.ts.
 */
import { z } from 'zod';
import { BALANCE } from '../balance';
import { ARMOR_WEIGHTS } from '../balance/player';
import { AMMO_WEAPON_CLASSES, DAMAGE_TYPE_IDS, HEAVY_ATTACKS, RANGED_WEAPON_CLASSES, THROW_EFFECTS } from '../balance/combat';
import { WEAPON_CLASSES } from '../balance/tools';
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
// Combat blocks (M6, docs/SPIEL.md §10)
// ---------------------------------------------------------------------------------------------

/** Largest swing of a weapon [°] (a full circle). */
const FULL_CIRCLE_DEG = 360;
/** Impact classes 1–5 (`wucht`): hitstop 2–6 ticks and knockback (`BALANCE.combat.impact`). */
export const WUCHT_MIN = 1;
export const WUCHT_MAX = 5;

/** A condition a hit can cause (§19.3 "Zustände über Waffen und Munition"): condition id, chance per hit, duration. */
export const hitConditionSchema = z
  .object({
    /** Condition id (src/content/conditions.ts: brennen, verlangsamt, vergiftung, blutung, betaeubt, geblendet …). */
    id: idSchema,
    /** Chance per hit [0–1]. */
    chance: z.number().gt(0).max(1),
    /** Duration [s]. */
    sekunden: z.number().positive(),
  })
  .strict();
/** A condition a hit can cause. */
export type HitCondition = z.output<typeof hitConditionSchema>;

/**
 * How a weapon attacks (`waffe`, §19.1 "Reichweite, Schlagbogen, Tempo, Ausdauerkosten und Stagger-Wert je Waffe").
 * Ranged classes (bow, crossbow, sling, thrown) carry `geschoss`; thrown weapons also `wurf`.
 */
export const weaponBlockSchema = z
  .object({
    /** Weapon class (`WEAPON_CLASSES`; `faust` is the bare hand and never an item). */
    klasse: z.enum(WEAPON_CLASSES),
    /** Damage type (§19.3). */
    schadensart: z.enum(DAMAGE_TYPE_IDS),
    /** Damage of a light blow or a full shot [HP] (§D: base damage of the tier × class factor). */
    schaden: z.number().positive(),
    /** Reach [px]: of a blow from the centre of the feet; of a ranged weapon its farthest shot or throw. */
    reichweite: z.number().positive(),
    /** Width of the swing [°] (ranged weapons: the width they cover, unused for the shot). */
    bogen: z.number().positive().max(FULL_CIRCLE_DEG),
    /** One whole blow, shot or throw: wind-up, blow, recovery [s]. */
    tempo: z.number().positive(),
    /** Stamina per blow or shot [points]. */
    ausdauer: z.number().min(0),
    /** Stagger of the target [s]. */
    stagger: z.number().min(0),
    /** Impact class 1–5: hitstop 2–6 ticks and knockback (`BALANCE.combat.impact`). */
    wucht: z.number().int().min(WUCHT_MIN).max(WUCHT_MAX),
    /** Combo: damage factor of each light blow of the chain (§19.2 "Schwert 3er-Kombo"); absent = every blow alike. */
    kombo: z.array(z.number().positive()).min(2).optional(),
    /** Kind of the heavy attack (§19.2); absent = a harder blow (`schlag`). */
    schwer: z.enum(HEAVY_ATTACKS).optional(),
    /** Condition a hit can cause. */
    zustand: hitConditionSchema.optional(),
    /** Ranged weapons: speed of the shot [px/s], draw time [s] and reload time [s] (defaults `BALANCE.combat.ranged` by class). */
    geschoss: z
      .object({ geschwindigkeit: z.number().positive(), spannen: z.number().positive().optional(), nachladen: z.number().positive().optional() })
      .strict()
      .optional(),
    /** Thrown weapons: what they do where they land, and the radius of a burst [px] (0 for `einzel`). */
    wurf: z.object({ wirkung: z.enum(THROW_EFFECTS), radius: z.number().min(0) }).strict().optional(),
  })
  .strict();
/** How a weapon attacks. */
export type WeaponBlock = z.output<typeof weaponBlockSchema>;

/** What a piece of ammunition adds to its weapon's shot (`munition`, §19.2 "Munition"). */
export const ammoBlockSchema = z
  .object({
    /** The weapon class that shoots it. */
    fuer: z.enum(AMMO_WEAPON_CLASSES),
    /** Damage added to the weapon's [HP] (before tension, resistance, armour). */
    schaden: z.number().min(0),
    /** Damage type of the hit (the arrowhead decides, not the bow). */
    schadensart: z.enum(DAMAGE_TYPE_IDS),
    /** Impact class 1–5 of the hit; absent = the weapon's. */
    wucht: z.number().int().min(WUCHT_MIN).max(WUCHT_MAX).optional(),
    /** Condition a hit can cause (fire and poison arrows). */
    zustand: hitConditionSchema.optional(),
    /** Light once it stuck (§12.2 "Leuchtpfeil | 3 | 60 s"): radius [tiles], duration [s]. */
    licht: z.object({ radius: z.number().positive(), sekunden: z.number().positive() }).strict().optional(),
  })
  .strict();
/** What ammunition adds to a shot. */
export type AmmoBlock = z.output<typeof ammoBlockSchema>;

/** How a shield blocks (`schild`, §19.2 "Schilde"). */
export const shieldBlockSchema = z
  .object({
    /** Share of a blocked hit's damage the shield absorbs [0–1] (§19.2: Holz 40 %, Bronze 60 %, Turmschild 90 %). */
    blockkraft: z.number().gt(0).max(1),
    /** Stamina per point of absorbed damage [points/HP]. */
    ausdauerJeSchaden: z.number().min(0),
    /** Walking tempo while blocking with it [× normal] (§19.2 "Turmschild … langsam"). */
    tempoFaktor: z.number().gt(0).max(1),
  })
  .strict();
/** How a shield blocks. */
export type ShieldBlock = z.output<typeof shieldBlockSchema>;

const RANGED: ReadonlySet<string> = new Set(RANGED_WEAPON_CLASSES);

/** Consistency of a `waffe` block (class, ranged data, throw, combo, heavy attack). */
function checkWeaponBlock(w: WeaponBlock, issue: (path: string, message: string) => void): void {
  const ranged = RANGED.has(w.klasse);
  if (w.klasse === 'faust') issue('waffe', 'the fist is the bare hand, never an item (docs/SPIEL.md §14)');
  if (ranged !== (w.geschoss !== undefined)) issue('waffe', ranged ? `a ${w.klasse} needs its geschoss (speed of the shot)` : 'only ranged weapons carry geschoss');
  if ((w.klasse === 'wurf') !== (w.wurf !== undefined)) issue('waffe', 'exactly the thrown weapons (klasse wurf) carry wurf');
  if (w.wurf !== undefined && (w.wurf.wirkung === 'einzel') !== (w.wurf.radius === 0)) issue('waffe', 'a single-target throw has radius 0, a burst a radius > 0');
  if (ranged && w.kombo !== undefined) issue('waffe', 'only melee weapons chain combos');
  if (ranged && w.schwer !== undefined) issue('waffe', 'ranged weapons have no heavy attack (holding draws the shot)');
  if (w.schwer === 'wurf' && w.klasse !== 'speer') issue('waffe', 'only the spear is thrown as its heavy attack (§19.2)');
}

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
    /** Combat: how the weapon attacks (weapons; throwables in the ammunition category). */
    waffe: weaponBlockSchema.optional(),
    /** Combat: what the ammunition adds to its weapon's shot. */
    munition: ammoBlockSchema.optional(),
    /** Combat: how the shield blocks. */
    schild: shieldBlockSchema.optional(),
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
    const w = item.waffe;
    if (w !== undefined) {
      if (cat !== 'waffe' && !(cat === 'munition' && w.klasse === 'wurf')) issue('waffe', 'weapons carry attack data; in the ammunition category only thrown weapons');
      checkWeaponBlock(w, issue);
      if (item.werte?.schaden !== undefined && item.werte.schaden !== w.schaden) issue('werte', `werte.schaden (${item.werte.schaden}) must equal waffe.schaden (${w.schaden}): one damage for tooltip and fight`);
      if (w.klasse === 'axt' && item.werkzeug?.art !== 'axt') issue('werkzeug', 'a battle axe carries tool data of kind axt: it fells trees (§19.2 "fällt Bäume mit 50 %")');
    }
    if (cat === 'munition' && (item.munition === undefined) === (w === undefined)) issue('munition', 'ammunition carries either munition data (arrows, bolts, stones) or a thrown weapon (waffe, klasse wurf)');
    if (item.munition !== undefined && cat !== 'munition') issue('munition', 'only ammunition carries munition data');
    if (item.schild !== undefined) {
      if (cat !== 'schild') issue('schild', 'only shields carry block data');
      if (item.werte?.blockkraft !== undefined && item.werte.blockkraft !== item.schild.blockkraft) issue('werte', 'werte.blockkraft must equal schild.blockkraft');
    }
    const sources = item.quellen ?? [];
    if (new Set(sources).size !== sources.length) issue('quellen', 'sources must be unique');
  });

/** One item definition (validated). */
export type ItemDef = z.output<typeof itemSchema>;
/** Item data as written in the content files. */
export type ItemInput = z.input<typeof itemSchema>;
