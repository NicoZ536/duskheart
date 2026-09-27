/**
 * Balance values of the fire simulation (MASTERPROMPT §16.2 "Brennbar", §16.8 "Gebäude nehmen nur durch
 * Schattenflut, Brände und Bosse Schaden", §10 "Feuer löschen", §3.3 "Welt-Tick … Feuer"; M4-28) – group
 * `BALANCE.fire` (src/content/balance.ts re-exports it). How well a build part burns is its material's
 * `flammability` (`BALANCE.building.materials`). Every value states its unit and the reason for it.
 *
 * A fire burns on a tile: every world second (1 Hz, §3.3) it takes hit points from the flammable parts there and a
 * standing tree, and after a delay it catches the flammable neighbours. Rain puts out what no roof covers.
 */

export const FIRE_BALANCE = {
  /**
   * Hit points a fire takes per second from a part of flammability 1 [HP/s]; a part loses its flammability's share
   * of it (rounded, at least 1). §16.2: a wood wall (300 HP) burns down in 30 s – about as long as a camp fire takes
   * to catch properly –, a palisade (150) in 15 s; timber frame "kaum (−70 %)" loses 3 HP/s and stands 150 s.
   */
  damagePerSecond: 10,
  /**
   * Delay until a burning tile catches a neighbour of flammability 1 [s], without wind. A wooden house is ablaze
   * within a minute or two; the delay grows with 1 / flammability, so timber frame (0,3) catches after 40 s – almost
   * never before the wood beside it has burned out (§16.2 "kaum (−70 %)").
   */
  spreadSeconds: 12,
  /** Delay factor towards a diagonal neighbour [factor]: the corners touch less than the sides. */
  diagonalFactor: 1.5,
  /**
   * Wind (§10 "Wind: … Feuerausbreitung"): the weather's wind strength (0 calm … 1 storm) in classes from these
   * thresholds [wind 0–1] – calm, breeze, wind, storm.
   */
  windClassFrom: [0.25, 0.5, 0.75],
  /**
   * How much each wind class speeds the spread downwind [factor per alignment]: the spread speed is multiplied by
   * 1 + boost × alignment (alignment 1 downwind, 0 across, −1 upwind). A storm makes a fire run downwind 2,5 × as
   * fast; upwind it creeps (at least `minWindFactor`).
   */
  windBoost: [0, 0.5, 1, 1.5],
  /** Slowest spread against the wind [factor]: embers still drift, a fire never stops dead against a storm. */
  minWindFactor: 0.25,
  /**
   * Precipitation of rain from which a fire under the open sky goes out [0–1]. §10 "Feuer löschen": rain (0,65) and
   * thunderstorms put fires out, a drizzle (0,25) does not; snow and ash fall do not douse.
   */
  rainFromPrecipitation: 0.3,
  /**
   * A standing tree (§16.2 "Ausbreitung auf … Bäume"): flammability [0–1] – green wood with sap catches and burns
   * worse than dry planks – and its burn hit points [HP]: about a wood wall's worth of trunk. A burned tree leaves
   * its stump, which grows back like a felled one.
   */
  tree: { flammability: 0.6, burnHp: 300 },
  /**
   * Light of a burning tile (the light source list, §12.1) [tiles, light level, 0–1, px, palette ref]: flames on a
   * wall light the surroundings like a camp fire's low flame; the colour of the camp fire.
   */
  light: { radiusTiles: 5, intensity: 1, flicker: 0.4, flameHeightPx: 12, farbe: 'feuer.3' },
  /** Heat of a burning tile (§11.2 "Feuer +15 °C im Kern") [°C, tiles]: a burning wall heats like a camp fire. */
  heat: { coreHeatC: 15, coreRadiusTiles: 1, radiusTiles: 4 },
};
