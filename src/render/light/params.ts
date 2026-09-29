/**
 * Tuning of the light strand of M5 (MASTERPROMPT §6.1 passes 3–6, §6.2 "Nacht", §6.3): occluder mask and
 * distance fields, sun and moon shadows, cloud shadows and canopy dapple, ambient occlusion, soft point-light
 * shadows. One table, read by the passes (as `#define`s) and by their CPU mirrors (unit tests), so GLSL and
 * TypeScript share one set of numbers.
 *
 * Coordinates are world pixels (x east, y south), heights pixels above the ground of level 0 (a level is
 * `WAND_PX_JE_STUFE` = 16 px, the G-buffer's height range 128 px).
 */

/** Occluder mask and signed distance fields (§6.1 pass 3). */
export const SDF = {
  /**
   * Margin of the occluder, SDF and sun-shadow targets around the frame [px]: occluders and shadow casters
   * just outside the picture still shadow what is inside (a wall beside the view, a tree below it).
   */
  marginPx: 32,
  /**
   * Largest first step of the jump flood [px]: seeds reach 2 · step − 1 px, farther pixels keep the cap
   * `maxDistancePx`. Soft shadows and ambient occlusion only need the near field, and every halving saves a
   * full-screen pass (SwiftShader, integrated GPUs).
   */
  firstStepPx: 32,
  /** Distance written where no seed was found within reach [px] (the jump flood's reach). */
  maxDistancePx: 63,
  /** Mask height above the terrain that makes an object pixel a seed [px] (half a pixel of rounding in 8 bits). */
  seedEpsilonPx: 0.5,
} as const;

/** Occluder classes of the mask (how a point light's ray treats them, §12.1 vs. presentation). */
export const OCCLUDER_CLASS = {
  /** Trunks, rocks, furniture, stations, fences: block a ray below their top; shadows of presentation only. */
  decor: 0,
  /** Walls, closed doors, solid rock: block every ray – like the gameplay light map's tile raycast. */
  structural: 1,
  /** A raised terrain level (plateau and the cliff face below its edge): blocks a light standing lower (§12.1). */
  terrain: 2,
  /**
   * A roof over the build grid: no ray blocker, a cover – a light under it does not reach the outside of roofs and
   * crowns, a light in the open reaches them over the walls (they lie above the walls).
   */
  roof: 3,
  /**
   * An opening in a wall – a window, an open door or gate: no ray blocker (glass and doorways let the light through,
   * like the gameplay light map), a mark for the light map comparison – the map walks whole tiles through a one-tile
   * opening, the renderer traces the pixel's ray, so light through it is not comparable (M5-28).
   */
  opening: 4,
} as const;
export type OccluderClass = (typeof OCCLUDER_CLASS)[keyof typeof OCCLUDER_CLASS];

/** Top of structural occluders [px]: above every light and receiver (the G-buffer's height range). */
export const STRUCTURAL_TOP_PX = 127;
/** Value of the mask's structural channel under a roof (below ½: no wall, no seed of the distance field). */
export const ROOF_MARK = 0.25;
/**
 * Value of the structural channel in a wall's opening (window, open door or gate): between the roof mark and ½ – no
 * wall, no seed; under a roof the opening's mark wins (MAX), and it still reads as roofed (above half the roof mark).
 */
export const OPENING_MARK = 0.375;

/** Soft point-light shadows by sphere tracing through the SDF (§6.1 pass 5, §6.3 "harte/weiche SDF-Schatten"). */
export const POINT_SHADOW = {
  /** Most march steps per pixel and light (a 128-px radius crosses open ground in a few SDF steps). */
  maxSteps: 40,
  /** Smallest step [px]: inside and right beside an occluder the march advances pixel by pixel. */
  minStepPx: 1,
  /**
   * Penumbra sharpness k of res = min(k · d / t) (Quilez): the larger, the harder. 8 gives a penumbra of about
   * an eighth of the occluder's distance – soft at the far end of a long wall shadow, crisp at its foot.
   */
  softness: 8,
  /**
   * Where a ray starts from a receiver [px]: off its own texel in every direction (a diagonal texel is 1.41 px across).
   * A pixel at the foot of a cliff face or on the rim of a raised level has its ground point in a rim texel of the mask
   * – a seed of the field – and would otherwise shadow itself.
   */
  startPx: 1.5,
  /**
   * How far in front of its own footprint a pixel of an occluder may stand and still leave it first [px]: its relief
   * pushes the reconstructed ground point south of the anchor line (a table's top by several pixels), so a lamp
   * behind it still lights its top. Walls are no decor: a wall met on the way stops the light.
   */
  ownGracePx: 10,
  /** The last stretch before the light that is never tested [px]: the light's own housing (lamp, fireplace, kiln). */
  lightClearancePx: 5,
  /** Height tolerance of the ray against an occluder's top [px] (8-bit heights, half-pixel rounding). */
  heightEpsilonPx: 1,
} as const;

