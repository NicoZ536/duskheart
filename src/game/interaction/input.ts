/**
 * Interaction input (MASTERPROMPT §26 "E Interagieren", §11.4 "Sammeln (halten, Fortschrittsring)"):
 * holding the action `interact` works the target in focus, releasing stops. `InputCommandTranslator`
 * (src/game/input.ts) asks `InteractionInput.command` once per frame; like sprint and sneak, only
 * changes are sent (the press and the release – also the release a menu causes by switching the input
 * context), so a held key costs nothing per frame and recordings stay small.
 */
import type { Action } from '../../engine/input/actions';

/** What the interaction needs of the frame's actions (`ActionReader`). */
export interface InteractionActionSource {
  isDown(action: Action): boolean;
  wasPressed(action: Action): boolean;
}

/** The interact command of a frame. */
export type InteractCommand = { type: 'player.interact'; on: boolean };

/** Tracks the sent state of `interact`. */
export class InteractionInput {
  private sent = false;

  /**
   * The command of this frame (press or release), or `null` when nothing changed. A tap pressed and
   * released within one frame counts as a press (the release follows in the next frame).
   */
  command(reader: InteractionActionSource): InteractCommand | null {
    const down = reader.isDown('interact') || (!this.sent && reader.wasPressed('interact'));
    if (down === this.sent) return null;
    this.sent = down;
    return { type: 'player.interact', on: down };
  }

  /** A new player (spawn, load) holds nothing: the next frame sends a held key again. */
  resync(): void {
    this.sent = false;
  }
}
