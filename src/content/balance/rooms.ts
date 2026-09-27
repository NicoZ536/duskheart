/**
 * Balance values of rooms (MASTERPROMPT §16.4 "Räume"; M4-15 … M4-18) – group `BALANCE.rooms`
 * (src/content/balance.ts re-exports it). The room types themselves are content (src/content/roomTypes.ts).
 * Every value states its unit and the reason for it.
 *
 * - Detection: a flood fill from a tile through everything that does not close a room; closed by walls,
 *   doors, gates and windows (and by rock and cliff faces around them); at most 400 tiles; an interior is a
 *   room at least 90 % under a roof.
 * - Climate: an interior pulls the outside air towards 18 °C by the insulation of its walls and roof, heat
 *   and cold sources inside add to it (§16.4 "Heizquellen (Kamin, Ofen) und Kühlquellen (Eis) wirken").
 * - Comfort 0–20 (§16.4 "Behaglichkeit 0–20 aus einzigartigen Möbelkategorien, Licht, Wärme, Raumgröße und
 *   Deko").
 */

export const ROOM_BALANCE = {
  /** Largest room [tiles]. §16.4: "Flood-Fill …; ≤ 400 Tiles". */
  maxTiles: 400,
  /**
   * Most tiles the region cache keeps before it lets go of the outdoor fills [tiles] (§30: memory stays bounded while
   * the player explores – every outdoor fill caches up to 401 tiles and was never released, M4-Gate). 65 536 = the
   * tiles of 8 × 8 chunks, more than the camera's load ring; rooms (bounded by buildings) stay cached.
   */
  cacheTiles: 65_536,
  /** Share of a room's tiles under a roof from which it is an interior [fraction]. §16.4: "Innenraum = mindestens 90 % überdacht". */
  interiorRoofShare: 0.9,
  climate: {
    /** Temperature an interior tends to [°C]. §16.4: "Temperatur nach Dämmwert der Wände Richtung 18 °C gedämpft". */
    targetC: 18,
    /**
     * Weight of the walls in the insulation of a room [fraction]; the roof has the rest. Walls are the larger
     * surface of a small house and the wind hits them; the roof keeps the night sky's cold out.
     */
    wallWeight: 0.6,
    /**
     * Insulation of natural walls around a room – rock and cliff faces [0–1]: a room dug into rock keeps the
     * warmth of the earth nearly like clay (§9.3 "Höhlen nahe Basiswert").
     */
    naturalWallInsulation: 0.85,
    /**
     * Share of a source's core heat that warms the air of a room [fraction] (§11.2: a fire is +15 °C in its
     * core): a fire in a small room warms it by half its core heat.
     */
    heatShare: 0.5,
    /**
     * Room size up to which a source warms the whole room fully [tiles]; a larger room gets the share
     * `referenceTiles / size` – a fire heats a hut, not a hall.
     */
    referenceTiles: 16,
  },
  comfort: {
    /** Highest comfort [points]. §16.4: "Behaglichkeit 0–20". */
    max: 20,
    /** Points per unique furniture category in the room [points]. §16.4: "aus einzigartigen Möbelkategorien". */
    perCategory: 1,
    /** Most points from unique categories [points]: eight kinds of furniture make a home, more is clutter. */
    maxCategories: 8,
    /** Points for light in the room [points] by number of lights: one lamp, two or more (§16.4 "Licht"). */
    light: [2, 3] as readonly number[],
    /**
     * Points for warmth [points]: room temperature inside the snug band, or at least in the tolerable band
     * (§16.4 "Wärme"; the snug band is the §11.2 comfort band of a lightly dressed player, 18–26 °C, a little
     * cooler: a room is cosy before it is warm).
     */
    warmth: { snug: 3, snugLowC: 16, snugHighC: 24, tolerable: 1, tolerableLowC: 12, tolerableHighC: 28 },
    /**
     * Points by room size [points] (§16.4 "Raumgröße"): from `tiles` tiles on, `points` points – a cramped hut
     * gives nothing, a room to move in more; the largest step at 24 tiles (a 6 × 4 room).
     */
    size: [
      { tiles: 6, points: 1 },
      { tiles: 12, points: 2 },
      { tiles: 24, points: 3 },
    ] as ReadonlyArray<{ readonly tiles: number; readonly points: number }>,
    /** Points per decoration (pictures, plants, carpets, trophies …) [points]. §16.4: "Deko". */
    perDecoration: 1,
    /** Most points from decoration [points]. */
    maxDecoration: 4,
    /** Comfort from which a room gives "Behaglich" [points]: a room with a few kinds of furniture, light and warmth. */
    cosyFrom: 6,
    /**
     * Duration the room renews "Behaglich" with every world tick [s]: a few seconds, so the condition ends soon
     * after the player leaves (src/content/conditions.ts "Hält an, solange du drinnen bleibst").
     */
    cosySeconds: 5,
  },
  effects: {
    /**
     * Crafting tempo in a workshop [fraction added to the tempo]. §16.4: "Werkstatt (≥ 3 Stationen: +15 %
     * Tempo)" – added to the Handwerk bonus (§23.2), so both speed up the same crafting time.
     */
    workshopTempo: 0.15,
    /** Comfort of a trophy hall [points]. §16.4: "Trophäenhalle (Behaglichkeit)": trophies on display make the hall a place to be proud of. */
    trophyHallComfort: 3,
  },
};
