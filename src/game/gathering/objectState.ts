/**
 * What harvesting writes into a chunk's object state (docs/WORLD.md §3 "Objektzustand (Treffer-HP,
 * Wachstum, Nachwachs-Zeitpunkt) sparsam in Map<tileIndex, ObjectState>"). Objects without an entry are
 * in their generated state: standing, full hit points. Harvesting records:
 *
 * | stage | `growth` | `hp` | `regrowAtTick` | drawn as |
 * |---|---|---|---|---|
 * | damaged, standing | `GROWTH_GROWN` (1) | hit points left | `NO_REGROW_TICK` | the object |
 * | felled tree | `STAGE_STUMP` (−1) | hit points of the stump left | tick the tree is back, or `NO_REGROW_TICK` inside a base | `<id>_stumpf` |
 * | picked bush, picked fruit tree | `STAGE_HARVESTED` (−2) | hit points of the object | tick it carries again | clip `abgeerntet` |
 *
 * Objects that leave nothing behind (rocks, ore nodes, plants, scatter, cut bushes) are removed from the
 * tile (`object` = 0); if they come back, the gathering system keeps their regrow time in its own save
 * participant. Growth values ≥ 0 stay reserved for growing plants (0 = just planted … 1 = grown; farming,
 * §17), so the harvest stages are negative.
 */
import { NO_REGROW_TICK, type ObjectState } from '../../world/model/chunk';

/** `growth` of a grown object (standing; state only because it lost hit points). */
export const GROWTH_GROWN = 1;
/** `growth` of a felled tree: its stump stands on the tile. */
export const STAGE_STUMP = -1;
/** `growth` of a picked bush or fruit tree: it stands without fruit until `regrowAtTick`. */
export const STAGE_HARVESTED = -2;

/** Whether the state is a felled tree's stump. */
export function isStump(state: ObjectState | undefined): boolean {
  return state !== undefined && state.growth === STAGE_STUMP;
}

/** Whether the state is a picked bush or fruit tree waiting for its fruit. */
export function isHarvested(state: ObjectState | undefined): boolean {
  return state !== undefined && state.growth === STAGE_HARVESTED;
}

/** Whether the object comes back at a known tick (stump regrowing into a tree, bush carrying again). */
export function regrowsAt(state: ObjectState | undefined): number {
  return state === undefined ? NO_REGROW_TICK : state.regrowAtTick;
}
