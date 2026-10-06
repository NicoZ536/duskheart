/**
 * Beacons at runtime (docs/SPIEL.md §22, ADR-0207; strand F, system `beacons`): out → ready (the biome's boss defeated) →
 * the ignition sequence → lit; the light wave and the healing of the world, the protection zone "Erleuchtet", the travel
 * point and the respawn. Not a chunk object: the beacon belongs to its system (position from the site's mark or slot).
 * Saved per beacon (participant `beacons`).
 */
import type { Layer } from '../../world/model/coords';

export const BEACON_STATES = ['erloschen', 'bereit', 'entzuendung', 'entzuendet'] as const;
export type BeaconStateId = (typeof BEACON_STATES)[number];
export interface BeaconState {
  readonly nummer: number;
  state: BeaconStateId;
  ignitionTick: number;
  litTick: number;
  visionShown: boolean;
}
export interface BeaconsApi {
  state(nummer: number): Readonly<BeaconState>;
  litCount(): number;
  /** How far the healing wave has reached region `region` at `tick` (0–1); the renderer reads it for corruption and grading. */
  healing(region: number, tick: number): number;
  /** Inside a lit beacon's protection zone ("Erleuchtet", spawn block, fear relief). */
  inZone(layer: Layer, tx: number, ty: number): boolean;
}
