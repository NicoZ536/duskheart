/**
 * Schemas of the creature content (MASTERPROMPT §19.4, §20.1, §12.4, §31.4; docs/SPIEL.md §11, §14; M6-13, M6-19,
 * M6-27, M6-30, M6-32). Four collections describe every creature as data – the creature system
 * (src/game/creatures/) reads nothing else:
 *
 * - `creatures`: one record per creature (the §C count `creatures`, variants excluded; elites also `elites`):
 *   names and bestiary texts DE/EN, family and fighting side, size class (the sprite cell), tier, health, pace,
 *   body radius, armour and resistances per damage type, what its body is made of, its attacks (name = sprite clip
 *   `attack_<name>_<r>`, damage, reach, swing, wind-up that must match the wind-up frames of the sprite, cooldown,
 *   weight in the pattern choice, area), its AI profile, its loot table, its sounds (call, hurt, death; one per
 *   attack), when it is awake, how it moves, the colour of its glowing eyes (night hunters) and whether traps catch it.
 * - `aiProfiles`: how a kind of creature behaves (docs/SPIEL.md §11 "KI"): its stance towards the player, senses,
 *   courage, leash, the weights of its idle states, pack tactics, distance of ranged fighters, doors, light.
 * - `lootTables` (id = the creature's id, so a table is the source `drop:<kreatur>` of its items): weighted,
 *   seeded, tier-dependent draws dropped on defeat (`beute`) and the yields of carving the carcass with a knife
 *   (`zerlegen`).
 * - `spawnTables` (id = a biome): what lives there by day and by night, per season (a creature entry names the
 *   seasons it appears in), and the population factor of each season. Shadow brood entries are spawned by the
 *   night spawner (§12.4), all others make up the persistent population of the chunks.
 * - `traps` (id = the trap item): which creatures a placed trap catches and how often.
 *
 * Enumerations that mirror the game layer (teams, hit materials, mover classes) are repeated here, because content
 * imports nothing but the engine; tests/unit/game/kreatur-inhalt.test.ts checks they agree.
 */
import { z } from 'zod';
import { DAMAGE_TYPE_IDS } from '../balance/combat';
import { SEASON_IDS } from '../balance';
import { idSchema, localizedTextSchema, refSchema, tierSchema } from '../schema/common';
import { hitConditionSchema, sfxIdSchema } from '../schema/item';

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

/** Families of §20.1 (docs/SPIEL.md §11): peaceful animals, foes, shadow brood, elites. */
export const CREATURE_FAMILIES = ['friedlich', 'gegner', 'schattenbrut', 'elite'] as const;
/** One family. */
export type CreatureFamily = (typeof CREATURE_FAMILIES)[number];

/** Sides a creature fights on (the creature teams of `COMBAT_TEAMS`, src/game/combat/targets.ts). */
export const CREATURE_TEAMS = ['tier', 'feind', 'schattenbrut'] as const;
/** One creature side. */
export type CreatureTeam = (typeof CREATURE_TEAMS)[number];

/** Size classes = sprite cells (§4.4: klein 16, mittel 32, groß 48–64). */
export const CREATURE_SIZES = [16, 32, 48, 64] as const;
/** One size class [px]. */
export type CreatureSize = (typeof CREATURE_SIZES)[number];

/** What a body is made of (`HIT_MATERIALS` of src/game/combat/targets.ts): particles and sounds of a hit. */
export const CREATURE_MATERIALS = ['fleisch', 'fell', 'panzer', 'holz', 'stein', 'schatten'] as const;
/** One body material. */
export type CreatureMaterial = (typeof CREATURE_MATERIALS)[number];

/** How a body moves (`MOVER_CLASSES` of src/world/path/types.ts). */
export const CREATURE_LOCOMOTION = ['land', 'schwimmer', 'amphibie', 'flieger'] as const;
/** One kind of locomotion. */
export type CreatureLocomotion = (typeof CREATURE_LOCOMOTION)[number];

/** Phases of the day a creature is awake in (docs/SPIEL.md §11 "Aktivität Tag/Nacht/Dämmerung"). */
export const CREATURE_ACTIVITY = ['tag', 'daemmerung', 'nacht'] as const;
/** One phase of activity. */
export type CreatureActivity = (typeof CREATURE_ACTIVITY)[number];

