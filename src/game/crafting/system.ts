/**
 * Crafting system (MASTERPROMPT §15.1, §13.1, §23.2 Handwerk; docs/SPIEL.md §3, §6, §8; M3-16, M4-01 … M4-03).
 *
 * - **Visibility** (every tick, and before a command): whatever the player owns is remembered
 *   (`besessen`); a recipe becomes visible once every ingredient was owned – for a group ingredient any
 *   member – and its station is known – a station of its line at its stage or higher owned, or met in the
 *   world (`meetStation`, the station system) – or, for a recipe with a blueprint, once the blueprint is
 *   learned (`learnBlueprint`: dungeons, the trader, tablets). A newly visible recipe raises
 *   `recipeDiscovered`. `unlockAll` (the console's `unlock`) shows every recipe.
 * - **Orders** (`craft.start {recipe, count}`): a visible hand recipe (a batch of a processing station is
 *   refused with `processing`: it goes into the station's slots), its station in reach and its
 *   surroundings (water) given, room in the queue (10) and ingredients for all `count` pieces – usable
 *   pieces only (a broken tool is no ingredient), any members for a group ingredient, from the bags first,
 *   then from the chests in reach when that is on (`craft.useChests`, the storage system's
 *   `StoreProvider`). They are taken at once and reserved for the order. An upgrade recipe (Werkbank I → II) is
 *   made one piece at a time (`upgradeOnce`) and needs the stage below its product itself at hand – a station
 *   already at that stage or above is refused (`alreadyUpgraded`), its materials would be lost.
 * - **Work** (every tick): the first order of the queue advances while the player lives and is awake and –
 *   checked when a piece begins – its station and surroundings are still at hand; otherwise it waits
 *   (`blocked`). The best station at hand (highest stage; for an upgrade the stage below its product) works the
 *   piece: its crafting time is shortened by the station's tempo, by the Handwerk skill – at a station with a skill
 *   of its own by that skill instead (Schmieden at the anvil, §23.2 "je Stufe +0,5 % Wirkung im Bereich") – and by
 *   the workshop the work happens in (`useWorkshops`, §16.4 "+15 % Tempo": the room of the placed station, the
 *   player's room in the hand). A finished piece consumes its share of the reservation
 *   and goes into the bags – with a quality from the Handwerk level and the station's quality points when
 *   it has durability or stats (§13.1), keeping durability and quality where the recipe says so; what does
 *   not fit lands at the player's feet. An upgrade recipe turns its station into the next stage instead
 *   (`StationUpgrader`); when that station left the world meanwhile, the piece's ingredients go back
 *   (`craftCancelled`, `stationWeg`) – never the station as an item. Every finished piece gives Handwerk experience.
 * - **Cancel** (`craft.cancel {index}`): the whole reservation of the order goes back into the bags
 *   ("Abbrechen erstattet vollständig"; what does not fit lands at the feet). `cancelAll` does the same
 *   for every order (the death system before it fills the grave).
 * - **Pins** (`craft.pin {recipe, on}`, §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten live"; M4-08): a
 *   visible recipe joins the pinned list the HUD's tracker shows (at most `MAX_PINNED_RECIPES`, the oldest goes),
 *   or leaves it. Pinning is bookkeeping, not work: it needs no living player.
 * - `takeItems` takes usable pieces from the bags and the chests in reach for other systems (repair).
 *   `waterInReach` answers the surroundings check of `umgebung: 'wasser'` for the presentation (the recipe book
 *   shows "Nur am Wasser" met or not); `countAvailable` counts many items with one look at the chests.
 * - Global (the player's own work). Save participant `crafting`: owned items, met stations, learned
 *   blueprints, the chest switch, the unlock switch, the pinned recipes and the queue with its reservations.
 */
