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
  /** Angle of the trains against the wind [rad]. */
  angles: [0, 0.7, -0.9],
  /** Share of each train in the slope. */
  weights: [0.55, 0.3, 0.15],
  /** Phase speed [px/s]. */
  speedPxPerSecond: 7,
  /** Slope of the ambient waves in calm air and at full wind. */
  calmSlope: 0.17,
  windSlope: 0.32,
  /** Share of the ambient motion left with "Reduzierte Bewegung" (§29). */
  reducedMotion: 0.4,
  /**
   * Slope towards the sky above which a water pixel is a step lighter (below its negative: a step darker) – the
   * moving light and dark dashes of the surface, whole pixels.
   */
  lightThreshold: 0.16,
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
  /** Colour the water absorbs towards (lit by the ambient light) and the tint of the shallows. */
  deepColor: 'wasser.0',
  shallowColor: 'wasser.4',
  /** Share of the shallow tint right at the shore (turquoise shallows, fading out by a third of the full depth). */
  shallowTint: 0.14,
} as const;

/** Shore foam over the water's distance field (§6.1 pass 7 "Uferschaum (SDF)"). */
export const FOAM = {
  /** Width of the foam band at the shore [px] (its breathing adds `surgePx`). */
  widthPx: 1.1,
  /** How far the surf runs up and back [px], and its period [s]. */
  surgePx: 1.4,
  surgePeriodSeconds: 3.4,
  /** A second, broken line of foam further out [px] and its share of pixels. */
  outerLinePx: 4.5,
  outerShare: 0.3,
  /** How much of the water colour the foam covers: the solid band, the broken line. */
  cover: 0.72,
  shadeCover: 0.45,
  /** Size of the foam's break-up cells [px]. */
  cellPx: 3,
  /** Colour of foam and of its shaded underside, and how much of the light falling on the water it reflects. */
  color: 'eis.4',
  shadeColor: 'eis.2',
  /** Wave crests of the interactive field whiter than this height carry foam too (the ring around a swimmer). */
  crestHeight: 0.55,
} as const;

/** White water where a waterfall (the terrain's falling water on a wall) meets the water below it. */
export const FALL_FOAM = {
  /** How far below the fall the pool churns [px]. */
  reachPx: 6,
  /** Share of churning pixels right under the fall (thinning out to none at `reachPx`); half as many again are shaded foam. */
  share: 0.8,
  /** How often the churn changes [per second]. */
  flickerPerSecond: 8,
  /** Tilt of the G-buffer normal from which a water pixel is falling water (a wall faces south, open water up). */
  fallTilt: 0.3,
} as const;

/** Caustics in the shallows (§6.1 pass 7 "Kaustiken im Flachen"). */
export const CAUSTICS = {
  /** Size of a caustic cell [px] and its drift speed [px/s]. */
  cellPx: 15,
  driftPxPerSecond: 3,
  /** Width of a caustic line (F2 − F1 in cell units: one to two pixels). */
  lineWidth: 0.085,
  /** Depth share (0 at the shore, 1 at full depth) up to which caustics show; they fade towards it in `fadeSteps` steps. */
  maxDepth: 0.5,
  fadeSteps: 3,
  /** Share of the caustic colour laid over the ground on a line at full sun (twice where both layers cross), and the colour. */
  strength: 0.32,
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
  /** Share of the reflected object in the water colour (calm water; waves break it up). */
  objectShare: 0.48,
  /** Fade of object reflections towards the end of the search and at the picture's top edge [px]. */
  fadePx: 24,
  /** Sideways displacement of reflections by the wave slope [px per unit of slope] and its cap [px]. */
  distortPxPerSlope: 5,
  maxDistortPx: 3,
} as const;

