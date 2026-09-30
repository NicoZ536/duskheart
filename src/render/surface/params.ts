/**
 * Parameters of the world surface (MASTERPROMPT §6.2 "Wind", "Jahreszeiten", "Nässe", "Nacht", effect shaders;
 * M5-17 … M5-20, M5-23, M5-24; docs/RENDER.md §4 "Welt-Oberfläche"): every number the surface effects use, in one
 * data table – the shaders get them as `#define`s (`surfaceDefines`), the scene fillers read them directly.
 *
 * Units: world pixels, game minutes (the weather runs on the calendar: 1 game hour = 1 real minute at the
 * default day length), presentation seconds for purely visual motion (sway, flutter, blinking).
 */
import { FOOTSTEP_MATERIALS, type FootstepMaterial } from '../../content/terrain';
import { PALETTE_RAMPS } from '../../generated/palette';

export const SURFACE_PARAMS = {
  wind: {
    /** Sway of a whole sprite at full weather wind (×`windAmplitude` of the sprite) [scale]. */
    scale: 1.35,
    /** Share of the sway that is a steady lean downwind (the rest oscillates around it). */
    lean: 0.45,
    /** Vertical share of the sway when the wind blows north or south (3/4 view: the top dips towards the viewer). */
    depthShare: 0.35,
    /** Gusts: wavelength of the gust fronts rolling downwind over meadows [px], their speed [px/s] and strength. */
    gustWavelength: 150,
    gustSpeed: 70,
    gustStrength: 0.55,
    /** Flutter of wind-flagged pixels on rigid sprites (banners, laundry, drying bundles, flower pots): largest shift [px] at full wind. */
    flutterPx: 2,
    /** Flutter wave: rows per wave and cycles per second. */
    flutterRows: 6,
    flutterHz: 1.6,
  },
  /** Interactive grass (M5-17): the interaction texture around the camera. */
  grass: {
    /** Margin of the interaction texture beyond the frame on every side [px] (anchors of grass just outside the view). */
    marginPx: 24,
    /** Radius of a walking figure's push [px] and its strength at the centre. */
    benderRadiusPx: 9,
    benderStrength: 1,
    /** Half-life of a trail [s]: the grass springs back behind the figure. */
    springBackSeconds: 0.45,
    /** Frame step used while the presentation clock stands still (frozen screenshots) [s]: no decay. */
    frozenStepSeconds: 0,
    /** Largest sideways bend at the top of a grass sprite [px] and how far it is pressed down (share of its height). */
    bendPx: 5,
    flattenShare: 0.45,
    /** Offset of the two gradient probes around the anchor [px]. */
    probePx: 3,
    /** Bend response per object kind (grass and herbs bend fully, bushes are brushed, trees stand). */
    bendByKind: { pflanze: 1, deko: 0.7, busch: 0.35, baum: 0 } as Readonly<Record<string, number>>,
    /** Figures pushing the grass at once (the player now; creatures later). */
    maxBenders: 32,
  },
  /** Canopy and roof see-through (M5-18, final). */
  canopy: {
    /** Circle radius [px] (the player's body and a margin) and its lift above the feet (the body's middle). */
    radiusPx: 22,
    liftPx: 12,
    /** Inner share of the circle that is fully see-through; the ring outside it dithers out. */
    core: 0.72,
    /** Opening and closing of the circle [s] when the player steps under or out from a crown or roof. */
    openSeconds: 0.25,
    /** Frame step while the clock stands still (frozen screenshots) [share per frame]. */
    frozenStep: 0.2,
    /** Dither cell of the ring [px] (2 = clusters of two pixels, no single-pixel noise). */
    ditherCell: 1,
  },
  /** Seasons (M5-19): foliage rows blend over two days around each season change. */
  seasons: {
    transitionDays: 2,
    /** Weight of a pixel's ramp step in its switch threshold (light steps first); the rest comes from the tree's own seed. */
    rankWeight: 0.65,
  },
  /** Snow (M5-19): cover 0…1 grows with snowfall, melts above freezing. */
  snow: {
    /** Cover per game minute at full snowfall (precipitation 1): a full cover in ≈ 3 game hours of snow. */
    growPerMinute: 1 / 180,
    /** Melt per game minute and °C above `meltFromC`. */
    meltPerMinuteC: 1 / 900,
    meltFromC: 0.5,
    /** First sight of a world (no history): full cover at or below `coldC`, none at or above `warmC`. */
    coldC: -2,
    warmC: 2,
    /** Outside winter a first sight finds old snow only where it is this cold (permanent snow of the high mountains). */
    permanentBelowC: -10,
    /** Cluster noise of the snow line: base wavelength [px] and the cell size of the pattern [px]. */
    noiseWavelengthPx: 26,
    noiseDetailPx: 7,
    cellPx: 2,
    /** Up-facing share needed on sprites: pixels whose normal points at least this far up catch snow first. */
    spriteUpFrom: 0.2,
    /** Cover needed before the first pixel of a sprite's top catches snow (roofs and crowns stay dark in a dusting). */
    spriteCoverFrom: 0.15,
  },
  /** Footprints in snow (M5-19). */
  footprints: {
    /** Distance between two prints [px] and the sideways offset of left and right foot [px]. */
    stridePx: 5,
    sidePx: 2,
    /** A print fades over this many game minutes, faster while it snows (the snow fills it). */
    fadeMinutes: 120,
    fillPerSnowMinute: 3,
    /** Prints kept (older ones are dropped first). */
    capacity: 192,
    /** Snow cover from which a figure leaves prints on ground that is not a snow tile. */
    coverFrom: 0.35,
  },
  /** Wetness and puddles (M5-20). */
  wet: {
    /** Wetness per game minute at full rain; drying per game minute (≈ 2.5 game hours from soaked to dry) and faster in heat. */
    wetPerMinute: 1 / 25,
    dryPerMinute: 1 / 150,
    dryPerMinuteC: 1 / 3000,
    /** Puddles fill once the ground is this wet, and grow to `puddleCoverMax` of soft ground at full fill. */
    puddleFrom: 0.45,
    puddleFillPerMinute: 1 / 60,
    puddleDryPerMinute: 1 / 240,
    puddleCoverMax: 0.2,
    /** Puddle hollows: noise wavelength [px] and cell [px]. */
    puddleWavelengthPx: 40,
    puddleCellPx: 2,
    /** Wet ground: ramp steps darker at full wetness, gloss at full wetness; puddles: gloss. */
    darkenSteps: 1,
    gloss: 0.35,
    puddleGloss: 0.9,
    /**
     * A puddle mirrors the sky (M5-60: before, the ground two steps darker under the sky sheen read as a pale flat patch
     * by day): the water ramp in its middle, one cell under the north bank the bank's dark mirror image, one cell above
     * the south lip the light of the sky, and glints – in every glint cell of w × h px with the share `puddleGlintShare`
     * one dash of `puddleGlintLengthPx` on its top row, world-fixed. [ramp, step] of the palette.
     */
    puddleWater: ['wasser', 3] as const,
    puddleBank: ['wasser', 1] as const,
    puddleLip: ['wasser', 4] as const,
    puddleGlint: ['eis', 3] as const,
    puddleGlintCellPx: [8, 5] as const,
    puddleGlintLengthPx: 3,
    puddleGlintShare: 0.4,
    /** The rim: soaked ground one puddle cell wide around the water, this many ramp steps darker, and its gloss. */
    puddleRimSteps: 2,
    puddleRimGloss: 0.6,
    /**
     * By night a puddle mirrors a dark sky (M5-60): its tones (water, bank, lip, glint) go `puddleNightSteps` ramp steps
     * darker up to the daylight level `puddleNightLevel`, none from `puddleDayLevel` up, whole steps between – the
     * scene's daylight level `dayLevel` (the brightest channel of its ambient): a rainy noon 0.7, a rainy night
     * 0.14 … 0.25, a clear night under a full moon 0.36. Lit by a torch the water stays dark and shows the flame's mirror
     * image instead of a pale diffuse patch.
     */
    puddleNightSteps: 2,
    puddleNightLevel: 0.25,
    puddleDayLevel: 0.55,
    /** Share of the wetness a weathered sprite (rocks, roofs, trunks) shows as gloss. */
    spriteGloss: 0.25,
  },
  /** Mirror of lights in puddles (M5-20, pass `pfuetzen`). */
  puddleMirror: {
    /** Streak of a mirrored light: half width [px], length per px of light height, and brightness. */
    halfWidthPx: 3,
    lengthPerHeight: 1.6,
    minLengthPx: 6,
    strength: 1.3,
    /** Sky sheen: share of the ambient light a puddle mirrors. */
    sky: 0.3,
    /** Horizontal ripple of the streak while it rains [px] and its speed [rad/s]. */
    ripplePx: 1,
    rippleSpeed: 7,
  },
  /** Fireflies (M5-23): summer nights over meadows. */
  fireflies: {
    /** World cell per swarm [px] and fireflies per cell at most. */
    cellPx: 48,
    perCell: 2,
    /** Share of cells with fireflies. */
    density: 0.55,
    /** Drift radius [px], drift period [s], height over the ground [px]. */
    driftPx: 11,
    driftSeconds: 7,
    heightPx: 10,
    /** Blink period [s] and the lit share of it. */
    blinkSeconds: 3.2,
    litShare: 0.45,
    /** Daylight below which they come out. */
    daylightBelow: 0.2,
    /** Most fireflies per frame. */
    max: 64,
    /** Biomes and seasons of fireflies. */
    biomes: ['gruenhain', 'nebelmoor'] as readonly string[],
    seasons: ['fruehling', 'sommer'] as readonly string[],
    /**
     * Around a firefly creature (content `gluehwuermchen`, M6-20: a swarm one can watch and chase) the drifting ones keep this
     * clear [px] – its sprite already shows a little swarm, two drawn over each other would glow twice as bright. A world cell.
     */
    creatureClearPx: 48,
    /** Firefly creatures in view the drifting ones keep clear of, at most. */
    creatureMax: 16,
  },
  /** Glowing mushrooms and other emissive plants (M5-23): a slow breathing of their glow. */
  glow: {
    periodSeconds: 3.6,
    /** Extra emission at the peak (0…1 → ×(1 + 3·x), `emissiveBoost`). */
    boost: 0.35,
    /** Hard steps of the breath (pixel-art pulse, no smooth ramp). */
    steps: 4,
  },
  /** Effect shaders (M5-24). */
  effects: {
    /**
     * Interaction outline: a glint – the accent's lighter step – runs diagonally along it, anchored to the world: bands
     * `outlineGlintWidthPx` wide every `outlineGlintSpacingPx`, one spacing per `outlineGlintSeconds` (a slow shine,
     * never a blink; still with reduced motion).
     */
    outlineGlintSpacingPx: 36,
    outlineGlintWidthPx: 3,
    outlineGlintSeconds: 2.4,
    /**
     * Palette swap of an effect (`creep`): the order of the pixels mixes their ramp step (light first, share
     * `creepRankWeight`) with a world-anchored cluster noise over the sprite (wavelength and detail [px]).
     */
    creepWavelengthPx: 9,
    creepDetailPx: 4,
    creepRankWeight: 0.45,
    /** White flash strength with the accessibility option "Blitz- und Flackerreduktion". */
    reducedFlash: 0.45,
  },
} as const;

