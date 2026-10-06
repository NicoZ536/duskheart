/**
 * What the composition root (src/main.tsx) gives the main menu (M7-50 … M7-58): the settings, the stored worlds
 * (list, delete, export, import – IndexedDB through src/save/**), the start of a world (the start request,
 * src/ui/menu/start.ts), the clipboard, the clock and the seed suggestion, the screens' sounds and the build version.
 * The menu components never touch IndexedDB, the file system or the clipboard themselves.
 */
import type { WorldSizePreset } from '../../content/balance';
import type { SettingsStore } from '../../engine/settings';
import type { StartRequest } from './start';

/** A stored world as the world selection lists it (the world's meta, src/save/store.ts `WorldMeta`). */
export interface WeltEintrag {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly groesse: WorldSizePreset;
  /** Game day of the newest save. */
  readonly tag: number;
  /** Simulation ticks played. */
  readonly ticks: number;
  /** When the newest save was written [ms since the epoch]. */
  readonly gespeichert: number;
}

/** A file the player picked to import. */
export interface ImportDatei {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The stored worlds. Every call may fail (blocked storage, a broken file): the menu shows the reason. */
export interface WeltQuelle {
  /** The worlds, newest save first. */
  liste(): Promise<WeltEintrag[]>;
  /** Removes the world and every slot of it. */
  loeschen(id: string): Promise<void>;
  /** Writes the world as a `.dhsave` file for the player (download); returns the file name. */
  exportieren(id: string): Promise<string>;
  /** Imports a `.dhsave` file as a new world; returns it. */
  importieren(datei: ImportDatei): Promise<WeltEintrag>;
}

export interface HauptmenueHooks {
  readonly settings: SettingsStore;
  readonly welten: WeltQuelle;
  /** Starts a world: writes the start request and boots the game with it. */
  starten(request: StartRequest): void;
  /** Copies `text` to the clipboard; false when the browser refuses (the menu then shows the text). */
  kopieren(text: string): Promise<boolean>;
  /** Wall clock [ms since the epoch] (new world ids). */
  jetzt(): number;
  /** A seed suggestion for a new world (0 … 2³² − 1). */
  zufallsSeed(): number;
  /** Plays the screens' sounds (the audio kernel's `play`). */
  readonly klang?: { play(cue: { readonly id: string }): boolean };
  /** Build version shown in the corner of the main menu. */
  readonly version: string;
  /** Why the world the tab was to start could not be loaded (shown in the main menu), or absent. */
  readonly meldung?: string;
}