/** The light map comparison (§12.1 "Ein Debug-Overlay vergleicht Gameplay-Licht mit gerendertem Licht", M5-28). */
export const LIGHTMAP_COMPARISON = {
  /**
   * Distance from a wall or cliff within which a ground pixel is not comparable [px]: the gameplay map blends the
   * visibility of the tile centres around a point (a tile each way), the renderer traces the pixel's own ray.
   */
  nearStructuralPx: 16,
  /** Step of the probes along eight directions that find a wall behind nearer decor [px] (a wall band is 6 px). */
  probePx: 4,
  /** Uncertainty mark (light level × share) above which the comparison skips a pixel. */
  unsure: 0.01,
  /**
   * Largest difference between a pixel's G-buffer height and the ground of its mask texel for it to be ground [px]:
   * under half a step of the 8-bit height (0.5 px) – flat ground of a raised level stands exactly its 16 px per level
   * high, a sprite's foot or a cliff face drawn over it does not.
   */
  groundPx: 0.25,
  /** Step of the walk along a receiver's ray that looks for a wall's opening [px] (a window's band is 6 px deep). */
  openingStepPx: 2,
} as const;

/** Ambient occlusion from the SDF (§6.1 pass 5 "Umgebungslicht … × SDF-AO"). */
export const SDF_AO = {
  /** Distance over which an occluder darkens the ambient light around its foot [px]. */
  radiusPx: 10,
  /** Ambient kept right at an occluder's foot (1 − strength). */
  strength: 0.45,
  /** Height above its own ground a receiver is out of an occluder's AO [px] (the foot shadow is a contact shadow). */
  reachHeightPx: 14,
} as const;

/** Sun and moon silhouette shadows (§6.1 pass 4). */
export const SUN_SHADOW = {
  /** Longest shadow the renderer draws [length per unit caster height]; the calendar allows 3 at the horizon. */
  maxLength: 2.4,
  /** Penumbra of a sun shadow: radius of the filter at a caster 16 px above the receiver [px]. */
  penumbraPer16Px: 0.75,
  /** Largest penumbra radius [px]. */
  maxPenumbraPx: 2.5,
  /** Height tolerance of a receiver against the stored caster height [px]. */
  heightEpsilonPx: 1.5,
  /** Strength of the moon's shadows is the calendar's (`moonShadowStrength` × phase); daylight shadows at full sun: 1. */
} as const;

/**
 * Sun casters of the build grid (M5-02, M5-05; `light/sunCasters.ts`): heights above the ground a house stands on
 * [px]. The parts' sprites do not cast – the grid does, so the shadow is the same inside and outside the house.
 */
export const BUILDING_SUN = {
  /** Top of walls, closed doors and gates, windows (one level of wall: `_bau.ts` "16 px sichtbare Wand"). */
  wallTopPx: 16,
  /** Slab of a roof: from the wall top up to the ridge. */
  roofBottomPx: 16,
  roofTopPx: 26,
  /** Overhang of a roof's open side beyond the wall band (`_bau.ts`: "Überstand 2 px über dem Wandband"). */
  eavePx: 2,
  /**
   * Share of the sky light that reaches what stands under a roof (the roof hides most of the sky; the rest comes in
   * through windows and doors): rooms are dimmer than the open by day, the sun through a window stands out.
   */
  roofSkyShare: 0.5,
} as const;

/** Glass in the sun's path (M5-05: windows, glass roofs). */
export const GLASS = {
  /** Share of the sun a pane lets through at its brightest channel. */
  transmission: 0.85,
  /** How far a coloured pane's light is lifted towards white (0 = the pane's pure hue): the stained glass still glows. */
  whiten: 0.2,
} as const;