import { BALANCE } from '../../content/balance';
import type { RecipeDef } from '../../content/recipes/schema';
import type { ItemDef } from '../../content/schema/item';
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
import { affordablePieces, craftSeconds, craftTicks, freshWaterWithin, hasQuality, keptState, ownedItems, pieceShare, qualityStars, recipeVisible, takeUsable, usableCount } from './formulas';
import { contentRecipeBook, type RecipeBook } from './recipes';
import type { CraftingSkills, CraftingStore, SpillItems, StationAtHand, StationProvider, StationUpgrader, StoreProvider, WorkshopTempo } from './sources';
import { craftingSnapshot, craftingSnapshotSchema, emptyCraftingState, MAX_PINNED_RECIPES, type CraftOrder, type CraftingState } from './state';

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
  private readonly upgraders: StationUpgrader[] = [];
  private workshop: WorkshopTempo | null = null;
  private readonly stationKnown = (station: string): boolean => this.knowsStation(station);
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
      'craft.pin': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.pin(sim, cmd.recipe, cmd.on)),
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

  /** Adds a source of placed stations (the station system, lit campfires). */
  addStations(provider: StationProvider): void {
    this.stationProviders.push(provider);
  }

  /** Adds what turns a placed station into its next stage (the station system). */
  addUpgrader(upgrader: StationUpgrader): void {
    this.upgraders.push(upgrader);
  }

  /** Connects the rooms: the tempo a workshop adds to the work in it (§16.4 "Werkstatt … +15 % Tempo"). */
  useWorkshops(tempo: WorkshopTempo): void {
    this.workshop = tempo;
  }

  /** Crafting tempo the room around tile (tx, ty) of `layer` adds [fraction]; 0 without rooms (§16.4 "Werkstatt"). */
  workshopTempoAt(sim: Simulation, layer: Layer, tx: number, ty: number): number {
    return this.workshop?.(sim, layer, tx, ty) ?? 0;
  }

  /** The player met a placed station `station` (the station system): recipes needing it may become visible. */
  meetStation(sim: Simulation, station: string): void {
    if (this.state.stationen.has(station)) return;
    this.state.stationen.add(station);
    this.refreshVisible(sim);
  }

  /**
   * Whether the station `station` is known: a station of its line at its stage or higher was owned or met
   * (§15.1 "die Station bekannt ist"; knowing Werkbank II means knowing what Werkbank I makes).
   */
  knowsStation(station: string): boolean {
    const stations = this.recipes.stations;
    if (this.state.besessen.has(station) || this.state.stationen.has(station)) return true;
    for (const s of stations.list) {
      if (s.id !== station && (this.state.besessen.has(s.id) || this.state.stationen.has(s.id)) && stations.satisfies(station, s.id)) return true;
    }
    return false;
  }

  /** Effect bonus of skill `skill` for crafting speed [fraction; §23.2 +0,5 % per level], 0 without skills. */
  skillBonus(skill: string): number {
    return this.skills?.bonus(skill) ?? 0;
  }

  /** Makes every recipe visible (the console's `unlock`); raises `recipeDiscovered` for each new one. */
  unlockAll(sim: Simulation): void {
    if (this.state.alle) return;
    this.state.alle = true;
    this.refreshVisible(sim);
  }

  /** Whether every recipe is unlocked. */
  get unlockedAll(): boolean {
    return this.state.alle;
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

  /**
   * Gives the experience of source `sourceId` `times` times through the connected skill system (station
   * work: building a station, smelting, smithing – src/content/stations.ts `erfahrung`); 0 without one or for
   * a source no skill knows.
   */
  award(sim: Simulation, sourceId: string, times = 1): number {
    if (this.skills === null || !this.skills.hasSource(sourceId)) return 0;
    return this.skills.award(sim, sourceId, times);
  }

  /** Whether the player has owned `item` at least once. */
  hasOwned(item: string): boolean {
    return this.state.besessen.has(item);
  }

  /** Whether crafting takes from chests in reach. */
  get usesChests(): boolean {
    return this.state.kisten;
  }

  /** The recipes pinned to the HUD's tracker, oldest first (`craft.pin`). */
  get pinned(): readonly string[] {
    return this.state.angeheftet;
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

  /**
   * Fills `inBags` with the usable pieces of each of `items` in the bags and `all` with them together with the chests in
   * reach [pieces] – the chests are looked up once for every item (the presentation's sample, ≈ 10×/s).
   */
  countAvailable(sim: Simulation, items: readonly string[], inBags: Map<string, number>, all: Map<string, number>): void {
    const stores = this.stores(sim);
    const bags = this.inventory.state;
    for (const item of items) {
      const own = usableCount(bags, item);
      let n = own;
      for (let i = 0; i < stores.length; i++) n += (stores[i] as CraftingStore).count(item);
      inBags.set(item, own);
      all.set(item, n);
    }
  }

  /** Pieces of recipe `id` the ingredients at hand afford [pieces]. */
  affordable(sim: Simulation, id: string): number {
    if (!this.recipes.has(id)) return 0;
    const stores = this.stores(sim);
    return affordablePieces(this.recipes.ingredients(id), (item) => usableCount(this.inventory.state, item) + stores.reduce((n, s) => n + s.count(item), 0));
  }

  /**
   * Takes `count` usable pieces of `item` – from the bags first, then from the chests in reach when that is on
   * – and returns them with their state; `null` (nothing taken) when fewer are at hand. For other systems
   * that pay with materials (repair, §13.1).
   */
  takeItems(sim: Simulation, item: string, count: number): ItemStack[] | null {
    if (count < 1 || this.available(sim, item) < count) return null;
    const taken: ItemStack[] = [];
    let need = count;
    const fromBags = Math.min(need, usableCount(this.inventory.state, item));
    if (fromBags > 0) {
      const t = takeUsable(this.inventory.state, item, fromBags);
      if (t === null) throw new Error(`CraftingSystem: ${fromBags} × "${item}" counted but not taken`);
      this.inventory.bags.replace(t.state);
      sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
      taken.push(...t.taken);
      need -= fromBags;
    }
    for (const store of this.stores(sim)) {
      if (need === 0) break;
      const n = Math.min(need, store.count(item));
      if (n > 0) {
        taken.push(...store.take(sim, item, n));
        need -= n;
      }
    }
    if (need > 0) throw new Error(`CraftingSystem: ${need} × "${item}" missing after the check`);
    return taken;
  }

  /**
   * The best station at hand for recipes of `station` (highest quality, then tempo) – with `exact` only a station
   * `station` itself (the stage an upgrade recipe turns into the next) –, or `null`.
   */
  stationAtHand(sim: Simulation, station: string, exact = false): StationAtHand | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return null;
    let best: StationAtHand | null = null;
    for (const p of this.stationProviders) {
      const s = p(sim, body.layer, this.at.x, this.at.y, STATION_RADIUS_PX, station, exact);
      if (s !== null && (best === null || s.qualitaet > best.qualitaet || (s.qualitaet === best.qualitaet && s.tempo > best.tempo))) best = s;
    }
    return best;
  }

  /**
   * Whether open fresh water lies within reach of the player's feet – the surroundings recipes with
   * `umgebung: 'wasser'` need (§18 "Eimer füllen"); false without a player. The same check `craft.start` makes.
   */
  waterInReach(sim: Simulation): boolean {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return false;
    return this.waterNear(body.layer, this.at.x, this.at.y);
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
      if (this.visible.has(r.id)) continue;
      if (!s.alle && !recipeVisible(r, this.recipes.ingredients(r.id), s.besessen, this.stationKnown, s.bauplaene)) continue;
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
      const at = recipe.station === null ? null : this.stationAtHand(sim, recipe.station, recipe.aufwerten === true);
      // The station's own skill speeds the work at it (Schmieden at the anvil, §23.2 "im Bereich"), else Handwerk; the
      // workshop around the station (in the hand: around the player) adds its tempo (§16.4).
      const skill = at === null ? CRAFT_SKILL : (this.recipes.stations.skill(at.station) ?? CRAFT_SKILL);
      order.dauer = craftTicks(craftSeconds(recipe), this.skillBonus(skill) + this.workshopTempo(sim, at), at?.tempo ?? 1);
      if (at !== null) {
        order.station = at.station;
        if (at.platz > 0) order.platz = at.platz;
      }
      sim.events.push('craftStarted', { recipe: recipe.id, ticks: order.dauer, tick: sim.eventTick });
    }
    this.blockedValue = null;
    order.fortschritt++;
    if (order.fortschritt >= order.dauer) this.finishPiece(sim, order, recipe);
  }

  /**
   * One piece is done: its share of the reservation is consumed; the product goes into the bags with its
   * quality – or, for an upgrade, replaces the station it was made at.
   */
  private finishPiece(sim: Simulation, order: CraftOrder, recipe: RecipeDef): void {
    const { consumed, rest } = pieceShare(this.recipes.ingredients(recipe.id), order.reserviert);
    order.reserviert = rest;
    const def = this.recipes.catalog.get(recipe.ergebnis.item);
    const upgraded = recipe.aufwerten === true && order.platz !== undefined && this.upgrade(sim, order.platz, def.id);
    if (recipe.aufwerten === true && !upgraded) {
      // The station to upgrade left the world while the piece was worked (taken down with its part, destroyed): the
      // piece's ingredients go back – the next stage never becomes an item of its own.
      for (const stack of consumed) this.deliver(sim, stack);
      sim.events.push('craftCancelled', { recipe: recipe.id, pieces: 1, reason: 'stationWeg', tick: sim.eventTick });
      this.pieceDone(order);
      return;
    }
    let quality = 1;
    if (!upgraded) {
      const kept = keptState(recipe, def, consumed);
      quality = kept?.qualitaet ?? this.pieceQuality(def, order.station);
      const made = newStack(def, recipe.ergebnis.anzahl, quality === 1 ? {} : { qualitaet: quality });
      this.deliver(sim, kept === null ? made : { ...made, haltbarkeit: kept.haltbarkeit });
    }
    this.skills?.award(sim, CRAFT_XP_SOURCE);
    const extra = order.station === undefined ? undefined : this.recipes.stations.find(order.station)?.erfahrung;
    if (extra !== undefined) this.award(sim, extra);
    sim.events.push('craftCompleted', { recipe: recipe.id, item: def.id, count: recipe.ergebnis.anzahl, qualitaet: quality, aufgewertet: upgraded, tick: sim.eventTick });
    this.pieceDone(order);
  }

  /** The piece being worked on in `order` is over: the next one begins fresh; a finished order leaves the queue. */
  private pieceDone(order: CraftOrder): void {
    order.anzahl--;
    order.fortschritt = 0;
    order.dauer = 0;
    delete order.station;
    delete order.platz;
    if (order.anzahl === 0) this.state.auftraege.shift();
  }

  /**
   * Crafting tempo the workshop of a piece adds [fraction] (§16.4): the room of the placed station `at`, else – in the
   * hand or at a station of another system (a campfire, within reach of the player) – the player's room.
   */
  private workshopTempo(sim: Simulation, at: StationAtHand | null): number {
    if (this.workshop === null) return 0;
    if (at !== null && at.tx !== undefined && at.ty !== undefined) {
      const layer = this.player.body(sim)?.layer ?? 0;
      return this.workshop(sim, layer, at.tx, at.ty);
    }
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return 0;
    return this.workshop(sim, body.layer, Math.floor(this.at.x / TILE_PX), Math.floor(this.at.y / TILE_PX));
  }

  /**
   * Quality of a finished piece of `def` [stars] (§13.1): from the Handwerk level and the quality points of
   * the station it was made at (`null` = in the hand); 1 for items without durability or stats.
   */
  private pieceQuality(def: ItemDef, station: string | undefined): number {
    if (!hasQuality(def)) return 1;
    const level = this.skills?.level(CRAFT_SKILL) ?? 1;
    return qualityStars(level, station === undefined ? null : this.recipes.stations.stage(station).qualitaet);
  }

  /** Turns the placed station `platz` into `to` through the first upgrader that knows it. */
  private upgrade(sim: Simulation, platz: number, to: string): boolean {
    for (const u of this.upgraders) if (u(sim, platz, to)) return true;
    return false;
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
    if (this.recipes.isProcessing(recipe)) return 'processing';
    // A station is upgraded once: a second piece would find the next stage and turn it into itself.
    if (recipe.aufwerten === true && cmd.count > 1) return 'upgradeOnce';
    if (this.state.auftraege.length >= C.queueLength) return 'queueFull';
    const missing = this.surroundings(sim, recipe);
    if (missing !== null) return missing;
    if (this.affordable(sim, recipe.id) < cmd.count) return 'notEnough';
    const reserved = this.reserve(sim, recipe, cmd.count);
    this.state.auftraege.push({ rezept: recipe.id, anzahl: cmd.count, fortschritt: 0, dauer: 0, reserviert: reserved });
    sim.events.push('craftQueued', { recipe: recipe.id, count: cmd.count, index: this.state.auftraege.length - 1, tick });
    return null;
  }

  /**
   * Pins (`on`) or unpins recipe `id`: a pin needs a visible recipe; pinning a pinned recipe or unpinning one that
   * is not pinned changes nothing; one pin more than `MAX_PINNED_RECIPES` lets the oldest go.
   */
  private pin(sim: Simulation, id: string, on: boolean): Refusal {
    const pins = this.state.angeheftet;
    const at = pins.indexOf(id);
    if (!on) {
      if (at >= 0) pins.splice(at, 1);
      return null;
    }
    if (!this.recipes.has(id)) return 'unknownRecipe';
    this.discover(sim);
    if (!this.visible.has(id)) return 'recipeHidden';
    if (at >= 0) return null;
    pins.push(id);
    if (pins.length > MAX_PINNED_RECIPES) pins.splice(0, pins.length - MAX_PINNED_RECIPES);
    return null;
  }

  /**
   * Takes the ingredients of `count` pieces: for each ingredient the bags first (a group's members in their
   * order), then the chests in reach (the caller checked they suffice).
   */
  private reserve(sim: Simulation, recipe: RecipeDef, count: number): ItemStack[] {
    const reserved: ItemStack[] = [];
    let bags = this.inventory.state;
    const stores = this.stores(sim);
    for (const z of this.recipes.ingredients(recipe.id)) {
      let need = z.anzahl * count;
      for (const item of z.items) {
        const fromBags = Math.min(need, usableCount(bags, item));
        if (fromBags === 0) continue;
        const taken = takeUsable(bags, item, fromBags);
        if (taken === null) throw new Error(`CraftingSystem: ${fromBags} × "${item}" counted but not taken`);
        bags = taken.state;
        reserved.push(...taken.taken);
        need -= fromBags;
      }
      for (const store of stores) {
        for (const item of z.items) {
          if (need === 0) break;
          const n = Math.min(need, store.count(item));
          if (n > 0) {
            reserved.push(...store.take(sim, item, n));
            need -= n;
          }
        }
      }
      if (need > 0) throw new Error(`CraftingSystem: ${need} × "${z.key}" missing after the check`);
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
      // An upgrade needs the stage below its product itself; a higher stage of the line is upgraded already.
      const exact = recipe.aufwerten === true;
      if (!this.stationProviders.some((p) => p(sim, layer, x, y, STATION_RADIUS_PX, station, exact) !== null)) {
        return exact && this.stationProviders.some((p) => p(sim, layer, x, y, STATION_RADIUS_PX, station) !== null) ? 'alreadyUpgraded' : 'noStation';
      }
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

  private refuse(sim: Simulation, type: CommandOfType<'craft.start' | 'craft.cancel' | 'craft.pin'>['type'], tick: number, reason: Refusal): void {
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
      for (const z of this.recipes.ingredients(recipe.id)) {
        const held = o.reserviert.reduce((n, s) => (z.items.includes(s.item) ? n + s.count : n), 0);
        if (held !== z.anzahl * o.anzahl) throw new TypeError(`crafting snapshot invalid: order ${k} reserves ${held} × "${z.key}" for ${o.anzahl} pieces of ${z.anzahl}`);
      }
      if (o.station !== undefined && !this.recipes.stations.has(o.station)) throw new TypeError(`crafting snapshot invalid: order ${k} is worked at the unknown station "${o.station}"`);
      const order: CraftOrder = { rezept: o.rezept, anzahl: o.anzahl, fortschritt: o.fortschritt, dauer: o.dauer, reserviert: o.reserviert.map((s) => ({ ...s })) };
      if (o.station !== undefined) order.station = o.station;
      if (o.platz !== undefined) order.platz = o.platz;
      return order;
    });
    for (const id of d.bauplaene) {
      if (this.recipes.find(id)?.bauplan === undefined) throw new TypeError(`crafting snapshot invalid: "${id}" is no recipe with a blueprint`);
    }
    const pins = d.angeheftet ?? [];
    for (const id of pins) {
      if (!this.recipes.has(id)) throw new TypeError(`crafting snapshot invalid: the unknown recipe "${id}" is pinned`);
    }
    const s = this.state;
    s.besessen.clear();
    s.stationen.clear();
    s.bauplaene.clear();
    for (const id of d.besessen) s.besessen.add(id);
    for (const id of d.stationen) s.stationen.add(id);
    for (const id of d.bauplaene) s.bauplaene.add(id);
    s.kisten = d.kisten;
    s.alle = d.alle === true;
    s.auftraege.length = 0;
    s.auftraege.push(...orders);
    s.angeheftet.length = 0;
    s.angeheftet.push(...pins);
    this.visible.clear();
    this.refreshVisible(null);
    this.seenRevision = -1;
    this.blockedValue = null;
  }
}
