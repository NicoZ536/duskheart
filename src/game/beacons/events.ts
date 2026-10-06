/**
 * Events of the beacons (aggregated into `SimEventMap`; docs/SPIEL.md §17, §22): the music plays the beacon's stinger, the
 * renderer the spark climbing the beacon, the flame, the light wave and the particle storm, the UI the vision.
 * - `beaconIgnitionStarted {beacon, biome}`: E lit the beacon – the ignition sequence runs (`BALANCE.beacons.ignitionSeconds`).
 * - `beaconLit {beacon, biome}`: the flame stands – the region heals, the zone protects, unlocks and the ember core arrive.
 * Refused commands raise `commandRejected` with a `BeaconRejectReason` (texts `ui.leuchtfeuer.reject.<reason>`).
 */

/**
 * Why a beacon command had no effect: `unknownBeacon`; `noSite` – the world has no site for it; `noPlayer`, `dead`;
 * `outOfReach`; `notReady` – its boss still lives (or its time has not come, a later task); `bossAwake` – a fight is on;
 * `lit` – it burns already (or is being lit); `notLit` – the vision of a beacon that does not burn.
 */
export const BEACON_REJECT_REASONS = ['unknownBeacon', 'noSite', 'noPlayer', 'dead', 'outOfReach', 'notReady', 'bossAwake', 'lit', 'notLit'] as const;
/** One reason a beacon command was refused. */
export type BeaconRejectReason = (typeof BEACON_REJECT_REASONS)[number];

export interface BeaconEventMap {
  beaconIgnitionStarted: { readonly beacon: number; readonly biome: string; readonly x: number; readonly y: number; readonly tick: number };
  beaconLit: { readonly beacon: number; readonly biome: string; readonly x: number; readonly y: number; readonly tick: number };
}

/** Event names of `BeaconEventMap`. */
export const BEACON_EVENT_TYPES = ['beaconIgnitionStarted', 'beaconLit'] as const satisfies ReadonlyArray<keyof BeaconEventMap>;

/** Sounds of the beacon (src/content/sfx/leuchtfeuer.ts); strand A's stinger `leuchtfeuer` plays over `lit`. */
export const BEACON_SFX = {
  ignite: 'sfx_leuchtfeuer_entzuenden',
  lit: 'sfx_leuchtfeuer_brennt',
} as const;
