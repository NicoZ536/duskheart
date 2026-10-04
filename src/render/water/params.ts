/**
 * Tuning of the water strand of M5 (MASTERPROMPT §6.1 pass 7, §6.2 "Nacht … Sterne in Wasserspiegelungen", §6.3
 * "Wasser vereinfacht / ohne Spiegelung / voll"): refraction of the ground, depth colouring, shore foam, caustics,
 * reflections of the sky and of what stands above the shoreline, the immersion mask of figures, interactive waves
 * and winter ice. One table, read by the pass (as `#define`s) and by its CPU mirrors (unit tests), so GLSL and
 * TypeScript share one set of numbers.
 *
 * Coordinates are world pixels (x east, y south); heights pixels above the ground of level 0 (the G-buffer's
 * height, `gbuffer.ts`). Colours are palette references (`rampe.stufe`, docs/RENDER.md §1) – the water keeps to the
 * palette's hues; effects only blend between them and the lit scene.
 */
import { LUMA } from '../post/grading';
import { TILE_PX } from '../tilemap/chunk';

/** Interactive waves: the wave equation on a world-anchored grid around the camera (§6.1 pass 7). */
export const WAVES = {
  /** World px per texel of the wave field (ripples of at least four pixels: the field is smooth at pixel scale). */
  texelPx: 2,
  /** Field around the largest internal view (640 × 270 plus the 1-px border, §4.2) on every side [px]: ripples just outside the picture still run into it. */
  marginPx: 48,
  /** Simulation steps per second of presentation time (fixed step: the same waves at every frame rate). */
  stepHz: 30,
  /** Most steps in one frame (after a hitch the field skips ahead instead of catching up for seconds). */
  maxStepsPerFrame: 4,
  /**
   * Squared wave speed c² [texel² / step²] of the discrete wave equation h' = 2h − h⁻ + c²·∇²h. Stable up to 0.5;
   * 0.25 lets a ring expand by half a texel per step – 30 px/s, two tiles a second, like ripples on a pond.
   */
  speed2: 0.25,
  /** Share of the height kept per step (a rain ring fades within about half a second and 16 px, a wake trails). */
  damping: 0.93,
  /** Share kept per step in a texel beside the shore (the bank swallows the waves instead of ringing). */
  shoreDamping: 0.82,
  /** Height range of the 16-bit packing (±range; a single impulse stays far below it). */
  range: 8,
  /** Wave height → surface slope: gradient [height per px] × this is the normal's tilt. */
  slope: 0.9,
  /** Smallest radius of a kick [texels]: a narrower one would excite the checkerboard of the grid (the shortest wave). */
  minImpulseTexels: 1.6,
  /**
   * Contour height of the rings: where the field rises through it, a 1-px lighter line, where it sinks through its
   * negative a darker one – crisp pixel rings however wide the wave is.
   */
  rippleCrest: 0.05,
  /** Share of the shallow colour on a crest line, brightness kept on a trough line. */
  rippleLight: 0.42,
  rippleDark: 0.82,
  /**
   * Slope of the field (height per px × `slope`) from which a flank is a solid light or dark band: a bow wave or a
   * splash (slopes of 0.15 and more); the rings of raindrops and fish stay lines (below 0.05).
   */
  flankSlope: 0.1,
} as const;

/**
 * Impulses into the wave field (`WaterState.impulse`): kick strength (a negative one presses the water down – a
 * drop, an arrow) and radius of the kick [px]. Continuous sources (a figure moving through the water) give their
 * strength per second; `WaterState.impulse` scales it by the frame time the caller hands in.
 */
export const IMPULSES = {
  /** A figure in the water, per second: pushing through it at full swimming speed. */
  figure: { strength: 5.5, radiusPx: 5 },
  /** A figure in the water at rest, per second: the slight bob of a swimmer or wader. */
  figureIdle: { strength: 1.1, radiusPx: 4 },
  /** A raindrop hitting the surface. */
  rain: { strength: -0.7, radiusPx: 3.4 },
  /** An arrow or bolt dipping in (M6-07 fires it where a projectile lands in water). */
  arrow: { strength: -2.4, radiusPx: 3 },
  /** A fish snapping at the surface. */
  fish: { strength: -1.6, radiusPx: 4 },
  /** Something heavy falling in (a thrown stone, a figure diving). */
  splash: { strength: -4, radiusPx: 6 },
} as const;
export type WaterImpulseKind = keyof typeof IMPULSES;

/** Largest number of impulses applied in one frame (the rest of a frame's rain is dropped, the field is saturated anyway). */
export const MAX_IMPULSES = 32;

/** Ambient surface motion without any impulse: small wind waves (procedural, world-anchored). */
export const AMBIENT_WAVES = {
  /** Wavelengths of the three wave trains [px] (incommensurable: no visible repetition). */
  wavelengthsPx: [29, 17, 11],
  /** Angle of the trains against the wind [rad] and their phase at the origin [rad]. */
  angles: [0, 0.7, -0.9],
  phases: [0, 1.7, 4.1],
  /** Share of each train in the slope. */
  weights: [0.55, 0.3, 0.15],
  /**
   * Phase speed [px/s]: each train's travel is integrated over the presentation clock and kept modulo `travelWaves` of
   * its wavelengths (`world/drift.ts`), so reduced motion slows the waves without a jump.
   */
  speedPxPerSecond: 7,
  /**
   * Waves of a train per travel period: the travel wraps after this many wavelengths (at full speed every 100 s for the
   * shortest train, every 265 s for the longest), and the sun's glints count a train's crests modulo it – the wrap moves
   * every crest's count by exactly this, so a crest keeps its index, and its sparkle, across the wrap (M5-42; wrapped
   * per wavelength, every streak rolled anew at once every 1.6–4.1 s). Its crests repeat after this many wavelengths
   * (at least 704 px, wider than the view).
   */
  travelWaves: 64,
  /** Slope of the ambient waves in calm air and at full wind. */
  calmSlope: 0.17,
  windSlope: 0.32,
  /** Share of the ambient motion (height and speed of the waves, drift of the caustics) left with "Reduzierte Bewegung" (§29). */
  reducedMotion: 0.4,
  /**
   * Slope towards the sky above which a water pixel is a step lighter (below its negative: a step darker) – the
   * moving light and dark dashes of the surface, whole pixels.
   */
  lightThreshold: 0.16,
  /** Direction a slope must point for its flank to face the sky the viewer sees mirrored (unit; +y south). */
  toSky: [-0.45, -0.89],
  /** A slow warp across each train bends its crests (no ruled lines): its amplitude [rad] and its wavelength [× the train's]. */
  warp: 1.3,
  warpSpan: 3.7,
} as const;

