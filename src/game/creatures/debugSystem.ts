/**
 * The creatures' debug command of M7 (M7-128; MASTERPROMPT §31.6 "Command-Replay für Bug-Repros"; docs/SPIEL.md §30
 * "Debug") – system `creature-debug`, right after the console's `cheats`:
 *
 * - `creature.condition {creature, condition, seconds}` (debug console `condition <kreatur> <zustand> [sekunden]`,
 *   src/debug/creatureCommands.ts): the living creature of kind `creature` nearest the player takes condition `condition`
 *   for `seconds` – laid by `CreatureSystem.layCondition` as a hit would lay it, without the hit. For a condition no item of
 *   the content lays yet (the frost of M7-71: `kreatur-frost` lays it by this command instead of a blow of the combat system
 *   from nowhere, ADR-0173 "die Simulation nur lesen"). Refused (`commandRejected`, silent like every debug command): an
 *   unknown creature or condition, no player, none of the kind within `MAX_DEBUG_KILL_RADIUS` tiles.
 *
 * A command like every other – validated by `gameCommandSchema`, applied in the next tick, recorded for replays. The command
 * belongs to the creatures' module (src/game/creatures/commands.ts); the system is its own so the creatures of M6 keep their
 * commands (ADR-0208: a command added in M7 belongs to a system M7 adds). No state, no tick hooks, no save participant.
 */
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { CreatureSystem } from './system';

/** Id of the creatures' debug system. */
export const CREATURE_DEBUG_SYSTEM_ID = 'creature-debug';

/** Dependencies: the creatures the condition is laid on. */
export interface CreatureDebugSystemDeps {
  readonly creatures: Pick<CreatureSystem, 'layCondition'>;
}

export class CreatureDebugSystem implements SimSystem {
  readonly id = CREATURE_DEBUG_SYSTEM_ID;
  readonly commands: CommandHandlers;

  constructor(deps: CreatureDebugSystemDeps) {
    const creatures = deps.creatures;
    this.commands = {
      'creature.condition': (sim: Simulation, cmd, tick) => {
        const reason = creatures.layCondition(sim, cmd.creature, cmd.condition, cmd.seconds, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
    };
  }
}