/** Wind-driven cloud shadows (M5-03, §6.1 pass 4). */
export const CLOUDS = {
  /** Size of a cloud [px]: the base wavelength of the noise. */
  scalePx: 176,
  /** Drift speed at full wind [px/s] and without wind (clouds always move a little). */
  speedPxPerSecond: 22,
  calmSpeedPxPerSecond: 3,
  /** Share of the sun a cloud takes away at its densest. */
  density: 0.62,
  /** Cloud cover of a clear sky and of an overcast one (the weather's cloudiness in between). */
  clearCover: 0.15,
  overcastCover: 0.8,
  /**
   * Noise threshold of a clear sky (cover 0) and of a closed one (cover 1): the three-octave value noise gathers
   * around 0.5, so the cover moves the threshold through that band – half the sky covered at cover ½.
   */
  thresholdClear: 0.74,
  thresholdClosed: 0.3,
  /** Softness of a cloud's edge (noise units). */
  edge: 0.05,
  /** Frequencies of the second and third noise octave against the first (off the lattice: no grid lines). */
  octaveScales: [2.03, 4.11],
  /**
   * Cells after which the first octave's lattice repeats (the others after as many of their own cells times their
   * frequency – whole numbers): the drift is kept modulo `scalePx` × this and wraps without a seam (`world/drift.ts`).
   * Longer than the largest world (2048 tiles, 32 768 px): no cloud repeats within a world.
   */
  periodCells: 200,
} as const;

/** Lattice periods of the cloud noise's three octaves [cells of each octave] (whole numbers, see `CLOUDS.periodCells`). */
export const CLOUD_OCTAVE_PERIODS: readonly [number, number, number] = [
  CLOUDS.periodCells,
  Math.round(CLOUDS.periodCells * CLOUDS.octaveScales[0]),
  Math.round(CLOUDS.periodCells * CLOUDS.octaveScales[1]),
];
/** Period of the cloud field along each axis [world px]: the cloud offset is kept modulo it. */
export const CLOUD_PERIOD_PX = CLOUDS.scalePx * CLOUDS.periodCells;

/** Canopy dapple (§6.1 pass 4 "Blätterdach-Sprenkel"): gaps in the shadow of crowns. */
export const DAPPLE = {
  /** Size of a light fleck [px]. */
  cellPx: 3,
  /** Share of a crown's shadow that lets the sun through. */
  openShare: 0.2,
  /**
   * Noise threshold of a fleck: the value noise (shadow_noise.glsl) gathers around ½, so its top fifth starts at about
   * 0.70 – `openShare` of the crown's shadow opens (tests/unit/render/schatten-sonne-mond.test.ts measures it).
   */
  threshold: 0.7,
  /** Sway of the flecks with the wind [px]. */
  swayPx: 1.5,
  /** Sway frequency [rad/s]. */
  swayFrequency: 1.3,
} as const;

/** Daylight split into sky and sun (§6.1 pass 5 "Sonne/Mond mit Normal-Mapping", M5-04). */
export const DAYLIGHT = {
  /**
   * Share of the daylight that comes from the sky (the rest is the sun). A flat, sunlit pixel gets sky + sun =
   * the whole ambient – the palette colours exactly as painted –, one in the sun's shadow only the sky part.
   */
  skyShare: 0.5,
  /** Blue of the sky light against the warmth of the sun (0 = both white): shadows lean blue, sunlit ground stays white. */
  skyCoolness: 0.14,
  /** Relief strength of the sun's normal mapping (shade = 1 + relief · (n·l − l_z)), softer than a torch's. */
  relief: 0.9,
  /** Sun elevation below which the sun's share fades into the sky's (dawn, dusk) [degrees]. */
  lowSunDeg: 12,
  /**
   * The weather's daylight factor (content/weather.ts `lightFactor`) at which the sun keeps all of its share and below
   * which none is left: cloudy skies (0.85) keep most of it between the clouds – their shadows drift over sunlit
   * ground –, drizzle and fog (0.75) half, rain (0.7) a third, a thunderstorm (0.6) nothing.
   */
  scatter: { clearFrom: 0.9, overcastBelow: 0.6 },
} as const;

/** Moonlight (§6.2 "kühles, gerichtetes Mondlicht (Mondphase = Helligkeit)", M5-04). */
export const MOONLIGHT_PARAMS = {
  /** Share of the night ambient that comes from the moon as directed light at full moon (none at the Finstermond). */
  directedShareFullMoon: 0.45,
  /** Relief strength of the moon's normal mapping. */
  relief: 0.8,
} as const;

/**
 * Near field of a flame (M5-31): what stands right under it (a torch's staff and wedge stones, a lamp's post) is lit
 * from above only. A narrow cone under the flame: radius = `radiusPx` + drop below the flame × `spread`.
 */
export const FLAME_NEAR_FIELD = {
  /** Radius of the cone right under the flame [px]. */
  radiusPx: 1,
  /** Widening of the cone per pixel of drop below the flame. */
  spread: 0.22,
  /** Light kept on a holder straight under the flame. */
  floor: 0.25,
} as const;