/** Colours of glowing eyes (docs/ART.md §8: `feuer.4*`, `eis.4*` or `verderb.4*` per kind). */
export const CREATURE_EYES = ['feuer', 'eis', 'verderb'] as const;

/**
 * Kinds of attack (§19.4): `nahkampf` hits the bodies in reach and swing in front of it, `sprung` leaps at the target
 * first (the wolf's pounce: it closes up to its reach during the strike), `flaeche` hits everything in a radius around
 * a point (with a ground mark while it winds up), `fernkampf` shoots a projectile.
 */
export const ATTACK_KINDS = ['nahkampf', 'sprung', 'flaeche', 'fernkampf'] as const;
/** One kind of attack. */
export type AttackKind = (typeof ATTACK_KINDS)[number];

/**
 * Stances towards the player (§19.4 "Verhalten"): `scheu` flees on sight, `wehrhaft` flees but strikes back when
 * cornered or hit, `revier` warns and attacks who comes too close to its home, `aggressiv` hunts what it notices,
 * `jaeger` hunts and stalks by night (shadow brood, the Nachtmahr).
 */
export const AI_STANCES = ['scheu', 'wehrhaft', 'revier', 'aggressiv', 'jaeger'] as const;
/** One stance. */
export type AiStance = (typeof AI_STANCES)[number];

/** Times of a spawn table. */
export const SPAWN_TIMES = ['tag', 'nacht'] as const;
/** One spawn time. */
export type SpawnTime = (typeof SPAWN_TIMES)[number];

/** Largest body radius [px] (the collision's `MAX_MOVER_EXTENT_PX`: a mover is at most one tile across its radius). */
export const CREATURE_MAX_RADIUS_PX = 16;
/** Prefix of a creature shot = its sprite `geschoss_<name>` (M6-15b; the combat system's projectile of a ranged attack). */
export const CREATURE_SHOT_PREFIX = 'geschoss_';
/** Wind-up of a telegraphed attack [s] (§19.4 "Ausholzeit 0,3–0,8 s"). */
export const WINDUP_MIN_SECONDS = 0.3;
export const WINDUP_MAX_SECONDS = 0.8;
/** Largest swing [°] (all around). */
const FULL_CIRCLE_DEG = 360;
/** Impact classes 1–5 (`BALANCE.combat.impact`). */
const WUCHT_MIN = 1;
const WUCHT_MAX = 5;

// ---------------------------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------------------------

/** Resistances per damage type (−1 … 1: 0,5 halves, −0,5 is a weakness taking 1,5×; absent = 0). */
export const resistancesSchema = z.partialRecord(z.enum(DAMAGE_TYPE_IDS), z.number().min(-1).max(1));

