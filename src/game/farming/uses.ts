/**
 * How the player farms (docs/SPIEL.md §20 "Handlungen (alle über ToolsSystem.addItemUse bzw. E-Ziele)"; M7-19 … M7-23):
 *
 * - **Item uses** of `player.useItem` (`ToolsSystem.addItemUse`, src/game/tools/itemUses.ts): a seed (`saat`) is sown, a sapling
 *   (`pflanzt`) planted, the watering can (`ladungen`) waters a plot or is filled at fresh water, fertiliser (`duenger`) is
 *   spread – on the tile the command names (it must lie within reach), else on the aimed tile within reach. One piece of the
 *   seed, sapling or fertiliser is used up; the can loses a charge per watering and a use of its durability per filling.
 * - **E targets** (`InteractionSystem.addUses`): with the matching item in the hand E does the same on the tile in focus – sow,
 *   water, fertilise, plant, fill the can –; with any hand E harvests a ripe crop (`farm.harvest`) or clears a dead plant, and
 *   names an unripe one ("Ernten: Karotte – noch nicht reif").
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import { WATER_DEPTH_MASK, WATER_FROZEN } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { waterSource } from '../actions/formulas';
import type { GatheringSystem } from '../gathering/system';
import { withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import { REACH_PX, distanceToRect } from '../interaction/formulas';
import type { UseOffer, UseProvider } from '../interaction/uses';
import type { SlotRef } from '../items/slots';
import { withCount, type ItemStack } from '../items/stack';
import type { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import { canCharges, withCharges, type FarmingSystem } from './system';
import type { FarmRejectReason } from './events';

const F = BALANCE.farming;

/** What the uses need of the other systems. */
export interface FarmUseDeps {
  readonly farming: FarmingSystem;
  readonly gathering: Pick<GatheringSystem, 'saplingProblem' | 'plantSapling' | 'chunkOf'>;
  readonly inventory: InventorySystem;
  readonly player: PlayerSystem;
}

/** The tool kind of the watering can. */
const CAN_KIND = 'giesskanne';

/** Whether `def` is a watering can. */
export function isCan(def: ItemDef): boolean {
  return def.werkzeug?.art === CAN_KIND && def.ladungen !== undefined;
}

/** The player's feet [px] and layer, or null without a player (a held record). */
function playerAt(deps: FarmUseDeps, sim: Simulation, out: { x: number; y: number; layer: Layer }): boolean {
  const body = deps.player.body(sim);
  if (body === undefined || !deps.player.position(sim, out)) return false;
  out.layer = body.layer;
  return true;
}

/** Whether tile (tx, ty) lies within the interaction reach of (x, y). */
function inReach(x: number, y: number, tx: number, ty: number): boolean {
  return distanceToRect(x, y, tx * TILE_PX, ty * TILE_PX, (tx + 1) * TILE_PX, (ty + 1) * TILE_PX) <= REACH_PX;
}

/** The fresh-water source on tile (tx, ty) for the can, or why not ('notWater', 'notFresh'). */
function freshWater(deps: FarmUseDeps, layer: Layer, tx: number, ty: number): FarmRejectReason | null {
  const chunk = deps.gathering.chunkOf(layer, tx, ty);
  if (chunk === undefined) return 'notWater';
  const w = chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
  if ((w & WATER_DEPTH_MASK) === 0 || (w & WATER_FROZEN) !== 0) return 'notWater';
  const source = waterSource(w);
  return source === 'fluss' || source === 'see' || source === 'quelle' ? null : 'notFresh';
}

