/**
 * Events of the fire simulation (aggregated into `SimEventMap`) – the feedback of MASTERPROMPT §2.7 for §16.2, §16.8
 * and §10: the renderer sets flames on burning tiles and smoke where they went out, the audio plays the fire's sounds
 * and the roar of every burning tile (src/audio/baseSounds.ts, src/audio/loopSources.ts).
 * Damage to buildings comes as the building events (`partDamaged`, `partRemoved` with `zerstoert`).
 *
 * - `fireStarted`: a tile caught fire – from a torch (`fackel`), from a burning neighbour (`ausbreitung`), from a fire
 *   flask's burst (`brandflasche`, M6-08) or from the console (`debug`).
 * - `fireOut`: the fire of a tile went out – nothing left to burn (`abgebrannt`) or rain (`regen`).
 * - `treeBurned`: a standing tree burned down to its stump.
 * Fires caught up in a frozen chunk raise none of these (their building damage still reports).
 * Refused commands raise `commandRejected` with a `FireRejectReason` (texts `ui.fire.reject.<reason>`).
 */

/** Why a fire command had no effect: nothing flammable on the tile (`nothingToBurn`), or it burns already (`burning`). */
export const FIRE_REJECT_REASONS = ['nothingToBurn', 'burning'] as const;
/** One reason a fire command was refused. */
export type FireRejectReason = (typeof FIRE_REJECT_REASONS)[number];

/** What set a tile alight (`brandflasche`: a thrown fire flask burst there, M6-08). */
export type FireCause = 'fackel' | 'ausbreitung' | 'debug' | 'brandflasche';
/** Why a fire went out. */
export type FireOutReason = 'abgebrannt' | 'regen';

interface FireBase {
  readonly layer: number;
  readonly tx: number;
  readonly ty: number;
  /** Centre of the tile [world px]. */
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

export interface FireEventMap {
  fireStarted: FireBase & { readonly cause: FireCause };
  fireOut: FireBase & { readonly reason: FireOutReason };
  treeBurned: FireBase;
}

/** Event names of `FireEventMap`. */
export const FIRE_EVENT_TYPES = ['fireStarted', 'fireOut', 'treeBurned'] as const satisfies ReadonlyArray<keyof FireEventMap>;
