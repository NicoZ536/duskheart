/**
 * What crafting reads from other systems through hooks (MASTERPROMPT §15.1; M3-16, completed by M4-02
 * chests and M4-03/M4-05 stations):
 *
 * - **Chests** (`CraftingStore`, `StoreProvider`): "Crafting nimmt aus Inventar und Kisten im Umkreis von
 *   8 Tiles (abschaltbar)". The storage system registers a provider that lists the chests within the
 *   radius around the player; crafting counts their contents and takes what the bags lack.
 * - **Stations** (`StationProvider`): the best placed station within reach of the player that can make the
 *   recipes of a station id – same line, same or higher stage (the station system, src/game/stations; the
 *   lit campfires of the light system, src/game/stations/campfire.ts) – with its tempo and quality points.
 * - **Upgrades** (`StationUpgrader`): an upgrade recipe (Werkbank I → II) turns the placed station it was
 *   made at into the next stage (the station system). It needs exactly the stage below its product at hand
 *   (`StationProvider` with `exact`): a higher stage satisfies the recipe's station but cannot be upgraded to it.
 * - **Workshops** (`WorkshopTempo`): the crafting tempo the room around a tile adds (§16.4 "Werkstatt … +15 %
 *   Tempo"; the rooms system) – the room of the station a piece is worked at, the player's in the hand.
 * - **Skills** (`CraftingSkills`): the Handwerk bonus shortens crafting, the Handwerk level sets the quality
 *   of a piece (§13.1), every finished piece gives experience (§23.2) – the skill system.
 * - **Spilling** (`SpillItems`): what does not fit into the bags lands at the player's feet (the drop
 *   system), so a finished piece or a refund is never lost.
 */
import type { Layer } from '../../world/model/coords';
import type { ItemStack } from '../items/stack';
import type { Simulation } from '../sim';

/** A container crafting may take from (a chest). */
export interface CraftingStore {
  /** Usable pieces of `item` it holds [pieces] (items with durability only while intact). */
  count(item: string): number;
  /** Takes `count` usable pieces of `item` (at most `count(item)`); returns them with their state. */
  take(sim: Simulation, item: string, count: number): readonly ItemStack[];
}

/** The containers within `radiusPx` of (x, y) on `layer`, nearest first. */
export type StoreProvider = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number) => readonly CraftingStore[];

/** A station at hand: which one, where (its placed id), how fast and how well it works. */
export interface StationAtHand {
  /** Station id (the placed item: `werkbank_2` for a recipe of `werkbank`). */
  readonly station: string;
  /** Id of the placed station in the station system; 0 for stations kept by another system (campfires). */
  readonly platz: number;
  /** Anchor tile of a placed station (its room is where the work happens); absent for stations of other systems. */
  readonly tx?: number;
  readonly ty?: number;
  /** Working speed [factor]. */
  readonly tempo: number;
  /** Quality points [points]. */
  readonly qualitaet: number;
}

/**
 * The best station within `radiusPx` of (x, y) on `layer` that can make the recipes of `station` (same line,
 * same or higher stage) – with `exact` only a station `station` itself (the stage an upgrade recipe turns into
 * the next) –, or `null`.
 */
export type StationProvider = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number, station: string, exact?: boolean) => StationAtHand | null;

/** Crafting tempo the room around tile (tx, ty) of `layer` adds [fraction] (§16.4 "Werkstatt … +15 % Tempo"). */
export type WorkshopTempo = (sim: Simulation, layer: Layer, tx: number, ty: number) => number;

/** Turns the placed station `platz` into station `to` (an upgrade recipe); false when it is gone. */
export type StationUpgrader = (sim: Simulation, platz: number, to: string) => boolean;

/** The skill system as crafting sees it. */
export interface CraftingSkills {
  /** Level of skill `id` [1–100]. */
  level(id: string): number;
  /** Effect bonus of skill `id` [fraction; +0,5 % per level]. */
  bonus(id: string): number;
  /** Awards the experience of source `sourceId` `times` times; returns the XP given. */
  award(sim: Simulation, sourceId: string, times?: number): number;
  /** Whether `sourceId` is an experience source of some skill. */
  hasSource(sourceId: string): boolean;
}

/** Puts a stack that found no room in the bags into the world at (x, y) on `layer`. */
export type SpillItems = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
