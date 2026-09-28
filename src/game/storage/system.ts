/**
 * Storage system (MASTERPROMPT §16.7 "Lagerung", §15.1 "Crafting nimmt aus Inventar und Kisten im Umkreis von 8
 * Tiles", §16.5 "Lagerübersicht aller Kisten"; docs/SPIEL.md §8 "Lagerung (M4-21)"; M4-21).
 *
 * - **Containers on the build grid:** a wooden crate (16 slots), a chest (24) or a storage shelf (48, raw materials and
 *   ingots only) is placed with `build.place` like any furniture; the system hears the part come and go
 *   (`BuildingSystem.addPartListener`) and keeps what lies inside. A chest that holds items is not taken down or
 *   replaced (`addRemovalRule` with the public `removalProblem`, which the build mode's ghost asks too: `notEmpty`); a
 *   destroyed one (fire, §16.8) spills its stacks onto the ground.
 * - **Working a chest** (`storage.*`, src/game/storage/commands.ts) within reach of its footprint: open and close
 *   the lid, put in and take out, take all, "Alles einlagern" (everything but the hotbar), sort, rename, label with an
 *   item icon; the quick stash sends every stack of the bags to the chests within 10 tiles that already hold its item.
 * - **Other systems:** crafting takes from the chests within 8 tiles (`storeProvider`, `CraftingSystem.addStores`);
 *   blueprints and repairs take their parts and materials from the chests near the building site (`countNear`,
 *   `takeNear`); the hearth shows the overview of its base (`near`, `storedTotals`); the search runs over the chests
 *   of the base around a spot (`baseChests`, `search`; the base is the hearth zone, `useBases`).
 *
 * A dead or sleeping player works no chest (every command refused with the reason). No tick hooks (chests change only
 * through commands and other systems). Save participant `storage` (version 1).
 */
import { BALANCE } from '../../content/balance';
import type { ContainerBalance } from '../../content/balance/storage';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import { cellRot, rotatedSize } from '../../world/structures/cells';
import type { BuildingSystem } from '../building/system';
import type { CommandOfType, GameCommandType } from '../commands';
import type { CraftingStore, SpillItems, StoreProvider } from '../crafting/sources';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { BagArea } from '../items/slots';
import { checkStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { ChestStoreCause, ChestTakeCause, StorageRejectReason } from './events';
import { chestCentre, containerAccepts, distanceToChest, distanceToChestIn, holds, isEmpty, putIntoSlots, sortedSlots, takeUsableFrom, usableIn } from './formulas';
import { copyStorageState, createStorageState, storageSnapshotSchema, type Chest, type StorageState } from './state';

/** Id of the storage system and its save participant. */
export const STORAGE_SYSTEM_ID = 'storage';
/** Data version of the `storage` participant. */
export const STORAGE_SAVE_VERSION = 1;

const S = BALANCE.storage;
const REACH_PX = S.reachTiles * TILE_PX;
const QUICK_STASH_PX = S.quickStashTiles * TILE_PX;
const SEARCH_PX = S.searchRadiusTiles * TILE_PX;
/** Chests crafting's look at the chests in reach holds before its distance list grows. */
const NEAR_CAPACITY = 16;
/** Bag areas a stack may be put into a chest from. */
const PUT_AREAS: ReadonlySet<BagArea> = new Set<BagArea>(['inventar', 'rucksackfach', 'schnellleiste', 'guertel']);
/** Bag areas "Alles einlagern" and the quick stash empty (§16.7 "außer Schnellleiste"). */
const STASH_AREAS: readonly BagArea[] = ['inventar', 'rucksackfach'];

/** The base around a tile: its centre [world px] and radius [px] (the hearth zone), or `null` outside every base. */
export type BaseResolver = (layer: Layer, tx: number, ty: number) => { readonly x: number; readonly y: number; readonly radiusPx: number } | null;

/** One find of a search: the chest, the slot, what lies there. */
export interface StorageFind {
  readonly chest: number;
  readonly index: number;
  readonly stack: ItemStack;
}

/** Dependencies of the storage system. */
export interface StorageSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** The build grid: containers are its parts. */
  readonly building: BuildingSystem;
  /** Where the stacks of a destroyed chest go (the drop system). */
  readonly spill: SpillItems;
}

