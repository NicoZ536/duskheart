/**
 * Simulation events → sounds (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback";
 * docs/ARCHITEKTUR.md "Datenfluss": the presentation reads the drained events after each tick). One data
 * table, `EVENT_SFX`, says what every event of `SimEventMap` sounds like – the SFX ids come from the
 * tables of the game modules (`PLAYER_SFX`, `GATHERING_SFX`, …) and from content (a terrain's footstep
 * material, an item's `sounds`, a condition's `sound`); `SILENT_EVENTS` names the events that stay
 * silent and why. Every event type is in exactly one of the two (tests/unit/audio/eventMap.test.ts), so a
 * new event cannot slip in without a decision about its sound.
 *
 * A mapper returns one-shots (`SfxCue`, with a world position for sounds that happen somewhere else than
 * at the player) and loop changes (`LoopCue`: whispers while afraid, breathing while asleep, the carried torch), or
 * null. The loops of things standing in the world – placed lights, working stations, the hearth, blazes – are not
 * started by events but by their state (src/audio/loopSources.ts): a loaded game has no events for them.
 *
 * The base (M4-29): building, storage, the hearth and fires sound with the tables of src/audio/baseSounds.ts – per
 * material, door kind and container –, a station with its own `sounds` (src/content/stations.ts).
 */
import { CONTENT } from '../content/index';
import type { BuildPartDef } from '../content/buildParts';
import { LIGHT_KINDS, lightKindOfItem } from '../content/lights';
import { RANGED_WEAPON_CLASSES } from '../content/balance/combat';
import type { RecipeDef } from '../content/recipes/schema';
import type { StationDef } from '../content/stations';
import { TILE_PX } from '../world/model/coords';
import { ACTION_SFX } from '../game/actions/events';
import { CRAFTING_SFX } from '../game/crafting/events';
import { LIGHT_SFX, lightKindSound } from '../game/light/events';
import { CONDITION_SFX } from '../game/conditions/events';
import { DEATH_SFX } from '../game/death/events';
import { DROP_SFX } from '../game/drops/events';
import { EQUIPMENT_FEEDBACK_SFX } from '../game/equipment/events';
import { FEAR_SFX } from '../game/fear/events';
import { fearStageIndex } from '../game/fear/formulas';
import { GATHERING_SFX } from '../game/gathering/events';
import { INTERACTION_SFX } from '../game/interaction/events';
import { INVENTORY_FEEDBACK_SFX } from '../game/inventory/events';
import { PLAYER_SFX } from '../game/player/events';
import { PLACE_SFX } from '../game/places/events';
import { MAP_SFX } from '../game/map/events';
import { WORLD_EVENT_SFX } from '../game/worldevents/events';
import { BOSS_SFX } from '../game/bosses/events';
import { FARM_SFX } from '../game/farming/events';
import { FISHING_SFX } from '../game/fishing/events';
import { BEACON_SFX } from '../game/beacons/events';
import { UNLOCK_SFX } from '../game/unlocks/events';
import { TRAVEL_SFX } from '../game/travel/events';
import { SKILL_SFX } from '../game/skills/events';
import { SLEEP_SFX } from '../game/sleep/events';
import { SURVIVAL_SFX } from '../game/survival/events';
import { COMBAT_SFX } from '../game/combat/events';
import type { HitMaterial } from '../game/combat/targets';
import type { ArmorWeightClass } from '../content/schema/item';
import { CREATURE_SFX, CREATURE_SHOT_SFX } from '../game/creatures/events';
import { CREATURE_SHOT_PREFIX } from '../content/creatures/schema';
import { KAMPF_ABWEHR_SFX, KAMPF_FERN_SFX, KAMPF_KRITISCH_SFX, KAMPF_SCHWUNG_SFX, KAMPF_TREFFER_SFX } from './kampfKlaenge';
import type { GameCommandType } from '../game/commands';
import type { SimEventMap } from '../game/sim';
import { footstepSfxId } from '../content/sfx/index';
import { BUILD_AUDIO, DOOR_AUDIO, FIRE_AUDIO, HEARTH_AUDIO, STATION_EXTRA_AUDIO, STORAGE_AUDIO, breakSound, buildSound, chestSound, doorSound, type SoundMaterial } from './baseSounds';
import type { SfxCue } from './sfxPlayer';

/** Starts, moves or (with `cue` null) stops the loop of a named slot. */
export interface LoopCue {
  readonly loop: string;
  readonly cue: SfxCue | null;
}

/** What an event makes heard. */
export type AudioCue = SfxCue | LoopCue;

/** Whether `c` changes a loop. */
export function isLoopCue(c: AudioCue): c is LoopCue {
  return 'loop' in c;
}

/** Content lookups of the mappers, and what they read from the simulation (`EventSfxWorld`). */
export interface EventSfxContext {
  /** Footstep sound of a terrain id, or null for ground without steps. */
  footstep(terrain: string): string | null;
  /** An item's own sound (`sounds.aufheben` / `sounds.benutzen`), or null. */
  itemSound(item: string, use: 'aufheben' | 'benutzen'): string | null;
  /** A condition's onset sound, or null. */
  conditionSound(condition: string): string | null;
  /** A recipe, or undefined. */
  recipe(recipe: string): RecipeDef | undefined;
  /** A station (by its item id), or undefined. */
  station(station: string): StationDef | undefined;
  /** A build part (by its item id), or undefined. */
  part(part: string): BuildPartDef | undefined;
  /** Footstep sound of the built floor under the player (src/audio/underfoot.ts), or null for the ground's own. */
  underfoot(): string | null;
  /** The light kind of placed light `light` (src/audio/lightProbe.ts), or null when it is not known. */
  placedLightKind(light: number): string | null;
  /** Weight class of the armour on the player's chest (src/audio/armourProbe.ts), or null without one. */
  playerArmour(): ArmorWeightClass | null;
}

/** What the mappers read from the running simulation (the runtime reads it; without it, the defaults). */
export interface EventSfxWorld {
  /** The floor under the player (the build grid at the listener); default: none, every step is the ground's. */
  readonly underfoot?: () => string | null;
  /** The kind of a placed light (the light system); default: unknown, fuel sounds like fuel on a fire. */
  readonly placedLightKind?: (light: number) => string | null;
  /** The armour on the player's chest (the equipment); default: none, a blow on the player adds no armour layer. */
  readonly playerArmour?: () => ArmorWeightClass | null;
}

/** The lookups on the game's content registry, and those of `world` on the simulation. */
export function createEventSfxContext(world: EventSfxWorld = {}): EventSfxContext {
  const terrain = CONTENT.collection('terrain');
  const items = CONTENT.collection('items');
  const conditions = CONTENT.collection('conditions');
  const recipes = CONTENT.collection('recipes');
  const stations = CONTENT.collection('stations');
  const parts = CONTENT.collection('buildParts');
  return {
    footstep: (id) => {
      const material = terrain.find(id)?.footstep;
      return material === undefined || material === null ? null : footstepSfxId(material);
    },
    itemSound: (id, use) => items.find(id)?.sounds[use] ?? null,
    conditionSound: (id) => conditions.find(id)?.sound ?? null,
    recipe: (id) => recipes.find(id),
    station: (id) => stations.find(id),
    part: (id) => parts.find(id),
    underfoot: world.underfoot ?? (() => null),
    placedLightKind: world.placedLightKind ?? (() => null),
    playerArmour: world.playerArmour ?? (() => null),
  };
}