/** One attack of a creature. */
export const creatureAttackSchema = z
  .object({
    /** Name of the attack = the sprite clip `attack_<name>_<richtung>` (snake_case). */
    name: idSchema,
    art: z.enum(ATTACK_KINDS),
    schadensart: z.enum(DAMAGE_TYPE_IDS),
    /** Damage on Normal [HP] (§D: a normal hit 8–12 % of the effective health, a heavy telegraphed one 20–30 %). */
    schaden: z.number().positive(),
    /** Reach from the body's centre to the target's edge [px] (`flaeche`: the distance to the centre of the area). */
    reichweite: z.number().positive(),
    /** Width of the swing [°] (`nahkampf`, `sprung`). */
    bogen: z.number().positive().max(FULL_CIRCLE_DEG),
    /**
     * Wind-up on Normal [s] (§19.4 "Ausholzeit 0,3–0,8 s"): the readable pose of the telegraph – exactly the wind-up
     * positions of the sprite's attack clip (docs/ART.md §15.3 "Ausholen"; the validator compares). The difficulty scales
     * it (`BALANCE.creatures.difficulty.windupFactor`).
     */
    ausholzeit: z.number().min(WINDUP_MIN_SECONDS).max(WINDUP_MAX_SECONDS),
    /**
     * Run-up between the wind-up and the strike [s] (a charge: the clip's `Anlauf` positions, absent = none): the blow lands
     * `ausholzeit + anlauf` after the telegraph began – the time of the clip's `schlag` event.
     */
    anlauf: z.number().positive().max(WINDUP_MAX_SECONDS).optional(),
    /** Time before the same attack may come again [s]. */
    abklingzeit: z.number().positive(),
    /** Weight in the pattern choice among the attacks that are ready and in reach. */
    gewicht: z.number().positive(),
    /** Impact class 1–5 (hitstop 2–6 ticks, knockback). */
    wucht: z.number().int().min(WUCHT_MIN).max(WUCHT_MAX),
    /** Stagger of the target [s]. */
    stagger: z.number().min(0),
    /** Area attacks: radius of the area [px] (marked on the ground while winding up). */
    flaeche: z.object({ radius: z.number().positive() }).strict().optional(),
    /**
     * Ranged attacks (M6-15b): speed [px/s] and what flies – a creature shot of the combat system's projectiles (not an item:
     * `CombatSystem.addShot`), drawn with the sprite of the same id `geschoss_<name>`. It flies `reichweite` far.
     */
    geschoss: z.object({ geschwindigkeit: z.number().positive(), sprite: idSchema.startsWith(CREATURE_SHOT_PREFIX, 'a shot is the sprite geschoss_<name>') }).strict().optional(),
    /**
     * A grab (§20.1 "Kriecher (hält fest)"): a blow that lands holds the player for up to `sekunden` [s] – the body cannot
     * move or roll (`PlayerSystem.addMotionHold`) – while the creature gnaws `schadenProSekunde` [HP/s] of the attack's damage
     * type in `bisse` bites; a hit that hurts it, a stagger, glaring light or distance breaks the hold.
     */
    festhalten: z.object({ sekunden: z.number().positive(), schadenProSekunde: z.number().positive(), bisse: z.number().int().min(1) }).strict().optional(),
    /**
     * The light eater's blow (§12.4 "Der Lichtfresser löscht Fackeln und Laternen im Umkreis von 4 Tiles und saugt
     * Lumen-Ladungen ab"): every torch and lantern within `radiusTiles` of its body goes out, and `lumen` charges are
     * drained from each Lumen light there (the light eaters of `CreatureSystem.addLightEater`).
     */
    lichtfressen: z.object({ radiusTiles: z.number().positive(), lumen: z.number().int().min(0) }).strict().optional(),
    /** Condition a hit can cause. */
    zustand: hitConditionSchema.optional(),
    /**
     * Only from camouflage (the profile's `tarnung`): the ambush a hidden creature springs when its prey comes within reach –
     * its wind-up is the reveal; once revealed the creature fights with its other attacks.
     */
    ausTarnung: z.literal(true).optional(),
    /** Sound of the strike. */
    sound: sfxIdSchema,
  })
  .strict()
  .superRefine((a, ctx) => {
    if ((a.art === 'flaeche') !== (a.flaeche !== undefined)) ctx.addIssue({ code: 'custom', path: ['flaeche'], message: 'exactly the area attacks (art flaeche) carry flaeche' });
    if ((a.art === 'fernkampf') !== (a.geschoss !== undefined)) ctx.addIssue({ code: 'custom', path: ['geschoss'], message: 'exactly the ranged attacks (art fernkampf) carry geschoss' });
    if (a.festhalten !== undefined && a.art !== 'nahkampf') ctx.addIssue({ code: 'custom', path: ['festhalten'], message: 'only a melee blow grabs' });
  });
/** One attack of a creature. */
export type CreatureAttack = z.output<typeof creatureAttackSchema>;

/** A variant (§20.1 "Schattenbrut-Varianten je Biom über Palette und Modifikator"): a palette row and multipliers. */
export const creatureVariantSchema = z
  .object({
    id: idSchema,
    /** Palette row of the sprite (`assets-src/paletteRows.ts`). */
    palette: idSchema,
    /** Biomes it appears in instead of the base form. */
    biome: z.array(refSchema).min(1),
    /** Multipliers of health, damage and pace. */
    leben: z.number().positive(),
    schaden: z.number().positive(),
    tempo: z.number().positive(),
  })
  .strict();

/** Bestiary entry (§20.1 "Bestiarium-Eintrag DE/EN", M6-32): lore and a tip, unlocked by watching and defeating. */
export const bestiaryEntrySchema = z
  .object({
    /** What one learns by watching it (shown once sighted). */
    text: localizedTextSchema,
    /** How to deal with it (shown once defeated). */
    hinweis: localizedTextSchema,
  })
  .strict();

