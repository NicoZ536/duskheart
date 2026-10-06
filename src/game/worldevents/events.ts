/**
 * Events of the world events (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen", §18) – the
 * feedback of MASTERPROMPT §2.7 for §10: the HUD shows the announcement with the time left and the running event, the music
 * plays its stinger (strand A, `worldEventAnnounced`), the chronicle notes the start (G), the renderer blends the sky.
 *
 * - `worldEventAnnounced`: an event is coming – `startTick`/`endTick` of its planned run.
 * - `worldEventStarted`: it runs; `worldEventEnded`: it is over (`grund`: `zeit` its time ran out, `abgesagt` its
 *   condition broke off – the storm moved on, the sky clouded over –, `debug` the console ended it).
 * - `lightningStruck`: a bolt hit (`x`, `y` [px]) – `ziel` what it struck (`baum`, `bauteil`, `metall`, `boden`),
 *   `entzuendet` whether it set a fire.
 * - `meteorImpact`: the Lumen rain's meteorite came down at (`x`, `y`) [px]; `lumenShardFell`: a glowing shard landed there.
 * Refused commands raise `commandRejected` with a `WorldEventRejectReason` (texts `ui.ereignis.reject.<reason>`).
 */

/**
 * Why a world event command had no effect: `unknownEvent` – no such event, or one that does not run yet (`umgesetzt` names
 * its task); `bigEventRunning` – another big event runs (at most one at a time, §18); `notRunning` – nothing to end;
 * `noPlayer` – a strike needs the player's surface (debug `lightning.strike` near the player).
 */
export const WORLD_EVENT_REJECT_REASONS = ['unknownEvent', 'bigEventRunning', 'notRunning', 'noPlayer'] as const;
/** One reason a world event command was refused. */
export type WorldEventRejectReason = (typeof WORLD_EVENT_REJECT_REASONS)[number];

/** Why a world event ended. */
export type WorldEventEndReason = 'zeit' | 'abgesagt' | 'debug';
/** What a lightning bolt struck. */
export type LightningTarget = 'baum' | 'bauteil' | 'metall' | 'boden';

export interface WorldEventEventMap {
  worldEventAnnounced: { readonly event: string; readonly startTick: number; readonly endTick: number; readonly tick: number };
  worldEventStarted: { readonly event: string; readonly startTick: number; readonly endTick: number; readonly tick: number };
  worldEventEnded: { readonly event: string; readonly endTick: number; readonly grund: WorldEventEndReason; readonly tick: number };
  lightningStruck: { readonly layer: number; readonly x: number; readonly y: number; readonly ziel: LightningTarget; readonly entzuendet: boolean; readonly tick: number };
  meteorImpact: { readonly layer: number; readonly x: number; readonly y: number; readonly tick: number };
  lumenShardFell: { readonly layer: number; readonly x: number; readonly y: number; readonly tick: number };
}

/** Event names of `WorldEventEventMap`. */
export const WORLD_EVENT_EVENT_TYPES = [
  'worldEventAnnounced',
  'worldEventStarted',
  'worldEventEnded',
  'lightningStruck',
  'meteorImpact',
  'lumenShardFell',
] as const satisfies ReadonlyArray<keyof WorldEventEventMap>;

/** Sounds of the world events (src/content/sfx/ereignisse.ts; src/audio/eventMap.ts). */
export const WORLD_EVENT_SFX = {
  announced: 'sfx_ereignis_ankuendigung',
  strike: 'sfx_blitz_einschlag',
  meteor: 'sfx_meteor_einschlag',
  shard: 'sfx_lumen_scherbe',
} as const;