/** Takes one piece of the stack in `ref` (its slot holds `stack`). */
function useOne(deps: FarmUseDeps, sim: Simulation, ref: SlotRef, stack: ItemStack): void {
  deps.inventory.bags.replace(withSlot(deps.inventory.state, ref, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
  sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
}

/** Puts `next` into slot `ref` (the can with its new charges or durability). */
function replaceStack(deps: FarmUseDeps, sim: Simulation, ref: SlotRef, next: ItemStack): void {
  deps.inventory.bags.replace(withSlot(deps.inventory.state, ref, next));
  sim.events.push('inventoryChanged', { change: 'add', tick: sim.eventTick });
}

/**
 * The can of `stack` filled at fresh water: full charges, one use of its durability (§D "jede Nutzung"); broken (durability
 * 0) it cannot be filled.
 */
export function filledCan(stack: ItemStack, def: ItemDef): ItemStack {
  const max = def.ladungen?.max ?? F.canCharges;
  const worn = stack.haltbarkeit === undefined ? stack : { ...stack, haltbarkeit: Math.max(0, stack.haltbarkeit - 1) };
  return withCharges(worn, max);
}

/** Fills the can of `ref` at the fresh water of tile (tx, ty); the refusal or null. */
function fill(deps: FarmUseDeps, sim: Simulation, ref: SlotRef, stack: ItemStack, def: ItemDef, layer: Layer, tx: number, ty: number): FarmRejectReason | 'notUsable' | null {
  const water = freshWater(deps, layer, tx, ty);
  if (water !== null) return water;
  if (stack.haltbarkeit === 0) return 'notUsable';
  if (canCharges(stack) >= (def.ladungen?.max ?? F.canCharges)) return 'canFull';
  const next = filledCan(stack, def);
  replaceStack(deps, sim, ref, next);
  if (next.haltbarkeit === 0) sim.events.push('itemBroken', { at: { ...ref }, item: next.item, tick: sim.eventTick });
  sim.events.push('canFilled', { layer, tx, ty, item: stack.item, tick: sim.eventTick });
  return null;
}

/** Does the farming use of item `def` in slot `ref` on tile (tx, ty); the refusal or null. */
function act(deps: FarmUseDeps, sim: Simulation, ref: SlotRef, stack: ItemStack, def: ItemDef, layer: Layer, tx: number, ty: number): FarmRejectReason | 'notUsable' | null {
  const farming = deps.farming;
  if (def.saat !== undefined) {
    const problem = farming.sowProblem(layer, tx, ty, def);
    if (problem !== null) return problem;
    useOne(deps, sim, ref, stack);
    farming.sow(sim, layer, tx, ty, def);
    return null;
  }
  if (def.pflanzt !== undefined) {
    if (farming.isPlot(layer, tx, ty)) return 'cannotPlant';
    const problem = deps.gathering.saplingProblem(layer, tx, ty, def.pflanzt);
    if (problem !== null) return 'cannotPlant';
    useOne(deps, sim, ref, stack);
    deps.gathering.plantSapling(sim, layer, tx, ty, def.pflanzt);
    sim.events.push('saplingPlanted', { layer, tx, ty, item: def.id, object: def.pflanzt, tick: sim.eventTick });
    return null;
  }
  if (isCan(def)) {
    if (!farming.isPlot(layer, tx, ty)) return fill(deps, sim, ref, stack, def, layer, tx, ty);
    const problem = farming.waterProblem(layer, tx, ty, stack);
    if (problem !== null) return problem;
    replaceStack(deps, sim, ref, farming.water(sim, layer, tx, ty, stack));
    return null;
  }
  if (def.duenger !== undefined) {
    const problem = farming.fertilizeProblem(layer, tx, ty, def);
    if (problem !== null) return problem;
    useOne(deps, sim, ref, stack);
    farming.fertilize(sim, layer, tx, ty, def);
    return null;
  }
  return 'notUsable';
}

/** Whether `def` is one of the field's items (seed, sapling, watering can, fertiliser). */
export function isFarmItem(def: ItemDef): boolean {
  return def.saat !== undefined || def.pflanzt !== undefined || isCan(def) || def.duenger !== undefined;
}

/** The item use of the field (`ToolsSystem.addItemUse`). */
export function farmItemUse(deps: FarmUseDeps): ItemUseHandler {
  const at = { x: 0, y: 0, layer: 0 as Layer };
  return {
    id: 'feld',
    handles: isFarmItem,
    use(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
      if (!playerAt(deps, sim, at)) return { reject: 'noPlayer' };
      const t = ctx.target;
      if (t === null || !inReach(at.x, at.y, t.tx, t.ty)) return ctx.primary ? 'used' : { reject: 'outOfReach' };
      const reason = act(deps, sim, ctx.slot, ctx.stack, ctx.def, at.layer, t.tx, t.ty);
      if (reason === null) return 'used';
      return ctx.primary ? 'used' : { reject: reason };
    },
  };
}

/** Block text of a refusal for the E hint (src/content/uses.ts), or null when it shows none. */
function blockOf(reason: FarmRejectReason | 'notUsable' | null): UseOffer['block'] {
  switch (reason) {
    case 'canEmpty':
      return 'kanneLeer';
    case 'canFull':
      return 'kanneVoll';
    case 'soilWet':
      return 'bodenNass';
    case 'notFresh':
      return 'salzwasser';
    default:
      return null;
  }
}

/** The E targets of the field (see module comment). */
export function farmUses(deps: FarmUseDeps): UseProvider {
  const farming = deps.farming;
  /** The bag slot of the hand (hotbar selection). */
  const hand = (): { ref: SlotRef; stack: ItemStack; def: ItemDef } | null => {
    const state = deps.inventory.state;
    const stack = deps.inventory.selected();
    if (stack === null) return null;
    return { ref: { bereich: 'schnellleiste', index: state.auswahl }, stack, def: deps.inventory.bags.catalog.get(stack.item) };
  };
  const centre = (out: UseOffer, tx: number, ty: number): void => {
    out.x = tx * TILE_PX + TILE_PX / 2;
    out.y = ty * TILE_PX + TILE_PX / 2;
  };
  return {
    offer(_sim, layer, tx, ty, out) {
      out.block = null;
      out.detail = null;
      out.aimedOnly = false;
      const h = hand();
      const harvest = farming.harvestState(layer, tx, ty);
      if (harvest === 'ernten' || harvest === 'raeumen') {
        out.action = harvest;
        out.subject = harvest === 'raeumen' ? 'welke_pflanze' : (cropIdAt(farming, layer, tx, ty) as string);
        centre(out, tx, ty);
        return true;
      }
      if (h !== null && isFarmItem(h.def)) {
        const def = h.def;
        if (def.saat !== undefined && farming.isPlot(layer, tx, ty)) {
          if (farming.sowProblem(layer, tx, ty, def) !== null) return unripe(farming, layer, tx, ty, out);
          out.action = 'saeen';
          out.subject = def.id;
        } else if (def.pflanzt !== undefined) {
          if (farming.isPlot(layer, tx, ty) || deps.gathering.saplingProblem(layer, tx, ty, def.pflanzt) !== null) return false;
          out.action = 'pflanzen';
          out.subject = def.id;
          out.aimedOnly = true;
        } else if (isCan(def)) {
          if (farming.isPlot(layer, tx, ty)) {
            out.action = 'giessen';
            out.subject = 'acker';
            out.block = blockOf(farming.waterProblem(layer, tx, ty, h.stack));
          } else {
            const water = freshWater(deps, layer, tx, ty);
            if (water === 'notWater') return false;
            out.action = 'fuellen';
            out.subject = def.id;
            out.aimedOnly = true;
            out.block = water !== null ? 'salzwasser' : canCharges(h.stack) >= (def.ladungen?.max ?? F.canCharges) ? 'kanneVoll' : null;
          }
        } else if (def.duenger !== undefined && farming.isPlot(layer, tx, ty)) {
          if (farming.fertilizeProblem(layer, tx, ty, def) !== null) return false;
          out.action = 'duengen';
          out.subject = 'acker';
        } else return unripe(farming, layer, tx, ty, out);
        centre(out, tx, ty);
        return true;
      }
      return unripe(farming, layer, tx, ty, out);
    },
    use(sim, layer, tx, ty, tick) {
      const harvest = farming.harvestState(layer, tx, ty);
      if (harvest === 'ernten' || harvest === 'raeumen') {
        farming.commands['farm.harvest']?.(sim, { type: 'farm.harvest', tx, ty }, tick);
        return;
      }
      const h = hand();
      if (h === null || !isFarmItem(h.def)) return;
      if (h.def.saat !== undefined && farming.isPlot(layer, tx, ty)) {
        farming.commands['farm.plant']?.(sim, { type: 'farm.plant', tx, ty }, tick);
        return;
      }
      const reason = act(deps, sim, h.ref, h.stack, h.def, layer, tx, ty);
      if (reason !== null) sim.events.push('commandRejected', { type: 'player.useItem', reason, tick });
    },
  };
}

/** Offers an unripe crop as "Ernten: <crop> – noch nicht reif" (false: no crop growing there). */
function unripe(farming: FarmingSystem, layer: Layer, tx: number, ty: number, out: UseOffer): boolean {
  if (farming.harvestState(layer, tx, ty) !== 'unreif') return false;
  const crop = cropIdAt(farming, layer, tx, ty) as string;
  out.action = 'ernten';
  out.subject = crop;
  out.block = 'unreif';
  out.detail = crop;
  out.x = tx * TILE_PX + TILE_PX / 2;
  out.y = ty * TILE_PX + TILE_PX / 2;
  return true;
}

/** The crop id growing on tile (tx, ty), or null. */
function cropIdAt(farming: FarmingSystem, layer: Layer, tx: number, ty: number): string | null {
  const c = farming.chunkAt(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
  if (c === undefined) return null;
  return farming.cropAt(c.crop[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number)?.id ?? null;
}

/** The player's reach for `farm.harvest`: the player's layer when tile (tx, ty) lies within the interaction reach, else null. */
export function farmReach(player: PlayerSystem): (sim: Simulation, tx: number, ty: number) => Layer | null {
  const at = { x: 0, y: 0 };
  return (sim, tx, ty) => {
    const body = player.body(sim);
    if (body === undefined || !player.position(sim, at)) return null;
    return inReach(at.x, at.y, tx, ty) ? body.layer : null;
  };
}
