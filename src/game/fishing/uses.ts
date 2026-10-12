/**
 * How the player fishes (docs/SPIEL.md §20 "Angeln"; M7-24) – E targets (`InteractionSystem.addUses`), registered before the
 * water's own use (drinking), so with the rod, a pickaxe or a fish trap in the hand E on water does the fishing:
 * - **rod**, no line out: open water (or an open ice hole) on the aimed tile or the tile ahead – "Auswerfen": the cast goes
 *   to the aimed point when it is open water within `castReachTiles` (far out into the lake), else to the tile in focus;
 *   frozen water without a hole is named and blocked ("gefroren"). Line out: "Einholen (halten)" on the player's own tile
 *   (so no flower or bush nearby takes the press) and on aimed water – E held reels (the fishing system reads
 *   `InteractionSystem.holding`), a press before the bite reels the empty line in.
 * - **pickaxe** on frozen water without a hole: "Eisloch schlagen" (`fishing.cutHole`).
 * - **fish trap** on open water without a trap: "Aufstellen" (`fishing.placeTrap`).
 * - **any hand** on a trap: "Leeren" when it caught something, else "Nehmen" (`fishing.takeTrap`).
 *
 * The rod also works from the primary button (M7-85, `fishingItemUse` – an item use of `player.useItem`, src/game/tools/itemUses.ts;
 * the input sends `fishing.reel` while the button is held, src/game/combat/input.ts): no line out, the cast goes to the aimed
 * point when it is open water within `castReachTiles`, else to the aimed tile (a press at dry land stays silent); a line in the
 * air or waiting is reeled in empty, as E does; a bite and the fight are the held button's reel. From a slot (the inventory) or
 * on a named tile the cast is refused with its reason.
 */
import type { ItemDef } from '../../content/schema/item';
import { WATER_DEPTH_MASK, WATER_FROZEN, WATER_SEA } from '../../world/model/chunk';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { InventorySystem } from '../inventory/system';
import type { UseOffer, UseProvider } from '../interaction/uses';
import type { Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import { ICE_TOOL_KIND, TRAP_ITEM, isRod, type FishingSystem } from './system';
import { BALANCE } from '../../content/balance';

/** What the uses need of the other systems. */
export interface FishingUseDeps {
  readonly fishing: FishingSystem;
  readonly inventory: InventorySystem;
  /** The aimed point (`InteractionSystem.aimPoint`), or null. */
  aimPoint(): Readonly<{ x: number; y: number }> | null;
  /** The player's feet [world px]; false without a player. */
  feet(sim: Simulation, out: { x: number; y: number }): boolean;
}

const CAST_REACH_PX = BALANCE.fishing.castReachTiles * TILE_PX;

/** The fishing E targets (see module comment). */
export function fishingUses(deps: FishingUseDeps): UseProvider {
  const { fishing, inventory } = deps;
  const at = { x: 0, y: 0 };
  const hand = (): ItemDef | null => {
    const s = inventory.selected();
    return s === null ? null : inventory.bags.catalog.get(s.item);
  };
  const centre = (out: UseOffer, tx: number, ty: number): true => {
    out.x = tx * TILE_PX + TILE_PX / 2;
    out.y = ty * TILE_PX + TILE_PX / 2;
    return true;
  };
  return {
    offer(sim, layer, tx, ty, out) {
      out.block = null;
      out.detail = null;
      out.aimedOnly = false;
      const trap = fishing.trapAt(layer, tx, ty);
      if (trap !== undefined) {
        out.action = trap.fish.length > 0 ? 'leeren' : 'nehmen';
        out.subject = TRAP_ITEM;
        return centre(out, tx, ty);
      }
      const def = hand();
      // The line out: E is the reel – on the player's own tile, so nothing nearer (a flower at the shore) takes the press.
      if (def !== null && isRod(def) && fishing.phase !== 'aus' && deps.feet(sim, at) && Math.floor(at.x / TILE_PX) === tx && Math.floor(at.y / TILE_PX) === ty) {
        out.action = 'einholen';
        out.subject = 'pose';
        return centre(out, tx, ty);
      }
      const w = fishing.waterAt(layer, tx, ty);
      if ((w & WATER_DEPTH_MASK) === 0) return false;
      const frozen = (w & WATER_FROZEN) !== 0;
      if (def === null) return false;
      out.aimedOnly = true;
      if (isRod(def)) {
        if (fishing.phase !== 'aus') {
          out.action = 'einholen';
          out.subject = 'pose';
          return centre(out, tx, ty);
        }
        out.action = 'auswerfen';
        const open = !frozen || fishing.holeOpen(layer, tx, ty, sim.clock.day);
        out.subject = frozen ? 'eisloch' : (w & WATER_SEA) !== 0 ? 'meerwasser' : 'suesswasser';
        if (!open) {
          out.subject = 'eis';
          out.block = 'gefroren';
        }
        return centre(out, tx, ty);
      }
      if (def.werkzeug?.art === ICE_TOOL_KIND && frozen) {
        if (fishing.holeOpen(layer, tx, ty, sim.clock.day)) return false;
        out.action = 'eisloch';
        out.subject = 'eis';
        return centre(out, tx, ty);
      }
      if (def.id === TRAP_ITEM && !frozen) {
        out.action = 'aufstellen';
        out.subject = TRAP_ITEM;
        return centre(out, tx, ty);
      }
      return false;
    },
    use(sim, layer, tx, ty, tick) {
      const trap = fishing.trapAt(layer, tx, ty);
      if (trap !== undefined) {
        fishing.commands['fishing.takeTrap']?.(sim, { type: 'fishing.takeTrap', tx, ty }, tick);
        return;
      }
      const def = hand();
      if (def === null) return;
      if (isRod(def)) {
        const phase = fishing.phase;
        if (phase === 'wurf' || phase === 'warten') fishing.commands['fishing.cancel']?.(sim, { type: 'fishing.cancel' }, tick);
        if (phase !== 'aus') return;
        // Far out: the aimed point when it is open water within the cast reach, else the tile in focus.
        const aim = deps.aimPoint();
        let x = tx * TILE_PX + TILE_PX / 2;
        let y = ty * TILE_PX + TILE_PX / 2;
        if (aim !== null && deps.feet(sim, at) && (aim.x - at.x) ** 2 + (aim.y - at.y) ** 2 <= CAST_REACH_PX ** 2 && fishing.castProblem(layer, Math.floor(aim.x / TILE_PX), Math.floor(aim.y / TILE_PX), sim.clock.day) === null) {
          x = aim.x;
          y = aim.y;
        }
        fishing.commands['fishing.cast']?.(sim, { type: 'fishing.cast', x, y }, tick);
        return;
      }
      if (def.werkzeug?.art === ICE_TOOL_KIND) {
        fishing.commands['fishing.cutHole']?.(sim, { type: 'fishing.cutHole', tx, ty }, tick);
        return;
      }
      if (def.id === TRAP_ITEM) {
        const state = inventory.state;
        fishing.commands['fishing.placeTrap']?.(sim, { type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: state.auswahl }, tx, ty }, tick);
      }
    },
  };
}

