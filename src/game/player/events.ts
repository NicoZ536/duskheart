/**
 * Simulation events of the player's body (MASTERPROMPT §2.7: every action has visual and acoustic
 * feedback). The presentation maps them to sprite clips, particles and the sounds of `PLAYER_SFX`.
 *
 * - `playerSpawned`: the player entity appeared (start beach, debug spawn).
 * - `playerStateChanged`: the movement mode changed (idle, walk, sprint, sneak, roll, swim, jump, climb) –
 *   sprint start, sneaking, splash into deep water, climbing out.
 * - `playerRolled`: a dodge roll started in direction (dx, dy).
 * - `playerLanded`: a jump down a cliff (or a step off a ledge) ended after `levels` height levels; with
 *   fall damage, a broken bone, or softly in deep water.
 * - `playerClimbed`: the player climbed `levels` up a placed ladder.
 * - `playerStep`: a footstep (or swim stroke) every `stepLengthTiles`, with the ground under the feet
 *   (terrain id, water depth) and the noise of the movement mode (§11.4, for creature perception).
 * - Failed player commands raise `commandRejected` with a `PlayerRejectReason`.
 */
import type { PlayerMoveState } from '../../content/balance/player';
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';

/** Why a player command had no effect. */
export type PlayerRejectReason =
  /** There is no player (spawn one first). */
  | 'noPlayer'
  /** `player.spawn` while the player exists. */
  | 'playerExists'
  /** Not enough stamina (a roll needs its full cost). */
  | 'noStamina'
  /** The body is busy (rolling, jumping, climbing) or cannot do it here (rolling while swimming). */
  | 'busy'
  /** No free tile to spawn on near the requested spot. */
  | 'noFreeTile';

/** Water under the player's feet. */
export type WaterContact = 'none' | 'shallow' | 'deep';

export interface PlayerEventMap {
  playerSpawned: { readonly entity: Entity; readonly x: number; readonly y: number; readonly layer: Layer; readonly tick: number };
  playerStateChanged: { readonly entity: Entity; readonly state: PlayerMoveState; readonly previous: PlayerMoveState; readonly tick: number };
  playerRolled: { readonly entity: Entity; readonly dx: number; readonly dy: number; readonly tick: number };
  playerLanded: { readonly entity: Entity; readonly levels: number; readonly damage: number; readonly fracture: boolean; readonly water: boolean; readonly tick: number };
  playerClimbed: { readonly entity: Entity; readonly levels: number; readonly tick: number };
  playerStep: { readonly entity: Entity; readonly terrain: string; readonly water: WaterContact; readonly noise: number; readonly tick: number };
}

/** Event names of `PlayerEventMap`. */
export const PLAYER_EVENT_TYPES = ['playerSpawned', 'playerStateChanged', 'playerRolled', 'playerLanded', 'playerClimbed', 'playerStep'] as const satisfies ReadonlyArray<keyof PlayerEventMap>;

/**
 * Sound ids of the player's actions (`sfx_<bereich>_<name>`, docs/SPIEL.md §5) for the audio kernel
 * (M3-33, "jede Spieleraktion aus M3 hat Sound"). Footsteps pick `sfx_schritt_<boden>` from the terrain
 * id of `playerStep` (grass, earth, stone, sand, water groups are the audio kernel's).
 */
export const PLAYER_SFX = {
  spawn: 'sfx_spieler_erwachen',
  sprintStart: 'sfx_spieler_sprint',
  sneakStart: 'sfx_spieler_schleichen',
  roll: 'sfx_spieler_rolle',
  jump: 'sfx_spieler_sprung',
  land: 'sfx_spieler_landung',
  fracture: 'sfx_spieler_knochenbruch',
  splash: 'sfx_wasser_platsch',
  swimStroke: 'sfx_wasser_schwimmzug',
  climb: 'sfx_spieler_klettern',
  footstepWater: 'sfx_schritt_wasser',
} as const;