/**
 * The sound of a finished piece of `recipe`: its own `sound` (filling a bucket scoops water), else the finished piece
 * of the station it is made at (its `sounds.fertig`, src/content/stations.ts), else the crafting chime of the hand.
 */
export function recipeSound(recipe: string, ctx: EventSfxContext): string {
  const r = ctx.recipe(recipe);
  if (r?.sound !== undefined) return r.sound;
  const station = r === undefined || r.station === null ? undefined : ctx.station(r.station);
  return station === undefined ? CRAFTING_SFX.done : station.sounds.fertig;
}

/** Whether `recipe` is made at a station (its loop sounds while the queue works, src/audio/loopSources.ts). */
function atStation(recipe: string, ctx: EventSfxContext): boolean {
  const station = ctx.recipe(recipe)?.station;
  return station !== undefined && station !== null;
}

/** The sound material of the station `station` (set up, taken down). */
function stationBody(station: string, ctx: EventSfxContext): SoundMaterial {
  const def = ctx.station(station);
  return def === undefined ? 'holz' : def.sounds.koerper;
}

/** Whether station `station` burns fuel (a kiln, the furnace, the charcoal mound). */
function fired(station: string, ctx: EventSfxContext): boolean {
  return ctx.station(station)?.verarbeitung?.brennstoff === true;
}

type Mapper<P> = (payload: P, ctx: EventSfxContext) => AudioCue | readonly AudioCue[] | null;
/** The table type: a mapper per event type. */
export type EventSfxTable = { readonly [K in keyof SimEventMap]?: Mapper<SimEventMap[K]> };

/**
 * Loop slots of the player's state and the carried torch; placed lights, stations, the hearth and blazes have the
 * slots of src/audio/loopSources.ts.
 */
export const LOOP_SLOTS = { whispers: 'furcht_fluestern', heartbeat: 'furcht_herz', sleep: 'schlaf', handLight: 'licht_hand' } as const;

/** Volume of the carried torch's burn loop: it sits at the listener, so it is kept below the world's sounds. */
const HAND_LIGHT_VOLUME = 0.45;

/** Footstep volume: 0,4 + 0,6 × movement noise (sneaking 0,3 → 0,58, walking 1, sprinting 1,5 → 1,3). */
const STEP_VOLUME_BASE = 0.4;
const STEP_VOLUME_PER_NOISE = 0.6;
/** Actions that end in silence (the event that caused it already sounds). */
const QUIET_INTERRUPTIONS: ReadonlySet<string> = new Set(['tod', 'schlaf']);
/** Harvest actions done by hand: the pick sound instead of a tool hit. */
const HAND_PICKS: ReadonlySet<string> = new Set(['pfluecken', 'ernten', 'aufsammeln']);
/** Harvests whose end breaks a node apart. */
const BREAKING_MATERIALS: ReadonlySet<string> = new Set(['stein', 'erz', 'kristall']);

/**
 * Refused commands that answer with the error sound: discrete player actions. Continuous input
 * (move, aim, sprint, sneak) and debug commands stay silent – they are refused every tick while held.
 */
const REJECT_SFX: Partial<Record<GameCommandType, string>> = {
  'player.interact': INTERACTION_SFX.refused,
  'player.selectHotbar': INVENTORY_FEEDBACK_SFX.rejected,
  'player.scrollHotbar': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.move': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.split': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.collect': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.sort': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.quickMove': INVENTORY_FEEDBACK_SFX.rejected,
  'inventory.discard': INVENTORY_FEEDBACK_SFX.rejected,
  'action.eat': INVENTORY_FEEDBACK_SFX.rejected,
  'action.drink': INVENTORY_FEEDBACK_SFX.rejected,
  'action.sit': INVENTORY_FEEDBACK_SFX.rejected,
  'action.throw': INVENTORY_FEEDBACK_SFX.rejected,
  'action.useBelt': INVENTORY_FEEDBACK_SFX.rejected,
  'sleep.start': INVENTORY_FEEDBACK_SFX.rejected,
  'death.lootGrave': INVENTORY_FEEDBACK_SFX.rejected,
  'death.respawn': INVENTORY_FEEDBACK_SFX.rejected,
  'skills.choosePerk': INVENTORY_FEEDBACK_SFX.rejected,
  'craft.start': INVENTORY_FEEDBACK_SFX.rejected,
  'craft.cancel': INVENTORY_FEEDBACK_SFX.rejected,
  'craft.useChests': INVENTORY_FEEDBACK_SFX.rejected,
  'craft.pin': INVENTORY_FEEDBACK_SFX.rejected,
  'player.useItem': INVENTORY_FEEDBACK_SFX.rejected,
  'light.toggle': INVENTORY_FEEDBACK_SFX.rejected,
  'light.place': INVENTORY_FEEDBACK_SFX.rejected,
  'light.fuel': INVENTORY_FEEDBACK_SFX.rejected,
  'light.ignite': INVENTORY_FEEDBACK_SFX.rejected,
  'light.douse': INVENTORY_FEEDBACK_SFX.rejected,
  'light.take': INVENTORY_FEEDBACK_SFX.rejected,
  // The base (M4): every command a click or key sends once. `storage.close` (closing always works) and the debug
  // command `fire.ignite` stay silent.
  'station.place': INVENTORY_FEEDBACK_SFX.rejected,
  'station.remove': INVENTORY_FEEDBACK_SFX.rejected,
  'station.use': INVENTORY_FEEDBACK_SFX.rejected,
  'station.put': INVENTORY_FEEDBACK_SFX.rejected,
  'station.take': INVENTORY_FEEDBACK_SFX.rejected,
  'station.takeAll': INVENTORY_FEEDBACK_SFX.rejected,
  'repair.item': INVENTORY_FEEDBACK_SFX.rejected,
  'build.place': INVENTORY_FEEDBACK_SFX.rejected,
  'build.blueprint': INVENTORY_FEEDBACK_SFX.rejected,
  'build.complete': INVENTORY_FEEDBACK_SFX.rejected,
  'build.remove': INVENTORY_FEEDBACK_SFX.rejected,
  'build.upgrade': INVENTORY_FEEDBACK_SFX.rejected,
  'build.door': INVENTORY_FEEDBACK_SFX.rejected,
  'build.repair': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.open': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.put': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.take': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.takeAll': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.storeAll': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.quickStash': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.sort': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.rename': INVENTORY_FEEDBACK_SFX.rejected,
  'storage.label': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.use': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.fuel': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.take': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.ignite': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.douse': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.core': INVENTORY_FEEDBACK_SFX.rejected,
  'hearth.uncore': INVENTORY_FEEDBACK_SFX.rejected,
  // Hunting (M6-30): carving without a knife, a trap out of reach or on a blocked tile, full bags. The debug commands
  // `creature.spawn` and `creature.kill` stay silent (the console says why).
  'carcass.carve': INVENTORY_FEEDBACK_SFX.rejected,
  'trap.place': INVENTORY_FEEDBACK_SFX.rejected,
  'trap.take': INVENTORY_FEEDBACK_SFX.rejected,
  // Boss, beacon, fast travel (M7-32 … M7-37): what E or a screen button sends. The debug commands `boss.debug`,
  // `beacon.debug` and `unlock.grant` stay silent (the console says why); `beacon.visionSeen` is the vision screen closing.
  'boss.summon': INVENTORY_FEEDBACK_SFX.rejected,
  'beacon.ignite': INVENTORY_FEEDBACK_SFX.rejected,
  'travel.open': INVENTORY_FEEDBACK_SFX.rejected,
  'travel.go': INVENTORY_FEEDBACK_SFX.rejected,
  'travel.rename': INVENTORY_FEEDBACK_SFX.rejected,
  // Places (M7-07): E at a mark that has nothing (yet) – an opened chest, a shrine still resting; the debug discovery.
  'place.use': INVENTORY_FEEDBACK_SFX.rejected,
  'place.discover': INVENTORY_FEEDBACK_SFX.rejected,
  // World events (M7-38 … M7-40): the console's start, stop and bolt.
  'worldEvent.start': INVENTORY_FEEDBACK_SFX.rejected,
  'worldEvent.stop': INVENTORY_FEEDBACK_SFX.rejected,
  'lightning.strike': INVENTORY_FEEDBACK_SFX.rejected,
  // World settings (M7-51): one click in the pause menu's world view; Unbarmherzig refuses every change but the season length.
  'world.setDifficulty': INVENTORY_FEEDBACK_SFX.rejected,
  'world.setSettings': INVENTORY_FEEDBACK_SFX.rejected,
};