/** Rain on the water: drops per second and 10 000 px² of water at full rain, and the time slots drops fall in. */
export const RAIN_RIPPLES = {
  dropsPerSecond: 7,
  /** Slots per second the drops are drawn from (each slot holds at most one drop per 10 000 px²; deterministic by time). */
  slotsPerSecond: 60,
} as const;

/** Fish snapping at the surface of deep water: events per second and 100 deep tiles. */
export const FISH = {
  perSecond: 0.35,
  slotsPerSecond: 8,
} as const;

/** Refraction of the ground under the water (§6.1 pass 7 "Refraktion des Grunds"). */
export const REFRACTION = {
  /** Largest displacement of the ground by the waves [px] (whole pixels: the ground stays pixel art). */
  maxPx: 2,
  /**
   * Displacement per unit of slope [px]: the crests of calm water (slope ≈ 0.19) shift the ground by a pixel, a
   * stiff breeze (≈ 0.32) by two in the deep.
   */
  pxPerSlope: 6,
  /** Share of the displacement in the shallows (the ground right under the surface moves less). */
  shallowShare: 0.6,
} as const;

/**
 * Share of the light's hue in what the water lights with it (foam, deep colour, the submerged body): the brightness
 * is the light's, its colour only in part (`lightOf`, water_surface.frag).
 */
export const LIGHT_HUE = 0.2;

/**
 * Luminance weights of the water's light measurements (`lightOf`, the sunlight on the water, the body under water):
 * the one luma of the render code (`post/grading.ts`, M5-47).
 */
export { LUMA };

/**
 * Floors of the water's light measurements – below them a ratio of two dark values would blow up: the luminance and a
 * channel of the albedo a pixel's light is read against (`lightOf`, `sunSeen`), the luminance of a light's hue
 * (`lightOf`) and of the light on a body under water (`throughWater`).
 */
export const LIGHT_FLOORS = {
  albedoLuma: 0.02,
  albedoChannel: 0.04,
  hueLuma: 0.001,
  lightLuma: 0.05,
} as const;

/** Shore distance without the occluder pass's water field: the nearest non-water pixel searched in eight directions up to this reach [px]. */
export const SHORE_SEARCH_PX = 6;

/**
 * The tile grid's bound on the shore distance (what is drawn over the water – a crown in front of a lake, a figure –
 * is no shore): the grid holds each water tile's distance from its centre to the nearest land tile within
 * `searchTiles` tiles (`waterScene.ts`); a pixel of the tile lies at most half a tile diagonal nearer, and the coast
 * art of a water tile reaches up to `artReachPx` into it from its land neighbour. Beyond the reach of the shore effects
 * (ice ≤ 1.25 × `ICE.maxShorePx`, depth ≤ `DEPTH.fullDepthPx`) the bound alone decides.
 */
export const SHORE_TILES = {
  searchTiles: 4,
  artReachPx: 8,
} as const;

/** Depth colouring (§6.1 pass 7 "Tiefenfärbung"): absorption towards the colour of deep water. */
export const DEPTH = {
  /** Distance from the shore at which the water counts as fully deep [px] (with the tile's depth class). */
  fullDepthPx: 44,
  /** Share of the deep-water colour laid over the ground at full depth (the terrain already darkens by ramp steps). */
  deepAbsorb: 0.28,
  /**
   * Colour the water absorbs towards (lit by the light on the water) and the tint of the shallows. The terrain darkens
   * deep water by at most one ramp step (`TERRAIN_SHADING.waterMaxSteps`); the absorption does the rest – towards the
   * deep blue of the lake, not its black.
   */
  deepColor: 'wasser.1',
  shallowColor: 'wasser.4',
  /** Share of the shallow tint right at the shore (turquoise shallows), and the depth share by which it has faded out. */
  shallowTint: 0.14,
  shallowFade: 0.33,
  /** Deepest depth share of a tile of the shallow depth class (a ford stays light however far its banks are). */
  shallowClassDepth: 0.45,
} as const;

