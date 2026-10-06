/**
 * Events of the world settings (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * `worldSettingsChanged` – one per changed field of `world.setDifficulty` / `world.setSettings`, with the difficulty that
 * holds after the command (the chronicle notes it, the pause menu's world view refreshes). Refused commands raise
 * `commandRejected` with a `WorldSettingsRejectReason`.
 */
import type { Difficulty } from '../../content/balance/death';

/** The fields a world settings command changes (the German names of the commands). */
export const WORLD_SETTINGS_FIELDS = ['schwierigkeit', 'friedlich', 'hungerDurst', 'gegnerschaden', 'schattenflut', 'logistikRealismus', 'jahreszeitenLaenge'] as const;
/** One field of the world settings. */
export type WorldSettingsField = (typeof WORLD_SETTINGS_FIELDS)[number];

/** Why a world settings command had no effect. */
export type WorldSettingsRejectReason =
  /** Unbarmherzig: the difficulty and every setting that would soften it are locked (§29 "außer Unbarmherzig"). */
  'difficultyLocked';

export interface WorldSettingsEventMap {
  worldSettingsChanged: { readonly schwierigkeit: Difficulty; readonly feld: WorldSettingsField; readonly tick: number };
}

/** Event names of `WorldSettingsEventMap`. */
export const WORLD_SETTINGS_EVENT_TYPES = ['worldSettingsChanged'] as const satisfies ReadonlyArray<keyof WorldSettingsEventMap>;
