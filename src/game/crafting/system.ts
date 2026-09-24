/**
 * Crafting system (MASTERPROMPT §15.1, §23.2 Handwerk; docs/SPIEL.md §3, §6; M3-16).
 *
 * - **Visibility** (every tick, and before a command): whatever the player owns is remembered
 *   (`besessen`); a recipe becomes visible once every ingredient was owned and its station is known –
 *   owned, or met in the world (`meetStation`) – or, for a recipe with a blueprint, once the blueprint is
 *   learned (`learnBlueprint`). A newly visible recipe raises `recipeDiscovered`.
 * - **Orders** (`craft.start {recipe, count}`): a visible recipe, its station in reach and its
 *   surroundings (water) given, room in the queue (10) and ingredients for all `count` pieces – usable
 *   pieces only (a broken tool is no ingredient), from the bags first, then from the chests in reach when
 *   that is on (`craft.useChests`, the storage system's `StoreProvider`). They are taken at once and
 *   reserved for the order.
 * - **Work** (every tick): the first order of the queue advances while the player lives and is awake and – checked when
 *   a piece begins – its station and surroundings are still at hand; otherwise it waits (`blocked`). One
 *   piece takes its crafting time, shortened by the Handwerk skill. A finished piece consumes its share of
 *   the reservation and goes into the bags (keeping durability and quality where the recipe says so);
 *   what does not fit lands at the player's feet. Every piece gives Handwerk experience.
 * - **Cancel** (`craft.cancel {index}`): the whole reservation of the order goes back into the bags
 *   ("Abbrechen erstattet vollständig"; what does not fit lands at the feet). `cancelAll` does the same
 *   for every order (the death system before it fills the grave).
 * - Global (the player's own work). Save participant `crafting`: owned items, met stations, learned
 *   blueprints, the chest switch and the queue with its reservations.
 */
import { BALANCE } from '../../content/balance';
import type { RecipeDef } from '../../content/recipes/schema';
import { NULL_ENTITY } from '../../engine/ecs';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { CommandOfType } from '../commands';
import type { InventorySystem } from '../inventory/system';
import { checkStack, newStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { CraftCancelReason, CraftRejectReason } from './events';
import { affordablePieces, craftSeconds, craftTicks, freshWaterWithin, keptState, ownedItems, pieceShare, recipeVisible, takeUsable, usableCount } from './formulas';
import { contentRecipeBook, type RecipeBook } from './recipes';
import type { CraftingSkills, CraftingStore, SpillItems, StationProvider, StoreProvider } from './sources';
import { craftingSnapshot, craftingSnapshotSchema, emptyCraftingState, type CraftOrder, type CraftingState } from './state';

/** Id of the crafting system and its save participant. */
export const CRAFTING_SYSTEM_ID = 'crafting';
/** Data version of the `crafting` participant. */
export const CRAFTING_SAVE_VERSION = 1;
/** The skill that makes crafting faster (§23.2 "Handwerk: Schnelleres Herstellen"). */
export const CRAFT_SKILL = 'handwerk';
/** Experience source of a finished piece (src/content/skills.ts). */
export const CRAFT_XP_SOURCE = 'gegenstand_hergestellt';

const C = BALANCE.crafting;
const CHEST_RADIUS_PX = C.chestRadiusTiles * TILE_PX;
const STATION_RADIUS_PX = C.stationRadiusTiles * TILE_PX;
const WATER_REACH_PX = C.waterReachTiles * TILE_PX;
/** Tiles around the feet the water probe loads (the reach plus the tile the feet stand on). */
const WATER_TILES = Math.ceil(C.waterReachTiles) + 1;

/** Dependencies of the crafting system. */
export interface CraftingSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** The world's tiles (water in reach). */
  readonly collision: WorldCollision;
  /** Where what does not fit into the bags goes (the drop system). */
  readonly spill: SpillItems;
  /** Default: the game's recipes on the inventory's item catalog. */
  readonly recipes?: RecipeBook;
}

/** A refusal or `null`. */
type Refusal = CraftRejectReason | null;

export class CraftingSystem implements SimSystem {
  readonly id = CRAFTING_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  readonly recipes: RecipeBook;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly spill: SpillItems;
  private readonly state: CraftingState = emptyCraftingState();
  /** Visible recipe ids (derived from the state). */
  private readonly visible = new Set<string>();
  /** Bag revision last read into `besessen` (-1 = never). */
  private seenRevision = -1;
  private skills: CraftingSkills | null = null;
  private readonly storeProviders: StoreProvider[] = [];
  private readonly stationProviders: StationProvider[] = [];
  private blockedValue: CraftRejectReason | null = null;
  private readonly at = { x: 0, y: 0 };