/** Shore foam over the water's distance field (§6.1 pass 7 "Uferschaum (SDF)"). */
export const FOAM = {
  /** Width of the foam band at the shore [px] (its breathing adds `surgePx`). */
  widthPx: 1.1,
  /** How far the surf runs up and back [px], and its period [s]; the surge runs along the shore by this phase per px. */
  surgePx: 1.4,
  surgePeriodSeconds: 3.4,
  surgePhasePerPx: 0.045,
  /** A second, broken line of foam further out [px] and its share of pixels. */
  outerLinePx: 4.5,
  outerShare: 0.3,
  /** How far the broken line runs up with the surf (share of the band's surge) and its half width [px]. */
  outerSurge: 0.8,
  outerHalfWidthPx: 0.7,
  /** The band's outermost pixel [px wide]: this share of its pixels is shaded foam (a ragged rim, not a ruled edge). */
  rimPx: 1,
  rimShadeShare: 0.35,
  /** How much of the water colour the foam covers: the solid band, the broken line. */
  cover: 0.72,
  shadeCover: 0.45,
  /** Size of the foam's break-up cells [px]. */
  cellPx: 3,
  /** Colour of foam and of its shaded underside, and how much of the light falling on the water it reflects. */
  color: 'eis.4',
  shadeColor: 'eis.2',
  /**
   * Wave crests of the interactive field whiter than this height carry foam too (the ring around a swimmer): the share of
   * foamed pixels grows by `crestRamp` per unit of height above it, up to `crestMaxShare`.
   */
  crestHeight: 0.55,
  crestRamp: 2.5,
  crestMaxShare: 0.9,
} as const;

/** White water where a waterfall (the terrain's falling water on a wall) meets the water below it. */
export const FALL_FOAM = {
  /** How far below the fall the pool churns [px]. */
  reachPx: 6,
  /** Share of churning pixels right under the fall (thinning out to none at `reachPx`); `shadeShare` of that again are shaded foam. */
  share: 0.8,
  shadeShare: 0.5,
  /** How often the churn changes [per second] (a quarter with flash reduction, `WaterRenderSettings.flicker`). */
  flickerPerSecond: 8,
  /**
   * Time slots of the churn: each pixel's slots start at its own offset within `slotSpread` slots (the pixels do not
   * change all at once), and a slot moves the pixel's hash cell by `slotStride` (a new roll per slot).
   */
  slotSpread: 4,
  slotStride: [5, 7],
  /** Tilt of the G-buffer normal from which a water pixel is falling water (a wall faces south, open water up). */
  fallTilt: 0.3,
} as const;

/** Caustics in the shallows (§6.1 pass 7 "Kaustiken im Flachen"). */
export const CAUSTICS = {
  /**
   * Size of a caustic cell [px] and its drift speed [px/s]. A fine net (M5-62: 15-px cells with straight seams read like
   * the cracks of ice).
   */
  cellPx: 11,
  driftPxPerSecond: 3,
  /**
   * The second layer of lines: its cells against the first's and its drift against the first's (it runs the other
   * way). Both layers' offsets are integrated over the clock and kept modulo `periodCells` of their cells – the Voronoi
   * lattice repeats with that period, so the drift wraps without a seam (both periods whole 1/16 px, `world/drift.ts`).
   */
  layerScale: 0.625,
  layerDrift: -0.6,
  periodCells: 80,
  /** Where the second layer's lattice starts against the first's [px] (their seams never coincide). */
  layerOffsetPx: [31, 17],
  /** Width of a caustic line (F2 − F1 in cell units: about a pixel), and the second layer's against it. */
  lineWidth: 0.1,
  layerLineWidth: 1.2,
  /**
   * Bend of the lines: the lattice coordinates are warped by up to `warpPx` [px] in waves of `warpSpanCells` cells (a
   * whole number of them per lattice period: no seam at the drift's wrap) – light focused by the waves runs in curves,
   * not in the straight seams of cracks.
   */
  warpPx: 1,
  warpSpanCells: 2,
  /**
   * Wobble of the cells: each cell's point swings up to `wobble` [cell units] around the cell's centre, at `wobbleSpeed`
   * [rad/s] along x and y – the second layer `layerWobble` times as fast – on the water's motion clock (reduced motion
   * slows it, `MOTION_CLOCK`).
   */
  wobble: 0.38,
  wobbleSpeed: [0.8, 0.6],
  layerWobble: 1.3,
  /** Depth share (0 at the shore, 1 at full depth) up to which caustics show; they fade towards it in `fadeSteps` steps. */
  maxDepth: 0.5,
  fadeSteps: 3,
  /**
   * Share of the caustic colour laid over the ground on a line at full sun (twice where both layers cross, at most
   * `maxCover`), and the colour: faint lines of light, brighter where they cross (M5-62: 0.32, up to 0.6).
   */
  strength: 0.22,
  maxCover: 0.36,
  color: 'eis.3',
} as const;

/** Reflections (§6.1 pass 7 "Spiegelung (Himmel; nachts Mond und Sterne; Objekte über der Uferlinie)"). */
export const REFLECTION = {
  /** Longest reflection searched above a water pixel [px] (an object's reflection reaches twice its height below its base). */
  maxDistancePx: 112,
  /** Every pixel is searched up to `fineReachPx` above a water pixel, then every `stepPx` (tolerance ≥ half the step). */
  fineReachPx: 16,
  stepPx: 2,
  /** Height tolerance of a hit [px] (8-bit heights, half-pixel rounding). */
  tolerancePx: 1.5,
  /** Height above the water surface from which a pixel mirrors [px] (below it: the bank itself). */
  minHeightPx: 0.75,
  /** Share of the reflected object in the water colour (calm water; waves break it up). */
  objectShare: 0.48,
  /** Share of the mirror (sky and objects) the waves take away at their steepest, and the slope at which they do. */
  tiltLoss: 0.5,
  tiltFullSlope: 0.5,
  /** Fade of object reflections towards the end of the search and at the picture's top edge [px]. */
  fadePx: 24,
  /** Sideways displacement of reflections by the wave slope [px per unit of slope] and its cap [px]. */
  distortPxPerSlope: 5,
  maxDistortPx: 3,
} as const;

