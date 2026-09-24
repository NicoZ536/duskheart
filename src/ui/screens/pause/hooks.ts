/**
 * What the composition root (src/main.tsx) gives the game's menus (M3-31): the settings store, the
 * pause of the simulation loop, saving, the way back to the title and the sounds of the screens. Every
 * hook is optional – a menu entry whose hook is missing is not shown (no entry that does nothing).
 */
import type { SettingsStore } from '../../../engine/settings';

/** Result of a manual save. */
export type SaveOutcome =
  | {
      readonly ok: true;
      /** Game day and minute of the saved state (shown in the confirmation). */
      readonly day: number;
      readonly minuteOfDay: number;
    }
  | { readonly ok: false; readonly error: string };

export interface MenuHooks {
  /** Settings of the game (the pause menu shows the settings that already take effect). */
  readonly settings?: SettingsStore;
  /** Pauses (true) or resumes (false) the simulation while a pausing screen is open. */
  readonly setPaused?: (paused: boolean) => void;
  /** Saves the running world (IndexedDB, docs/ARCHITEKTUR.md "Speichern"). */
  readonly save?: () => Promise<SaveOutcome>;
  /** Leaves the game for the title (after saving). */
  readonly toTitle?: () => void;
  /** Plays the screens' sounds (opening, closing, moving the focus, pressing; the audio kernel's `play`). */
  readonly klang?: { play(cue: { readonly id: string }): boolean };
}