/** Surface classes of ground by footstep material (terrain content `footstep`): what weather does to it. */
export interface GroundSurface {
  /** Rain darkens it and makes it glossy. */
  readonly wets: boolean;
  /** Puddles gather in its hollows. */
  readonly puddles: boolean;
  /** It is snow already (prints show, the snow mask adds nothing). */
  readonly snow: boolean;
  /** Snow settles on it. */
  readonly catchesSnow: boolean;
}

export const GROUND_SURFACE: Readonly<Record<FootstepMaterial, GroundSurface>> = {
  gras: { wets: true, puddles: true, snow: false, catchesSnow: true },
  erde: { wets: true, puddles: true, snow: false, catchesSnow: true },
  sand: { wets: true, puddles: false, snow: false, catchesSnow: true },
  schnee: { wets: false, puddles: false, snow: true, catchesSnow: false },
  asche: { wets: true, puddles: false, snow: false, catchesSnow: true },
  kristall: { wets: true, puddles: false, snow: false, catchesSnow: true },
  schlamm: { wets: true, puddles: true, snow: false, catchesSnow: true },
  stein: { wets: true, puddles: true, snow: false, catchesSnow: true },
  eis: { wets: false, puddles: false, snow: false, catchesSnow: true },
  wurzel: { wets: true, puddles: false, snow: false, catchesSnow: false },
};