/** Sounds of the kernel's own choosing (no game table names them). */
export const KERNEL_SFX = {
  /** A stump torn out (`harvested`, action `roden`). */
  stumpCleared: 'sfx_baum_roden',
  /** A rock, ore or crystal node breaks apart (`harvested`, action `abbauen`). */
  nodeBroken: 'sfx_sammeln_bersten',
  /** A perk was chosen (M7-02 retrofit: a seal of its own instead of the menu click). */
  perkChosen: 'sfx_fertigkeit_perk_gewaehlt',
  /** An item was used that has no use sound of its own. */
  itemUsed: 'sfx_ui_klick',
  /** Earth shovelled into a dug tile (`itemUsed` `zuschuetten`, M4-40). */
  filled: 'sfx_graben_zuschuetten',
} as const;

/**
 * Sounds M7-02 retrofits to actions of M3–M6 that only borrowed one (src/content/sfx/nachruestung.ts;
 * tests/unit/audio/abdeckung.test.ts): the heavy attack drawn back, a new bestiary stage. (The cures' own sounds –
 * `sfx_heilen_verband`, `sfx_heilen_schiene` – belong in the items' `sounds.benutzen`, like every item's use sound.)
 */
export const RETROFIT_SFX = {
  heavyWindup: 'sfx_kampf_ausholen_schwer',
  bestiary: 'sfx_bestiarium_eintrag',
} as const;

/** The net (M7-31, src/content/sfx/instrumente.ts): the swing, and the catch in the mesh. */
export const NET_SFX = { swing: 'sfx_netz_schwung', caught: 'sfx_netz_fang' } as const;

/** Weapon classes that shoot or throw: their release sounds with `projectileFired`, not with a swing. */
const RANGED_CLASSES: ReadonlySet<string> = new Set(RANGED_WEAPON_CLASSES);
/** The items (weapons and shields for the fight's sounds). */
const ITEM_DEFS = CONTENT.collection('items');

/**
 * The swing of a blow (M6-33): the heavy attack's long sweep; else the weapon's own swing by its damage type (its
 * `sounds.benutzen`, src/content/items/waffen.ts), a tool's own swing, the bare fist's low swish.
 */
function swingSound(item: string | null, heavy: boolean, ctx: EventSfxContext): string {
  if (heavy) return KAMPF_SCHWUNG_SFX.schwer;
  return item === null ? KAMPF_SCHWUNG_SFX.wucht : (ctx.itemSound(item, 'benutzen') ?? KAMPF_SCHWUNG_SFX.wucht);
}

/**
 * The sound of a block with `item` (M6-33): a shield's own (`sounds.benutzen`: boards knock, bronze rings), a bronze
 * weapon or tool clangs, stone, flint, bone and wood knock, bare arms smack.
 */
function blockSound(item: string | null, ctx: EventSfxContext): string {
  if (item === null) return KAMPF_ABWEHR_SFX.hand;
  const def = ITEM_DEFS.find(item);
  if (def?.kategorie === 'schild') return ctx.itemSound(item, 'benutzen') ?? KAMPF_ABWEHR_SFX.holz;
  return def !== undefined && def.stufe >= 1 ? KAMPF_ABWEHR_SFX.metall : KAMPF_ABWEHR_SFX.holz;
}

/** The draw or reload of a ranged weapon class (bow creaks, crossbow ratchets, sling whirs), or `null` (throws, blows). */
function drawSound(klasse: string): string | null {
  return klasse === 'bogen' || klasse === 'armbrust' || klasse === 'schleuder' ? KAMPF_FERN_SFX.spannen[klasse] : null;
}

/** The release of a shot or throw by the class that looses it (a thrown spear swishes like every throw). */
function releaseSound(klasse: string): string {
  return klasse === 'bogen' || klasse === 'armbrust' || klasse === 'schleuder' ? KAMPF_FERN_SFX.loslassen[klasse] : KAMPF_FERN_SFX.loslassen.wurf;
}

/** Lamps (src/content/lights.ts): they take their own fuel piece by piece – resin into the bowl, not a log on embers. */
const LAMP_KINDS: ReadonlySet<string> = new Set(LIGHT_KINDS.filter((k) => k.verhalten === 'lampe').map((k) => k.id));
/** Furniture lights (lamps, lanterns, the fireplace): build parts, set up and taken down with their material's sound. */
const FURNITURE_LIGHT_KINDS: ReadonlySet<string> = new Set(LIGHT_KINDS.filter((k) => k.moebel !== undefined).map((k) => k.id));

/** Centre of a tile [px]. */
function tileCentre(t: number): number {
  return t * TILE_PX + TILE_PX / 2;
}

/** A one-shot at the listener. */
function own(id: string, volume?: number): SfxCue {
  return volume === undefined ? { id } : { id, volume };
}

/** A one-shot at a world position. */
function at(id: string, x: number, y: number, layer?: number): SfxCue {
  return layer === undefined ? { id, x, y } : { id, x, y, layer };
}

/** Voices of a creature (content `creatures`). */
function creatureSounds(creature: string): { readonly laut: string; readonly treffer: string; readonly tod: string } {
  return CONTENT.collection('creatures').get(creature).sounds;
}

/**
 * The layer of the body a blow meets (M6-33 "Treffer je Material", presets in src/content/sfx/kampf.ts): under the damage
 * type's hit – the type says what struck, the material what was struck.
 */
export const KAMPF_MATERIAL_SFX = {
  fleisch: 'sfx_kampf_material_fleisch',
  fell: 'sfx_kampf_material_fell',
  panzer: 'sfx_kampf_material_panzer',
  holz: 'sfx_kampf_material_holz',
  stein: 'sfx_kampf_material_stein',
  schatten: 'sfx_kampf_material_schatten',
} as const satisfies Record<HitMaterial, string>;

/**
 * What a blow on the player meets (M6-33 "Treffer je Material"): the armour on its chest by weight class (§11.4) – heavy
 * armour is plates of metal (bronze in M6, iron and steel later), medium hardened leather; light cloth adds nothing to the
 * hurt sound of `playerDamaged`.
 */
export const KAMPF_RUESTUNG_SFX = {
  leicht: null,
  mittel: 'sfx_kampf_material_leder',
  schwer: 'sfx_kampf_material_metall',
} as const satisfies Record<ArmorWeightClass, string | null>;

