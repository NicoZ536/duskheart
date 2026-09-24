/**
 * Light input (MASTERPROMPT §26 "F Licht an/aus"): the action `toggleLight` (F, gamepad Y) lights or
 * snuffs the carried torch. `InputCommandTranslator` (src/game/input.ts) calls `lightToggleCommand` once
 * per frame in the player's branch; the command acts in the next simulation tick.
 */
import type { Action } from '../../engine/input/actions';

/** What the light key needs of the frame's actions (`ActionReader`). */
export interface LightActionSource {
  wasPressed(action: Action): boolean;
}

/** The light command of this frame, or `null`. */
export function lightToggleCommand(reader: LightActionSource): { type: 'light.toggle' } | null {
  return reader.wasPressed('toggleLight') ? { type: 'light.toggle' } : null;
}
