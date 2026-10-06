/**
 * Pure rules of the beacons (MASTERPROMPT §4.1 "die Welt heilt sichtbar", §8; docs/SPIEL.md §22 "Wirkungen: Lichtwelle (Radius
 * wächst ab `litTick` mit `waveTilesPerSecond`), Verderbnis weicht in den Regionen des Bioms, die die Welle erreicht …, globale
 * Heilungsstufe je Anzahl entzündeter Leuchtfeuer 0–6 (`BEACON_HEALING[n]`)"; M7-35): the wave's radius, how far it healed a
 * point, the corruption around a dark site, the healing step of the world.
 */
import { BALANCE } from '../../content/balance';
import type { BeaconHealingStep } from '../../content/balance/beacons';

const BE = BALANCE.beacons;
const TICK_HZ = BALANCE.time.tickHz;

/** The healing steps 0–6 (`BEACON_HEALING`): saturation and warmth rise, the corruption left falls with every lit beacon. */
export const BEACON_HEALING: readonly BeaconHealingStep[] = BE.healing;

/** The healing step of `lit` lit beacons (clamped to 0–6). */
export function healingStep(lit: number): BeaconHealingStep {
  const n = Math.max(0, Math.min(BEACON_HEALING.length - 1, Math.floor(lit)));
  return BEACON_HEALING[n] as BeaconHealingStep;
}

/** Radius of the light wave of a beacon lit at `litTick`, at `tick` [tiles] (0 before). */
export function waveRadiusTiles(litTick: number, tick: number): number {
  return tick <= litTick ? 0 : ((tick - litTick) / TICK_HZ) * BE.waveTilesPerSecond;
}

/** How far the wave of radius `waveTiles` healed a point `distanceTiles` from its beacon (0–1; the front is soft). */
export function healedBy(waveTiles: number, distanceTiles: number): number {
  const h = (waveTiles - distanceTiles) / BE.waveFrontTiles;
  return h <= 0 ? 0 : h >= 1 ? 1 : h;
}

/** Corruption of a point `distanceTiles` from a dark beacon site (0–1): strongest at the site, gone at the radius. */
export function siteCorruption(distanceTiles: number): number {
  const r = BE.corruption.radiusTiles;
  return distanceTiles >= r ? 0 : BE.corruption.strength * (1 - distanceTiles / r);
}
