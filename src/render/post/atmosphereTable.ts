/**
 * Atmosphere of every biome, daytime and weather (docs/ART.md §5 "Grading-Absicht", MASTERPROMPT §6.1
 * pass 8/9; M5-10, M5-14, M5-22): the grade by day and by night, the twilight grades, the fog (base
 * density, morning mist, night mist, colour, height), the heat shimmer and the corruption base value of
 * each biome, and what each weather adds. Colours are palette references (`rampe.stufe`).
 *
 * The game view blends these by the biome weights around the camera, the daylight of the calendar and
 * the weather blend of the camera's region (`src/render/world/atmosphereScene.ts`). Grünhain by day is
 * the neutral grade – the reference of all tints (ART.md), its palette reaches the screen as painted.
 */
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { paletteRefHex } from '../palette/rows';
import type { WeatherStateId } from '../../content/weather';
import type { GradingPartial } from './grading';

const BYTE_MAX = 255;
const HEX_RADIX = 16;

/** A palette reference as display-space RGB (0…1). */
export function paletteColor(ref: string): readonly [number, number, number] {
  const hex = paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX);
  return [Number.parseInt(hex.slice(1, 3), HEX_RADIX) / BYTE_MAX, Number.parseInt(hex.slice(3, 5), HEX_RADIX) / BYTE_MAX, Number.parseInt(hex.slice(5, 7), HEX_RADIX) / BYTE_MAX];
}

/** Split toning of the shadows towards a palette colour (premultiplied by the amount, see GRADING_KEYS). */
function shadows(ref: string, amount: number): GradingPartial {
  const [r, g, b] = paletteColor(ref);
  return { shadowR: r * amount, shadowG: g * amount, shadowB: b * amount, shadowAmount: amount };
}

/** Split toning of the highlights towards a palette colour (premultiplied by the amount). */
function highlights(ref: string, amount: number): GradingPartial {
  const [r, g, b] = paletteColor(ref);
  return { highlightR: r * amount, highlightG: g * amount, highlightB: b * amount, highlightAmount: amount };
}

/** Uniform lift of the blacks (a haze over the darkest values). */
function lift(v: number): GradingPartial {
  return { liftR: v, liftG: v, liftB: v };
}

/** Uniform gamma (above 1 opens the darks). */
function gamma(v: number): GradingPartial {
  return { gammaR: v, gammaG: v, gammaB: v };
}

/** Uniform gain. */
function gain(v: number): GradingPartial {
  return { gainR: v, gainG: v, gainB: v };
}

/** Fog of a biome. */
export interface BiomeFog {
  /** Density at any time (0…1). */
  readonly base: number;
  /** Extra density at dawn (morning mist, peaks mid-twilight). */
  readonly mist: number;
  /** Extra density at night (ground mist). */
  readonly night: number;
  /** Fog colour (lit by the ambient light). */
  readonly color: string;
  /** Height above the ground where the fog has thinned out [px]. */
  readonly heightPx: number;
}

/** Atmosphere of one biome. */
export interface BiomeAtmosphere {
  readonly day: GradingPartial;
  /** The grade at night (underground: the same as `day`, there is no sky). */
  readonly night: GradingPartial;
  readonly fog: BiomeFog;
  /** Heat shimmer at full daylight under a clear sky (0…1; underground: always). */
  readonly heat: number;
  /** Corruption of the biome's regions until their beacon burns (0…1, M7 lowers it per region). */
  readonly corruption: number;
}

/** Fog height of low ground mist and of thick fog [px above the ground]. */
const MIST_HEIGHT_PX = 28;
const FOG_HEIGHT_PX = 56;

/** The grade of a cold, violet-shadowed night (shared start of the surface night grades). */
const NIGHT_BASE: GradingPartial = { temperature: -0.18, saturation: 0.9, contrast: 1.04, vignette: 0.28 };