/** Schema of one creature. */
export const creatureSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** One line for tooltips and the bestiary list. */
    beschreibung: localizedTextSchema,
    familie: z.enum(CREATURE_FAMILIES),
    team: z.enum(CREATURE_TEAMS),
    /** Biomes it lives in (shadow brood: empty – it comes everywhere at night and underground). */
    biome: z.array(refSchema),
    /** Size class = sprite cell [px]. */
    groesse: z.literal(CREATURE_SIZES),
    /** Tier T0–T7 (loot draws, tier-dependent entries). */
    stufe: tierSchema,
    /** Health on Normal [HP] (§D: normal foes of a tier fall after 4–6 hits of a tier weapon). */
    leben: z.number().positive(),
    /** Pace walking and running [tiles/s]. */
    tempo: z.object({ gehen: z.number().positive(), rennen: z.number().positive() }).strict(),
    /** Radius of the body [px] (combat, collision). */
    radius: z.number().positive().max(CREATURE_MAX_RADIUS_PX),
    /** Armour value R (§19.3: reduction R / (R + 50)). */
    ruestung: z.number().min(0),
    resistenzen: resistancesSchema,
    material: z.enum(CREATURE_MATERIALS),
    angriffe: z.array(creatureAttackSchema),
    /** AI profile. */
    ki: refSchema,
    /** Loot table (= the creature's id); `null` only with `ohneBeute`. */
    beute: refSchema.nullable(),
    /** Why a creature leaves nothing (docs/SPIEL.md §11 "außer Glühwürmchen: begründet leer erlaubt per Feld"). */
    ohneBeute: z.string().min(1).optional(),
    sounds: z.object({ laut: sfxIdSchema, treffer: sfxIdSchema, tod: sfxIdSchema }).strict(),
    /** Phases of the day it is awake in; outside them it sleeps. */
    aktiv: z.array(z.enum(CREATURE_ACTIVITY)).min(1),
    fortbewegung: z.enum(CREATURE_LOCOMOTION),
    /** Glowing eyes (night hunters, docs/ART.md §8): the colour family, or null. */
    augen: z.enum(CREATURE_EYES).nullable(),
    /** Traps (`traps`) can catch it. */
    fangbar: z.boolean(),
    varianten: z.array(creatureVariantSchema).optional(),
    bestiarium: bestiaryEntrySchema,
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if ((c.beute === null) !== (c.ohneBeute !== undefined)) issue('ohneBeute', 'a creature without loot table says why (ohneBeute), and only then');
    if (c.beute !== null && c.beute !== c.id) issue('beute', `the loot table of ${c.id} is ${c.id} (the source drop:${c.id} of its items)`);
    if (c.tempo.rennen < c.tempo.gehen) issue('tempo', 'running is not slower than walking');
    const names = c.angriffe.map((a) => a.name);
    if (new Set(names).size !== names.length) issue('angriffe', 'attack names are unique (one sprite clip each)');
    if ((c.familie === 'schattenbrut') !== (c.team === 'schattenbrut')) issue('team', 'shadow brood fights on the side schattenbrut, nothing else does');
    if (c.familie !== 'schattenbrut' && c.biome.length === 0) issue('biome', 'a creature that is not shadow brood lives in at least one biome');
    if (c.familie === 'friedlich' && c.team !== 'tier') issue('team', 'peaceful animals fight on the side tier');
  });
/** One creature. */
export type CreatureDef = z.output<typeof creatureSchema>;
/** Input of one creature. */
export type CreatureInput = z.input<typeof creatureSchema>;

// ---------------------------------------------------------------------------------------------
// AI profiles
// ---------------------------------------------------------------------------------------------