/**
 * The telegraph of a wind-up (M6-15, M6-33; §19.4 "klar sichtbar und hörbar"): one cold ping for every wind-up, with an
 * underlayer by what winds up – an area attack with its ground mark rumbles, the shadow brood hisses, animals and foes ping.
 */
export const TELEGRAPH_SFX = {
  schlag: CREATURE_SFX.telegraph,
  brut: 'sfx_kreatur_telegraph_brut',
  flaeche: 'sfx_kreatur_telegraph_flaeche',
} as const;

/** The telegraph sound of creature `creature`'s wind-up (`flaeche`: the attack marks an area). */
export function telegraphSound(creature: string, flaeche: boolean): string {
  if (flaeche) return TELEGRAPH_SFX.flaeche;
  return CONTENT.collection('creatures').find(creature)?.familie === 'schattenbrut' ? TELEGRAPH_SFX.brut : TELEGRAPH_SFX.schlag;
}

/**
 * Sound of a boss attack landing (`bossAttack`): roots bursting out for an area, the leaf storm and the burning arena their
 * own; a summon is silent (its servants call) – null also for an attack the boss no longer has.
 */
function bossAttackSound(boss: string, angriff: string): string | null {
  const def = CONTENT.collection('bosses').find(boss);
  if (def === undefined) return null;
  for (const p of def.phasen) {
    const a = p.angriffe.find((x) => x.id === angriff);
    if (a === undefined) continue;
    if (a.art === 'flaeche') return BOSS_SFX.root;
    if (a.art === 'arena') return a.effekt === 'blaettersturm' ? BOSS_SFX.storm : BOSS_SFX.burn;
    return null;
  }
  return null;
}

/** Sound of a creature's attack by name, or null for an attack the creature no longer has. */
function attackSound(creature: string, name: string): string | null {
  return CONTENT.collection('creatures').find(creature)?.angriffe.find((a) => a.name === name)?.sound ?? null;
}