/** Atmosphere by biome id (every biome of src/content/biomes.ts; tests keep it complete). */
export const BIOME_ATMOSPHERE: Readonly<Record<string, BiomeAtmosphere>> = {
  gruenhain: {
    // ART.md: "Tag warm-neutral … Referenz aller Tönungen" – the neutral grade.
    day: {},
    // "Nacht kühles Blau mit violetten Schatten".
    night: { ...NIGHT_BASE, ...shadows('nacht.4', 0.3), ...highlights('eis.3', 0.08) },
    fog: { base: 0, mist: 0.3, night: 0.05, color: 'eis.2', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  salzkueste: {
    // "Hell und luftig, leicht cyanfarbene Lichter, hoher Weißanteil, dunstige Ferne".
    day: { ...lift(0.035), contrast: 0.94, saturation: 0.95, temperature: -0.08, ...highlights('wasser.5', 0.18) },
    // "Nacht marineblau mit silbernem Mondlicht".
    night: { ...NIGHT_BASE, temperature: -0.25, ...shadows('wasser.2', 0.25), ...highlights('eis.3', 0.15) },
    fog: { base: 0.06, mist: 0.25, night: 0.06, color: 'eis.3', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  nebelmoor: {
    // "Entsättigt, grünlich-grau, flacher Kontrast; Nebel hebt die Schatten an, Lichter wirken diffus".
    day: { saturation: 0.75, contrast: 0.9, tint: -0.25, ...lift(0.03), ...shadows('stein.3', 0.15) },
    // "Nacht petrolschwarz".
    night: { ...NIGHT_BASE, saturation: 0.75, contrast: 0.96, tint: -0.15, ...shadows('wasser.2', 0.25) },
    fog: { base: 0.3, mist: 0.35, night: 0.15, color: 'eis.2', heightPx: FOG_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  frostkamm: {
    // "Kalt, blaue Schatten, strahlendes Weiß, geringe Sättigung – Feuer wirkt hier besonders warm".
    day: { temperature: -0.22, saturation: 0.85, ...shadows('eis.1', 0.2), ...gain(1.03) },
    // "Nacht klar und stahlblau".
    night: { ...NIGHT_BASE, temperature: -0.3, contrast: 1.08, ...shadows('eis.0', 0.25) },
    fog: { base: 0, mist: 0.2, night: 0, color: 'eis.3', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  glutsand: {
    // "Heiß: gebleichte Lichter, warmgelbe Mitteltöne, harte Mittagskontraste, Hitzeflimmern".
    day: { temperature: 0.12, contrast: 1.1, saturation: 0.9, ...gain(1.04), ...highlights('sand.4', 0.15) },
    // "die Nacht kippt kalt-violett".
    night: { ...NIGHT_BASE, temperature: -0.2, ...shadows('nacht.4', 0.35) },
    fog: { base: 0, mist: 0, night: 0, color: 'sand.4', heightPx: MIST_HEIGHT_PX },
    heat: 0.75,
    corruption: 0,
  },
  aschenschlund: {
    // "Dunkel und rauchig-entsättigt, Rot-Orange steigt aus der Tiefe, hoher Kontrast zwischen Asche und Glut".
    day: { saturation: 0.72, contrast: 1.12, ...gain(0.96), ...shadows('laub.1', 0.2), vignette: 0.2 },
    // Night (M5-63, ART §8): the moonlit ash lies at ≈ 0.02 … 0.08 – a contrast above 1 around the pivot crushed it,
    // the crowns and trunks to black and left only the glowing embers floating. The night opens the darks (gamma, no
    // extra contrast) and tints them in the biome's night colour `feuer.0`: ash, crowns and cliffs stay silhouettes.
    night: { ...NIGHT_BASE, saturation: 0.72, temperature: -0.05, contrast: 0.96, ...gamma(1.3), ...shadows('feuer.0', 0.4) },
    fog: { base: 0.1, mist: 0, night: 0.05, color: 'stein.2', heightPx: FOG_HEIGHT_PX },
    heat: 0.4,
    corruption: 0,
  },
  scherbenhain: {
    // "Kühl-pastellig, helle Lichter mit Bloom, prismatische Farbsäume, Lichtanomalien".
    day: { ...lift(0.03), saturation: 0.9, contrast: 0.95, temperature: -0.12, ...highlights('verderb.4', 0.1) },
    // "Nacht tiefviolett mit leuchtenden Kristallen".
    night: { ...NIGHT_BASE, temperature: -0.12, ...shadows('nacht.4', 0.35) },
    fog: { base: 0.08, mist: 0.15, night: 0.05, color: 'eis.2', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  nachtherz: {
    // "Umgekehrtes Licht: Lichtquellen kalt-weiß, Schatten violett glühend, stark entsättigt, schwere Vignette".
    // Figure before ground (M5-63, ART §8): corruption turns the figure's colours into the ground's violets (tunic
    // `wasser.2` → `nacht.2`, ground `verderb.1`/`nacht.3`), so it reads by its darker light and its contour only. The day
    // spreads the tones between them (more contrast, a little gain: black contour, pale face); the night opens its darks
    // (the violet ground glows, the figure stands dark on it) instead of crushing them.
    day: { saturation: 0.5, contrast: 1.27, ...gain(1.08), ...shadows('verderb.2', 0.3), ...highlights('eis.4', 0.3), vignette: 0.6 },
    night: { saturation: 0.5, contrast: 0.94, ...gamma(1.25), temperature: -0.15, ...shadows('verderb.2', 0.35), ...highlights('eis.4', 0.35), vignette: 0.7 },
    fog: { base: 0.12, mist: 0, night: 0.08, color: 'nacht.4', heightPx: FOG_HEIGHT_PX },
    heat: 0,
    corruption: 1,
  },
  wurzelhoehlen: {
    // "Umgebungslicht ≈ 0, erdig-warmes Dunkel … Fackeln tragen die Szene".
    day: { temperature: 0.1, ...shadows('erde.2', 0.2), vignette: 0.35 },
    night: { temperature: 0.1, ...shadows('erde.2', 0.2), vignette: 0.35 },
    fog: { base: 0.05, mist: 0, night: 0, color: 'stein.2', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  tiefgrund: {
    // "Kalt und blaugrau, sparsam".
    day: { temperature: -0.2, saturation: 0.82, ...shadows('stein.2', 0.2), vignette: 0.35 },
    night: { temperature: -0.2, saturation: 0.82, ...shadows('stein.2', 0.2), vignette: 0.35 },
    fog: { base: 0.08, mist: 0, night: 0, color: 'stein.3', heightPx: MIST_HEIGHT_PX },
    heat: 0,
    corruption: 0,
  },
  glutadern: {
    // "Heiß: tiefrote Schatten, Orange von unten, Hitzeflimmern; Lumenit als kalter Gegenpol".
    day: { temperature: 0.2, contrast: 1.08, ...shadows('laub.1', 0.3), vignette: 0.3 },
    night: { temperature: 0.2, contrast: 1.08, ...shadows('laub.1', 0.3), vignette: 0.3 },
    fog: { base: 0.06, mist: 0, night: 0, color: 'laub.1', heightPx: MIST_HEIGHT_PX },
    heat: 0.5,
    corruption: 0,
  },
};

/** The biome whose atmosphere applies where the camera finds no biome (open sea, unloaded ground). */
export const FALLBACK_BIOME = 'salzkueste';

/**
 * Twilight grades, added on top of the day/night blend with weight 4·d·(1 − d) of the daylight d (full
 * at mid-twilight). Grünhain ART.md: "Dämmerung orange-rosa".
 */
export const TWILIGHT_GRADING: { readonly dawn: GradingPartial; readonly dusk: GradingPartial } = {
  dawn: { temperature: 0.04, saturation: 1.03, ...highlights('haut.4', 0.18), ...shadows('eis.1', 0.15) },
  // Orange lights, rose mid-tones (a touch of magenta, red gain), violet shadows.
  dusk: { temperature: 0.8, tint: 0.45, gainR: 1.08, gainG: 0.97, gainB: 0.9, saturation: 1.05, ...highlights('laub.3', 0.5), ...shadows('nacht.4', 0.35), vignette: 0.14 },
};

/** What a weather state adds to the atmosphere. */
export interface WeatherAtmosphere {
  readonly grading: GradingPartial;
  /** Colour of the weather's haze (null: the biome's fog colour). */
  readonly fogColor: string | null;
  /** Height of the haze [px] (null: the biome's). */
  readonly fogHeightPx: number | null;
  /** Heat shimmer by day (0…1). */
  readonly heat: number;
}

/** Atmosphere by weather state (every state of src/content/weather.ts). */
export const WEATHER_ATMOSPHERE: Readonly<Record<WeatherStateId, WeatherAtmosphere>> = {
  klar: { grading: {}, fogColor: null, fogHeightPx: null, heat: 0 },
  bewoelkt: { grading: { saturation: 0.9, contrast: 0.95, temperature: -0.1 }, fogColor: null, fogHeightPx: null, heat: 0 },
  nebel: { grading: { saturation: 0.75, contrast: 0.85, temperature: -0.05, ...lift(0.03) }, fogColor: null, fogHeightPx: FOG_HEIGHT_PX + 24, heat: 0 },
  niesel: { grading: { saturation: 0.88, contrast: 0.95, temperature: -0.15 }, fogColor: 'stein.4', fogHeightPx: null, heat: 0 },
  regen: { grading: { saturation: 0.8, contrast: 0.95, temperature: -0.2, ...gain(0.95) }, fogColor: 'stein.4', fogHeightPx: null, heat: 0 },
  gewitter: { grading: { saturation: 0.75, contrast: 1.1, temperature: -0.25, ...gain(0.9), vignette: 0.25 }, fogColor: 'stein.3', fogHeightPx: null, heat: 0 },
  schnee: { grading: { saturation: 0.85, temperature: -0.25, ...lift(0.03) }, fogColor: 'eis.3', fogHeightPx: null, heat: 0 },
  schneesturm: { grading: { saturation: 0.65, contrast: 0.8, temperature: -0.3, ...lift(0.08) }, fogColor: 'eis.4', fogHeightPx: FOG_HEIGHT_PX + 24, heat: 0 },
  hitzewelle: { grading: { temperature: 0.15, contrast: 1.05, saturation: 0.92, ...gain(1.04) }, fogColor: null, fogHeightPx: null, heat: 0.6 },
  sandsturm: { grading: { temperature: 0.35, saturation: 0.8, contrast: 0.8, ...lift(0.06), ...highlights('sand.2', 0.35) }, fogColor: 'sand.3', fogHeightPx: FOG_HEIGHT_PX + 24, heat: 0.2 },
  ascheregen: { grading: { saturation: 0.6, contrast: 0.9, temperature: 0.05, ...lift(0.03), ...shadows('stein.1', 0.2) }, fogColor: 'stein.2', fogHeightPx: null, heat: 0 },
  sternschnuppennacht: { grading: { saturation: 1.05, contrast: 1.05 }, fogColor: null, fogHeightPx: null, heat: 0 },
};

/** The grade corruption pulls towards at full strength (dark-violet, drained, heavy edges). */
export const CORRUPTION_GRADING: GradingPartial = { saturation: 0.7, contrast: 1.06, temperature: -0.12, ...shadows('verderb.2', 0.3), ...gain(0.94), vignette: 0.4 };

/** Density of fog one unit of weather haze brings (a full fog weather). */
export const HAZE_TO_FOG = 0.85;
/** Most fog the picture shows (0…1): the scene stays readable under the thickest fog. */
export const MAX_FOG = 0.85;
/** Grain of the game view by day and at night (0…1; the grain is strongest in the dark). */
export const VIEW_GRAIN = { day: 0.25, night: 0.6 } as const;