/** Schema of one AI profile. */
export const aiProfileSchema = z
  .object({
    id: idSchema,
    haltung: z.enum(AI_STANCES),
    /** Sight range in full light [tiles] (§19.4: scaled by the light at the player, ×2 with an own light). */
    sicht: z.number().positive(),
    /** Hearing: factor on the radius of noises (1 = as loud as they are). */
    gehoer: z.number().min(0),
    /** A shy creature flees when the player comes this close [tiles] (seen or heard). */
    fluchtDistanz: z.number().min(0),
    /** Share of its health below which it gives up the fight and retreats (0 = never). */
    mut: z.number().min(0).max(1),
    /** Leash around its home [tiles]: beyond it the creature returns (§19.4 "Heimkehr (Leine)"). */
    leine: z.number().positive(),
    /** Radius it roams around its home [tiles]. */
    streifen: z.number().positive(),
    /** Weights of the idle states. */
    gewichte: z.object({ ruhen: z.number().min(0), grasen: z.number().min(0), umherstreifen: z.number().min(0) }).strict(),
    /** How long it investigates a noise or the last place it saw its target [s]. */
    untersuchen: z.number().positive(),
    /** How long it remembers a target it lost sight of [s]. */
    gedaechtnis: z.number().positive(),
    /** Pack tactics (§19.4 "Rudel umkreisen und flankieren"): distance of the ring around the target, attackers at once. */
    rudel: z.object({ ringTiles: z.number().positive(), angreiferZugleich: z.number().int().min(1) }).strict().optional(),
    /** Ranged fighters keep this distance to their target [tiles] (§19.4 "Fernkämpfer halten Abstand"). */
    fernkampfAbstand: z.number().positive().optional(),
    /** Summoners keep others between themselves and the target (§19.4 "Beschwörer schützen sich"). */
    schuetztSich: z.boolean(),
    /** Breaks closed doors in its way (§19.4 "Türen (für bestimmte Gegner brechbar)"). */
    brichtTueren: z.boolean(),
    /** Avoids tiles brighter than this (§12.4: shadow brood 0,5), or null. */
    meidetLicht: z.number().min(0).max(1).nullable(),
    /** Flutters up while fleeing for this long [s] (ground birds): it flies over bushes and water meanwhile. */
    fluchtFlug: z.number().positive().optional(),
    /**
     * Camouflage (docs/SPIEL.md §11 "Tarnung", the Dornling): the creature waits hidden and still – its sprite's clip `tarnung` –
     * until its prey comes within the reach of an ambush attack (`ausTarnung`) or it is hit; revealing takes `erwachen` [s]
     * (the sprite's clip `erwachen`, it cannot act meanwhile); after `tarnenNach` [s] without a target it hides again.
     */
    tarnung: z.object({ erwachen: z.number().positive(), tarnenNach: z.number().positive() }).strict().optional(),
    /**
     * Flees from open flames (§19.4; smoke drives off the wasps): a torch, a camp fire or a burning tile within this many tiles
     * [tiles] makes it flee away from the flame, whatever its stance.
     */
    scheutFeuer: z.number().positive().optional(),
    /** Hunts until glaring light or defeat, whatever the leash (the Nachtmahr, §12.3). */
    unerbittlich: z.boolean(),
  })
  .strict();
/** One AI profile. */
export type AiProfileDef = z.output<typeof aiProfileSchema>;

// ---------------------------------------------------------------------------------------------
// Loot tables
// ---------------------------------------------------------------------------------------------

/** Count range [min, max] (inclusive). */
const countRangeSchema = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([a, b]) => b >= a, { message: 'max ≥ min' });

/** One weighted entry of a loot draw. */
export const lootEntrySchema = z
  .object({
    item: refSchema,
    /** Weight of the entry among the entries available at the creature's tier. */
    gewicht: z.number().positive(),
    anzahl: countRangeSchema,
    /** Only from this tier on (tier-dependent loot). */
    stufeAb: tierSchema.optional(),
  })
  .strict();

/** One yield of carving: an independent chance per carcass. */
export const carveEntrySchema = z
  .object({
    item: refSchema,
    /** Chance the carcass yields it [0–1]. */
    chance: z.number().gt(0).max(1),
    anzahl: countRangeSchema,
  })
  .strict();

/** Schema of one loot table (id = the creature's id). */
export const lootTableSchema = z
  .object({
    id: idSchema,
    /** Draws on defeat: how many (range) from the weighted entries (none when the list is empty). */
    ziehungen: z.tuple([z.number().int().min(0), z.number().int().min(0)]).refine(([a, b]) => b >= a, { message: 'max ≥ min' }),
    beute: z.array(lootEntrySchema),
    /** Yields of carving the carcass with a knife (animals); an empty list leaves no carcass. */
    zerlegen: z.array(carveEntrySchema),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.beute.length === 0 && t.ziehungen[1] > 0) ctx.addIssue({ code: 'custom', path: ['ziehungen'], message: 'draws need entries' });
    if (t.beute.length === 0 && t.zerlegen.length === 0) ctx.addIssue({ code: 'custom', path: ['beute'], message: 'a loot table yields something (a creature without loot has no table: ohneBeute)' });
  });
