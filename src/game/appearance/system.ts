/**
 * The player's appearance (MASTERPROMPT §26 "Charaktererstellung"; docs/SPIEL.md §26 "Aussehen", §16 system order 6; M7-52) –
 * system and save participant `appearance`, right after `player`.
 *
 * Holds the chosen appearance (`types.ts`); `appearance.set` is the character creation's choice, sent as the first command of a
 * new world. Once chosen it stays: a second `appearance.set` is refused (`appearanceLocked`) – a later mirror will change it
 * (§26 "danach nur über spätere Spiegel-Funktion"). A world from before M7 loads with the figure as drawn up to M6, not chosen.
 * No tick hooks: the appearance depends on neither time nor chunks; it changes nothing in the simulation (the collision
 * circle and the hitbox stay those of `mittel`, §26 – the shapes differ by a pixel at the shoulders).
 */
import type { SaveParticipant } from '../participant';
import type { CommandOfType } from '../commands';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { defaultAppearance } from './formulas';
import { APPEARANCE_MIGRATIONS, APPEARANCE_SAVE_VERSION, APPEARANCE_SYSTEM_ID, parseAppearance, serializeAppearance } from './state';
import type { Appearance, AppearanceApi } from './types';

export class AppearanceSystem implements SimSystem, AppearanceApi {
  readonly id = APPEARANCE_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private current: Appearance = defaultAppearance();

  constructor() {
    this.commands = { 'appearance.set': (sim, cmd, tick) => this.set(sim, cmd, tick) };
    this.save = {
      id: APPEARANCE_SYSTEM_ID,
      version: APPEARANCE_SAVE_VERSION,
      migrations: APPEARANCE_MIGRATIONS,
      serialize: () => serializeAppearance(this.current),
      deserialize: (data) => {
        this.current = parseAppearance(data);
      },
    };
  }

  get appearance(): Appearance {
    return this.current;
  }

  private set(sim: Simulation, cmd: CommandOfType<'appearance.set'>, tick: number): void {
    if (this.current.gewaehlt) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'appearanceLocked', tick });
      return;
    }
    this.current = { name: cmd.name, form: cmd.form, haut: cmd.haut, frisur: cmd.frisur, haar: cmd.haar, oberteil: cmd.oberteil, hose: cmd.hose, gewaehlt: true };
    sim.events.push('appearanceChanged', { tick });
  }
}