/**
 * Housing of a light (M5-35): a fire inside a decor footprint – a kiln's chamber, a furnace's shaft, a fireplace, a
 * lamp's case – lights its own body only through its openings (their glow is the sprite's emission). The body's pixels
 * (occluder bit, upright, their ground point in the footprint the light stands in) keep `floor` of the light.
 */
export const LIGHT_HOUSING = {
  /** Light kept on the housing's own body. */
  floor: 0.3,
  /** Longest line from the light through its footprint to a pixel's ground point [px] (the widest housing, 2 tiles). */
  spanPx: 32,
  /** How far outside the footprint a body pixel's ground point may lie [px] (its relief pushes it south of the base line). */
  gracePx: 3,
  /**
   * Decor tops closer than this to the housing's top are the housing itself [px]: the rays of its light pass it (both
   * come from the same 8-bit mask texel, so the housing matches exactly).
   */
  sameTopPx: 0.25,
  /**
   * How far beside a decor footprint a light may stand and still burn in it [px] – only a footprint rising above the
   * flame: the hearth's fire burns at the middle of its 3 × 3 tiles, its ring's ellipse begins a pixel south of that
   * (sprite footprints are drawn shapes, not the simulation's grid). A trunk or rock farther away keeps its shadow.
   */
  edgePx: 3,
} as const;

/**
 * Point light over daylight (M5 review M1): the composition adds the light pass's point and spot light softly –
 * dynamic × (1 − suppression · saturate(peak of the pixel's daylight) · the scene's daylight level). By day (level 1) a
 * torch or the hearth adds nothing to a pixel the sun lights fully (no halo, no ray shadows of fence posts, no bloom),
 * about half in a room or a shadow; at dusk (level ≈ 0.45) it keeps over 80 %, at night nearly all, in a cave all of it.
 * The light target itself – what the light map comparison reads – is unchanged.
 */
export const POINT_OVER_DAYLIGHT = {
  /** How strongly the daylight takes the point light's place (1: fully where the daylight reaches the ambient of noon). */
  suppression: 1,
} as const;

/**
 * Daylight factors at pixel size (M5 review Minor 6, §6 "in Pixelgröße gerastert"): the ambient occlusion, the sun's
 * penumbra and the edges of cloud shadows change in steps of 1/`levels` with the composition's world-anchored 4×4 Bayer
 * threshold between them (like the point light's bands, the fog and the bloom) – with dither on; smooth without. A factor
 * of 1 stays exactly 1, so unshadowed daylight keeps the palette colours as painted.
 */
export const DAYLIGHT_STEPS = {
  /** Steps per unit of light. */
  levels: 8,
} as const;

/**
 * Occluder ring (M5 review M2): walls, closed doors and gates, raised terrain and roofs of the scene (terrain and build
 * grid, `scene.sky.occluders`; decor left out) beyond the flood frame, in a coarse RGBA8 target with the mask's layout.
 * A ray of a point light that leaves the flood frame – a light standing outside it, a tall pixel whose ground point lies
 * below the view – is traced on through it, so a torch in a hut beside the view stays behind its walls; so is a ray whose
 * sphere trace ran out of steps along a wall (Minor 2). The ring reaches `reachPx` beyond the view on every side and the
 * G-buffer's height range further south (the ground points of the view's tallest pixels).
 */
export const OCCLUDER_RING = {
  /** Size of a ring texel [px]; footprints grow by half a texel, so a wall band keeps every texel it touches. */
  texelPx: 2,
  /** Reach beyond the view [px]: the largest light radius of the content (stations: 12 tiles, `STATION_LIGHT_RADIUS_MAX`). */
  reachPx: 192,
  /** Step of the march through mask and ring [px]: below the 6-px wall band (`WALL_BAND`), so no wall is stepped over. */
  stepPx: 4,
  /** Most steps of that march: a whole light radius of `reachPx` and a third more; a ray still not through counts as blocked. */
  maxSteps: 64,
} as const;

