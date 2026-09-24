/**
 * Belt input (MASTERPROMPT §13.1 "Gürtel (3 Schnellverbrauch-Plätze, Taste Q)", §26 "Q Gürtel"): the action
 * `belt` consumes from the first filled belt slot. `InputCommandTranslator` (src/game/input.ts) calls
 * `beltCommand` once per frame in the player's branch; the command acts in the next simulation tick.
 */
import type { Action } from '../../engine/input/actions';

/** What the belt needs of the frame's actions (`ActionReader`). */
export interface BeltActionSource {
  wasPressed(action: Action): boolean;
}

/** The belt command of this frame, or `null`. */
export function beltCommand(reader: BeltActionSource): { type: 'action.useBelt' } | null {
  return reader.wasPressed('belt') ? { type: 'action.useBelt' } : null;
}