export const EVENT_SFX: EventSfxTable = {
  commandRejected: (e) => {
    if (e.type === 'player.roll') return e.reason === 'noStamina' ? own(SURVIVAL_SFX.damage.durst) : null;
    // The attack and block buttons are held input (M6-02): out of breath pants like the roll, a missing arrow errs, the rest
    // (busy, staggered, swimming, dead, asleep) stays silent – a button held through a roll is no mistake.
    if (e.type === 'combat.attack' || e.type === 'combat.block') return e.reason === 'noStamina' ? own(SURVIVAL_SFX.damage.durst) : e.reason === 'noAmmo' ? own(INVENTORY_FEEDBACK_SFX.rejected) : null;
    const id = REJECT_SFX[e.type];
    return id === undefined ? null : own(id);
  },
  // --- Player body (M3-08, M3-09) -------------------------------------------------------------
  playerSpawned: () => own(PLAYER_SFX.spawn),
  playerStateChanged: (e) => {
    if (e.state === e.previous) return null;
    switch (e.state) {
      case 'sprint':
        return own(PLAYER_SFX.sprintStart);
      case 'sneak':
        return own(PLAYER_SFX.sneakStart);
      case 'swim':
        return own(PLAYER_SFX.splash);
      case 'jump':
        return own(PLAYER_SFX.jump);
      case 'climb':
        return own(PLAYER_SFX.climb);
      default:
        return null;
    }
  },
  playerRolled: () => own(PLAYER_SFX.roll),
  playerLanded: (e) => own(e.fracture ? PLAYER_SFX.fracture : e.water ? PLAYER_SFX.splash : PLAYER_SFX.land),
  playerStep: (e, ctx) => {
    const volume = STEP_VOLUME_BASE + STEP_VOLUME_PER_NOISE * e.noise;
    if (e.water === 'deep') return own(PLAYER_SFX.swimStroke, volume);
    // A built floor (planks, flagstones, the jetty over the shallows) sounds like itself (M4-29).
    const floor = ctx.underfoot();
    if (floor !== null) return own(floor, volume);
    if (e.water === 'shallow') return own(PLAYER_SFX.footstepWater, volume);
    const id = ctx.footstep(e.terrain);
    return id === null ? null : own(id, volume);
  },
  // --- Survival, conditions (M3-17 … M3-20) ---------------------------------------------------
  playerDamaged: (e) => own(SURVIVAL_SFX.damage[e.cause]),
  survivalStageChanged: (e) => {
    const id = (SURVIVAL_SFX.stage as Readonly<Record<string, string>>)[e.stage];
    return id === undefined ? null : own(id);
  },
  conditionApplied: (e, ctx) => {
    if (e.outcome === 'unveraendert') return null;
    const id = ctx.conditionSound(e.id);
    return id === null ? null : own(id);
  },
  conditionRemoved: (e) => (e.reason === 'tod' ? null : own(CONDITION_SFX.removed)),
  conditionPulse: () => own(CONDITION_SFX.pulse),
  playerAfflicted: (e) => own(e.source === 'trugbild' ? FEAR_SFX.hallucinationHit : CONDITION_SFX.hurt),
  // --- Bags, equipment, drops (M3-02, M3-03, M3-10) ------------------------------------------
  inventoryChanged: (e) => (e.change === 'add' ? null : own(INVENTORY_FEEDBACK_SFX[e.change])),
  itemsAdded: (e, ctx) => own(ctx.itemSound(e.item, 'aufheben') ?? INVENTORY_FEEDBACK_SFX.move),
  inventoryFull: () => own(INVENTORY_FEEDBACK_SFX.full),
  hotbarSelected: () => own(INVENTORY_FEEDBACK_SFX.hotbar),
  equipmentChanged: (e) => own(e.item === null ? INVENTORY_FEEDBACK_SFX.unequip : INVENTORY_FEEDBACK_SFX.equip),
  itemBroken: () => own(EQUIPMENT_FEEDBACK_SFX.broken),
  dropSpawned: (e) => at(DROP_SFX.pop, e.fromX, e.fromY, e.layer),
  dropLanded: (e) => at(DROP_SFX.land, e.x, e.y),
  dropPickedUp: (e) => (e.magnet ? at(DROP_SFX.magnet, e.x, e.y) : null),
  dropBlocked: () => own(INVENTORY_FEEDBACK_SFX.full),
  // --- Harvesting (M3-10 … M3-14) -------------------------------------------------------------
  actionStarted: (e) => (e.byHand ? null : own(INTERACTION_SFX.swing)),
  actionStopped: (e) => (e.reason === 'gone' || e.reason === 'outOfReach' || e.reason === 'blocked' ? own(ACTION_SFX.interrupted) : null),
  harvestHit: (e) => {
    if (e.tooHard) return at(GATHERING_SFX.tooHard, e.x, e.y, e.layer);
    return at(HAND_PICKS.has(e.action) ? GATHERING_SFX.pick : GATHERING_SFX.hit[e.material], e.x, e.y, e.layer);
  },
  harvested: (e) => {
    if (e.action === 'roden') return at(KERNEL_SFX.stumpCleared, e.x, e.y, e.layer);
    return e.action === 'abbauen' && BREAKING_MATERIALS.has(e.material) ? at(KERNEL_SFX.nodeBroken, e.x, e.y, e.layer) : null;
  },
  treeFelled: (e) => at(GATHERING_SFX.treeCreak, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  treeLanded: (e) => at(GATHERING_SFX.treeLand, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  digSpotFound: (e) => at(GATHERING_SFX.digSpot, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  // --- Actions (M3-25) ------------------------------------------------------------------------
  activityStarted: (e, ctx) => {
    switch (e.action) {
      case 'essen':
        return own((e.item === null ? null : ctx.itemSound(e.item, 'benutzen')) ?? ACTION_SFX.eat);
      case 'trinken':
        return own(ACTION_SFX.drink);
      case 'sitzen':
        return own(ACTION_SFX.sit);
    }
  },
  activityFinished: (e) => (e.action === 'sitzen' ? own(ACTION_SFX.stand) : null),
  activityInterrupted: (e) => {
    if (QUIET_INTERRUPTIONS.has(e.reason)) return null;
    return own(e.action === 'sitzen' ? ACTION_SFX.stand : ACTION_SFX.interrupted);
  },
  itemEaten: () => own(ACTION_SFX.swallow),
  waterDrunk: () => own(ACTION_SFX.swallow),
  itemThrown: () => own(ACTION_SFX.throw),
  thrownItemLanded: (e) => at(e.sunk ? ACTION_SFX.sink : ACTION_SFX.land, e.x, e.y, e.layer),
  // --- Fear (M3-23) ---------------------------------------------------------------------------
  fearStageChanged: (e) => {
    const i = fearStageIndex(e.stage);
    return [
      { loop: LOOP_SLOTS.whispers, cue: i >= fearStageIndex('fluestern') ? own(FEAR_SFX.whispers) : null },
      { loop: LOOP_SLOTS.heartbeat, cue: i >= fearStageIndex('bedrohlich') ? own(FEAR_SFX.heartbeat) : null },
    ];
  },
  fearChanged: (e) => own(e.amount > 0 ? FEAR_SFX.fright : FEAR_SFX.calm),
  hallucinationAppeared: (e) => at(FEAR_SFX.hallucination, e.x, e.y),
  hallucinationVanished: (e) => (e.reason === 'angriff' ? null : own(FEAR_SFX.hallucinationGone)),
  nightmareSummoned: () => own(FEAR_SFX.nightmare),
  nightmareEnded: (e) => (e.reason === 'tod' ? null : own(FEAR_SFX.nightmareGone)),
  // --- Sleep (M3-24) --------------------------------------------------------------------------
  sleepStarted: () => [own(SLEEP_SFX.lieDown), { loop: LOOP_SLOTS.sleep, cue: own(SLEEP_SFX.breathing) }],
  sleepEnded: (e) => {
    const stop: LoopCue = { loop: LOOP_SLOTS.sleep, cue: null };
    if (e.reason === 'tod') return stop;
    return [stop, own(e.reason === 'angriff' ? SLEEP_SFX.startled : SLEEP_SFX.wake)];
  },
  // --- Skills (M3-32) -------------------------------------------------------------------------
  xpGained: () => own(SKILL_SFX.xp),
  skillLevelUp: () => own(SKILL_SFX.levelUp),
  perkChoiceOpened: () => own(SKILL_SFX.perk),
  perkChosen: () => own(KERNEL_SFX.perkChosen),
  // --- Crafting and using items (M3-15, M3-16, M4-29) ------------------------------------------
  recipeDiscovered: () => own(CRAFTING_SFX.discovered),
  craftQueued: () => own(CRAFTING_SFX.queued),
  // In the hand: the knocking of the work. At a station its loop sounds while the queue works (loopSources.ts).
  craftStarted: (e, ctx) => (atStation(e.recipe, ctx) ? null : own(CRAFTING_SFX.working)),
  // An upgrade recipe turned the station into its next stage: `stationUpgraded` sounds.
  craftCompleted: (e, ctx) => (e.aufgewertet === true ? null : own(recipeSound(e.recipe, ctx))),
  craftCancelled: (e) => (e.reason === 'tod' ? null : own(CRAFTING_SFX.cancelled)),
  // Filling a dug tile sounds like the earth going in, whatever is shovelled; other uses sound like the item.
  itemUsed: (e, ctx) => at(e.use === 'zuschuetten' ? KERNEL_SFX.filled : (ctx.itemSound(e.item, 'benutzen') ?? KERNEL_SFX.itemUsed), e.x, e.y, e.layer),
  // --- Light (M3-22) --------------------------------------------------------------------------
  lightIgnited: (e) => at(lightKindSound(e.kind, 'an'), e.x, e.y, e.layer),
  // A torch put away leaves the hand quietly (its loop ends with `carriedLightChanged`); placed lights burn in their
  // loops of src/audio/loopSources.ts.
  lightExtinguished: (e) => (e.reason === 'verstaut' ? null : at(lightKindSound(e.kind, 'aus'), e.x, e.y, e.layer)),
  fireCooled: (e) => at(LIGHT_SFX.cooled, e.x, e.y, e.layer),
  // A furniture light comes with its build part: `partPlaced` sounds (and taken down, `partRemoved`).
  lightPlaced: (e) => (FURNITURE_LIGHT_KINDS.has(e.kind) ? null : at(LIGHT_SFX.place, tileCentre(e.tx), tileCentre(e.ty), e.layer)),
  lightRemoved: (e) => (e.reason === 'genommen' ? own(LIGHT_SFX.take) : null),
  // Fuel thunks onto a fire's embers (the camp fire, the fireplace); a lamp takes its resin like the item it is.
  fireFueled: (e, ctx) => {
    const kind = ctx.placedLightKind(e.light);
    const lamp = kind !== null && LAMP_KINDS.has(kind);
    return at(lamp ? (ctx.itemSound(e.item, 'aufheben') ?? INVENTORY_FEEDBACK_SFX.move) : LIGHT_SFX.fuel, e.x, e.y, e.layer);
  },
  carriedLightChanged: (e) => {
    const kind = e.item === null ? undefined : lightKindOfItem(e.item);
    const burning = e.lit && kind !== undefined;
    return { loop: LOOP_SLOTS.handLight, cue: burning ? own(lightKindSound(kind.id, 'brennen'), HAND_LIGHT_VOLUME) : null };
  },
  flammableIgnited: (e) => at(LIGHT_SFX.flammable, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  // --- Death (M3-26) --------------------------------------------------------------------------
  playerDied: () => [own(DEATH_SFX.died), { loop: LOOP_SLOTS.sleep, cue: null }],
  playerRespawned: () => own(DEATH_SFX.respawn),
  graveCreated: (e) => at(DEATH_SFX.grave, e.x, e.y, e.layer),
  graveLooted: () => own(DEATH_SFX.loot),
  respawnPointSet: () => own(DEATH_SFX.respawnPoint),
  // --- Stations (M4-03 … M4-06, M4-29); their work loops come from loopSources.ts --------------
  stationPlaced: (e, ctx) => at(BUILD_AUDIO.place[stationBody(e.station, ctx)], e.x, e.y, e.layer),
  stationRemoved: (e, ctx) => at(BUILD_AUDIO.dismantle[stationBody(e.station, ctx)], e.x, e.y, e.layer),
  // Fuel feeds the fire; what goes into the other slots left the bags with their sound (`inventoryChanged`).
  stationLoaded: (e) => (e.bereich === 'brennstoff' ? at(STATION_EXTRA_AUDIO.fuel, e.x, e.y, e.layer) : null),
  stationProduced: (e, ctx) => {
    const def = ctx.station(e.station);
    return def === undefined ? null : at(def.sounds.fertig, e.x, e.y, e.layer);
  },
  stationStopped: (e, ctx) => {
    switch (e.reason) {
      case 'ausgang':
        return at(STATION_EXTRA_AUDIO.standstill, e.x, e.y, e.layer);
      case 'brennstoff':
        return at(LIGHT_SFX.cooled, e.x, e.y, e.layer);
      case 'eingang':
        // The last batch sounded as it came out; a fired station ticks as it cools.
        return fired(e.station, ctx) ? at(STATION_EXTRA_AUDIO.cooling, e.x, e.y, e.layer) : null;
    }
  },
  stationUpgraded: (e) => at(BUILD_AUDIO.upgraded, e.x, e.y, e.layer),
  // --- Repair (M4-09) -----------------------------------------------------------------------
  itemRepaired: () => own(STATION_EXTRA_AUDIO.repaired),
  // --- Building (M4-11 … M4-25) -------------------------------------------------------------
  partPlaced: (e) => at(e.blueprint ? BUILD_AUDIO.blueprint : BUILD_AUDIO.place[buildSound(e.material)], tileCentre(e.tx), tileCentre(e.ty), e.layer),
  partRemoved: (e) => {
    const x = tileCentre(e.tx);
    const y = tileCentre(e.ty);
    switch (e.reason) {
      case 'abgebaut':
        return at(e.refund === 'keine' ? BUILD_AUDIO.blueprintDiscarded : BUILD_AUDIO.dismantle[buildSound(e.material)], x, y, e.layer);
      case 'zerstoert':
        return at(BUILD_AUDIO.destroyed[breakSound(e.material)], x, y, e.layer);
      case 'abgefallen':
        return at(BUILD_AUDIO.fallOff, x, y, e.layer);
      case 'eingestuerzt':
      case 'aufgewertet':
        // The collapse (`roofCollapsed`) and the upgrade (`partUpgraded`) sound once for all their tiles.
        return null;
    }
  },
  partUpgraded: (e) => {
    const x = tileCentre(e.tx);
    const y = tileCentre(e.ty);
    return [at(BUILD_AUDIO.upgraded, x, y, e.layer), at(BUILD_AUDIO.place[buildSound(e.material)], x, y, e.layer)];
  },
  blueprintCompleted: (e) => {
    const x = tileCentre(e.tx);
    const y = tileCentre(e.ty);
    return [at(BUILD_AUDIO.finished, x, y, e.layer), at(BUILD_AUDIO.place[buildSound(e.material)], x, y, e.layer)];
  },
  roofCollapsed: (e) => at(BUILD_AUDIO.collapse, e.x, e.y, e.layer),
  doorToggled: (e, ctx) => {
    const door = DOOR_AUDIO[doorSound(e.part, ctx.part(e.part)?.art)];
    return at(e.open ? door.open : door.close, tileCentre(e.tx), tileCentre(e.ty), e.layer);
  },
  partDamaged: (e) => at(BUILD_AUDIO.damaged[breakSound(e.material)], tileCentre(e.tx), tileCentre(e.ty), e.layer),
  partRepaired: (e) => at(BUILD_AUDIO.repaired, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  // --- Storage (M4-21) ----------------------------------------------------------------------
  chestOpened: (e) => at(STORAGE_AUDIO.lid[chestSound(e.item)].open, e.x, e.y, e.layer),
  chestClosed: (e) => at(STORAGE_AUDIO.lid[chestSound(e.item)].close, e.x, e.y, e.layer),
  // The quick stash sounds once for every chest it filled (`quickStashed`).
  chestStored: (e) => (e.by === 'schnellablage' ? null : own(e.by === 'alles' ? STORAGE_AUDIO.all : STORAGE_AUDIO.stored)),
  chestSorted: () => own(STORAGE_AUDIO.sorted),
  chestRenamed: () => own(STORAGE_AUDIO.labelled),
  chestLabeled: () => own(STORAGE_AUDIO.labelled),
  quickStashed: () => own(STORAGE_AUDIO.quickStash),
  // --- Hearth (M4-20); its crackle comes from loopSources.ts --------------------------------
  hearthFueled: (e) => at(STATION_EXTRA_AUDIO.fuel, e.x, e.y, e.layer),
  hearthIgnited: (e) => at(HEARTH_AUDIO.ignited, e.x, e.y, e.layer),
  hearthOut: (e) => at(e.reason === 'geloescht' ? HEARTH_AUDIO.doused : HEARTH_AUDIO.out, e.x, e.y, e.layer),
  hearthCoreSet: (e) => at(HEARTH_AUDIO.coreSet, e.x, e.y, e.layer),
  hearthCoreTaken: (e) => at(HEARTH_AUDIO.coreTaken, e.x, e.y, e.layer),
  // --- Fire (M4-28); a burning tile's roar comes from loopSources.ts ------------------------
  fireStarted: (e) => at(e.cause === 'ausbreitung' ? FIRE_AUDIO.spreads : FIRE_AUDIO.breaksOut, e.x, e.y, e.layer),
  fireOut: (e) => at(e.reason === 'regen' ? FIRE_AUDIO.rain : FIRE_AUDIO.burnedOut, e.x, e.y, e.layer),
  treeBurned: (e) => at(FIRE_AUDIO.treeBurned, e.x, e.y, e.layer),
  // --- The fight (M6-02 … M6-09; the weapons' sounds of M6-33, src/content/sfx/kampf.ts) ------------------------------
  // The swing by damage type and heavy attack; a shot or throw sounds on release (projectileFired).
  attackStarted: (e, ctx) => (RANGED_CLASSES.has(e.klasse) ? null : at(swingSound(e.item, e.schwer, ctx), e.x, e.y, e.layer)),
  // Only the player winds up with this event (creatures telegraph, M6-15): a bow is drawn, a crossbow reloads, a sling
  // whirs; a melee wind-up is a pose, the blow sounds with attackStarted.
  attackWindup: (e) => {
    // A heavy attack draws its strength audibly (M7-02); a bow, a crossbow or a sling sounds its draw.
    const id = e.schwer ? RETROFIT_SFX.heavyWindup : drawSound(e.klasse);
    return id === null ? null : own(id);
  },
  // The hit by damage type over the body's material, a crit with its ringing accent; on the player the hurt sound of
  // playerDamaged speaks, with the clang or slap of the armour the blow met.
  hitLanded: (e, ctx) => {
    if (e.targetTeam === 'spieler') {
      const worn = ctx.playerArmour();
      const id = worn === null ? null : KAMPF_RUESTUNG_SFX[worn];
      return id === null ? null : at(id, e.x, e.y, e.layer);
    }
    const hit = at(KAMPF_TREFFER_SFX[e.art], e.x, e.y, e.layer);
    const body = at(KAMPF_MATERIAL_SFX[e.material], e.x, e.y, e.layer);
    return e.crit ? [hit, body, at(KAMPF_KRITISCH_SFX, e.x, e.y, e.layer)] : [hit, body];
  },
  parried: (e) => at(KAMPF_ABWEHR_SFX.parade, e.x, e.y, e.layer),
  blocked: (e, ctx) => {
    const block = at(blockSound(e.mit, ctx), e.x, e.y, e.layer);
    return e.guardBroken ? [block, at(KAMPF_ABWEHR_SFX.bricht, e.x, e.y, e.layer)] : block;
  },
  // A creature shot (M6-15b) leaves with the creature's attack sound (`creatureAttack`); it lands with a splat.
  projectileFired: (e) => (e.item.startsWith(CREATURE_SHOT_PREFIX) ? null : at(releaseSound(e.klasse), e.x, e.y, e.layer)),
  projectileHit: (e) => (e.wirkung === null || e.wirkung === 'einzel' ? null : at(COMBAT_SFX.burst[e.wirkung], e.x, e.y, e.layer)),
  projectileStuck: (e) =>
    e.item.startsWith(CREATURE_SHOT_PREFIX) ? at(CREATURE_SHOT_SFX.impact, e.x, e.y, e.layer) : e.wo === 'ziel' ? null : at(e.wo === 'wasser' ? COMBAT_SFX.sink : KAMPF_FERN_SFX.steckt, e.x, e.y, e.layer),
  // --- Creatures (M6-13 … M6-32): their voices are content (`sounds`, `angriffe[].sound`, src/content/sfx/kreaturen.ts) ---
  creatureCall: (e) => at(creatureSounds(e.creature).laut, e.x, e.y, e.layer),
  creatureFlushed: (e) => at(CREATURE_SFX.flushed, e.x, e.y, e.layer),
  // A camouflaged creature shows itself (M6-22): its call – the Dornling's rustle and hiss – warns before its ambush lands.
  creatureRevealed: (e) => at(creatureSounds(e.creature).laut, e.x, e.y, e.layer),
  // The telegraph (M6-15, §19.4 "klar sichtbar und hörbar"): a warning tone at the wind-up – by what winds up –; the blow
  // has the attack's sound.
  creatureTelegraph: (e) => at(telegraphSound(e.creature, e.flaeche !== null), e.x, e.y, e.layer),
  creatureAttack: (e) => {
    const id = attackSound(e.creature, e.angriff);
    return id === null ? null : at(id, e.x, e.y, e.layer);
  },
  creatureHurt: (e) => at(creatureSounds(e.creature).treffer, e.x, e.y, e.layer),
  creatureDied: (e) => at(creatureSounds(e.creature).tod, e.x, e.y, e.layer),
  creatureFaded: (e) => at(CREATURE_SFX.fade, e.x, e.y, e.layer),
  creatureBurning: (e) => at(CREATURE_SFX.burn, e.x, e.y, e.layer),
  carcassCarved: (e) => at(CREATURE_SFX.carve, e.x, e.y, e.layer),
  trapPlaced: (e) => at(CREATURE_SFX.trapSet, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  trapSprung: (e) => at(CREATURE_SFX.trapSprung, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  // A new bestiary stage: a page turned and written (M6-32; its own sound since M7-02).
  bestiaryUnlocked: () => own(RETROFIT_SFX.bestiary),
  // The net (M7-31): the swing, and a little chime when something is caught in the mesh.
  netSwung: (e) => (e.fang === null ? at(NET_SFX.swing, e.x, e.y, e.layer) : [at(NET_SFX.swing, e.x, e.y, e.layer), at(NET_SFX.caught, e.x, e.y, e.layer)]),
  // Places (M7-07 … M7-09, src/content/sfx/orte.ts): discovery at the player, chests and caches at their tile, the tower's
  // wind and the note at the player, a cleansed place as a calm chord.
  placeDiscovered: () => own(PLACE_SFX.discovered),
  placeChestOpened: (e) => at(PLACE_SFX.chest, tileCentre(e.tx), tileCentre(e.ty)),
  placeCleansed: () => own(PLACE_SFX.cleansed),
  towerClimbed: () => own(PLACE_SFX.tower),
  placeNoteRead: () => own(PLACE_SFX.note),
  placeDugUp: (e) => at(PLACE_SFX.cache, tileCentre(e.tx), tileCentre(e.ty)),
  // The map (M7-49): setting an own marker scratches the quill.
  mapMarked: () => own(MAP_SFX.marked),
  // World events (M7-38 … M7-40, src/content/sfx/ereignisse.ts): the announcement at the player, strikes, the meteorite and
  // falling shards where they land.
  worldEventAnnounced: () => own(WORLD_EVENT_SFX.announced),
  lightningStruck: (e) => at(WORLD_EVENT_SFX.strike, e.x, e.y, e.layer),
  meteorImpact: (e) => at(WORLD_EVENT_SFX.meteor, e.x, e.y, e.layer),
  lumenShardFell: (e) => at(WORLD_EVENT_SFX.shard, e.x, e.y, e.layer),
  // Bosses (M7-32 … M7-34, src/content/sfx/boss.ts): the groan of waking and the fall at the trunk, the bark bursting at a new
  // phase; a telegraphed area rumbles like the creatures' (a summon has its cast), it lands as roots bursting out, the leaf storm
  // and the burning arena with their own; servants speak through `creatureCall` …
  bossAwakened: (e) => at(BOSS_SFX.awake, e.x, e.y),
  bossPhaseChanged: () => own(BOSS_SFX.phase),
  bossTelegraph: (e) => at(e.flaeche === 'beschwoerung' ? BOSS_SFX.summon : TELEGRAPH_SFX.flaeche, e.x, e.y),
  bossAttack: (e) => {
    const id = bossAttackSound(e.boss, e.angriff);
    return id === null ? null : at(id, e.x, e.y);
  },
  bossDefeated: (e) => at(BOSS_SFX.fall, e.x, e.y),
  // Beacons, unlocks, shards, travel (M7-35 … M7-37, src/content/sfx/leuchtfeuer.ts).
  beaconIgnitionStarted: (e) => at(BEACON_SFX.ignite, e.x, e.y),
  beaconLit: (e) => at(BEACON_SFX.lit, e.x, e.y),
  unlockGranted: () => own(UNLOCK_SFX.granted),
  shardUsed: (e, ctx) => own(ctx.itemSound(e.item, 'benutzen') ?? KERNEL_SFX.itemUsed),
  travelled: () => own(TRAVEL_SFX.travelled),
  travelPointRenamed: () => own(STORAGE_AUDIO.labelled),
  lumenCharged: () => own(LIGHT_SFX.lumenCharged),
  // The field (M7-19 … M7-23, src/content/sfx/feld.ts): the player's work at its plot; crows caw at a pecked plot.
  cropPlanted: (e) => at(FARM_SFX.sown, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  saplingPlanted: (e) => at(FARM_SFX.planted, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  plotWatered: (e) => at(FARM_SFX.watered, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  canFilled: (e) => at(FARM_SFX.canFilled, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  plotFertilized: (e) => at(FARM_SFX.fertilized, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  cropHarvested: (e) => at(FARM_SFX.harvested, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  cropCleared: (e) => at(FARM_SFX.cleared, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  pestAppeared: (e) => (e.art === 'kraehen' ? at(FARM_SFX.crows, tileCentre(e.tx), tileCentre(e.ty), e.layer) : null),
  // Fishing (M7-24, src/content/sfx/angeln.ts): the rod at the player, the float out on the water.
  fishCast: (e) => [own(FISHING_SFX.cast), at(FISHING_SFX.plop, e.x, e.y, e.layer)],
  fishBite: (e) => at(FISHING_SFX.bite, e.x, e.y, e.layer),
  fishHooked: () => own(FISHING_SFX.hooked),
  fishLeap: (e) => at(FISHING_SFX.leap, e.x, e.y, e.layer),
  fishCaught: () => own(FISHING_SFX.caught),
  fishLost: (e) => (e.grund === 'gerissen' ? own(FISHING_SFX.snapped) : at(FISHING_SFX.escaped, e.x, e.y, e.layer)),
  castEnded: () => own(FISHING_SFX.reeledIn),
  iceHoleCut: (e) => at(FISHING_SFX.iceHole, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  fishTrapPlaced: (e) => at(FISHING_SFX.trap, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  fishTrapTaken: (e) => at(FISHING_SFX.trap, tileCentre(e.tx), tileCentre(e.ty), e.layer),
  fishTrapEmptied: (e) => at(FISHING_SFX.trapEmptied, tileCentre(e.tx), tileCentre(e.ty), e.layer),
};

/** Events without a sound of their own, and why. */
export const SILENT_EVENTS: { readonly [K in keyof SimEventMap]?: string } = {
  entitySpawned: 'Infrastruktur: jede Entität, der Klang kommt vom fachlichen Ereignis (Drop, Spieler …)',
  entityDespawned: 'Infrastruktur: jede Entität, der Klang kommt vom fachlichen Ereignis',
  worldTick: 'Takt (1 Hz), kein Geschehen',
  dailyTick: 'Takt (06:00), der Morgen klingt über Schlaf und Umgebung',
  playerClimbed: 'der Kletterklang spielt beim Beginn (playerStateChanged climb)',
  tileDug: 'der Grabtreffer (harvestHit) klingt schon',
  objectRegrown: 'geschieht abseits und beim Aufholen gebündelt',
  dropExpired: 'der Drop verschwindet unbemerkt, weit weg vom Spieler',
  graveEmptied: 'das Leeren (graveLooted) klingt schon',
  skillProgressLost: 'der Tod hat seinen eigenen Klang (playerDied)',
  stationOpened: 'der Stationsbildschirm öffnet mit seinem eigenen Klang (MenuHooks.klang)',
  stationBatchStarted: 'die Station klingt über ihre Arbeitsschleife, solange sie läuft (loopSources.ts) – auch über aufeinanderfolgende Chargen hinweg',
  playerRoomChanged: 'Betreten ist Gehen (Schritte); der Raum klingt über Hall und Dämpfung aus dem Zustand (src/audio/reverb.ts, occlusion.ts, M7-01)',
  instrumentPlayed: 'das Lied selbst erklingt (src/audio/music, aus dem Zustand des Instruments – auch nach dem Laden)',
  instrumentStopped: 'das Lied klingt aus (src/audio/music/player.ts blendet es aus)',
  chestPlaced: 'die Kiste ist ein Bauteil: partPlaced klingt mit ihrem Material',
  chestRemoved: 'partRemoved klingt mit ihrem Material, verstreute Stapel als Drops (dropSpawned)',
  hearthBuilt: 'das Herdfeuer ist ein Bauteil: partPlaced klingt mit seinem Stein',
  hearthRemoved: 'partRemoved klingt mit seinem Stein, verstreuter Vorrat als Drops (dropSpawned)',
  hearthOpened: 'der Herdfeuer-Bildschirm öffnet mit seinem eigenen Klang (MenuHooks.klang)',
  stationTaken: 'die Stücke kommen in die Taschen: itemsAdded klingt mit dem Material des Items',
  chestTaken: 'zum Spieler: itemsAdded klingt mit dem Material des Items; für Handwerk und Bau klingt deren Arbeit',
  hearthFuelTaken: 'der Brennstoff kommt in die Taschen: itemsAdded klingt mit dem Material des Items',
  staggered: 'das Taumeln folgt einem Treffer oder einer Parade, die schon klingen (hitLanded, parried)',
  combatantDefeated: 'der letzte Treffer klingt (hitLanded); den Tod vertont das System des Körpers – playerDied beim Spieler, der Todeslaut der Kreatur (M6-19 ff.)',
  creatureSpawned: 'Kreaturen erscheinen unbemerkt (Bestand, Nachwuchs, Nachtbrut abseits des Blicks); ihr Ruf (creatureCall) macht sie hörbar',
  doorBattered: 'der Schlag gegen die Tür klingt mit ihrem Material (partDamaged)',
  carcassRotted: 'der Kadaver verwest abseits, meist fern vom Spieler',
  trapTaken: 'die Falle kommt in die Taschen: itemsAdded klingt mit dem Material des Items',
  placeRevealed: 'eine Karte (Kartentisch, Auftrag, Händlerin) zeigt den Ort; es klingt die Quelle, nicht der ferne Ort',
  mapUnmarked: 'ein Marker wird im Kartenbildschirm entfernt, dessen Bedienung schon klingt (MenuHooks.klang)',
  mapRenamed: 'die Umbenennung geschieht im Kartenbildschirm, dessen Eingabe schon klingt (MenuHooks.klang)',
  placeLooted: 'die letzte Truhe klingt schon beim Öffnen (placeChestOpened)',
  placeGuardsReturned: 'die Wächter kehren zurück, während der Spieler fort ist (Rückkehr erst nach Tagen); ihre Stimmen klingen, wenn er sie trifft',
  shrineBlessed: 'der Segen klingt als Zustand gesegnet (conditionApplied, sfx_zustand_gesegnet)',
  worldEventStarted: 'der Beginn klingt mit der Ankündigung (worldEventAnnounced) und dem, was das Ereignis tut (Einschläge, Dunkel, Brand)',
  worldEventEnded: 'ein Ereignis klingt aus: der Himmel kehrt zurück, die Musik folgt der Lage (Strang A)',
  bossReset: 'der Tod hat seinen Klang (playerDied), die Flucht ist Gehen; das Siegel fällt sichtbar, die Bossmusik endet (Musikdirektor)',
  travelOpened: 'der Reisebildschirm öffnet mit seinem eigenen Klang (MenuHooks.klang)',
  worldSettingsChanged: 'die Änderung kommt aus einem Menü (Neue Welt, Pausemenü „Welt“), dessen Bedienung schon klingt (MenuHooks.klang); die Welt selbst ändert sich unhörbar',
  // The field (M7-19 … M7-23): what happens at 06:00 happens to many plots at once and mostly out of earshot – the look tells it.
  plotCreated: 'die Hacke klingt mit tileDug, das Beet mit dem Setzen des Bauteils (partPlaced)',
  plotRemoved: 'Zuschütten, Überbauen und Abbauen klingen mit ihren eigenen Ereignissen (tileFilled, partPlaced, partRemoved)',
  cropRipe: 'um 06:00 in vielen Beeten zugleich, meist fern vom Spieler: die reife Pflanze zeigt es',
  cropDied: 'um 06:00 (Frost, Mehltau) oder still gefressen: die welke Pflanze zeigt es',
  pestCured: 'die Kräuterbrühe klingt schon als Düngen (plotFertilized)',
  saplingGrown: 'um 06:00, meist fern vom Spieler: der Jungbaum zeigt es',
  wormFound: 'der Wurm fällt als Drop aus der Hacke: tileDug und dropSpawned klingen',
  // Fishing (M7-24).
  fishTrapCaught: 'um 06:00 in der Reuse unter Wasser – hörbar wird der Fang beim Leeren (fishTrapEmptied)',
};

/** The cues of one event (flattened). */
export function cuesFor<K extends keyof SimEventMap>(type: K, payload: SimEventMap[K], ctx: EventSfxContext, table: EventSfxTable = EVENT_SFX): readonly AudioCue[] {
  const mapper = table[type] as Mapper<SimEventMap[K]> | undefined;
  if (mapper === undefined) return [];
  const out = mapper(payload, ctx);
  if (out === null) return [];
  return isCueList(out) ? out : [out];
}

function isCueList(c: AudioCue | readonly AudioCue[]): c is readonly AudioCue[] {
  return Array.isArray(c);
}
