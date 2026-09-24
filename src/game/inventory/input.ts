/**
 * Hotbar input (MASTERPROMPT §13.1 "Schnellleiste 10 (Tasten 1–0, Mausrad)", §26): the actions
 * `hotbar1`–`hotbar10` select a slot, `hotbarNext`/`hotbarPrev` (mouse wheel, shoulder buttons)
 * scroll. `InputCommandTranslator` (src/game/input.ts) calls `hotbarCommand` once per frame; the
 * command acts in the next simulation tick.
 */
import { HOTBAR_ACTIONS, type Action } from '../../engine/input/actions';

/** What the hotbar needs of the frame's actions (`ActionReader`). */
export interface HotbarActionSource {
  wasPressed(action: Action): boolean;
  pressCount(action: Action): number;
}

/** The hotbar command of this frame, or `null`: a number key wins over the wheel; several wheel notches add up. */
export function hotbarCommand(reader: HotbarActionSource): { type: 'player.selectHotbar'; index: number } | { type: 'player.scrollHotbar'; delta: number } | null {
  for (let index = 0; index < HOTBAR_ACTIONS.length; index++) {
    if (reader.wasPressed(HOTBAR_ACTIONS[index] as Action)) return { type: 'player.selectHotbar', index };
  }
  const notches = reader.pressCount('hotbarNext') - reader.pressCount('hotbarPrev');
  if (notches === 0) return null;
  const limit = HOTBAR_ACTIONS.length - 1;
  const delta = notches > limit ? limit : notches < -limit ? -limit : notches;
  return { type: 'player.scrollHotbar', delta };
}
