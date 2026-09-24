/**
 * Use targets of the interaction system (MASTERPROMPT §11.4 "Interagieren (E)", "Essen/Trinken",
 * "Sitzen (Stühle, Baumstümpfe)", "Schlafen", §11.5, §11.6, §12.2, §18; docs/SPIEL.md §3): besides drops,
 * objects and tiles, E *uses* things – and the owning system does it through its own command, so every
 * refusal and every feedback event is the one that command raises:
 * - a camp fire: light it when it holds fuel and is cold (`light.ignite`), else feed it from the bags
 *   (`light.fuel`: the fuel in the hand, else the fuel that burns longest) – blocked without fuel in the
 *   bags or when it is full (§15.4 "max. 6 min");
 * - a placed torch: take it back into the bags (`light.take`) – blocked when the bags are full;
 * - water on the aimed tile or the tile ahead (like digging, never a side effect of standing at a shore):
 *   drink a sip (`action.drink`) – the sea is too salty, ice is frozen (§18);
 * - a tree stump: sit down (`action.sit`, §11.4), or stand up again while seated (`action.stand`) – with an
 *   axe in the hand the stump is cleared instead (the gathering target wins the tie);
 * - the player's grave: recover what fits (`death.lootGrave`, §11.6) – blocked when nothing fits;
 * - a sleeping place of a provider (placed beds, M4): lie down (`sleep.start`, §11.5) – blocked before
 *   19:00 unless exhausted.
 *
 * A provider answers per tile (`offer`, read-only) and acts on it (`use`). `createUseProviders` builds
 * them over the systems of `createSimulation` (src/game/setup.ts registers them with `addUses`, in this
 * order). Verbs, names and reasons of the hint are content texts (src/content/uses.ts). ADR-0028.
 */
import { lightKind } from '../../content/lights';
import type { UseAction, UseBlock, UseSubjectId } from '../../content/uses';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { ActionsSystem } from '../actions/system';
import { waterSource } from '../actions/formulas';
import type { Grave } from '../death/state';
import type { DeathSystem } from '../death/system';
import type { GatheringSystem } from '../gathering/system';
import type { InventorySystem } from '../inventory/system';
import { CARRY_AREAS, type BagArea, type SlotRef } from '../items/slots';
import { newStack, type ItemStack } from '../items/stack';
import { fuelItemsThatFit, fuelTicks } from '../light/formulas';
import type { LightSystem } from '../light/system';
import type { PlayerSystem } from '../player/system';
import type { GameCommandType } from '../commands';
import type { CommandHandler, CommandHandlers, Simulation } from '../sim';
import { sleepAllowed } from '../sleep/formulas';
import type { SleepSystem } from '../sleep/system';

/** Why a use target cannot be used now: a reason of its own (content text) or full bags. */
export type UseRejectReason = UseBlock | 'bagsFull';

/** Subject of the hint: a light kind (its name), a `USE_SUBJECTS` id, or the stump. */
export type UseSubject = string;
/** The stump as the subject of sitting (the same name as clearing it, `ui.interaction.stump`). */
export const STUMP_SUBJECT = 'baumstumpf';

/** One use target on a tile, as a provider reports it. */
export interface UseOffer {
  action: UseAction;
  subject: UseSubject;
  block: UseRejectReason | null;
  /** Centre of the thing [world px]. */
  x: number;
  y: number;
  /** Only on the aimed tile or the tile ahead, ranked like a tile (water: no hint from standing at a shore). */
  aimedOnly: boolean;
}

/** A fresh offer record. */
export function createUseOffer(): UseOffer {
  return { action: 'trinken', subject: '', block: null, x: 0, y: 0, aimedOnly: false };
}

/** Reports and uses the use targets of one kind. */
export interface UseProvider {
  /** Fills `out` with the use target on tile (tx, ty) of `layer`; false when there is none. Read-only. */
  offer(sim: Simulation, layer: Layer, tx: number, ty: number, out: UseOffer): boolean;
  /** Uses the target (the owning system's command, applied in this tick). */
  use(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): void;
}

/** The systems the use targets belong to. */
export interface UseProviderDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly gathering: GatheringSystem;
  readonly light: LightSystem;
  readonly actions: ActionsSystem;
  readonly death: DeathSystem;
  readonly sleep: SleepSystem;
}

/** The handler of command `type` in `system` (the use targets act through the owning system's command). */
function handler<K extends GameCommandType>(system: { readonly commands?: CommandHandlers }, type: K): CommandHandler<K> {
  const h = system.commands?.[type] as CommandHandler<K> | undefined;
  if (h === undefined) throw new Error(`use targets: no handler for ${type}`);
  return h;
}