/** The rod as an item use of `player.useItem` (the primary button, a slot's use; see module comment). */
export function fishingItemUse(deps: FishingUseDeps): ItemUseHandler {
  const { fishing } = deps;
  const at = { x: 0, y: 0 };
  return {
    id: 'angel',
    handles: isRod,
    use(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
      const phase = fishing.phase;
      // A line in the air or waiting: reeled in empty (E does the same); a bite or a fight belong to the held reel.
      if (phase === 'wurf' || phase === 'warten') {
        fishing.commands['fishing.cancel']?.(sim, { type: 'fishing.cancel' }, ctx.tick);
        return 'used';
      }
      if (phase !== 'aus') return 'used';
      const t = ctx.target;
      const day = sim.clock.day;
      if (!deps.feet(sim, at)) return { reject: 'noPlayer' };
      // Far out: the aimed point when it is open water within the cast reach (not for a named tile: E's own target).
      const aim = ctx.named ? null : deps.aimPoint();
      if (aim !== null && t !== null && (aim.x - at.x) ** 2 + (aim.y - at.y) ** 2 <= CAST_REACH_PX ** 2 && fishing.castProblem(t.layer, Math.floor(aim.x / TILE_PX), Math.floor(aim.y / TILE_PX), day) === null) {
        fishing.commands['fishing.cast']?.(sim, { type: 'fishing.cast', x: aim.x, y: aim.y }, ctx.tick);
        return 'used';
      }
      if (t === null) return ctx.primary ? 'used' : { reject: 'noWater' };
      const x = t.tx * TILE_PX + TILE_PX / 2;
      const y = t.ty * TILE_PX + TILE_PX / 2;
      // The primary button at dry land or beyond the reach stays silent (a click must not sound an error).
      if (ctx.primary && ((x - at.x) ** 2 + (y - at.y) ** 2 > CAST_REACH_PX ** 2 || fishing.castProblem(t.layer, t.tx, t.ty, day) !== null)) return 'used';
      fishing.commands['fishing.cast']?.(sim, { type: 'fishing.cast', x, y }, ctx.tick);
      return 'used';
    },
  };
}

/** The player's layer is the line's: a helper for the E targets' feet (`FishingUseDeps.feet`). */
export function fishingFeet(player: { body(sim: Simulation): { layer: Layer } | undefined; position(sim: Simulation, out: { x: number; y: number }): boolean }): FishingUseDeps['feet'] {
  return (sim, out) => player.body(sim) !== undefined && player.position(sim, out);
}