/** The sky as the water mirrors it: colours by time of day and weather, stars, moon, sun glitter. */
export const SKY = {
  /**
   * Share of the sky in the water colour by day and by night (the night sky is dark: stars and moon need more). On every
   * quality level – "Wasser vereinfacht" and "ohne Spiegelung" drop only the mirror of objects, stars and moon.
   */
  dayShare: 0.45,
  nightShare: 0.55,
  /** Parallax of the mirrored sky against the camera (0 = fixed to the screen like the real reflection of an infinitely far sky). */
  parallax: 0.12,
  /**
   * Sky colours (palette references): day (zenith, horizon), twilight, night, overcast. The twilight is a deeper blue
   * between day and night (M5-54: violet and brown mirrored lakes and ice purple or muddy – violet belongs to the
   * corruption, the Schattenbrut and the epic rarity, docs/ART.md §8); the warm dusk is the grading's, not the mirror's.
   */
  dayZenith: 'wasser.3',
  dayHorizon: 'eis.1',
  duskZenith: 'wasser.2',
  duskHorizon: 'eis.0',
  nightZenith: 'wasser.0',
  nightHorizon: 'wasser.1',
  overcast: 'stein.3',
  /** Brightness of the night sky colours (they are palette darks, the reflection must stay darker than the moonlit ground). */
  nightBrightness: 0.7,
  /** Share of an overcast sky at full cloud cover. */
  overcastShare: 0.85,
  /**
   * Calendar ticks between two samplings of calendar, weather and temperature for the water (the sky changes slowly;
   * a clock jump, a new weather period or another layer sample at once).
   */
  refreshTicks: 15,
} as const;

/**
 * The water's flicker clock (sparkle, twinkle, churn): presentation time at the settings' flicker rate, kept modulo
 * this period [s] (whole 1/`DRIFT_UNITS` s: `world/drift.ts`) – once a period the sparkle rolls anew, unseen among its
 * own slots.
 */
export const FLICKER_CLOCK = { periodSeconds: 2048 } as const;

/**
 * The water's motion clock (the caustics' cell wobble, the surf running up the shore, the wobble of a wading figure's
 * waterline): presentation time × the settings' motion scale (reduced motion, §29), integrated like the drifts and kept
 * modulo this period [s] (whole 1/`DRIFT_UNITS` s: `world/drift.ts`). Every speed on it is a whole number of turns per
 * period (`motionRate`), so its wrap shows no seam (M5-47).
 */
export const MOTION_CLOCK = { periodSeconds: 2048 } as const;

/** The angular speed `radPerSecond` [rad/s] rounded to a whole number of turns per `MOTION_CLOCK` period (at most half a turn per period off). */
export function motionRate(radPerSecond: number): number {
  const turn = (2 * Math.PI) / MOTION_CLOCK.periodSeconds;
  return Math.round(radPerSecond / turn) * turn;
}

/** Stars mirrored in the water at night (M5-23 "Sterne in Wasserspiegelungen"). */
export const STARS = {
  /** Cell of the star field [px]: at most one star per cell. */
  cellPx: 7,
  /** Share of cells with a star. */
  density: 0.16,
  /** Share of stars bright enough for a cross of four dimmer neighbours, and the cross's brightness against the star's. */
  brightShare: 0.12,
  crossLevel: 0.4,
  /** Brightness of the dimmest star against the brightest (each star's lies between, by its hash). */
  minLevel: 0.55,
  /** Margin of a star from its cell's edge [px] (two stars never touch). */
  marginPx: 1,
  /** Twinkle: speed [rad/s] (a quarter with flash reduction) and depth (share of the brightness that comes and goes). */
  twinkleSpeed: 2.3,
  twinkleDepth: 0.45,
  /** Brightness of a star (HDR) and its colour. */
  brightness: 1.35,
  color: 'eis.4',
  /** Cloud cover above which no star shows. */
  maxCloudCover: 0.75,
} as const;

/** The moon mirrored in the water. */
export const MOON = {
  /** Radius of the mirrored disc [px]. */
  radiusPx: 5,
  /** Brightness at full moon (HDR) and its colour (the lit part), the unlit part's share. */
  brightness: 1.6,
  color: 'eis.4',
  darkShare: 0.1,
  /**
   * Where the disc sits: share of the view width it swings from the centre with the moon's east–west position, and
   * its height band (share of the view height from the top: a high moon lies nearer the viewer, lower). The band lies
   * in the lower half – the camera centres the player, who looks out over the water in front of them.
   */
  swingShare: 0.3,
  topShare: 0.56,
  bottomShare: 0.8,
  /**
   * Glitter path below the disc: length [px], half width at its end [px] and at the disc (share of the radius), share of
   * pixels that sparkle – `pathCalm` of it on calm water, more by `pathSlopeGain` per unit of wave slope – and their
   * brightness (share of the moon's).
   */
  pathPx: 70,
  pathHalfWidthPx: 9,
  pathStartShare: 0.6,
  pathSparkle: 0.3,
  pathCalm: 0.6,
  pathSlopeGain: 2,
  pathLevel: 0.75,
  /** How often the path's sparkle changes [per second] (a quarter with flash reduction); its time slots as `FALL_FOAM`'s. */
  pathFlickerPerSecond: 4,
  pathSlotSpread: 4,
  pathSlotStride: [13, 0],
} as const;

