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
 * at the player) and loop changes (`LoopCue`: whispers while afraid, breathing while asleep), or null.
 */
import { CONTENT } from '../content/index';
import { lightKindOfItem } from '../content/lights';
import { TILE_PX } from '../world/model/coords';
import { ACTION_SFX } from '../game/actions/events';
import { CRAFTING_SFX, craftCompletedSound } from '../game/crafting/events';
import { LIGHT_SFX, lightKindSound } from '../game/light/events';
import { CARRIED_LIGHT_ID } from '../game/light/system';
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
import { SKILL_SFX } from '../game/skills/events';
import { SLEEP_SFX } from '../game/sleep/events';
import { SURVIVAL_SFX } from '../game/survival/events';
import type { GameCommandType } from '../game/commands';
import type { SimEventMap } from '../game/sim';
import { footstepSfxId } from '../content/sfx/index';
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

/** Content lookups of the mappers. */
export interface EventSfxContext {
  /** Footstep sound of a terrain id, or null for ground without steps. */
  footstep(terrain: string): string | null;
  /** An item's own sound (`sounds.aufheben` / `sounds.benutzen`), or null. */
  itemSound(item: string, use: 'aufheben' | 'benutzen'): string | null;
  /** A condition's onset sound, or null. */
  conditionSound(condition: string): string | null;
  /** The sound of a finished piece of a recipe (its own `sound` or the crafting chime). */
  recipeSound(recipe: string): string;
}

/** The lookups on the game's content registry. */
export function createEventSfxContext(): EventSfxContext {
  const terrain = CONTENT.collection('terrain');
  const items = CONTENT.collection('items');
  const conditions = CONTENT.collection('conditions');
  const recipes = CONTENT.collection('recipes');
  return {
    footstep: (id) => {
      const material = terrain.find(id)?.footstep;
      return material === undefined || material === null ? null : footstepSfxId(material);
    },
    itemSound: (id, use) => items.find(id)?.sounds[use] ?? null,
    conditionSound: (id) => conditions.find(id)?.sound ?? null,
    recipeSound: (id) => craftCompletedSound(recipes.find(id)),
  };
}

type Mapper<P> = (payload: P, ctx: EventSfxContext) => AudioCue | readonly AudioCue[] | null;
/** The table type: a mapper per event type. */
export type EventSfxTable = { readonly [K in keyof SimEventMap]?: Mapper<SimEventMap[K]> };

/** Loop slots of the player's state and the carried torch; placed lights burn in `lightLoop(id)`. */
export const LOOP_SLOTS = { whispers: 'furcht_fluestern', heartbeat: 'furcht_herz', sleep: 'schlaf', handLight: 'licht_hand' } as const;

/** Loop slot of placed light `id` (a torch on its stake or wall, a camp fire). */
export function lightLoop(id: number): string {
  return `licht_${id}`;
}

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
  'player.useItem': INVENTORY_FEEDBACK_SFX.rejected,
  'light.toggle': INVENTORY_FEEDBACK_SFX.rejected,
  'light.place': INVENTORY_FEEDBACK_SFX.rejected,
  'light.fuel': INVENTORY_FEEDBACK_SFX.rejected,
  'light.ignite': INVENTORY_FEEDBACK_SFX.rejected,
  'light.douse': INVENTORY_FEEDBACK_SFX.rejected,
  'light.take': INVENTORY_FEEDBACK_SFX.rejected,
};

/** Sounds of the kernel's own choosing (no game table names them). */
export const KERNEL_SFX = {
  /** A stump torn out (`harvested`, action `roden`). */
  stumpCleared: 'sfx_baum_roden',
  /** A rock, ore or crystal node breaks apart (`harvested`, action `abbauen`). */
  nodeBroken: 'sfx_sammeln_bersten',
  /** A perk was chosen. */
  perkChosen: 'sfx_ui_klick',
  /** An item was used that has no use sound of its own. */
  itemUsed: 'sfx_ui_klick',
} as const;

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

export const EVENT_SFX: EventSfxTable = {
  commandRejected: (e) => {
    if (e.type === 'player.roll') return e.reason === 'noStamina' ? own(SURVIVAL_SFX.damage.durst) : null;
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
  // --- Crafting and using items (M3-15, M3-16) ------------------------------------------------
  recipeDiscovered: () => own(CRAFTING_SFX.discovered),
  craftQueued: () => own(CRAFTING_SFX.queued),
  craftStarted: () => own(CRAFTING_SFX.working),
  craftCompleted: (e, ctx) => own(ctx.recipeSound(e.recipe)),
  craftCancelled: (e) => (e.reason === 'tod' ? null : own(CRAFTING_SFX.cancelled)),
  itemUsed: (e, ctx) => at(ctx.itemSound(e.item, 'benutzen') ?? KERNEL_SFX.itemUsed, e.x, e.y, e.layer),
  // --- Light (M3-22) --------------------------------------------------------------------------
  lightIgnited: (e) => at(lightKindSound(e.kind, 'an'), e.x, e.y, e.layer),
  lightExtinguished: (e) => {
    // A torch put away leaves the hand quietly (its loop ends with `carriedLightChanged`).
    if (e.reason === 'verstaut') return null;
    const out = at(lightKindSound(e.kind, 'aus'), e.x, e.y, e.layer);
    return e.light === CARRIED_LIGHT_ID ? out : [out, { loop: lightLoop(e.light), cue: null }];
  },
  fireCooled: (e) => at(LIGHT_SFX.cooled, e.x, e.y, e.layer),
  lightPlaced: (e) => {
    const x = tileCentre(e.tx);
    const y = tileCentre(e.ty);
    const placed = at(LIGHT_SFX.place, x, y, e.layer);
    return e.lit ? [placed, { loop: lightLoop(e.light), cue: at(lightKindSound(e.kind, 'brennen'), x, y, e.layer) }] : placed;
  },
  lightRemoved: (e) => {
    const stop: LoopCue = { loop: lightLoop(e.light), cue: null };
    return e.reason === 'genommen' ? [own(LIGHT_SFX.take), stop] : stop;
  },
  fireFueled: (e) => at(LIGHT_SFX.fuel, e.x, e.y, e.layer),
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
