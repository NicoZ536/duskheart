/**
 * Use targets of the creatures (docs/SPIEL.md §3 "E", §11 "Beute, Jagen, Fallen"; MASTERPROMPT §14 "Jagen & Zerlegen"):
 * - a carcass: "Zerlegen: Hase" – with a knife in the hand it is carved (`carcass.carve`); without one the hint names
 *   what is missing (`keinMesser`);
 * - a set trap: "Nehmen: Schlinge" – it comes back into the bags with its catch left as a carcass (`trap.take`); full
 *   bags block it.
 * The interaction system asks them per tile (src/game/interaction/uses.ts, ADR-0028); they act through the owning
 * system's command, so every refusal and feedback is that command's.
 */
import type { GameCommandType } from '../commands';
import { NULL_ENTITY } from '../../engine/ecs';
import { setOffer, type UseProvider } from '../interaction/uses';
import type { CommandHandler, CommandHandlers } from '../sim';
import type { CreatureSystem } from './system';
import type { TrapSystem } from './traps';

/** The handler of command `type` in `system`. */
function handler<K extends GameCommandType>(system: { readonly commands?: CommandHandlers }, type: K): CommandHandler<K> {
  const h = system.commands?.[type] as CommandHandler<K> | undefined;
  if (h === undefined) throw new Error(`creature use targets: no handler for ${type}`);
  return h;
}

/** E on a carcass: carve it with a knife (the subject is the creature, named by its content record). */
export function carcassUses(creatures: CreatureSystem): UseProvider {
  const carve = handler(creatures, 'carcass.carve');
  return {
    offer(_sim, layer, tx, ty, out) {
      const e = creatures.carcassAt(layer, tx, ty);
      if (e === NULL_ENTITY) return false;
      const c = creatures.carcasses.get(e);
      if (c === undefined) return false;
      return setOffer(out, 'zerlegen', c.creature, creatures.knifeInHand() ? null : 'keinMesser', tx, ty);
    },
    use(sim, layer, tx, ty, tick) {
      const e = creatures.carcassAt(layer, tx, ty);
      if (e !== NULL_ENTITY) carve(sim, { type: 'carcass.carve', carcass: e }, tick);
    },
  };
}

/** E on a set trap: take it back (the subject is the trap item). */
export function trapUses(traps: TrapSystem): UseProvider {
  const take = handler(traps, 'trap.take');
  return {
    offer(_sim, layer, tx, ty, out) {
      const t = traps.trapAt(layer, tx, ty);
      if (t === undefined) return false;
      return setOffer(out, 'nehmen', t.item, traps.roomFor(t.id) ? null : 'bagsFull', tx, ty);
    },
    use(sim, layer, tx, ty, tick) {
      const t = traps.trapAt(layer, tx, ty);
      if (t !== undefined) take(sim, { type: 'trap.take', trap: t.id }, tick);
    },
  };
}