/**
 * Sun glitter by day (§6.1 pass 7): the facets of the small waves that throw the sun into the viewer's eye – short
 * streaks along the wave crests, only on the sun's mirror path (placed like the moon's: by the sun's east–west position
 * and elevation, fixed to the screen), only where the sun reaches the water (not in the shadow of a tree, a cloud or a
 * house: the light on the water tells) – never a starfield.
 *
 * - The path: an oval below the sun's mirror point, long and narrow under a low sun, short and wide under a high one;
 *   the chance of a streak falls off from its axis to its rim.
 * - A streak lies on the line where a wave train's flank faces the mirror point most (one pixel wide), cut into
 *   segments of `segmentPx` along the crest; each segment sparkles in its own time slots.
 * - Its brightness stays below the bloom's knee (its brightest channel × `level` ≤ BLOOM.threshold − BLOOM.knee, tested):
 *   a crisp pixel streak without a halo.
 */
export const GLITTER = {
  /** Share of the crest segments on the path's axis that sparkle at full sun (thinning out to none at its rim). */
  share: 0.8,
  /** Colour of a glint and the share of it laid over the water at full sun. */
  color: 'feuer.5',
  cover: 0.9,
  /** Brightness of the glint colour (its brightest channel; the colour's own is 1). */
  level: 1,
  /**
   * Longest streak along its crest [px] (every other segment of this length may sparkle), the shortest as a share of
   * it, and the crest line's width [px].
   */
  segmentPx: 5,
  minLength: 0.6,
  lineWidthPx: 1,
  /**
   * How far the small waves must face the mirror point (their slope towards it over their largest slope in the wind of
   * the moment, the reduced motion's calmer waves face it less) for a streak: on the path's axis and at its rim.
   */
  facingAxis: 0.05,
  facingRim: 0.35,
  /** How often a segment's sparkle changes [per second] (a quarter with flash reduction); its time slots as `FALL_FOAM`'s. */
  flickerPerSecond: 3,
  slotSpread: 8,
  slotStride: [7, 3],
  /**
   * How much of the sun must reach the water pixel (0 in full shade, 1 in full sun, read from the light the composition
   * gave it: tree, house and cloud shadows) for the first glints, and for all of them.
   */
  sunFrom: 0.45,
  sunFull: 0.9,
  /**
   * Where the mirror point sits: share of the view width it swings from the centre with the sun's east–west position,
   * its height (share of the view height from the top) under a low and under a high sun (a high sun's mirror lies
   * nearer the viewer), the path's length and the half width at its near end (shares of the view height and width) for
   * a low and a high sun; the half width at the mirror point is `startWidth` of that.
   */
  swingShare: 0.3,
  lowTop: 0.2,
  highTop: 0.3,
  lowLength: 0.75,
  highLength: 0.65,
  lowHalfWidth: 0.18,
  highHalfWidth: 0.45,
  startWidth: 0.45,
} as const;

/** Immersion mask for figures (§6.1 pass 7 "Eintauchmaske für Figuren"). */
export const IMMERSION = {
  /** How deep a wading figure stands in shallow water [px above its feet]. */
  wadeDepthPx: 3,
  /**
   * Share of a swimming creature's drawing (from its feet up to its top) that lies under the surface (src/render/game/
   * creatures.ts, ADR-0168): the jellyfish's tentacles up to the rim of its bell, the seal's belly and flippers, the frog's
   * legs – the rest floats above the water and mirrors in it.
   */
  creatureSwimShare: 0.55,
  /**
   * How far the swimming figure is sunk in its swim frames [px] (`SCHWIMM_TIEFE` of assets-src/sprites/figuren/
   * _spieler_sonder.ts; the unit test holds both equal): the body frame drawn under water is lowered by as much.
   */
  swimSinkPx: 5,
  /** Visibility of the body right under the surface and how fast it fades with depth [per px]. */
  visibility: 0.8,
  fadePerPx: 0.08,
  /**
   * Seen through the water a body loses its outline and most of its colour: it shows as a lighter shape of this
   * colour in the water (clothes and skin give back more light than the water around them) – `tintShare` of the
   * colour for a white body, `tintFloor` of that for a black one (the outline) – with `bodyShare` of its own colour.
   */
  tint: 'wasser.3',
  tintShare: 0.75,
  tintFloor: 0.35,
  bodyShare: 0.2,
  /** Margin around a figure in the water inside which the shore effects (foam, shallows) keep away [px]. */
  clearPx: 4,
  /**
   * The wobble of the waterline along the body [px], its speed [rad/s] on the water's motion clock (`MOTION_CLOCK`) and
   * its phase step from one column of the body to the next [rad/px].
   */
  wobblePx: 1,
  wobbleSpeed: 3.1,
  wobblePhasePerPx: 0.9,
  /**
   * How far from a wading figure's pixel the water it is seen through is searched (down, then sideways) [px], and the
   * depth share of that water (the shallows a figure wades in).
   */
  waterSearchPx: 8,
  waterDepthShare: 0.2,
  /** Half width of the waterline's glint beside the body [px]. */
  glintPx: 1,
} as const;

/** Most figures with an immersion mask per frame. */
export const MAX_IMMERSIONS = 8;