/** One loot table. */
export type LootTableDef = z.output<typeof lootTableSchema>;

// ---------------------------------------------------------------------------------------------
// Spawn tables
// ---------------------------------------------------------------------------------------------

/** One creature of a spawn table. */
export const spawnEntrySchema = z
  .object({
    kreatur: refSchema,
    gewicht: z.number().positive(),
    /** Group size [min, max] (packs, flocks). */
    gruppe: countRangeSchema,
    /** Seasons it appears in (absent = all). */
    jahreszeiten: z.array(z.enum(SEASON_IDS)).min(1).optional(),
  })
  .strict();
/** One creature of a spawn table. */
export type SpawnEntry = z.output<typeof spawnEntrySchema>;

/** Schema of one spawn table (id = the biome). */
export const spawnTableSchema = z
  .object({
    id: idSchema,
    /** Who appears by day and by night. */
    tag: z.array(spawnEntrySchema),
    nacht: z.array(spawnEntrySchema),
    /** Population factor of each season (0 = nothing new appears). */
    jahreszeiten: z.object(Object.fromEntries(SEASON_IDS.map((s) => [s, z.number().min(0).max(2)])) as Record<(typeof SEASON_IDS)[number], z.ZodNumber>).strict(),
    /** Why a time stays empty in a season (e.g. no wildlife in the Nachtherz); keyed `tag` / `nacht`. */
    leer: z.partialRecord(z.enum(SPAWN_TIMES), z.string().min(1)).optional(),
  })
  .strict();
/** One spawn table. */
export type SpawnTableDef = z.output<typeof spawnTableSchema>;

// ---------------------------------------------------------------------------------------------
// Traps
// ---------------------------------------------------------------------------------------------

/** Schema of one trap (id = the trap item). */
export const trapSchema = z
  .object({
    id: idSchema,
    /** Largest size class it holds [px]. */
    groesseMax: z.literal(CREATURE_SIZES),
    /** Chance a catchable creature stepping into it is caught [0–1]. */
    chance: z.number().gt(0).max(1),
    /**
     * Game hours after which an armed trap in a frozen chunk has caught something [min, max] (drawn when it is set):
     * the analytic catch-up of the chunk, docs/ARCHITEKTUR.md "Aufholen".
     */
    fangStunden: z.tuple([z.number().positive(), z.number().positive()]).refine(([a, b]) => b >= a, { message: 'max ≥ min' }),
  })
  .strict();
/** One trap. */
export type TrapDef = z.output<typeof trapSchema>;

// ---------------------------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------------------------

/** Sprite prefix of creatures (docs/SPIEL.md §11). */
export const CREATURE_SPRITE_PREFIX = 'kreatur_';

/** Sprite id of a creature. */
export function creatureSpriteId(id: string): string {
  return `${CREATURE_SPRITE_PREFIX}${id}`;
}

/** The four facings of the sprite clips (`<aktion>_<richtung>`, docs/ART.md §4). */
export const CREATURE_DIRECTIONS = ['down', 'up', 'left', 'right'] as const;

/** Clip name of an action towards a facing. */
export function creatureClipId(action: string, direction: (typeof CREATURE_DIRECTIONS)[number]): string {
  return `${action}_${direction}`;
}

/** Clip action of an attack. */
export function attackClipAction(attack: string): string {
  return `attack_${attack}`;
}

/** The mandatory actions every creature sprite has in every facing (§4.5 "Idle, Bewegung, … Treffer, Tod"). */
export const CREATURE_BASE_ACTIONS = ['idle', 'move', 'hit', 'death'] as const;

/** Clip actions of a camouflaged creature (the profile's `tarnung`): hidden, and revealing itself (docs/ART.md §15.3). */
export const CREATURE_HIDDEN_ACTION = 'tarnung';
export const CREATURE_REVEAL_ACTION = 'erwachen';

/** Event of an attack clip at which the blow lands (assets-src/lib/creatureAnim.ts `angriffClip`). */
export const ATTACK_STRIKE_EVENT = 'schlag';

/** §C count categories of a creature (ADR-0006): `creatures`, elites also `elites`. */
export function creatureCountCategories(c: Pick<CreatureDef, 'familie'>): Array<'creatures' | 'elites'> {
  return c.familie === 'elite' ? ['creatures', 'elites'] : ['creatures'];
}
