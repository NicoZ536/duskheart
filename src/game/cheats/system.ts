/**
 * Cheats of the debug console (MASTERPROMPT §31.6 "god, noclip, unlock"; M3-35), the simulation side of the
 * console's `god`, `noclip` and `unlock` (src/debug/playerCommands.ts):
 *
 * - `debug.god {on}` and `debug.noclip {on}` flip the switches of `DebugCheats` (src/game/cheats/state.ts),
 *   which the systems they change read: no damage to the player, movement through everything.
 * - `debug.unlock {skill?}` – the Grundform of M3: every skill (or `skill`) jumps to its highest level, its
 *   perk choices open (`SkillsSystem.unlock`, the same level-up and perk events as learning). Recipes and
 *   blueprints join once the game unlocks them (recipe discovery, M4-01). An unknown skill is refused
 *   (`unknownSkill`).
 *
 * No tick hooks. Save participant `cheats`: the switches – a game saved in god mode loads in god mode, so
 * the state after loading is the state before saving (docs/ARCHITEKTUR.md "Speichern").
 */
import { z } from 'zod';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem } from '../sim';
import type { SkillsSystem } from '../skills/system';
import type { DebugCheats } from './state';

/** Id of the cheat system and its save participant. */
export const CHEATS_SYSTEM_ID = 'cheats';
/** Data version of the `cheats` participant. */
export const CHEATS_SAVE_VERSION = 1;

const cheatsSnapshotSchema = z.object({ god: z.boolean(), noclip: z.boolean() }).strict();

/** Dependencies of the cheat system. */
export interface CheatsSystemDeps {
  /** The switches (shared with the systems that read them). */
  readonly cheats: DebugCheats;
  readonly skills: SkillsSystem;
}

export class CheatsSystem implements SimSystem {
  readonly id = CHEATS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The switches (read-only for callers; the commands flip them). */
  readonly cheats: Readonly<DebugCheats>;

  constructor(deps: CheatsSystemDeps) {
    const cheats = deps.cheats;
    const skills = deps.skills;
    this.cheats = cheats;
    this.commands = {
      'debug.god': (_sim, cmd) => {
        cheats.god = cmd.on;
      },
      'debug.noclip': (_sim, cmd) => {
        cheats.noclip = cmd.on;
      },
      'debug.unlock': (sim, cmd, tick) => {
        if (cmd.skill === undefined) {
          for (const def of skills.defs) skills.unlock(sim, def.id);
        } else if (skills.defs.some((d) => d.id === cmd.skill)) skills.unlock(sim, cmd.skill);
        else sim.events.push('commandRejected', { type: cmd.type, reason: 'unknownSkill', tick });
      },
    };
    this.save = {
      id: CHEATS_SYSTEM_ID,
      version: CHEATS_SAVE_VERSION,
      serialize: () => ({ god: cheats.god, noclip: cheats.noclip }),
      deserialize: (data) => {
        const parsed = cheatsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`cheats snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        cheats.god = parsed.data.god;
        cheats.noclip = parsed.data.noclip;
      },
    };
  }
}