  constructor(deps: CraftingSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.spill = deps.spill;
    this.recipes = deps.recipes ?? contentRecipeBook(deps.inventory.bags.catalog);
    this.commands = {
      'craft.start': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.start(sim, cmd, tick)),
      'craft.cancel': (sim, cmd, tick) => {
        const order = this.state.auftraege[cmd.index];
        if (order === undefined) {
          this.refuse(sim, cmd.type, tick, 'noOrder');
          return;
        }
        this.cancelAt(sim, cmd.index, 'abgebrochen');
      },
      'craft.useChests': (_sim, cmd) => {
        this.state.kisten = cmd.on;
      },
    };
    this.save = {
      id: CRAFTING_SYSTEM_ID,
      version: CRAFTING_SAVE_VERSION,
      serialize: () => craftingSnapshot(this.state),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Hooks and queries
  // -------------------------------------------------------------------------------------------

  /** Connects the skill system (Handwerk bonus and experience). */
  useSkills(skills: CraftingSkills): void {
    if (!skills.hasSource(CRAFT_XP_SOURCE)) throw new Error(`CraftingSystem: the skills have no experience source "${CRAFT_XP_SOURCE}"`);
    this.skills = skills;
  }

  /** Adds a source of chests in reach (the storage system, M4-02). */
  addStores(provider: StoreProvider): void {
    this.storeProviders.push(provider);
  }

  /** Adds a source of placed stations (the building system). */
  addStations(provider: StationProvider): void {
    this.stationProviders.push(provider);
  }

  /** The player met a placed station of item `station` (building system): recipes needing it may become visible. */
  meetStation(sim: Simulation, station: string): void {
    if (this.state.stationen.has(station)) return;
    this.state.stationen.add(station);
    this.refreshVisible(sim);
  }

  /** The player learned the blueprint of `recipe` (§15.1 "Baupläne"); false for a recipe without one. */
  learnBlueprint(sim: Simulation, recipe: string): boolean {
    const r = this.recipes.find(recipe);
    if (r?.bauplan === undefined || this.state.bauplaene.has(recipe)) return false;
    this.state.bauplaene.add(recipe);
    this.refreshVisible(sim);
    return true;
  }

  /** Whether the recipe `id` is visible. */
  isVisible(id: string): boolean {
    return this.visible.has(id);
  }

  /** The visible recipes in book order (allocates; the UI). */
  visibleRecipes(): RecipeDef[] {
    return this.recipes.list.filter((r) => this.visible.has(r.id));
  }

  /** Whether the player has owned `item` at least once. */
  hasOwned(item: string): boolean {
    return this.state.besessen.has(item);
  }

  /** Whether crafting takes from chests in reach. */
  get usesChests(): boolean {
    return this.state.kisten;
  }

  /** The queue (first = being worked on). */
  get orders(): readonly Readonly<CraftOrder>[] {
    return this.state.auftraege;
  }

  /** Progress of the piece being worked on [0–1] (0 without an order). */
  get progress(): number {
    const o = this.state.auftraege[0];
    return o === undefined || o.dauer === 0 ? 0 : o.fortschritt / o.dauer;
  }

  /** Why the first order does not advance right now, or `null` (the UI shows it). */
  get blocked(): CraftRejectReason | null {
    return this.blockedValue;
  }

  /** Usable pieces of `item` crafting can take now: the bags plus the chests in reach [pieces]. */
  available(sim: Simulation, item: string): number {
    let n = usableCount(this.inventory.state, item);
    for (const store of this.stores(sim)) n += store.count(item);
    return n;
  }

  /** Pieces of recipe `id` the ingredients at hand afford [pieces]. */
  affordable(sim: Simulation, id: string): number {
    const r = this.recipes.find(id);
    if (r === undefined) return 0;
    const stores = this.stores(sim);
    return affordablePieces(r, (item) => usableCount(this.inventory.state, item) + stores.reduce((n, s) => n + s.count(item), 0));
  }

  /** Cancels every order and refunds it (the death system, before the grave is filled). */
  cancelAll(sim: Simulation, reason: CraftCancelReason): void {
    while (this.state.auftraege.length > 0) this.cancelAt(sim, this.state.auftraege.length - 1, reason);
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    this.discover(sim);
    this.work(sim);
  }

  /** Remembers what the bags hold and raises `recipeDiscovered` for recipes that became visible. */
  private discover(sim: Simulation): void {
    const revision = this.inventory.bags.revision;
    if (revision === this.seenRevision) return;
    this.seenRevision = revision;
    const before = this.state.besessen.size;
    ownedItems(this.inventory.state, this.state.besessen);
    if (this.state.besessen.size !== before) this.refreshVisible(sim);
  }

  /** Adds the recipes that became visible; `sim` null = silently (loading). */
  private refreshVisible(sim: Simulation | null): void {
    const s = this.state;
    for (const r of this.recipes.list) {
      if (this.visible.has(r.id) || !recipeVisible(r, s.besessen, s.stationen, s.bauplaene)) continue;
      this.visible.add(r.id);
      sim?.events.push('recipeDiscovered', { recipe: r.id, tick: sim.eventTick });
    }
  }

  private work(sim: Simulation): void {
    const order = this.state.auftraege[0];
    if (order === undefined) {
      this.blockedValue = null;
      return;
    }
    const alive = this.alive(sim);
    if (alive !== null) {
      this.blockedValue = alive;
      return;
    }
    const recipe = this.recipes.get(order.rezept);
    if (order.dauer === 0) {
      const missing = this.surroundings(sim, recipe);
      if (missing !== null) {
        this.blockedValue = missing;
        return;
      }
      order.dauer = craftTicks(craftSeconds(recipe), this.skills?.bonus(CRAFT_SKILL) ?? 0);
      sim.events.push('craftStarted', { recipe: recipe.id, ticks: order.dauer, tick: sim.eventTick });
    }
    this.blockedValue = null;
    order.fortschritt++;
    if (order.fortschritt >= order.dauer) this.finishPiece(sim, order, recipe);
  }

  /** One piece is done: its share of the reservation is consumed, the product goes into the bags. */
  private finishPiece(sim: Simulation, order: CraftOrder, recipe: RecipeDef): void {
    const { consumed, rest } = pieceShare(recipe, order.reserviert);
    order.reserviert = rest;
    const def = this.recipes.catalog.get(recipe.ergebnis.item);
    const kept = keptState(recipe, def, consumed);
    const made = newStack(def, recipe.ergebnis.anzahl, kept === null ? {} : { qualitaet: kept.qualitaet });
    this.deliver(sim, kept === null ? made : { ...made, haltbarkeit: kept.haltbarkeit });
    this.skills?.award(sim, CRAFT_XP_SOURCE);
    sim.events.push('craftCompleted', { recipe: recipe.id, item: def.id, count: recipe.ergebnis.anzahl, tick: sim.eventTick });
    order.anzahl--;
    order.fortschritt = 0;
    order.dauer = 0;
    if (order.anzahl === 0) this.state.auftraege.shift();
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private start(sim: Simulation, cmd: CommandOfType<'craft.start'>, tick: number): Refusal {
    const alive = this.alive(sim);
    if (alive !== null) return alive;
    const recipe = this.recipes.find(cmd.recipe);
    if (recipe === undefined) return 'unknownRecipe';
    this.discover(sim);
    if (!this.visible.has(recipe.id)) return 'recipeHidden';
    if (this.state.auftraege.length >= C.queueLength) return 'queueFull';
    const missing = this.surroundings(sim, recipe);
    if (missing !== null) return missing;
    if (this.affordable(sim, recipe.id) < cmd.count) return 'notEnough';
    const reserved = this.reserve(sim, recipe, cmd.count);
    this.state.auftraege.push({ rezept: recipe.id, anzahl: cmd.count, fortschritt: 0, dauer: 0, reserviert: reserved });
    sim.events.push('craftQueued', { recipe: recipe.id, count: cmd.count, index: this.state.auftraege.length - 1, tick });
    return null;
  }

  /** Takes the ingredients of `count` pieces: the bags first, then the chests in reach (the caller checked they suffice). */
  private reserve(sim: Simulation, recipe: RecipeDef, count: number): ItemStack[] {
    const reserved: ItemStack[] = [];
    let bags = this.inventory.state;
    const stores = this.stores(sim);
    for (const z of recipe.zutaten) {
      let need = z.anzahl * count;
      const fromBags = Math.min(need, usableCount(bags, z.item));
      if (fromBags > 0) {
        const taken = takeUsable(bags, z.item, fromBags);
        if (taken === null) throw new Error(`CraftingSystem: ${fromBags} × "${z.item}" counted but not taken`);
        bags = taken.state;
        reserved.push(...taken.taken);
        need -= fromBags;
      }
      for (const store of stores) {
        if (need === 0) break;
        const n = Math.min(need, store.count(z.item));
        if (n > 0) {
          reserved.push(...store.take(sim, z.item, n));
          need -= n;
        }
      }
      if (need > 0) throw new Error(`CraftingSystem: ${need} × "${z.item}" missing after the check`);
    }
    if (bags !== this.inventory.state) {
      this.inventory.bags.replace(bags);
      sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
    }
    return reserved;
  }

  /** Cancels the order at `index` and refunds its reservation. */
  private cancelAt(sim: Simulation, index: number, reason: CraftCancelReason): void {
    const [order] = this.state.auftraege.splice(index, 1);
    if (order === undefined) return;
    for (const stack of order.reserviert) this.deliver(sim, stack);
    sim.events.push('craftCancelled', { recipe: order.rezept, pieces: order.anzahl, reason, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** Puts `stack` into the bags; what does not fit lands at the player's feet. */
  private deliver(sim: Simulation, stack: ItemStack): void {
    const { rest } = this.inventory.giveStack(sim, stack);
    if (rest === 0) return;
    const layer = this.player.body(sim)?.layer ?? 0;
    if (!this.player.position(sim, this.at)) throw new Error('CraftingSystem: items to put down, but there is no player');
    this.spill(sim, withCount(stack, rest), layer, this.at.x, this.at.y);
  }

  /** Whether the player can craft: there is one, it lives and it is awake (§11.5, §11.6); the refusal otherwise. */
  private alive(sim: Simulation): Refusal {
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined) return 'noPlayer';
    return this.player.incapacity(sim);
  }

  /** Whether the station and the surroundings `recipe` needs are at hand; the refusal otherwise. */
  private surroundings(sim: Simulation, recipe: RecipeDef): Refusal {
    if (recipe.station === null && recipe.umgebung === undefined) return null;
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    const { x, y } = this.at;
    const layer = body.layer;
    if (recipe.station !== null) {
      const station = recipe.station;
      if (!this.stationProviders.some((p) => p(sim, layer, x, y, STATION_RADIUS_PX, station))) return 'noStation';
    }
    if (recipe.umgebung === 'wasser' && !this.waterNear(layer, x, y)) return 'noWater';
    return null;
  }

  private waterNear(layer: Layer, x: number, y: number): boolean {
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    this.collision.ensureTiles(layer, tx - WATER_TILES, ty - WATER_TILES, tx + WATER_TILES, ty + WATER_TILES);
    const chunks = this.collision.chunks;
    return freshWaterWithin(x, y, WATER_REACH_PX, (wx, wy) => {
      const chunk = chunks.get(layer, wx >> CHUNK_SHIFT, wy >> CHUNK_SHIFT);
      return chunk === undefined ? 0 : (chunk.water[((wy & CHUNK_MASK) << CHUNK_SHIFT) | (wx & CHUNK_MASK)] as number);
    });
  }

  /** The chests crafting may take from now (none when switched off or without a player). */
  private stores(sim: Simulation): readonly CraftingStore[] {
    if (!this.state.kisten || this.storeProviders.length === 0) return [];
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return [];
    const out: CraftingStore[] = [];
    for (const p of this.storeProviders) out.push(...p(sim, body.layer, this.at.x, this.at.y, CHEST_RADIUS_PX));
    return out;
  }

  private refuse(sim: Simulation, type: CommandOfType<'craft.start' | 'craft.cancel'>['type'], tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  private restore(data: unknown): void {
    const parsed = craftingSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`crafting snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const catalog = this.recipes.catalog;
    const orders: CraftOrder[] = d.auftraege.map((o, k) => {
      const recipe = this.recipes.find(o.rezept);
      if (recipe === undefined) throw new TypeError(`crafting snapshot invalid: order ${k} names the unknown recipe "${o.rezept}"`);
      for (const stack of o.reserviert) {
        const def = catalog.find(stack.item);
        if (def === undefined) throw new TypeError(`crafting snapshot invalid: order ${k} reserves the unknown item "${stack.item}"`);
        const problem = checkStack(def, stack, Number.POSITIVE_INFINITY);
        if (problem !== null) throw new TypeError(`crafting snapshot invalid: order ${k}: ${problem}`);
      }
      for (const z of recipe.zutaten) {
        const held = o.reserviert.reduce((n, s) => (s.item === z.item ? n + s.count : n), 0);
        if (held !== z.anzahl * o.anzahl) throw new TypeError(`crafting snapshot invalid: order ${k} reserves ${held} × "${z.item}" for ${o.anzahl} pieces of ${z.anzahl}`);
      }
      return { rezept: o.rezept, anzahl: o.anzahl, fortschritt: o.fortschritt, dauer: o.dauer, reserviert: o.reserviert.map((s) => ({ ...s })) };
    });
    for (const id of d.bauplaene) {
      if (this.recipes.find(id)?.bauplan === undefined) throw new TypeError(`crafting snapshot invalid: "${id}" is no recipe with a blueprint`);
    }
    const s = this.state;
    s.besessen.clear();
    s.stationen.clear();
    s.bauplaene.clear();
    for (const id of d.besessen) s.besessen.add(id);
    for (const id of d.stationen) s.stationen.add(id);
    for (const id of d.bauplaene) s.bauplaene.add(id);
    s.kisten = d.kisten;
    s.auftraege.length = 0;
    s.auftraege.push(...orders);
    this.visible.clear();
    this.refreshVisible(null);
    this.seenRevision = -1;
    this.blockedValue = null;
  }
}
