/**
 * Combat input (docs/SPIEL.md §10 "Eingabe (M6-02)"; MASTERPROMPT §19.1, §26 "LMB/RT Angriff, RMB/LT Block/Zielen"):
 * `InputCommandTranslator` (src/game/input.ts) asks `CombatInput.commands` once per frame.
 *
 * - **Primary button** (`attack`): its press goes where the hand says (`primaryRoute`, src/game/combat/weapons.ts) – an
 *   item with a use of its own (food, bandage, bucket, torch, camp fire, earth) is used (`player.useItem`, as before M6);
 *   a weapon, a tool, the empty hand strike: `combat.attack {on: true}` on the press and `{on: false}` on the release, so
 *   the simulation measures the hold (light or heavy, a bow's draw). A tap pressed and released within one frame sends
 *   both in that frame. Without a hand route (a translator without a hand probe) every press is `player.useItem`, whose
 *   primary use hands a strike to the combat system itself (src/game/tools/system.ts).
 * - **Block button** (`block`): its held state, only while playing – in build mode the secondary button belongs to the
 *   build mode (rotate, cancel), in menus it is inactive – so switching to either releases it.
 * Like sprint and sneak only changes are sent; commands act in the next tick, no buffer across frames.
 */
import type { Action, InputContext } from '../../engine/input/actions';
import type { GameCommand } from '../commands';
import type { PrimaryRoute } from './weapons';

/** What the combat input needs of the frame's actions (`ActionReader`). */
export interface CombatActionSource {
  isDown(action: Action): boolean;
  wasPressed(action: Action): boolean;
  readonly context: InputContext;
}

/** Tracks the sent state of the attack and block buttons. */
export class CombatInput {
  private attackSent = false;
  private blockSent = false;

  /**
   * Pushes this frame's commands of the attack and block buttons into `push`; `route` is where a press of the primary
   * button goes now (`null`: no hand probe – every press is `player.useItem`). Returns the number pushed.
   */
  commands(reader: CombatActionSource, route: PrimaryRoute | null, push: (cmd: GameCommand) => void): number {
    let pushed = 0;
    const building = reader.context === 'build';
    const pressed = !building && reader.wasPressed('attack');
    if (pressed && !this.attackSent) {
      if (route === 'combat') {
        push({ type: 'combat.attack', on: true });
        this.attackSent = true;
      } else push({ type: 'player.useItem' });
      pushed++;
    }
    if (this.attackSent && (building || !reader.isDown('attack'))) {
      push({ type: 'combat.attack', on: false });
      this.attackSent = false;
      pushed++;
    }
    const block = reader.context === 'play' && reader.isDown('block');
    if (block !== this.blockSent) {
      push({ type: 'combat.block', on: block });
      this.blockSent = block;
      pushed++;
    }
    return pushed;
  }

  /** A new player (spawn, load) holds nothing: the next frame sends held buttons again. */
  resync(): void {
    this.attackSent = false;
    this.blockSent = false;
  }
}