/** Winter ice (M5-09 "Winter-Eis mit Rissen"): frozen water, glacier ice and the ice that grows from the shore in frost. */
export const ICE = {
  /** Air temperature at which ice starts to grow from the shore [°C] and at which it reaches `maxShorePx`. */
  freezeC: -1,
  hardFreezeC: -14,
  /** Widest shore ice [px]. */
  maxShorePx: 30,
  /**
   * Crack network: cell size [px] of the plates, the share of its cell a plate's point may lie anywhere in (centred),
   * width of a crack [px], share of plate edges that are cracked.
   */
  plateCellPx: 19,
  plateJitter: 0.8,
  crackWidthPx: 0.6,
  crackShare: 0.62,
  /**
   * Fine hairline cracks inside the plates (cell size [px], share, their lattice's offset against the plates' [px]) and
   * how dark a hairline and how bright a crack's lip are against a crack's core.
   */
  hairCellPx: 7,
  hairShare: 0.2,
  hairOffsetPx: [13, 7],
  hairStrength: 0.5,
  lipStrength: 0.7,
  /** How far the G-buffer's height of an ice pixel may lie from its tile's level [px] (ice on a raised bank is not the lake's). */
  levelTolerancePx: 2,
  /** The old ice of a glacier (the `eis` ground): share of its plate edges that are cracked, and how dark the cracks are (1 = like ice on water); no hairlines. */
  groundCrackShare: 0.3,
  groundCrackStrength: 0.55,
  /** Rim of the shore ice: size of its noise cells [px] and its reach as a share of the width (from `edgeMin` to `edgeMin + edgeSpread`). */
  edgeCellPx: 11,
  edgeMin: 0.65,
  edgeSpread: 0.6,
  /** Colours: ice (lit), the dark core of a crack, its bright lip, the blue of deep water under thin ice. */
  color: 'eis.2',
  crackColor: 'eis.0',
  lipColor: 'eis.4',
  deepColor: 'wasser.1',
  /** Share of the sky the ice mirrors, and the thin ice's opacity at the edge of the shore ice (it thickens to 1 towards land). */
  skyShare: 0.14,
  edgeOpacity: 0.55,
  /** Share of the water colour that shows through ice over deep water. */
  deepShowThrough: 0.22,
} as const;

/** Quality modes of the water (§6.3 "Wasser": vereinfacht / voll ohne Spiegelung / voll). */
export const WATER_MODES = {
  simple: { refraction: false, reflection: false, waves: false, caustics: false },
  noReflection: { refraction: true, reflection: false, waves: true, caustics: true },
  full: { refraction: true, reflection: true, waves: true, caustics: true },
} as const;

/** Tile grid of the water state around the camera: tiles across the largest view plus the wave margin, whole chunks aside. */
export const TILE_GRID = {
  /** Largest view width/height [px] the grid must cover (§4.2) plus two tiles of margin on every side. */
  viewWidthPx: 642,
  viewHeightPx: 272,
  marginTiles: 5,
} as const;

/** vec4s of the surface shader's frame array `uFrame` (layout: `WATER_FRAME` in passes/waterPass.ts, macros in water_surface.frag). */
export const WATER_FRAME_VEC4S = 9;

/**
 * Frequency [rad/px] of the bend of the caustic lines in a layer of `cellPx`-px cells: whole waves of about
 * `warpSpanCells` cells per lattice period of `periodCells` cells, so the bend repeats with the lattice (no seam at the
 * drift's wrap).
 */
export function causticWarpFrequency(cellPx: number, periodCells: number = CAUSTICS.periodCells, warpSpanCells: number = CAUSTICS.warpSpanCells): number {
  const waves = Math.max(1, Math.round(periodCells / warpSpanCells));
  return (2 * Math.PI * waves) / (cellPx * periodCells);
}

