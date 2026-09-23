/**
 * Input → commands (docs/ARCHITEKTUR.md "Datenfluss", MASTERPROMPT §3.3 "Eingaben werden zu
 * Commands"). Once per frame, before the loop runs its ticks, the actions evaluated by the
 * `ActionReader` become game commands in the simulation's queue. Commands carry intentions only;
 * whether they succeed is decided by the simulation.
 *
 * `move` is pushed only when the movement direction changes (including back to standing still),
 * so a held key costs nothing per frame and recordings stay small. The ActionReader already
 * handles input contexts: in menus (`ui` context) movement actions are inactive, which sends a stop.
 */
import type { CommandQueue } from '../engine/commands';
import type { ActionReader } from '../engine/input/reader';
import type { Vec2 } from '../engine/input/state';
import type { GameCommand } from './commands';

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

  /** Pushes this frame's commands into `queue`. Returns the number of commands pushed. */
  translate(reader: ActionReader, queue: CommandQueue<GameCommand>): number {
    const v = reader.moveVector(this.moveScratch);
    const dx = clampAxis(v.x);
    const dy = clampAxis(v.y);
    if (dx === this.sentDx && dy === this.sentDy) return 0;
    this.sentDx = dx;
    this.sentDy = dy;
    queue.push({ type: 'move', dx, dy });
    return 1;
  }

  /**
   * A new entity became the controlled one (spawn, loaded save): it stands still, so the next frame
   * sends the held direction again. Standing still sends nothing, so commands issued by other
   * sources in the same tick (debug tools, replays) are not overridden by a stop.
   */
  resync(): void {
    this.sentDx = 0;
    this.sentDy = 0;
  }
}