function setOffer(out: UseOffer, action: UseAction, subject: UseSubject, block: UseRejectReason | null, tx: number, ty: number, aimedOnly = false): true {
  out.action = action;
  out.subject = subject;
  out.block = block;
  out.x = tx * TILE_PX + TILE_PX / 2;
  out.y = ty * TILE_PX + TILE_PX / 2;
  out.aimedOnly = aimedOnly;
  return true;
}

/** Room of the bags for one piece of an item, cached per bag revision (the room check builds new bags). */
class RoomCache {
  private revision = -1;
  private readonly room = new Map<string, number>();
  private readonly stacks = new Map<string, ItemStack>();

  constructor(private readonly inventory: InventorySystem) {}

  /** Whether one fresh piece of `item` fits into the carried bags. */
  fits(item: string): boolean {
    const revision = this.inventory.bags.revision;
    if (revision !== this.revision) {
      this.revision = revision;
      this.room.clear();
    }
    let r = this.room.get(item);
    if (r === undefined) {
      let stack = this.stacks.get(item);
      if (stack === undefined) {
        stack = newStack(this.inventory.bags.catalog.get(item), 1);
        this.stacks.set(item, stack);
      }
      r = this.inventory.roomFor(stack);
      this.room.set(item, r);
    }
    return r > 0;
  }
}

/** A slot address being filled in (no allocation per scan). */
interface SlotOut {
  bereich: BagArea;
  index: number;
}

/**
 * Burn time [s] of the fuel E puts on a fire – the item in the hand when it burns, else the carried fuel that
 * burns longest (first slot on a tie) – with its slot in `out`; 0 without fuel.
 */
function scanFuel(inventory: InventorySystem, out: SlotOut | null): number {
  const state = inventory.state;
  const catalog = inventory.bags.catalog;
  const hand = state.schnellleiste[state.auswahl] ?? null;
  const handSeconds = hand === null ? undefined : catalog.get(hand.item).brennwert;
  if (handSeconds !== undefined) {
    if (out !== null) {
      out.bereich = 'schnellleiste';
      out.index = state.auswahl;
    }
    return handSeconds;
  }
  let best = 0;
  for (const bereich of CARRY_AREAS) {
    const slots = state[bereich];
    for (let index = 0; index < slots.length; index++) {
      const s = slots[index] ?? null;
      const seconds = s === null ? undefined : catalog.get(s.item).brennwert;
      if (seconds === undefined || seconds <= best) continue;
      best = seconds;
      if (out !== null) {
        out.bereich = bereich;
        out.index = index;
      }
    }
  }
  return best;
}

/** The fuel E puts on a fire: the item in the hand when it burns, else the carried fuel that burns longest (first slot on a tie). */
export function fuelSlot(inventory: InventorySystem): SlotRef | null {
  const out: SlotOut = { bereich: 'inventar', index: 0 };
  return scanFuel(inventory, out) > 0 ? out : null;
}

/** Camp fires (light, fuel) and placed torches (take). */
function lightUses(deps: UseProviderDeps, room: RoomCache): UseProvider {
  const { light, inventory } = deps;
  const ignite = handler(light, 'light.ignite');
  const fuel = handler(light, 'light.fuel');
  const take = handler(light, 'light.take');
  return {
    offer: (_sim, layer, tx, ty, out) => {
      const l = light.lightAt(layer, tx, ty);
      if (l === undefined) return false;
      if (l.torch !== null) return setOffer(out, 'nehmen', l.kind, room.fits(lightKind(l.kind).gegenstand) ? null : 'bagsFull', tx, ty);
      const fire = l.fire;
      if (fire === null) return false;
      if (!fire.lit && fire.fuel > 0) return setOffer(out, 'entzuenden', l.kind, null, tx, ty);
      const seconds = scanFuel(inventory, null);
      if (seconds <= 0) return setOffer(out, 'nachlegen', l.kind, 'keinBrennstoff', tx, ty);
      return setOffer(out, 'nachlegen', l.kind, fuelItemsThatFit(fire.fuel, fuelTicks(seconds), 1) < 1 ? 'feuerVoll' : null, tx, ty);
    },
    use: (sim, layer, tx, ty, tick) => {
      const l = light.lightAt(layer, tx, ty);
      if (l === undefined) return;
      if (l.torch !== null) take(sim, { type: 'light.take', light: l.id }, tick);
      else if (l.fire !== null && !l.fire.lit && l.fire.fuel > 0) ignite(sim, { type: 'light.ignite', tx, ty }, tick);
      else {
        const from = fuelSlot(inventory);
        if (from !== null) fuel(sim, { type: 'light.fuel', light: l.id, from }, tick);
      }
    },
  };
}