/** Surface bits of a terrain instance (`aBlend.z` of the terrain mesh). */
export const GROUND_BIT = { wets: 1, puddles: 2, snow: 4, catchesSnow: 8 } as const;

/** Surface bits of a footstep material (0 for ground without one, e.g. water or lava). */
export function groundBits(material: FootstepMaterial | null): number {
  if (material === null) return 0;
  const s = GROUND_SURFACE[material];
  return (s.wets ? GROUND_BIT.wets : 0) | (s.puddles ? GROUND_BIT.puddles : 0) | (s.snow ? GROUND_BIT.snow : 0) | (s.catchesSnow ? GROUND_BIT.catchesSnow : 0);
}

/** Every footstep material has its surface class (a new material must say how weather treats it). */
export const GROUND_MATERIALS: readonly FootstepMaterial[] = FOOTSTEP_MATERIALS;

/** Palette index (1…64) of step `step` of ramp `name`. */
export function rampIndex(name: string, step: number): number {
  let start = 1;
  for (const r of PALETTE_RAMPS) {
    if (r.name === name) {
      if (step < 0 || step >= r.size) throw new RangeError(`Palettenrampe ${name} hat keine Stufe ${step}`);
      return start + step;
    }
    start += r.size;
  }
  throw new Error(`Palettenrampe ${name} fehlt`);
}

