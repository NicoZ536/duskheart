/**
 * E on built things (MASTERPROMPT §11.4 "Interagieren (E)", "Sitzen (Stühle, Baumstümpfe)", §16.1, §16.2 "Türen …
 * Falltür"; M4-11, M4-19): use targets of the interaction system, named by their part's item:
 *
 * - a door, gate or trapdoor: open it or close it again ("Öffnen: Holztür", "Schließen: Holztür") through `build.door`
 *   – blocked while the player stands where it would close (or where a trapdoor would open under them);
 * - a chair, stool, bench or cushion (furniture of the category `sitz`): sit down on it (`action.sit`, the seat of the
 *   building's `seats()`), or, seated, stand up again (`action.stand`) – like a tree stump;
 * - a blueprint (§16.6 "Blaupausen … mit Hammer … fertigstellen", M4-24): finish it with the hammer in the hand
 *   (`build.complete`: the part from the bags or a chest near it) – blocked without a hammer; what else is missing
 *   (the part, a support, room) the command's refusal tells.
 *
 * Every refusal is the owning command's (src/game/building/system.ts, src/game/actions/system.ts).
 */
import type { Layer } from '../../world/model/coords';
import type { ActionsSystem } from '../actions/system';
import { setOffer, type UseOffer, type UseProvider } from '../interaction/uses';
import type { Simulation } from '../sim';
import type { BuildingSystem } from './system';

/** The doors, gates and trapdoors on the build grid as use targets: open, close. */
export function doorUses(building: BuildingSystem): UseProvider {
  const toggle = building.commands['build.door'];
  if (toggle === undefined) throw new Error('doorUses: no handler for build.door');
  return {
    offer: (sim: Simulation, _layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const door = building.doorAt(sim, tx, ty);
      if (door === null) return false;
      return setOffer(out, door.open ? 'schliessen' : 'oeffnen', door.part.id, door.problem === null ? null : 'imWeg', tx, ty);
    },
    use: (sim, _layer, tx, ty, tick) => toggle(sim, { type: 'build.door', tx, ty }, tick),
  };
}

/** The blueprints on the build grid as use targets: finish with a hammer. */
export function blueprintUses(building: BuildingSystem): UseProvider {
  const complete = building.commands['build.complete'];
  if (complete === undefined) throw new Error('blueprintUses: no handler for build.complete');
  return {
    offer: (sim: Simulation, _layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const plan = building.blueprintAt(sim, tx, ty);
      if (plan === null) return false;
      return setOffer(out, 'fertigstellen', plan.part.id, plan.hammer ? null : 'keinHammer', tx, ty);
    },
    use: (sim, _layer, tx, ty, tick) => complete(sim, { type: 'build.complete', tx, ty }, tick),
  };
}

/** The seats on the build grid (chairs, stools, benches, cushions) as use targets: sit down; seated, stand up. */
export function chairUses(building: BuildingSystem, actions: ActionsSystem): UseProvider {
  const seatAt = building.seats();
  const sit = actions.commands['action.sit'];
  const stand = actions.commands['action.stand'];
  if (sit === undefined || stand === undefined) throw new Error('chairUses: no handler for action.sit or action.stand');
  return {
    offer: (sim: Simulation, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const seat = seatAt(sim, layer, tx, ty);
      const part = seat === null ? undefined : building.partAt(layer, 'objekt', tx, ty);
      if (seat === null || part === undefined) return false;
      setOffer(out, actions.state.seat === null ? 'sitzen' : 'aufstehen', part.id, null, tx, ty);
      // The hint's marker sits on the seat, the middle of the piece.
      out.x = seat.x;
      out.y = seat.y;
      return true;
    },
    use: (sim, _layer, tx, ty, tick) => {
      if (actions.state.seat === null) sit(sim, { type: 'action.sit', tx, ty }, tick);
      else stand(sim, { type: 'action.stand' }, tick);
    },
  };
}