/** `#define`s of the water shaders (GLSL and TypeScript share one set of numbers). */
export function waterDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const v2 = (v: readonly [number, number]): string => `vec2(${f(v[0])}, ${f(v[1])})`;
  const i2 = (v: readonly [number, number]): string => `ivec2(${v[0]}, ${v[1]})`;
  const w = AMBIENT_WAVES;
  const c = CAUSTICS;
  const cellB = c.cellPx * c.layerScale;
  return {
    DH_WATER_TILE_PX: f(TILE_PX),
    DH_WATER_FRAME_VEC4S: String(WATER_FRAME_VEC4S),
    DH_LIGHT_HUE: f(LIGHT_HUE),
    DH_LUMA: `vec3(${f(LUMA[0])}, ${f(LUMA[1])}, ${f(LUMA[2])})`,
    DH_FLOOR_ALBEDO_LUMA: f(LIGHT_FLOORS.albedoLuma),
    DH_FLOOR_ALBEDO_CHANNEL: f(LIGHT_FLOORS.albedoChannel),
    DH_FLOOR_HUE_LUMA: f(LIGHT_FLOORS.hueLuma),
    DH_FLOOR_LIGHT_LUMA: f(LIGHT_FLOORS.lightLuma),
    DH_TRAVEL_WAVES: f(w.travelWaves),
    DH_WAVE_TEXEL: f(WAVES.texelPx),
    DH_WAVE_SPEED2: f(WAVES.speed2),
    DH_WAVE_DAMPING: f(WAVES.damping),
    DH_WAVE_SHORE_DAMPING: f(WAVES.shoreDamping),
    DH_WAVE_RANGE: f(WAVES.range),
    DH_WAVE_SLOPE: f(WAVES.slope),
    DH_IMPULSE_MIN_RADIUS: f(WAVES.minImpulseTexels),
    DH_RIPPLE_CREST: f(WAVES.rippleCrest),
    DH_RIPPLE_LIGHT: f(WAVES.rippleLight),
    DH_RIPPLE_DARK: f(WAVES.rippleDark),
    DH_WAVE_FLANK: f(WAVES.flankSlope),
    DH_MAX_IMPULSES: String(MAX_IMPULSES),
    DH_AMBIENT_WL0: f(w.wavelengthsPx[0]),
    DH_AMBIENT_WL1: f(w.wavelengthsPx[1]),
    DH_AMBIENT_WL2: f(w.wavelengthsPx[2]),
    DH_AMBIENT_A0: f(w.angles[0]),
    DH_AMBIENT_A1: f(w.angles[1]),
    DH_AMBIENT_A2: f(w.angles[2]),
    DH_AMBIENT_P0: f(w.phases[0]),
    DH_AMBIENT_P1: f(w.phases[1]),
    DH_AMBIENT_P2: f(w.phases[2]),
    DH_AMBIENT_W0: f(w.weights[0]),
    DH_AMBIENT_W1: f(w.weights[1]),
    DH_AMBIENT_W2: f(w.weights[2]),
    DH_AMBIENT_CALM: f(w.calmSlope),
    DH_AMBIENT_WINDY: f(w.windSlope),
    DH_AMBIENT_WARP: f(w.warp),
    DH_AMBIENT_WARP_SPAN: f(w.warpSpan),
    DH_WAVE_LIGHT: f(w.lightThreshold),
    DH_WAVE_TO_SKY: `vec2(${f(w.toSky[0])}, ${f(w.toSky[1])})`,
    DH_SHORE_SEARCH: String(SHORE_SEARCH_PX),
    DH_SHORE_SLACK: f((TILE_PX * Math.SQRT2) / 2 + SHORE_TILES.artReachPx),
    DH_REFRACT_MAX: f(REFRACTION.maxPx),
    DH_REFRACT_PER_SLOPE: f(REFRACTION.pxPerSlope),
    DH_REFRACT_SHALLOW: f(REFRACTION.shallowShare),
    DH_DEPTH_FULL: f(DEPTH.fullDepthPx),
    DH_DEPTH_ABSORB: f(DEPTH.deepAbsorb),
    DH_SHALLOW_TINT: f(DEPTH.shallowTint),
    DH_SHALLOW_FADE: f(DEPTH.shallowFade),
    DH_SHALLOW_CLASS_DEPTH: f(DEPTH.shallowClassDepth),
    DH_FOAM_WIDTH: f(FOAM.widthPx),
    DH_FOAM_SURGE: f(FOAM.surgePx),
    DH_FOAM_SURGE_RATE: f(motionRate((2 * Math.PI) / FOAM.surgePeriodSeconds)),
    DH_FOAM_SURGE_PHASE: f(FOAM.surgePhasePerPx),
    DH_FOAM_OUTER: f(FOAM.outerLinePx),
    DH_FOAM_OUTER_SHARE: f(FOAM.outerShare),
    DH_FOAM_OUTER_SURGE: f(FOAM.outerSurge),
    DH_FOAM_OUTER_HALF: f(FOAM.outerHalfWidthPx),
    DH_FOAM_RIM: f(FOAM.rimPx),
    DH_FOAM_RIM_SHADE: f(FOAM.rimShadeShare),
    DH_FOAM_CREST_RAMP: f(FOAM.crestRamp),
    DH_FOAM_CREST_MAX: f(FOAM.crestMaxShare),
    DH_FOAM_CELL: f(FOAM.cellPx),
    DH_FOAM_COVER: f(FOAM.cover),
    DH_FOAM_SHADE_COVER: f(FOAM.shadeCover),
    DH_FOAM_CREST: f(FOAM.crestHeight),
    DH_FALL_REACH: String(FALL_FOAM.reachPx),
    DH_FALL_SHARE: f(FALL_FOAM.share),
    DH_FALL_SHADE: f(FALL_FOAM.shadeShare),
    DH_FALL_FLICKER: f(FALL_FOAM.flickerPerSecond),
    DH_FALL_SLOT_SPREAD: f(FALL_FOAM.slotSpread),
    DH_FALL_SLOT_STRIDE: i2(FALL_FOAM.slotStride),
    DH_FALL_TILT: f(FALL_FOAM.fallTilt),
    DH_CAUSTIC_CELL: f(c.cellPx),
    DH_CAUSTIC_CELL_B: f(cellB),
    DH_CAUSTIC_PERIOD: String(c.periodCells),
    DH_CAUSTIC_PERIOD_PX: v2([c.cellPx * c.periodCells, cellB * c.periodCells]),
    DH_CAUSTIC_LAYER_OFFSET: v2(c.layerOffsetPx),
    DH_CAUSTIC_LINE: f(c.lineWidth),
    DH_CAUSTIC_LINE_B: f(c.lineWidth * c.layerLineWidth),
    DH_CAUSTIC_WARP: f(c.warpPx),
    DH_CAUSTIC_WARP_FREQ: v2([causticWarpFrequency(c.cellPx), causticWarpFrequency(cellB)]),
    DH_CAUSTIC_WOBBLE: f(c.wobble),
    DH_CAUSTIC_WOBBLE_A: v2([motionRate(c.wobbleSpeed[0]), motionRate(c.wobbleSpeed[1])]),
    DH_CAUSTIC_WOBBLE_B: v2([motionRate(c.wobbleSpeed[0] * c.layerWobble), motionRate(c.wobbleSpeed[1] * c.layerWobble)]),
    DH_CAUSTIC_MAX_DEPTH: f(c.maxDepth),
    DH_CAUSTIC_STEPS: f(c.fadeSteps),
    DH_CAUSTIC_STRENGTH: f(c.strength),
    DH_CAUSTIC_MAX_COVER: f(c.maxCover),
    DH_REFLECT_MAX: f(REFLECTION.maxDistancePx),
    DH_REFLECT_STEP: f(REFLECTION.stepPx),
    DH_REFLECT_FINE: f(REFLECTION.fineReachPx),
    DH_REFLECT_TOLERANCE: f(REFLECTION.tolerancePx),
    DH_REFLECT_SHARE: f(REFLECTION.objectShare),
    DH_REFLECT_MIN_HEIGHT: f(REFLECTION.minHeightPx),
    DH_REFLECT_TILT_LOSS: f(REFLECTION.tiltLoss),
    DH_REFLECT_TILT_FULL: f(REFLECTION.tiltFullSlope),
    DH_REFLECT_FADE: f(REFLECTION.fadePx),
    DH_REFLECT_DISTORT: f(REFLECTION.distortPxPerSlope),
    DH_REFLECT_MAX_DISTORT: f(REFLECTION.maxDistortPx),
    DH_SKY_PARALLAX: f(SKY.parallax),
    DH_STAR_CELL: f(STARS.cellPx),
    DH_STAR_DENSITY: f(STARS.density),
    DH_STAR_BRIGHT_SHARE: f(STARS.brightShare),
    DH_STAR_CROSS: f(STARS.crossLevel),
    DH_STAR_MIN_LEVEL: f(STARS.minLevel),
    DH_STAR_MARGIN: f(STARS.marginPx),
    DH_STAR_TWINKLE_SPEED: f(STARS.twinkleSpeed),
    DH_STAR_TWINKLE_DEPTH: f(STARS.twinkleDepth),
    DH_STAR_BRIGHTNESS: f(STARS.brightness),
    DH_MOON_BRIGHTNESS: f(MOON.brightness),
    DH_MOON_RADIUS: f(MOON.radiusPx),
    DH_MOON_DARK: f(MOON.darkShare),
    DH_MOON_PATH: f(MOON.pathPx),
    DH_MOON_PATH_WIDTH: f(MOON.pathHalfWidthPx),
    DH_MOON_PATH_START: f(MOON.pathStartShare),
    DH_MOON_PATH_SPARKLE: f(MOON.pathSparkle),
    DH_MOON_PATH_CALM: f(MOON.pathCalm),
    DH_MOON_PATH_SLOPE: f(MOON.pathSlopeGain),
    DH_MOON_PATH_LEVEL: f(MOON.pathLevel),
    DH_MOON_PATH_FLICKER: f(MOON.pathFlickerPerSecond),
    DH_MOON_SLOT_SPREAD: f(MOON.pathSlotSpread),
    DH_MOON_SLOT_STRIDE: i2(MOON.pathSlotStride),
    DH_GLITTER_SHARE: f(GLITTER.share),
    DH_GLITTER_COVER: f(GLITTER.cover),
    DH_GLITTER_LEVEL: f(GLITTER.level),
    DH_GLITTER_SEGMENT: f(GLITTER.segmentPx),
    DH_GLITTER_MIN_LENGTH: f(GLITTER.minLength),
    DH_GLITTER_LINE: f(GLITTER.lineWidthPx),
    DH_GLITTER_FACING_AXIS: f(GLITTER.facingAxis),
    DH_GLITTER_FACING_RIM: f(GLITTER.facingRim),
    DH_GLITTER_START_WIDTH: f(GLITTER.startWidth),
    DH_GLITTER_SUN_FROM: f(GLITTER.sunFrom),
    DH_GLITTER_SUN_FULL: f(GLITTER.sunFull),
    DH_GLITTER_FLICKER: f(GLITTER.flickerPerSecond),
    DH_GLITTER_SLOT_SPREAD: f(GLITTER.slotSpread),
    DH_GLITTER_SLOT_STRIDE: i2(GLITTER.slotStride),
    DH_MAX_IMMERSIONS: String(MAX_IMMERSIONS),
    DH_IMMERSE_VISIBILITY: f(IMMERSION.visibility),
    DH_IMMERSE_FADE: f(IMMERSION.fadePerPx),
    DH_IMMERSE_TINT: f(IMMERSION.tintShare),
    DH_IMMERSE_TINT_FLOOR: f(IMMERSION.tintFloor),
    DH_IMMERSE_BODY: f(IMMERSION.bodyShare),
    DH_IMMERSE_WOBBLE: f(IMMERSION.wobblePx),
    DH_IMMERSE_WOBBLE_SPEED: f(motionRate(IMMERSION.wobbleSpeed)),
    DH_IMMERSE_WOBBLE_PHASE: f(IMMERSION.wobblePhasePerPx),
    DH_IMMERSE_SEARCH: String(IMMERSION.waterSearchPx),
    DH_IMMERSE_WATER_DEPTH: f(IMMERSION.waterDepthShare),
    DH_IMMERSE_GLINT: f(IMMERSION.glintPx),
    DH_IMMERSE_CLEAR: f(IMMERSION.clearPx),
    DH_ICE_PLATE: f(ICE.plateCellPx),
    DH_ICE_JITTER: f(ICE.plateJitter),
    DH_ICE_HAIR_OFFSET: v2(ICE.hairOffsetPx),
    DH_ICE_HAIR_STRENGTH: f(ICE.hairStrength),
    DH_ICE_LIP_STRENGTH: f(ICE.lipStrength),
    DH_ICE_LEVEL_TOLERANCE: f(ICE.levelTolerancePx),
    DH_ICE_CRACK_WIDTH: f(ICE.crackWidthPx),
    DH_ICE_CRACK_SHARE: f(ICE.crackShare),
    DH_ICE_HAIR: f(ICE.hairCellPx),
    DH_ICE_HAIR_SHARE: f(ICE.hairShare),
    DH_ICE_GROUND_SHARE: f(ICE.groundCrackShare),
    DH_ICE_GROUND_STRENGTH: f(ICE.groundCrackStrength),
    DH_ICE_EDGE_CELL: f(ICE.edgeCellPx),
    DH_ICE_EDGE_MIN: f(ICE.edgeMin),
    DH_ICE_EDGE_SPREAD: f(ICE.edgeSpread),
    DH_ICE_SKY: f(ICE.skyShare),
    DH_ICE_EDGE_OPACITY: f(ICE.edgeOpacity),
    DH_ICE_DEEP_SHOW: f(ICE.deepShowThrough),
  };
}
