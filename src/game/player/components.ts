/**
 * ECS components of the player (docs/SPIEL.md §3): `player` (the body besides its position, which is the
 * shared `position` component of the motion system) and `vitals` (§11.1/§11.2). Both are registered
 * without an ECS serializer: the participants `player` and `vitals` save them (validated, versioned),
 * restored after the ECS itself.
 */
import { SparseSet, type Ecs } from '../../engine/ecs';
import type { Vitals } from '../survival/state';
import type { PlayerBody } from './state';

/** ECS component name of the player's body. */
export const PLAYER_COMPONENT = 'player';
/** ECS component name of the player's vitals. */
export const VITALS_COMPONENT = 'vitals';

/** The component stores of the player. */
export interface PlayerComponents {
  readonly body: SparseSet<PlayerBody>;
  readonly vitals: SparseSet<Vitals>;
}

/** Registers the player's component stores in `ecs`. */
export function registerPlayerComponents(ecs: Ecs): PlayerComponents {
  return {
    body: ecs.registerComponent(PLAYER_COMPONENT, new SparseSet<PlayerBody>()),
    vitals: ecs.registerComponent(VITALS_COMPONENT, new SparseSet<Vitals>()),
  };
}
