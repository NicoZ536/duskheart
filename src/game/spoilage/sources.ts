/**
 * The perishable containers as sources of the spoilage system (docs/SPIEL.md §17 "forEachPerishable", §21 "Behälter melden ihre
 * Stapel"; `PerishableContainerSource`, src/game/spoilage/types.ts): adapters over the public state of the systems that keep
 * them – the bags (inventory), the chests and the pantry barrel (storage), dropped stacks (drops) and graves (death). The
 * stations' slots spoil inside the station system's own advance, hour by hour between its batches (`stationSpoilage`, so a
 * frozen station catches up bit-identically, src/game/stations/system.ts `useSpoilage`).
 *
 * `chunk = null`: the bags and every container of the active zone; else the containers lying in that chunk. A visitor's
 * `replace` puts a spoiled stack where the old one lay (immutable bags: one new bag state after the visit).
 */
import { CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import type { ChunkData } from '../../world/model/chunk';
import type { DeathSystem } from '../death/system';
import type { DropSystem } from '../drops/system';
import { withSlot, type BagsState } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { BagArea } from '../items/slots';
import type { ItemStack } from '../items/stack';
import type { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import type { StorageSystem } from '../storage/system';
import { TILE_PX } from '../../world/model/coords';
import type { PerishableContainerSource, PerishableSlot, PerishableVisitor } from './types';

/** The bag areas whose stacks spoil (equipment and the backpack slot hold no food). */
export const PERISHABLE_BAG_AREAS: readonly BagArea[] = ['inventar', 'schnellleiste', 'rucksackfach', 'guertel'];

/** Whether a chunk of the world is in the active zone (its containers spoil hourly; frozen ones catch up). */
export type ActiveCheck = (sim: Simulation, layer: Layer, cx: number, cy: number) => boolean;

/** A mutable slot record the adapters fill (read it inside the visitor; it is reused). */
interface SlotRecord {
  container: PerishableSlot['container'];
  key: string;
  layer: Layer;
  tx: number;
  ty: number;
  stack: ItemStack;
}

function record(): SlotRecord {
  return { container: 'kiste', key: '', layer: 0, tx: 0, ty: 0, stack: { item: '', count: 1 } };
}

/** Whether tile (tx, ty) of `layer` lies in `chunk` (or, for `chunk` null, in the active zone). */
function inScope(sim: Simulation, active: ActiveCheck, chunk: ChunkData | null, layer: Layer, tx: number, ty: number): boolean {
  const cx = tx >> CHUNK_SHIFT;
  const cy = ty >> CHUNK_SHIFT;
  if (chunk === null) return active(sim, layer, cx, cy);
  return chunk.layer === layer && chunk.cx === cx && chunk.cy === cy;
}

/** The player's bags: spoil with the player wherever it is (only for `chunk` null). */
export function bagSource(inventory: InventorySystem, player: PlayerSystem): PerishableContainerSource {
  const at = { x: 0, y: 0 };
  const r = record();
  r.container = 'taschen';
  return {
    id: 'taschen',
    forEachPerishable(sim, chunk, visit) {
      if (chunk !== null) return;
      const body = player.body(sim);
      const placed = body !== undefined && player.position(sim, at);
      r.layer = placed ? body.layer : 0;
      r.tx = placed ? Math.floor(at.x / TILE_PX) : 0;
      r.ty = placed ? Math.floor(at.y / TILE_PX) : 0;
      let state: BagsState = inventory.state;
      for (const area of PERISHABLE_BAG_AREAS) {
        const slots = state[area];
        for (let index = 0; index < slots.length; index++) {
          const stack = slots[index] ?? null;
          if (stack === null || stack.frische === undefined) continue;
          r.key = `taschen:${area}:${index}`;
          r.stack = stack;
          visit(r, (next) => {
            state = withSlot(state, { bereich: area, index }, next);
          });
        }
      }
      // Spoilage is no deed of the player: the bags change silently (the UI reads their revision).
      inventory.bags.replace(state);
    },
  };
}

/** The chests and the pantry barrel of the storage system (`vorratsfass` keeps food at 0,75). */
export function chestSource(storage: StorageSystem, active: ActiveCheck): PerishableContainerSource {
  const r = record();
  return {
    id: 'kiste',
    forEachPerishable(sim, chunk, visit) {
      const chests = storage.chests;
      for (let c = 0; c < chests.length; c++) {
        const chest = chests[c] as (typeof chests)[number];
        if (!inScope(sim, active, chunk, chest.layer, chest.tx, chest.ty)) continue;
        r.container = chest.item === 'vorratsfass' ? 'vorratsfass' : 'kiste';
        r.layer = chest.layer;
        r.tx = chest.tx;
        r.ty = chest.ty;
        const slots = chest.slots;
        for (let i = 0; i < slots.length; i++) {
          const stack = slots[i] ?? null;
          if (stack === null || stack.frische === undefined) continue;
          r.key = `kiste:${chest.id}:${i}`;
          r.stack = stack;
          visit(r, (next) => {
            slots[i] = next;
          });
        }
      }
    },
  };
}

/** Dropped stacks lying in the world. */
export function dropSource(drops: DropSystem, active: ActiveCheck): PerishableContainerSource {
  const r = record();
  r.container = 'drop';
  return {
    id: 'drop',
    forEachPerishable(sim, chunk, visit) {
      const store = drops.store;
      for (let i = 0; i < store.size; i++) {
        const d = store.valueAt(i);
        if (d.stack.frische === undefined) continue;
        const tx = Math.floor(d.x / TILE_PX);
        const ty = Math.floor(d.y / TILE_PX);
        if (!inScope(sim, active, chunk, d.layer, tx, ty)) continue;
        r.key = `drop:${store.entityAt(i)}`;
        r.layer = d.layer;
        r.tx = tx;
        r.ty = ty;
        r.stack = d.stack;
        visit(r, (next) => {
          d.stack = next;
        });
      }
    },
  };
}

/** The player's graves (§11.6: what the dead carried lies there until recovered). */
export function graveSource(death: DeathSystem, active: ActiveCheck): PerishableContainerSource {
  const r = record();
  r.container = 'grab';
  return {
    id: 'grab',
    forEachPerishable(sim, chunk, visit) {
      const graves = death.state.graves;
      for (let g = 0; g < graves.length; g++) {
        const grave = graves[g] as (typeof graves)[number];
        const tx = Math.floor(grave.x / TILE_PX);
        const ty = Math.floor(grave.y / TILE_PX);
        if (!inScope(sim, active, chunk, grave.layer as Layer, tx, ty)) continue;
        r.layer = grave.layer as Layer;
        r.tx = tx;
        r.ty = ty;
        const items = grave.items as ItemStack[];
        for (let i = 0; i < items.length; i++) {
          const stack = items[i] as ItemStack;
          if (stack.frische === undefined) continue;
          r.key = `grab:${grave.id}:${i}`;
          r.stack = stack;
          visit(r, (next) => {
            items[i] = next;
          });
        }
      }
    },
  };
}

/** Every source over the game's systems. */
export function gameSources(deps: { inventory: InventorySystem; player: PlayerSystem; storage: StorageSystem; drops: DropSystem; death: DeathSystem }, active: ActiveCheck): PerishableContainerSource[] {
  return [bagSource(deps.inventory, deps.player), chestSource(deps.storage, active), dropSource(deps.drops, active), graveSource(deps.death, active)];
}

export type { PerishableVisitor };