/** `#define`s of the light strand's programs. */
export function lightStrandDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return {
    DH_SDF_MARGIN: f(SDF.marginPx),
    DH_SDF_MAX_DISTANCE: f(SDF.maxDistancePx),
    DH_SDF_SEED_EPSILON: f(SDF.seedEpsilonPx),
    DH_OCC_DECOR: f(OCCLUDER_CLASS.decor),
    DH_OCC_STRUCTURAL: f(OCCLUDER_CLASS.structural),
    DH_OCC_TERRAIN: f(OCCLUDER_CLASS.terrain),
    DH_OCC_ROOF: f(OCCLUDER_CLASS.roof),
    DH_ROOF_MARK: f(ROOF_MARK),
    DH_OCC_OPENING: f(OCCLUDER_CLASS.opening),
    DH_OPENING_MARK: f(OPENING_MARK),
    DH_STRUCTURAL_TOP: f(STRUCTURAL_TOP_PX),
    DH_PS_MAX_STEPS: String(POINT_SHADOW.maxSteps),
    DH_PS_MIN_STEP: f(POINT_SHADOW.minStepPx),
    DH_PS_SOFTNESS: f(POINT_SHADOW.softness),
    DH_PS_START: f(POINT_SHADOW.startPx),
    DH_PS_CLEARANCE: f(POINT_SHADOW.lightClearancePx),
    DH_PS_OWN_GRACE: f(POINT_SHADOW.ownGracePx),
    DH_PS_HEIGHT_EPSILON: f(POINT_SHADOW.heightEpsilonPx),
    DH_LM_NEAR: f(LIGHTMAP_COMPARISON.nearStructuralPx),
    DH_LM_GROUND: f(LIGHTMAP_COMPARISON.groundPx),
    DH_LM_PROBE: f(LIGHTMAP_COMPARISON.probePx),
    DH_LM_OPENING_STEP: f(LIGHTMAP_COMPARISON.openingStepPx),
    DH_AO_RADIUS: f(SDF_AO.radiusPx),
    DH_AO_STRENGTH: f(SDF_AO.strength),
    DH_AO_REACH_HEIGHT: f(SDF_AO.reachHeightPx),
    DH_SUN_PENUMBRA_PER16: f(SUN_SHADOW.penumbraPer16Px),
    DH_SUN_MAX_PENUMBRA: f(SUN_SHADOW.maxPenumbraPx),
    DH_SUN_HEIGHT_EPSILON: f(SUN_SHADOW.heightEpsilonPx),
    DH_CLOUD_SCALE: f(CLOUDS.scalePx),
    DH_CLOUD_DENSITY: f(CLOUDS.density),
    DH_CLOUD_EDGE: f(CLOUDS.edge),
    DH_CLOUD_T_CLEAR: f(CLOUDS.thresholdClear),
    DH_CLOUD_T_CLOSED: f(CLOUDS.thresholdClosed),
    DH_CLOUD_OCTAVE_1: f(CLOUDS.octaveScales[0]),
    DH_CLOUD_OCTAVE_2: f(CLOUDS.octaveScales[1]),
    DH_CLOUD_PERIOD_0: String(CLOUD_OCTAVE_PERIODS[0]),
    DH_CLOUD_PERIOD_1: String(CLOUD_OCTAVE_PERIODS[1]),
    DH_CLOUD_PERIOD_2: String(CLOUD_OCTAVE_PERIODS[2]),
    DH_DAPPLE_CELL: f(DAPPLE.cellPx),
    DH_DAPPLE_THRESHOLD: f(DAPPLE.threshold),
    DH_DAPPLE_SWAY: f(DAPPLE.swayPx),
    DH_DAPPLE_FREQUENCY: f(DAPPLE.swayFrequency),
    // The roof slab's thickness plus the 8-bit rounding of the stored heights.
    DH_ROOF_SLAB: f(BUILDING_SUN.roofTopPx - BUILDING_SUN.roofBottomPx + SUN_SHADOW.heightEpsilonPx),
    DH_ROOF_SKY: f(BUILDING_SUN.roofSkyShare),
    DH_GLASS_TRANSMISSION: f(GLASS.transmission),
    DH_GLASS_WHITEN: f(GLASS.whiten),
    DH_FLAME_NEAR_RADIUS: f(FLAME_NEAR_FIELD.radiusPx),
    DH_FLAME_NEAR_FLOOR: f(FLAME_NEAR_FIELD.floor),
    DH_FLAME_NEAR_SPREAD: f(FLAME_NEAR_FIELD.spread),
    DH_HOUSING_FLOOR: f(LIGHT_HOUSING.floor),
    DH_HOUSING_SPAN: String(LIGHT_HOUSING.spanPx),
    DH_HOUSING_GRACE: f(LIGHT_HOUSING.gracePx),
    DH_HOUSING_SAME_TOP: f(LIGHT_HOUSING.sameTopPx),
    DH_HOUSING_EDGE: String(LIGHT_HOUSING.edgePx),
    DH_POINT_DAY_SUPPRESSION: f(POINT_OVER_DAYLIGHT.suppression),
    DH_DAY_STEPS: f(DAYLIGHT_STEPS.levels),
    DH_RING_TEXEL: f(OCCLUDER_RING.texelPx),
    DH_RING_STEP: f(OCCLUDER_RING.stepPx),
    DH_RING_MAX_STEPS: String(OCCLUDER_RING.maxSteps),
  };
}
