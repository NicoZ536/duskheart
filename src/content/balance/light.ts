/**
 * Balance values of light (MASTERPROMPT §12.1 Gameplay-Lichtkarte, §12.2 Lichtquellen, §10
 * "Wetterwirkung … Fackeln", §15.4 Brennwerte; M3-21, M3-22) – group `BALANCE.light`
 * (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 *
 * Time: burn times of torches are game time (§12.2 "4 Spielstunden"), fuel of fires real seconds
 * (§15.4 "Brennwerte (Echtsekunden)") – the simulated second of the 60-Hz tick, like every other rate.
 * Light levels are the unit of the canonical light model (src/engine/lightFalloff.ts): 1 = full
 * daylight on flat ground, the value the renderer's light target holds for a flat pixel.
 */

/** Placement of a torch in the world: on its own stake, or on the wall face north of its tile. */
export const TORCH_MOUNTS = ['stand', 'wand'] as const;
/** One torch mount. */
export type TorchMount = (typeof TORCH_MOUNTS)[number];

export const LIGHT_BALANCE = {
  map: {
    /** Light stages of the gameplay light map [0–1]. §12.1: "Dunkel < 0,15 · Dämmrig 0,15–0,4 · Hell 0,4–0,9 · Gleißend > 0,9". */
    stages: { darkBelow: 0.15, brightFrom: 0.4, glaringAbove: 0.9 },
    /** Ambient light below the surface [0–1]. §12.1: "Höhle 0" – only light sources light the caves. */
    caveAmbient: 0,
    /**
     * Largest light radius the occlusion cache expects [tiles]. §12.2: the largest source of the table
     * is the Lichtwacht with 14 tiles; a larger radius would still work, it only costs a bigger window.
     */
    maxRadiusTiles: 14,
    /**
     * Lights kept in the occlusion cache without a place of their own [entries]. The hand light moves
     * every few ticks; the last positions of a player walking back and forth stay cached, older ones are
     * recomputed (a few hundred ray steps each).
     */
    movingCacheEntries: 8,
  },
  torch: {
    /** Reach of a torch [tiles]. §12.2: "Fackel (Hand/Wand) 6". */
    radiusTiles: 6,
    /** Burn time of a fresh torch [game hours]. §12.2: "4 Spielstunden". */
    burnGameHours: 4,
    /** Burn speed in rain [factor]. §10: "Regen halbiert die Brenndauer". */
    rainBurnFactor: 2,
    /**
     * Precipitation from which a torch counts as rained on [0–1 of the weather's precipitation]. The
     * state "Regen" (0,65) and the thunderstorm (1) douse, drizzle (0,25) does not: a pitch-soaked head
     * shrugs off a fine mist, and §10 names the rain, not the drizzle.
     */
    rainFromPrecipitation: 0.5,
    /**
     * Precipitation from which rain counts as heavy [0–1]. §10 "Starkregen": only the thunderstorm
     * (1,0) and the peak of a blend into it; a plain rain (0,65) never reaches it.
     */
    heavyRainFromPrecipitation: 0.9,
    /** Chance of going out per minute of heavy rain [0–1]. §10: "Starkregen 5 % Erlöschchance pro Minute" (simulated minutes, like every rate). */
    heavyRainExtinguishChance: 0.05,
    /** The minute of that chance [s]. §10 "pro Minute": the heavy-rain seconds of a torch are counted and every full minute rolls once. */
    heavyRainRollSeconds: 60,
    /**
     * Brightness of a torch at its flame [light level]. At the bearer's feet (flame 14 px above them)
     * the light is 0,87 – bright, but not the glaring light (> 0,9) that drives off the Nachtmahr (§12.3)
     * and burns the Schattenbrut (§12.4, a power of the Lumen lantern, not of a torch); 0,5 two tiles
     * out, where the Schattenbrut stops (§12.4 "meidet Licht > 0,5"), darkness from four tiles on.
     */
    intensity: 0.95,
    /** Flicker of the flame [0–1]. A fire flickers by 0,2–0,35 (src/engine/lightFalloff.ts); a torch head is small and lively. */
    flicker: 0.25,
    /**
     * Height of the flame above the ground [px] by where the torch is: in the hand at shoulder height;
     * on its stake (`fackel_stand`, socket `licht` 19 px above the foot, ADR-0019); on a wall
     * (`fackel_wand`, socket 9 px above its anchor, hung `wallMountPx` above the floor).
     */
    flameHeightPx: { hand: 14, stand: 19, wand: 17 },
    /** Height of a wall torch's anchor above the floor [px]. Half a wall step (16 px, §9.1): the holder sits at chest height of the figure. */
    wallMountPx: 8,
    /** Offset of the hand light from the feet towards the facing [px]. The off hand holds the torch a little in front of the body. */
    handReachPx: 3,
  },
  campfire: {
    /** Reach of a camp fire [tiles]. §12.2: "Lagerfeuer 8". */
    radiusTiles: 8,
    /** Most fuel a camp fire holds [s]. §15.4: "Ein Lagerfeuer fasst höchstens 6 Minuten". */
    maxFuelSeconds: 360,
    /**
     * Brightness of a burning camp fire [light level]. Glaring (> 0,9) on its seats (1,5 tiles): the
     * fire is the place the Nachtmahr cannot follow into (§12.3 "bis du gleißendes Licht erreichst");
     * bright up to about four tiles, the dark begins at six.
     */
    intensity: 1.2,
    /** Flicker of the fire [0–1]. Logs flare and settle more than a torch head. */
    flicker: 0.3,
    /** Height of the flames above the ground [px]. Socket `licht` of `lagerfeuer`: 8–11 px above the anchor. */
    flameHeightPx: 10,
    /** Fuel below which the fire burns low [s]. The clip `schwach` warns half a minute before the fire goes out. */
    weakBelowSeconds: 30,
    /** Radius of a low fire [factor]. The circle visibly shrinks before the fuel runs out. */
    weakRadiusFactor: 0.75,
    /** Brightness of a low fire [factor]. */
    weakIntensityFactor: 0.7,
    /** Embers after the fuel ran out [s]. Fuel added while they glow rekindles the fire without a light; after them only ash is left. */
    emberSeconds: 90,
    /** Reach of the embers [tiles]. A glow that marks the fire place, too weak to hold off the dark (Dunkel beyond one tile). */
    emberRadiusTiles: 2,
    /** Brightness of the embers [light level]. */
    emberIntensity: 0.35,
    /** Flicker of the embers [0–1]. Embers pulse more than they flicker. */
    emberFlicker: 0.4,
  },
  offhand: {
    /** Radius of a light hanging on the belt [factor]. §12.2: "Mit Schild oder Zweihandwaffe hängt sie am Gürtel (−40 % Radius)". */
    beltRadiusFactor: 0.6,
  },
  placement: {
    /** How far from the player a light can be placed [tiles]. §16: "Baureichweite 8 Tiles" – a torch or a camp fire is set up like any building part. */
    reachTiles: 8,
  },
};