/** Position of every palette index in its ramp, 0 (darkest) … 1 (lightest) – leaves change colour lightest first. */
export function rampRanks(ramps: readonly { readonly size: number }[] = PALETTE_RAMPS): number[] {
  const out: number[] = [];
  for (const r of ramps) for (let s = 0; s < r.size; s++) out.push(r.size > 1 ? s / (r.size - 1) : 0);
  return out;
}

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** First and last palette index of ramp `name` as a GLSL `ivec2`. */
function rampSpan(name: string): string {
  const r = PALETTE_RAMPS.find((x) => x.name === name);
  if (r === undefined) throw new Error(`Palettenrampe ${name} fehlt`);
  return `ivec2(${rampIndex(name, 0)}, ${rampIndex(name, r.size - 1)})`;
}

/** `#define`s of the surface for the sprite and terrain programs. */
export function surfaceDefines(): Readonly<Record<string, string>> {
  const p = SURFACE_PARAMS;
  return {
    DH_WIND_LEAN: glslFloat(p.wind.lean),
    DH_WIND_DEPTH_SHARE: glslFloat(p.wind.depthShare),
    DH_GUST_WAVELENGTH: glslFloat(p.wind.gustWavelength),
    DH_GUST_SPEED: glslFloat(p.wind.gustSpeed),
    DH_GUST_STRENGTH: glslFloat(p.wind.gustStrength),
    DH_FLUTTER_PX: glslFloat(p.wind.flutterPx),
    DH_FLUTTER_ROWS: glslFloat(p.wind.flutterRows),
    DH_FLUTTER_HZ: glslFloat(p.wind.flutterHz),
    DH_BEND_PX: glslFloat(p.grass.bendPx),
    DH_FLATTEN_SHARE: glslFloat(p.grass.flattenShare),
    DH_PROBE_PX: `${p.grass.probePx}`,
    DH_FADE_CORE: glslFloat(p.canopy.core),
    DH_SEASON_RANK_WEIGHT: glslFloat(p.seasons.rankWeight),
    DH_RAMP_RANKS: rampRanks().map(glslFloat).join(', '),
    DH_SNOW_WAVELENGTH: glslFloat(p.snow.noiseWavelengthPx),
    DH_SNOW_DETAIL: glslFloat(p.snow.noiseDetailPx),
    DH_SNOW_CELL: glslFloat(p.snow.cellPx),
    DH_SNOW_UP_FROM: glslFloat(p.snow.spriteUpFrom),
    DH_SNOW_SPRITE_FROM: glslFloat(p.snow.spriteCoverFrom),
    DH_SNOW_BASE: `${rampIndex('eis', 3)}`,
    DH_SNOW_LIGHT: `${rampIndex('eis', 4)}`,
    DH_SNOW_SHADE: `${rampIndex('eis', 2)}`,
    DH_SNOW_DEEP: `${rampIndex('eis', 1)}`,
    DH_PUDDLE_WAVELENGTH: glslFloat(p.wet.puddleWavelengthPx),
    DH_PUDDLE_CELL: glslFloat(p.wet.puddleCellPx),
    DH_PUDDLE_COVER: glslFloat(p.wet.puddleCoverMax),
    DH_WET_DARKEN_STEPS: glslFloat(p.wet.darkenSteps),
    DH_WET_GLOSS: glslFloat(p.wet.gloss),
    DH_PUDDLE_GLOSS: glslFloat(p.wet.puddleGloss),
    DH_PUDDLE_WATER: `${rampIndex(...p.wet.puddleWater)}`,
    DH_PUDDLE_BANK: `${rampIndex(...p.wet.puddleBank)}`,
    DH_PUDDLE_LIP: `${rampIndex(...p.wet.puddleLip)}`,
    DH_PUDDLE_GLINT: `${rampIndex(...p.wet.puddleGlint)}`,
    DH_PUDDLE_GLINT_CELL: `vec2(${glslFloat(p.wet.puddleGlintCellPx[0])}, ${glslFloat(p.wet.puddleGlintCellPx[1])})`,
    DH_PUDDLE_GLINT_LENGTH: glslFloat(p.wet.puddleGlintLengthPx),
    DH_PUDDLE_GLINT_SHARE: glslFloat(p.wet.puddleGlintShare),
    DH_PUDDLE_RIM_STEPS: `${p.wet.puddleRimSteps}`,
    DH_PUDDLE_RIM_GLOSS: glslFloat(p.wet.puddleRimGloss),
    DH_WET_SPRITE_GLOSS: glslFloat(p.wet.spriteGloss),
    DH_GLINT_SPACING: glslFloat(p.effects.outlineGlintSpacingPx),
    DH_GLINT_WIDTH: glslFloat(p.effects.outlineGlintWidthPx),
    DH_GLINT_SECONDS: glslFloat(p.effects.outlineGlintSeconds),
    DH_CREEP_WAVELENGTH: glslFloat(p.effects.creepWavelengthPx),
    DH_CREEP_DETAIL: glslFloat(p.effects.creepDetailPx),
    DH_CREEP_RANK_WEIGHT: glslFloat(p.effects.creepRankWeight),
    // Soil and plant ramps (snow settles on their pixels in cliff rims); gras and laub are neighbours in the palette.
    DH_SOIL_EARTH: rampSpan('erde'),
    DH_SOIL_PLANT: `ivec2(${rampIndex('gras', 0)}, ${rampIndex('laub', 4)})`,
    DH_SOIL_SAND: rampSpan('sand'),
    DH_GROUND_WETS: `${GROUND_BIT.wets}u`,
    DH_GROUND_PUDDLES: `${GROUND_BIT.puddles}u`,
    DH_GROUND_SNOW: `${GROUND_BIT.snow}u`,
    DH_GROUND_CATCHES_SNOW: `${GROUND_BIT.catchesSnow}u`,
  };
}
