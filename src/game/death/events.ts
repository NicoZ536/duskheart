/**
 * Events of death and respawn (aggregated into `SimEventMap`) – feedback hooks of MASTERPROMPT §11.6 and
 * §2.7: the death screen ("Dein Licht ist erloschen."), the death clip, the grave in the world and on the
 * map, the respawn with its flash of light.
 *
 * - `playerDied`: the player's light went out (position, cause, grave, whether the world is lost).
 * - `playerRespawned`: back at a bed, a beacon or the start beach.
 * - `graveCreated` / `graveLooted` / `graveEmptied`: a grave with items appears at the place of death (map
 *   marker) / the player took items out of it / it is empty and gone.
 * - `respawnPointSet`: a bed became the respawn point.
 * Refused death commands raise `commandRejected` with a `DeathRejectReason`.
 */
import type { DeathPenalty } from '../../content/balance/death';
import type { Entity } from '../../engine/ecs';
import type { SleepPlaceKind } from '../sleep/formulas';

/** Where the player respawns (§11.6: bed, lit beacon, start beach). */
export const RESPAWN_SPOTS = ['bett', 'leuchtfeuer', 'strand'] as const;
/** One respawn spot. */
export type RespawnSpot = (typeof RESPAWN_SPOTS)[number];

/** Why a death command had no effect. */
export type DeathRejectReason =
  /** The player is not dead (nothing to respawn from). */
  | 'notDead'
  /** Unbarmherzig: the world is lost. */
  | 'permadeath'
  /** No bed set / no lit beacon. */
  | 'noRespawnPoint'
  /** No such grave. */
  | 'noGrave'
  /** The player is dead (graves are for the living). */
  | 'dead';

export interface DeathEventMap {
  /**
   * The light went out: where, why (`cause`), the grave (id and item stacks; `null` without one), the
   * penalty of the difficulty, and where the player can respawn (`spots`, empty when the world is lost).
   */
  playerDied: {
    readonly entity: Entity;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
    readonly cause: string;
    readonly grave: number | null;
    readonly graveItems: number;
    readonly penalty: DeathPenalty;
    readonly spots: readonly RespawnSpot[];
    readonly permadeath: boolean;
    readonly tick: number;
  };
  playerRespawned: { readonly entity: Entity; readonly x: number; readonly y: number; readonly layer: number; readonly at: RespawnSpot; readonly tick: number };
  graveCreated: { readonly grave: number; readonly x: number; readonly y: number; readonly layer: number; readonly items: number; readonly tick: number };
  graveLooted: { readonly grave: number; readonly taken: number; readonly remaining: number; readonly tick: number };
  graveEmptied: { readonly grave: number; readonly tick: number };
  respawnPointSet: { readonly x: number; readonly y: number; readonly layer: number; readonly kind: SleepPlaceKind; readonly tick: number };
}

/** Event names of `DeathEventMap`. */
export const DEATH_EVENT_TYPES = ['playerDied', 'playerRespawned', 'graveCreated', 'graveLooted', 'graveEmptied', 'respawnPointSet'] as const satisfies ReadonlyArray<keyof DeathEventMap>;

/** Sounds of death and respawn (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33). */
export const DEATH_SFX = {
  died: 'sfx_tod_erloschen',
  respawn: 'sfx_tod_wiederkehr',
  grave: 'sfx_tod_grab',
  loot: 'sfx_tod_grab_leeren',
  respawnPoint: 'sfx_tod_bett',
} as const;
