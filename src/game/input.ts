/**
 * Input → commands (docs/ARCHITEKTUR.md "Datenfluss", MASTERPROMPT §3.3 "Eingaben werden zu
 * Commands", §26 "Standardbelegung"). Once per frame, before the loop runs its ticks, the actions
 * evaluated by the `ActionReader` become game commands in the simulation's queue. Commands carry
 * intentions only; whether they succeed is decided by the simulation.
 *
 * Target of the input (`InputTarget`):
 * - `player` – the player entity (M3-08): WASD/left stick → `player.move`, Shift → `player.sprint`,
 *   Ctrl → `player.sneak`, Space → `player.roll` (towards the held direction, else the facing), E held →
 *   `player.interact` (press and release, src/game/interaction/input.ts, M3-10), keys 1–0 and the wheel
 *   → `player.selectHotbar`/`player.scrollHotbar` (src/game/inventory/input.ts, M3-02), Q →
 *   `action.useBelt` (src/game/actions/input.ts, M3-25), F → `light.toggle` (src/game/light/input.ts,
 *   M3-22), the primary button (LMB/RT, action `attack`) → `player.useItem` with the item in the hand
 *   (eat, bandage, pour a bucket, set up a torch or camp fire; M3-15, M3-16, M3-22).
 * - `mover` – without a player, the controlled debug entity of M2 (`move`); `sprint`, `sneak` and
 *   `roll` have no meaning for it.
 * Direction and held modes are pushed only when they change (including back to standing still or
 * releasing), so a held key costs nothing per frame and recordings stay small; a roll is pushed on the
 * press. The ActionReader already handles input contexts and hold/toggle modes: in menus (`ui`
 * context) movement actions are inactive, which sends a stop and releases sprint and sneak.
 */
import type { CommandQueue } from '../engine/commands';
import type { ActionReader } from '../engine/input/reader';
import type { Vec2 } from '../engine/input/state';
import { beltCommand } from './actions/input';
import type { GameCommand } from './commands';
import { InteractionInput } from './interaction/input';
import { hotbarCommand } from './inventory/input';
import { lightToggleCommand } from './light/input';

/** What the input steers: the player, or (without a player) the controlled debug mover of M2. */
export type InputTarget = 'player' | 'mover';

/** Smallest and largest value of a command axis (see `moveCommandSchema`). */
const AXIS_MIN = -1;
const AXIS_MAX = 1;

function clampAxis(v: number): number {
  return v < AXIS_MIN ? AXIS_MIN : v > AXIS_MAX ? AXIS_MAX : v;
}

/** Translates the actions of one frame into game commands. */
export class InputCommandTranslator {
  private readonly moveScratch: Vec2 = { x: 0, y: 0 };
  /** Last sent direction (a fresh controlled entity stands still, i.e. {0, 0}). */
  private sentDx = 0;
  private sentDy = 0;
  /** Last sent sprint and sneak state (a fresh player holds neither). */
  private sentSprint = false;
  private sentSneak = false;
  private readonly interact = new InteractionInput();
  private target: InputTarget = 'mover';

  /**
   * Pushes this frame's commands for `target` into `queue`. Returns the number of commands pushed.
   * A change of the target re-sends the held state to the new one (`resync`).
   */
  translate(reader: ActionReader, queue: CommandQueue<GameCommand>, target: InputTarget = 'mover'): number {
    if (target !== this.target) {
      this.target = target;
      this.resync();
    }
    const v = reader.moveVector(this.moveScratch);
    const dx = clampAxis(v.x);
    const dy = clampAxis(v.y);
    let pushed = 0;
    if (dx !== this.sentDx || dy !== this.sentDy) {
      this.sentDx = dx;
      this.sentDy = dy;
      queue.push(target === 'player' ? { type: 'player.move', dx, dy } : { type: 'move', dx, dy });
      pushed++;
    }
    if (target !== 'player') return pushed;
    const sprint = reader.isDown('sprint');
    if (sprint !== this.sentSprint) {
      this.sentSprint = sprint;
      queue.push({ type: 'player.sprint', on: sprint });
      pushed++;
    }
    const sneak = reader.isDown('sneak');
    if (sneak !== this.sentSneak) {
      this.sentSneak = sneak;
      queue.push({ type: 'player.sneak', on: sneak });
      pushed++;
    }
    if (reader.wasPressed('roll')) {
      queue.push({ type: 'player.roll', dx, dy });
      pushed++;
    }
    const interact = this.interact.command(reader);
    if (interact !== null) {
      queue.push(interact);
      pushed++;
    }
    // Keys 1–0 also act in menus (the inventory puts the item under the pointer on that slot); only in play do they choose the hand.
    const hotbar = reader.context === 'ui' ? null : hotbarCommand(reader);
    if (hotbar !== null) {
      queue.push(hotbar);
      pushed++;
    }
    const belt = beltCommand(reader);
    if (belt !== null) {
      queue.push(belt);
      pushed++;
    }
    const light = lightToggleCommand(reader);
    if (light !== null) {
      queue.push(light);
      pushed++;
    }
    if (reader.wasPressed('attack')) {
      queue.push({ type: 'player.useItem' });
      pushed++;
    }
    return pushed;
  }

  /**
   * A new entity became the controlled one (spawn, loaded save): it stands still and holds nothing, so
   * the next frame sends the held direction and modes again. Standing still sends nothing, so commands
   * issued by other sources in the same tick (debug tools, replays) are not overridden by a stop.
   */
  resync(): void {
    this.sentDx = 0;
    this.sentDy = 0;
    this.sentSprint = false;
    this.sentSneak = false;
    this.interact.resync();
  }
}