/** Water of the aimed tile or the tile ahead: a sip (§18). */
function waterUses(deps: UseProviderDeps): UseProvider {
  const { gathering, actions } = deps;
  const drink = handler(actions, 'action.drink');
  return {
    offer: (_sim, layer, tx, ty, out) => {
      const chunk = gathering.chunkOf(layer, tx, ty);
      if (chunk === undefined) return false;
      const source = waterSource(chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
      if (source === null) return false;
      const subject: UseSubjectId = source === 'meer' ? 'meerwasser' : source === 'eis' ? 'eis' : source === 'quelle' ? 'quellwasser' : 'suesswasser';
      const block: UseBlock | null = source === 'meer' ? 'salzwasser' : source === 'eis' ? 'gefroren' : null;
      return setOffer(out, 'trinken', subject, block, tx, ty, true);
    },
    use: (sim, _layer, tx, ty, tick) => drink(sim, { type: 'action.drink', tx, ty }, tick),
  };
}

/** Tree stumps: sit down; seated, stand up (§11.4). */
function seatUses(deps: UseProviderDeps): UseProvider {
  const { gathering, actions } = deps;
  const sit = handler(actions, 'action.sit');
  const stand = handler(actions, 'action.stand');
  const at = { x: 0, y: 0 };
  return {
    offer: (_sim, layer, tx, ty, out) => {
      if (!gathering.stumpAt(layer, tx, ty, at) || Math.floor(at.x / TILE_PX) !== tx || Math.floor(at.y / TILE_PX) !== ty) return false;
      return setOffer(out, actions.state.seat === null ? 'sitzen' : 'aufstehen', STUMP_SUBJECT, null, tx, ty);
    },
    use: (sim, _layer, tx, ty, tick) => {
      if (actions.state.seat === null) sit(sim, { type: 'action.sit', tx, ty }, tick);
      else stand(sim, { type: 'action.stand' }, tick);
    },
  };
}

/** The player's graves: recover what fits (§11.6). */
function graveUses(deps: UseProviderDeps, room: RoomCache): UseProvider {
  const { death } = deps;
  const loot = handler(death, 'death.lootGrave');
  const graveAt = (layer: Layer, tx: number, ty: number): Readonly<Grave> | null => {
    const graves = death.state.graves;
    for (let i = 0; i < graves.length; i++) {
      const g = graves[i] as Grave;
      if (g.layer === layer && Math.floor(g.x / TILE_PX) === tx && Math.floor(g.y / TILE_PX) === ty) return g;
    }
    return null;
  };
  const anyFits = (grave: Readonly<Grave>): boolean => {
    for (let i = 0; i < grave.items.length; i++) if (room.fits((grave.items[i] as ItemStack).item)) return true;
    return false;
  };
  return {
    offer: (_sim, layer, tx, ty, out) => {
      const grave = graveAt(layer, tx, ty);
      if (grave === null) return false;
      return setOffer(out, 'bergen', 'grab', anyFits(grave) ? null : 'bagsFull', tx, ty);
    },
    use: (sim, layer, tx, ty, tick) => {
      const grave = graveAt(layer, tx, ty);
      if (grave !== null) loot(sim, { type: 'death.lootGrave', grave: grave.id }, tick);
    },
  };
}

/** Sleeping places of the providers (placed beds): lie down (§11.5). */
function sleepUses(deps: UseProviderDeps): UseProvider {
  const { sleep, player } = deps;
  const start = handler(sleep, 'sleep.start');
  return {
    offer: (sim, layer, tx, ty, out) => {
      const place = sleep.placeAt(sim, layer, tx, ty);
      if (place === null) return false;
      const v = player.vitalsOf(sim.player);
      const tired = v !== undefined && sleepAllowed(sim.clock.hour, v.exhaustion);
      return setOffer(out, 'schlafen', place.kind, tired ? null : 'nochNichtMuede', tx, ty);
    },
    use: (sim, _layer, tx, ty, tick) => start(sim, { type: 'sleep.start', tx, ty }, tick),
  };
}

/** The use providers over the game's systems, in the order the interaction system asks them. */
export function createUseProviders(deps: UseProviderDeps): UseProvider[] {
  const room = new RoomCache(deps.inventory);
  return [lightUses(deps, room), graveUses(deps, room), sleepUses(deps), seatUses(deps), waterUses(deps)];
}
