/**
 * Balance values of the beacons (MASTERPROMPT §8 "Entzünden → die Region heilt sichtbar, Schutzzone, Schnellreisepunkt,
 * neues Wissen, Story-Vision", §4.1 "Farben, die mit jedem entzündeten Leuchtfeuer lebendiger werden – die Welt heilt
 * sichtbar", §11.6, §23.1; docs/SPIEL.md §22; M7-35, M7-36) – group `BALANCE.beacons` (src/content/balance.ts re-exports
 * it). The beacons themselves are content (src/content/beacons/). Every value states its unit and the reason for it.
 */

/** Steps of the global healing (0–6 lit beacons): grade and corruption of the whole world. */
export interface BeaconHealingStep {
  /** Saturation of the grade [factor]. */
  readonly saettigung: number;
  /** Warmth of the grade [grading temperature]. */
  readonly waerme: number;
  /** Corruption left of a biome's base corruption [factor]. */
  readonly verderbnis: number;
}

export const BEACON_BALANCE = {
  /**
   * Length of the ignition sequence [s]: from `beacon.ignite` until the flame stands (`beaconLit`). Long enough for the
   * stinger, the spark climbing the beacon and the flame catching to be seen (§8 "Entzünden"), short enough not to bore.
   */
  ignitionSeconds: 6,
  /**
   * Speed of the healing wave [tiles/s]: the light runs out from the lit beacon over its biome (§8 "die Region heilt
   * sichtbar"). 12 tiles a second crosses a Grünhain region (≈ 180 tiles) in a quarter of a minute – a visible wave.
   */
  waveTilesPerSecond: 12,
  /** Width of the wave's front [tiles]: healing rises from 0 to 1 over this band, the edge of the light is soft. */
  waveFrontTiles: 24,
  /**
   * Radius of the protection zone "Erleuchtet" around a lit beacon [tiles]. §8 "Schutzzone": larger than a fresh hearth's
   * base (12, §16.5) – the beacon guards the whole site, its plaza and the arena's approach.
   */
  zoneTiles: 24,
  /** Reach of E at a beacon [tiles], from its centre. The beacon is 3 × 3 tiles: one step beyond its foot. */
  reachTiles: 3,
  /**
   * Corruption around a beacon that is not lit yet [0–1 at its site, radius tiles]: the site and the arena beside it lie in
   * a corrupted stretch (§12.3 "Verderbnisgebiet", ART.md §5 "Verderbnis … weicht mit jedem Leuchtfeuer") that fades with
   * the distance and gives way to the wave once the beacon burns.
   */
  corruption: { strength: 0.7, radiusTiles: 48 },
  /**
   * The world's healing by number of lit beacons, index 0–6 (docs/SPIEL.md §22 `BEACON_HEALING[n]`): saturation [factor] and
   * warmth [grading temperature] of the grade rise, the corruption left [factor] falls – monotone (heilungskurve.test.ts).
   * 0 is the world of M6 unchanged (§4.1 "gedämpft-satt"), 6 the healed world before the finale.
   */
  healing: [
    { saettigung: 1, waerme: 0, verderbnis: 1 },
    { saettigung: 1.05, waerme: 0.02, verderbnis: 0.84 },
    { saettigung: 1.09, waerme: 0.04, verderbnis: 0.68 },
    { saettigung: 1.12, waerme: 0.05, verderbnis: 0.52 },
    { saettigung: 1.15, waerme: 0.06, verderbnis: 0.36 },
    { saettigung: 1.18, waerme: 0.07, verderbnis: 0.2 },
    { saettigung: 1.2, waerme: 0.08, verderbnis: 0.05 },
  ] as readonly BeaconHealingStep[],
  /**
   * Light of a lit beacon: radius [tiles], brightness [light level], flicker [0–1], flame height above its foot [px], colour
   * [palette ref]. The brightest light of the world before the Lichtwacht (§12.2 table: up to 14 tiles) – glaring at its
   * foot, it drives the Nachtmahr off (§12.3) and lights the whole site.
   */
  light: { radiusTiles: 14, intensity: 1.4, flicker: 0.15, flameHeightPx: 34, farbe: 'feuer.4' },
  /** Light of a beacon ready to be lit (its boss defeated): a faint ember in the bowl [tiles, light level, 0–1, px, palette ref]. */
  emberLight: { radiusTiles: 3, intensity: 0.45, flicker: 0.35, flameHeightPx: 30, farbe: 'feuer.2' },
  /** Stand-off of the respawn spot in front of a lit beacon [tiles], south of its foot (§11.6 "an einem entzündeten Leuchtfeuer"). */
  respawnOffsetTiles: 3,
};