/** The sky as the water mirrors it: colours by time of day and weather, stars, moon, sun glitter. */
export const SKY = {
  /** Share of the sky in the water colour by day and by night (the night sky is dark: stars and moon need more). */
  dayShare: 0.32,
  nightShare: 0.55,
  /** Parallax of the mirrored sky against the camera (0 = fixed to the screen like the real reflection of an infinitely far sky). */
  parallax: 0.12,
  /** Sky colours (palette references): day (zenith, horizon), twilight, night, overcast. */
  dayZenith: 'wasser.3',
  dayHorizon: 'eis.1',
  duskZenith: 'verderb.3',
  duskHorizon: 'laub.3',
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

/** Stars mirrored in the water at night (M5-23 "Sterne in Wasserspiegelungen"). */
export const STARS = {
  /** Cell of the star field [px]: at most one star per cell. */
  cellPx: 7,
  /** Share of cells with a star. */
  density: 0.16,
  /** Share of stars bright enough for a cross of four dimmer neighbours. */
  brightShare: 0.12,
  /** Twinkle: speed [rad/s] and depth (share of the brightness that comes and goes). */
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
  /** Glitter path below the disc: length [px], half width at its end [px], share of pixels that sparkle. */
  pathPx: 70,
  pathHalfWidthPx: 9,
  pathSparkle: 0.3,
} as const;

/**
 * Sun glitter by day: short dashes of light on the crests of the small waves that face the sky (the light side of the
 * wave shading) – lines of sparkle along the crests that come and go, never a starfield.
 */
export const GLITTER = {
  /** Share of the sky-facing crest pixels where a glint starts at full sun, and the glint's brightness (HDR). */
  share: 0.02,
  brightness: 1.6,
  color: 'feuer.5',
  /** A glint is a dash along the crest: two pixels, three for this share of them (a single pixel would read as a star). */
  longShare: 0.35,
  /**
   * How far a pixel must lie up the sky-facing flank of the small waves for a glint (its facing over the waves'
   * largest slope in the wind of the moment: 1 on the steepest point); the full chance from `fullFacing`.
   */
  facing: 0.55,
  fullFacing: 0.85,
  /** How often a glint moves on [per second]. */
  flickerPerSecond: 3,
} as const;

/** Immersion mask for figures (§6.1 pass 7 "Eintauchmaske für Figuren"). */
export const IMMERSION = {
  /** How deep a wading figure stands in shallow water [px above its feet]. */
  wadeDepthPx: 3,
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
  /** The wobble of the waterline along the body [px] and its speed [rad/s]. */
  wobblePx: 1,
  wobbleSpeed: 3.1,
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
  /** Crack network: cell size [px] of the plates, width of a crack [px], share of plate edges that are cracked. */
  plateCellPx: 19,
  crackWidthPx: 0.6,
  crackShare: 0.62,
  /** Fine hairline cracks inside the plates (cell size [px], share). */
  hairCellPx: 7,
  hairShare: 0.2,
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
export const WATER_FRAME_VEC4S = 7;

/** `#define`s of the water shaders (GLSL and TypeScript share one set of numbers). */
export function waterDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const w = AMBIENT_WAVES;
  return {
    DH_WATER_TILE_PX: f(TILE_PX),
    DH_WATER_FRAME_VEC4S: String(WATER_FRAME_VEC4S),
    DH_LIGHT_HUE: f(LIGHT_HUE),
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
    DH_AMBIENT_W0: f(w.weights[0]),
    DH_AMBIENT_W1: f(w.weights[1]),
    DH_AMBIENT_W2: f(w.weights[2]),
    DH_AMBIENT_SPEED: f(w.speedPxPerSecond),
    DH_AMBIENT_CALM: f(w.calmSlope),
    DH_AMBIENT_WINDY: f(w.windSlope),
    DH_WAVE_LIGHT: f(w.lightThreshold),
    DH_SHORE_SEARCH: String(SHORE_SEARCH_PX),
    DH_SHORE_SLACK: f((TILE_PX * Math.SQRT2) / 2 + SHORE_TILES.artReachPx),
    DH_REFRACT_MAX: f(REFRACTION.maxPx),
    DH_REFRACT_PER_SLOPE: f(REFRACTION.pxPerSlope),
    DH_REFRACT_SHALLOW: f(REFRACTION.shallowShare),
    DH_DEPTH_FULL: f(DEPTH.fullDepthPx),
    DH_DEPTH_ABSORB: f(DEPTH.deepAbsorb),
    DH_SHALLOW_TINT: f(DEPTH.shallowTint),
    DH_FOAM_WIDTH: f(FOAM.widthPx),
    DH_FOAM_SURGE: f(FOAM.surgePx),
    DH_FOAM_PERIOD: f(FOAM.surgePeriodSeconds),
    DH_FOAM_OUTER: f(FOAM.outerLinePx),
    DH_FOAM_OUTER_SHARE: f(FOAM.outerShare),
    DH_FOAM_CELL: f(FOAM.cellPx),
    DH_FOAM_COVER: f(FOAM.cover),
    DH_FOAM_SHADE_COVER: f(FOAM.shadeCover),
    DH_FOAM_CREST: f(FOAM.crestHeight),
    DH_FALL_REACH: String(FALL_FOAM.reachPx),
    DH_FALL_SHARE: f(FALL_FOAM.share),
    DH_FALL_FLICKER: f(FALL_FOAM.flickerPerSecond),
    DH_FALL_TILT: f(FALL_FOAM.fallTilt),
    DH_CAUSTIC_CELL: f(CAUSTICS.cellPx),
    DH_CAUSTIC_DRIFT: f(CAUSTICS.driftPxPerSecond),
    DH_CAUSTIC_LINE: f(CAUSTICS.lineWidth),
    DH_CAUSTIC_MAX_DEPTH: f(CAUSTICS.maxDepth),
    DH_CAUSTIC_STEPS: f(CAUSTICS.fadeSteps),
    DH_CAUSTIC_STRENGTH: f(CAUSTICS.strength),
    DH_REFLECT_MAX: f(REFLECTION.maxDistancePx),
    DH_REFLECT_STEP: f(REFLECTION.stepPx),
    DH_REFLECT_FINE: f(REFLECTION.fineReachPx),
    DH_REFLECT_TOLERANCE: f(REFLECTION.tolerancePx),
    DH_REFLECT_SHARE: f(REFLECTION.objectShare),
    DH_REFLECT_FADE: f(REFLECTION.fadePx),
    DH_REFLECT_DISTORT: f(REFLECTION.distortPxPerSlope),
    DH_REFLECT_MAX_DISTORT: f(REFLECTION.maxDistortPx),
    DH_SKY_PARALLAX: f(SKY.parallax),
    DH_STAR_CELL: f(STARS.cellPx),
    DH_STAR_DENSITY: f(STARS.density),
    DH_STAR_BRIGHT_SHARE: f(STARS.brightShare),
    DH_STAR_TWINKLE_SPEED: f(STARS.twinkleSpeed),
    DH_STAR_TWINKLE_DEPTH: f(STARS.twinkleDepth),
    DH_STAR_BRIGHTNESS: f(STARS.brightness),
    DH_MOON_BRIGHTNESS: f(MOON.brightness),
    DH_MOON_RADIUS: f(MOON.radiusPx),
    DH_MOON_DARK: f(MOON.darkShare),
    DH_MOON_PATH: f(MOON.pathPx),
    DH_MOON_PATH_WIDTH: f(MOON.pathHalfWidthPx),
    DH_MOON_PATH_SPARKLE: f(MOON.pathSparkle),
    DH_GLITTER_SHARE: f(GLITTER.share),
    DH_GLITTER_BRIGHTNESS: f(GLITTER.brightness),
    DH_GLITTER_LONG: f(GLITTER.longShare),
    DH_GLITTER_FACING: f(GLITTER.facing),
    DH_GLITTER_FULL_FACING: f(GLITTER.fullFacing),
    DH_GLITTER_FLICKER: f(GLITTER.flickerPerSecond),
    DH_MAX_IMMERSIONS: String(MAX_IMMERSIONS),
    DH_IMMERSE_VISIBILITY: f(IMMERSION.visibility),
    DH_IMMERSE_FADE: f(IMMERSION.fadePerPx),
    DH_IMMERSE_TINT: f(IMMERSION.tintShare),
    DH_IMMERSE_TINT_FLOOR: f(IMMERSION.tintFloor),
    DH_IMMERSE_BODY: f(IMMERSION.bodyShare),
    DH_IMMERSE_WOBBLE: f(IMMERSION.wobblePx),
    DH_IMMERSE_WOBBLE_SPEED: f(IMMERSION.wobbleSpeed),
    DH_IMMERSE_GLINT: f(IMMERSION.glintPx),
    DH_IMMERSE_CLEAR: f(IMMERSION.clearPx),
    DH_ICE_PLATE: f(ICE.plateCellPx),
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