type Refusal = StorageRejectReason | null;

export class StorageSystem implements SimSystem {
  readonly id = STORAGE_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly building: BuildingSystem;
  private readonly spill: SpillItems;
  private stateValue: StorageState = createStorageState();
  private bases: BaseResolver | null = null;
  private readonly stores = new Map<number, CraftingStore>();
  /** Crafting's chests in reach (`storeProvider`), nearest first, with their chests and distances [px]: kept lists. */
  private readonly nearStores: CraftingStore[] = [];
  private readonly nearChests: Chest[] = [];
  private nearDistances = new Float64Array(NEAR_CAPACITY);
  /** The distance of the chest being looked at [px] (`distanceToChestIn`: never a heap number, M5-40). */
  private readonly chestDistance = new Float64Array(1);
  private readonly at = { x: 0, y: 0 };
  private readonly centre = { x: 0, y: 0 };

  constructor(deps: StorageSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.building = deps.building;
    this.spill = deps.spill;
    this.building.addPartListener({
      placed: (sim, part, layer, tx, ty) => this.attach(sim, part, layer, tx, ty),
      removed: (sim, part, layer, tx, ty) => this.detach(sim, part, layer, tx, ty),
    });
    this.building.addRemovalRule((_sim, part, layer, tx, ty) => this.removalProblem(part, layer, tx, ty));
    this.commands = {
      'storage.open': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.lid(sim, cmd.chest, 'chestOpened', tick)),
      'storage.close': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.lid(sim, cmd.chest, 'chestClosed', tick)),
      'storage.put': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.put(sim, cmd, tick)),
      'storage.take': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.take(sim, cmd, tick)),
      'storage.takeAll': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.takeAll(sim, cmd.chest, tick)),
      'storage.storeAll': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.storeAll(sim, cmd.chest, tick)),
      'storage.sort': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.sort(sim, cmd.chest, tick)),
      'storage.rename': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.rename(sim, cmd, tick)),
      'storage.label': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.label(sim, cmd, tick)),
      'storage.quickStash': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.quickStash(sim, tick)),
    };
    this.save = {
      id: STORAGE_SYSTEM_ID,
      version: STORAGE_SAVE_VERSION,
      // Saves from before storage (save version 1, M3) have no chests.
      migrations: [{ from: 0, migrate: () => ({ chests: [], nextId: 1 }) }],
      serialize: () => copyStorageState(this.stateValue),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** Every placed container (read-only for callers). */
  get chests(): readonly Readonly<Chest>[] {
    return this.stateValue.chests;
  }

  /** The container `id`, or `undefined`. */
  chest(id: number): Readonly<Chest> | undefined {
    return this.stateValue.chests.find((c) => c.id === id);
  }

  /** The container covering tile (tx, ty) of `layer`, or `undefined`. */
  chestAt(layer: Layer, tx: number, ty: number): Readonly<Chest> | undefined {
    return this.stateValue.chests.find((c) => c.layer === layer && tx >= c.tx && tx < c.tx + c.w && ty >= c.ty && ty < c.ty + c.h);
  }

  /**
   * Why the part `part` anchored on (tx, ty) of `layer` cannot be taken down or replaced now as far as storage is
   * concerned (`build.remove`, `build.upgrade`), or `null`: a container that holds items stays (`notEmpty`). Read-only –
   * the building system asks it as a removal rule, the build mode's ghost before the click (M5-36).
   */
  removalProblem(part: Pick<PartDef, 'id'>, layer: Layer, tx: number, ty: number): 'notEmpty' | null {
    const c = this.anchoredAt(part.id, layer, tx, ty);
    return c !== undefined && !isEmpty(c.slots) ? 'notEmpty' : null;
  }

  /** What a kind of container holds (`BALANCE.storage.containers`), or `undefined` for an item that is none. */
  containerOf(item: string): ContainerBalance | undefined {
    return S.containers[item];
  }

  /** The containers on `layer` whose footprint lies within `radiusPx` of world px (x, y), nearest first (ties by id). */
  near(layer: Layer, x: number, y: number, radiusPx: number): Readonly<Chest>[] {
    const out: Array<{ c: Chest; d: number }> = [];
    for (const c of this.stateValue.chests) {
      if (c.layer !== layer) continue;
      const d = distanceToChest(c, x, y);
      if (d <= radiusPx) out.push({ c, d });
    }
    out.sort((a, b) => a.d - b.d || a.c.id - b.c.id);
    return out.map((e) => e.c);
  }

  /** The chests of the base around tile (tx, ty): the hearth zone covering it, else those within the search radius. */
  baseChests(layer: Layer, tx: number, ty: number): Readonly<Chest>[] {
    const base = this.bases?.(layer, tx, ty) ?? null;
    if (base !== null) return this.near(layer, base.x, base.y, base.radiusPx);
    return this.near(layer, (tx + 1 / 2) * TILE_PX, (ty + 1 / 2) * TILE_PX, SEARCH_PX);
  }

  /** Every stack of the base around tile (tx, ty) whose item `match` accepts (§16.7 "Suche über alle Kisten der Basis"). */
  search(layer: Layer, tx: number, ty: number, match: (item: string) => boolean): StorageFind[] {
    const out: StorageFind[] = [];
    for (const c of this.baseChests(layer, tx, ty)) {
      c.slots.forEach((s, index) => {
        if (s !== null && match(s.item)) out.push({ chest: c.id, index, stack: s });
      });
    }
    return out;
  }

  /** Usable pieces of `item` in the chests within `radiusPx` of world px (x, y) on `layer` [pieces]. */
  countNear(item: string, layer: Layer, x: number, y: number, radiusPx: number): number {
    let n = 0;
    for (const c of this.near(layer, x, y, radiusPx)) n += usableIn(c.slots, item);
    return n;
  }

  /**
   * Takes `count` usable pieces of `item` from the chests within `radiusPx` of world px (x, y) on `layer`, nearest
   * first; returns them, or `null` (nothing taken) when fewer are there. `by` names the taker in `chestTaken`.
   */
  takeNear(sim: Simulation, item: string, count: number, layer: Layer, x: number, y: number, radiusPx: number, by: ChestTakeCause): ItemStack[] | null {
    const chests = this.near(layer, x, y, radiusPx) as Chest[];
    let have = 0;
    for (const c of chests) have += usableIn(c.slots, item);
    if (count < 1 || have < count) return null;
    const taken: ItemStack[] = [];
    let need = count;
    for (const c of chests) {
      if (need === 0) break;
      const n = Math.min(need, usableIn(c.slots, item));
      if (n > 0) {
        taken.push(...this.takeFrom(sim, c, item, n, by));
        need -= n;
      }
    }
    return taken;
  }

  /**
   * The chests as crafting's stores (§15.1: the chests within the crafting radius of the player, nearest first, like
   * `near`). The list is kept and filled anew by every call – crafting copies it at once; the presentation's samples ask
   * ≈ 10×/s without garbage (M5-40).
   */
  storeProvider(): StoreProvider {
    return (_sim, layer, x, y, radiusPx) => this.storesNear(layer, x, y, radiusPx);
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /** Connects the bases (the hearth zones) for the search and the overview. */
  useBases(resolver: BaseResolver): void {
    this.bases = resolver;
  }

  // -------------------------------------------------------------------------------------------
  // Build grid
  // -------------------------------------------------------------------------------------------

  private attach(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): void {
    const rules = S.containers[part.id];
    if (rules === undefined || this.anchoredAt(part.id, layer, tx, ty) !== undefined) return;
    const size = rotatedSize(part.w, part.h, cellRot(this.building.structures.cell(layer, part.layerIndex, tx, ty)));
    const c: Chest = { id: this.stateValue.nextId++, item: part.id, layer, tx, ty, w: size.w, h: size.h, slots: new Array<ItemStack | null>(rules.slots).fill(null), name: '', label: null };
    this.stateValue.chests.push(c);
    chestCentre(c, this.centre);
    sim.events.push('chestPlaced', { chest: c.id, item: c.item, layer, tx, ty, x: this.centre.x, y: this.centre.y, tick: sim.eventTick });
  }

  private detach(sim: Simulation, part: PartDef, layer: Layer, tx: number, ty: number): void {
    const c = this.anchoredAt(part.id, layer, tx, ty);
    if (c === undefined) return;
    this.stateValue.chests.splice(this.stateValue.chests.indexOf(c), 1);
    this.stores.delete(c.id);
    chestCentre(c, this.centre);
    let spilled = 0;
    for (const s of c.slots) {
      if (s === null) continue;
      this.spill(sim, s, layer, this.centre.x, this.centre.y);
      spilled++;
    }
    sim.events.push('chestRemoved', { chest: c.id, item: c.item, layer, x: this.centre.x, y: this.centre.y, spilled, tick: sim.eventTick });
  }

  /** The container of item `item` anchored on (tx, ty), or `undefined`. */
  private anchoredAt(item: string, layer: Layer, tx: number, ty: number): Chest | undefined {
    return this.stateValue.chests.find((c) => c.layer === layer && c.tx === tx && c.ty === ty && c.item === item);
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Whether the player can act (exists, lives, awake); the refusal otherwise. Fills `this.at`. */
  private able(sim: Simulation): Refusal {
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    return this.player.incapacity(sim);
  }

  /** The chest `id` within reach of the player (who can act), or the refusal. */
  private reachable(sim: Simulation, id: number): Chest | StorageRejectReason {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const c = this.stateValue.chests.find((x) => x.id === id);
    if (c === undefined) return 'unknownChest';
    if (this.player.body(sim)?.layer !== c.layer || distanceToChest(c, this.at.x, this.at.y) > REACH_PX) return 'outOfReach';
    return c;
  }

  private lid(sim: Simulation, id: number, type: 'chestOpened' | 'chestClosed', tick: number): Refusal {
    const c = this.reachable(sim, id);
    if (typeof c === 'string') return c;
    sim.events.push(type, this.base(c, tick));
    return null;
  }

  private put(sim: Simulation, cmd: CommandOfType<'storage.put'>, tick: number): Refusal {
    const c = this.reachable(sim, cmd.chest);
    if (typeof c === 'string') return c;
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from) || !PUT_AREAS.has(cmd.from.bereich)) return 'invalidSlot';
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return 'slotEmpty';
    const def = this.inventory.bags.catalog.get(stack.item);
    if (!containerAccepts(this.rulesOf(c), def)) return 'wrongItem';
    const want = Math.min(cmd.count ?? stack.count, stack.count);
    const moved = putIntoSlots(c.slots, withCount(stack, want), def.stapel);
    if (moved < 1) return 'chestFull';
    this.inventory.bags.replace(withSlot(bags, cmd.from, stack.count > moved ? withCount(stack, stack.count - moved) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    this.stored(sim, c, stack.item, moved, 'spieler', tick);
    return null;
  }

  private take(sim: Simulation, cmd: CommandOfType<'storage.take'>, tick: number): Refusal {
    const c = this.reachable(sim, cmd.chest);
    if (typeof c === 'string') return c;
    if (cmd.index >= c.slots.length) return 'invalidSlot';
    const stack = c.slots[cmd.index] ?? null;
    if (stack === null) return 'slotEmpty';
    const want = Math.min(cmd.count ?? stack.count, stack.count);
    const { added } = this.inventory.giveStack(sim, withCount(stack, want));
    if (added < 1) return 'bagsFull';
    c.slots[cmd.index] = stack.count > added ? withCount(stack, stack.count - added) : null;
    this.taken(sim, c, stack.item, added, 'spieler', tick);
    return null;
  }

  private takeAll(sim: Simulation, id: number, tick: number): Refusal {
    const c = this.reachable(sim, id);
    if (typeof c === 'string') return c;
    if (isEmpty(c.slots)) return 'slotEmpty';
    let any = false;
    for (let i = 0; i < c.slots.length; i++) {
      const stack = c.slots[i] ?? null;
      if (stack === null) continue;
      const { added } = this.inventory.giveStack(sim, stack);
      if (added < 1) continue;
      any = true;
      c.slots[i] = stack.count > added ? withCount(stack, stack.count - added) : null;
      this.taken(sim, c, stack.item, added, 'spieler', tick);
    }
    return any ? null : 'bagsFull';
  }

  private storeAll(sim: Simulation, id: number, tick: number): Refusal {
    const c = this.reachable(sim, id);
    if (typeof c === 'string') return c;
    const moved = this.stash(sim, [c], false, 'alles', tick);
    return moved > 0 ? null : 'nothingToStore';
  }

  private quickStash(sim: Simulation, tick: number): Refusal {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const layer = this.player.body(sim)?.layer ?? 0;
    const chests = this.near(layer, this.at.x, this.at.y, QUICK_STASH_PX) as Chest[];
    const touched = new Set<number>();
    const moved = this.stash(sim, chests, true, 'schnellablage', tick, touched);
    if (moved === 0) return 'nothingToStore';
    sim.events.push('quickStashed', { count: moved, chests: touched.size, tick });
    return null;
  }

  /**
   * Moves the stacks of the inventory and the backpack compartment into `chests` (in their order) – with `matching`
   * only into chests that already hold the item; returns the pieces moved.
   */
  private stash(sim: Simulation, chests: readonly Chest[], matching: boolean, by: ChestStoreCause, tick: number, touched?: Set<number>): number {
    const catalog = this.inventory.bags.catalog;
    let bags = this.inventory.state;
    let total = 0;
    for (const area of STASH_AREAS) {
      for (let index = 0; index < bags[area].length; index++) {
        let stack = bags[area][index] ?? null;
        if (stack === null) continue;
        const def = catalog.get(stack.item);
        for (const c of chests) {
          if (stack === null) break;
          if (!containerAccepts(this.rulesOf(c), def) || (matching && !holds(c.slots, stack.item))) continue;
          const moved = putIntoSlots(c.slots, stack, def.stapel);
          if (moved < 1) continue;
          total += moved;
          touched?.add(c.id);
          this.stored(sim, c, stack.item, moved, by, tick);
          stack = stack.count > moved ? withCount(stack, stack.count - moved) : null;
        }
        if (stack !== bags[area][index]) bags = withSlot(bags, { bereich: area, index }, stack);
      }
    }
    if (bags !== this.inventory.state) {
      this.inventory.bags.replace(bags);
      sim.events.push('inventoryChanged', { change: 'remove', tick });
    }
    return total;
  }

  private sort(sim: Simulation, id: number, tick: number): Refusal {
    const c = this.reachable(sim, id);
    if (typeof c === 'string') return c;
    const sorted = sortedSlots(c.slots, this.inventory.bags.catalog);
    for (let i = 0; i < c.slots.length; i++) c.slots[i] = sorted[i] ?? null;
    sim.events.push('chestSorted', this.base(c, tick));
    return null;
  }

  private rename(sim: Simulation, cmd: CommandOfType<'storage.rename'>, tick: number): Refusal {
    const c = this.reachable(sim, cmd.chest);
    if (typeof c === 'string') return c;
    c.name = cmd.name.trim();
    sim.events.push('chestRenamed', { ...this.base(c, tick), name: c.name });
    return null;
  }

  private label(sim: Simulation, cmd: CommandOfType<'storage.label'>, tick: number): Refusal {
    const c = this.reachable(sim, cmd.chest);
    if (typeof c === 'string') return c;
    const item = cmd.item ?? null;
    if (item !== null && !this.inventory.bags.catalog.has(item)) return 'unknownItem';
    c.label = item;
    sim.events.push('chestLabeled', { ...this.base(c, tick), label: item });
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private rulesOf(c: Chest): ContainerBalance {
    const rules = S.containers[c.item];
    if (rules === undefined) throw new Error(`StorageSystem: chest ${c.id} is the unknown container "${c.item}"`);
    return rules;
  }

  /**
   * `near` as crafting stores in the kept lists: insertion by distance, ties by id. The distances live in a typed array
   * that grows only when more chests are in reach than ever before.
   */
  private storesNear(layer: Layer, x: number, y: number, radiusPx: number): readonly CraftingStore[] {
    const chests = this.nearChests;
    const all = this.stateValue.chests;
    let dist = this.nearDistances;
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      const c = all[i] as Chest;
      if (c.layer !== layer) continue;
      const d = distanceToChestIn(c, x, y, this.chestDistance)[0] as number;
      if (d > radiusPx) continue;
      if (n === dist.length) {
        const grown = new Float64Array(2 * n);
        grown.set(dist);
        dist = this.nearDistances = grown;
      }
      let j = n++;
      for (; j > 0; j--) {
        const dj = dist[j - 1] as number;
        const cj = chests[j - 1] as Chest;
        if (dj < d || (dj === d && cj.id < c.id)) break;
        dist[j] = dj;
        if (j < chests.length) chests[j] = cj;
        else chests.push(cj);
      }
      dist[j] = d;
      if (j < chests.length) chests[j] = c;
      else chests.push(c);
    }
    const out = this.nearStores;
    for (let i = 0; i < n; i++) {
      const store = this.storeOf(chests[i] as Chest);
      if (i < out.length) out[i] = store;
      else out.push(store);
    }
    if (out.length !== n) {
      out.length = n;
      chests.length = n;
    }
    return out;
  }

  /** Crafting's view of a chest (one per chest). */
  private storeOf(c: Chest): CraftingStore {
    let store = this.stores.get(c.id);
    if (store === undefined) {
      store = this.newStore(c);
      this.stores.set(c.id, store);
    }
    return store;
  }

  /** The crafting store of chest `c` (its own function: closures over `c` here would make every `storeOf` call allocate their context). */
  private newStore(c: Chest): CraftingStore {
    return {
      count: (item) => usableIn(c.slots, item),
      take: (sim, item, count) => this.takeFrom(sim, c, item, count, 'handwerk'),
    };
  }

  /** Takes `count` usable pieces of `item` out of chest `c` (the caller checked they are there). */
  private takeFrom(sim: Simulation, c: Chest, item: string, count: number, by: ChestTakeCause): ItemStack[] {
    const taken = takeUsableFrom(c.slots, item, count);
    if (taken === null) throw new Error(`StorageSystem: ${count} × "${item}" not in chest ${c.id}`);
    this.taken(sim, c, item, count, by, sim.eventTick);
    return taken;
  }

  private base(c: Chest, tick: number): { chest: number; item: string; layer: number; x: number; y: number; tick: number } {
    chestCentre(c, this.centre);
    return { chest: c.id, item: c.item, layer: c.layer, x: this.centre.x, y: this.centre.y, tick };
  }

  private stored(sim: Simulation, c: Chest, item: string, count: number, by: ChestStoreCause, tick: number): void {
    sim.events.push('chestStored', { ...this.base(c, tick), stored: item, count, by });
  }

  private taken(sim: Simulation, c: Chest, item: string, count: number, by: ChestTakeCause, tick: number): void {
    sim.events.push('chestTaken', { ...this.base(c, tick), taken: item, count, by });
  }

  private restore(data: unknown): void {
    const parsed = storageSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`storage snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const catalog = this.inventory.bags.catalog;
    const ids = new Set<number>();
    for (const c of d.chests) {
      if (ids.has(c.id) || c.id >= d.nextId) throw new TypeError(`storage snapshot invalid: chest ids must be unique and below nextId (${c.id})`);
      ids.add(c.id);
      const rules = S.containers[c.item];
      if (rules === undefined) throw new TypeError(`storage snapshot invalid: chest ${c.id} is the unknown container "${c.item}"`);
      if (c.slots.length !== rules.slots) throw new TypeError(`storage snapshot invalid: chest ${c.id} ("${c.item}") has ${c.slots.length} slots, not ${rules.slots}`);
      if (c.label !== null && !catalog.has(c.label)) throw new TypeError(`storage snapshot invalid: chest ${c.id} is labelled with the unknown item "${c.label}"`);
      for (const s of c.slots) {
        if (s === null) continue;
        const def = catalog.find(s.item);
        if (def === undefined) throw new TypeError(`storage snapshot invalid: chest ${c.id} holds the unknown item "${s.item}"`);
        const problem = checkStack(def, s, def.stapel);
        if (problem !== null) throw new TypeError(`storage snapshot invalid: chest ${c.id}: ${problem}`);
        if (!containerAccepts(rules, def)) throw new TypeError(`storage snapshot invalid: chest ${c.id} ("${c.item}") cannot hold "${s.item}"`);
      }
    }
    this.stateValue = copyStorageState({ chests: d.chests.map((c) => ({ ...c, layer: c.layer as Layer })), nextId: d.nextId });
    this.stores.clear();
  }
}
