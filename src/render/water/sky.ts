/**
 * The sky the water mirrors (§6.1 pass 7 "Spiegelung (Himmel; nachts Mond und Sterne …)", §6.2 "Sterne in
 * Wasserspiegelungen"): colours by daytime and weather from the palette, the stars of a clear night, the moon with
 * its phase and its place by its position in the sky, the sun's glitter with its mirror path and the sunlight that
 * makes caustics – a pure function of calendar and weather, so the game view, tests and scenarios agree.
 *
 * In the 3/4 view the water mirrors the sky behind the viewer's line of sight; the disc of the moon is placed on the
 * water by its east–west position (east → right) and its height (a high moon lies nearer the viewer, lower in the
 * picture). The stars and the moon are fixed to the screen with a slight parallax (`SKY.parallax`), as the mirror
 * image of an infinitely far sky is.
 */
import { BALANCE } from '../../content/balance';
import { paletteRgb } from './colour';
import { GLITTER, MOON, SKY, STARS } from './params';
import { SKY_FIELD as F, type WaterSky } from './state';

export { paletteRgb } from './colour';

const DAY_ZENITH = paletteRgb(SKY.dayZenith);
const DAY_HORIZON = paletteRgb(SKY.dayHorizon);
const DUSK_ZENITH = paletteRgb(SKY.duskZenith);
const DUSK_HORIZON = paletteRgb(SKY.duskHorizon);
const NIGHT_ZENITH = paletteRgb(SKY.nightZenith);
const NIGHT_HORIZON = paletteRgb(SKY.nightHorizon);
const OVERCAST = paletteRgb(SKY.overcast);
/** Highest elevation the sun reaches in any season [degrees] (a midsummer noon): its mirror path is shortest there. */
const SUN_MAX_ELEVATION_DEG = Math.max(...Object.values(BALANCE.calendar.noonSunElevationDeg));

/** What the sky of a frame depends on. */
export interface WaterSkyInput {
  /** Daylight 0 (night) … 1 (day) of the calendar. */
  daylight: number;
  /** Sun: elevation [degrees] (≤ 0 below the horizon), the direction its shadows fall in (x: +east) and shadow strength 0…1. */
  sunElevationDeg: number;
  sunShadowX: number;
  sunStrength: number;
  /** Moon: elevation [degrees], the direction its shadows fall in (x: +east), lit fraction 0…1, waxing. */
  moonElevationDeg: number;
  moonShadowX: number;
  moonIllumination: number;
  moonWaxing: boolean;
  /** Weather: cloud cover 0…1. */
  cloudCover: number;
  /** Under the ground (caves): no sky at all. */
  underground: boolean;
}

/** A zeroed input (allocate once, fill every frame). */
export function createSkyInput(): WaterSkyInput {
  return { daylight: 1, sunElevationDeg: 45, sunShadowX: 0, sunStrength: 1, moonElevationDeg: 0, moonShadowX: 0, moonIllumination: 0, moonWaxing: true, cloudCover: 0, underground: false };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Share 0…1 of twilight colours: 0 in full day and deep night, 1 halfway through dawn or dusk. */
export function twilightShare(daylight: number): number {
  const d = clamp01(daylight);
  return clamp01(4 * d * (1 - d));
}

/** Fills `out` with the mirrored sky of `input`. */
export function waterSkyInto(out: WaterSky, input: WaterSkyInput): WaterSky {
  const v = out.values;
  if (input.underground) {
    v.fill(0);
    v[F.moonLit] = 1;
    v[F.moonX] = 0.5;
    return out;
  }
  const d = clamp01(input.daylight);
  const dusk = twilightShare(d);
  const cloud = clamp01(input.cloudCover);
  const overcast = cloud * SKY.overcastShare;
  v[F.zenithR] = skyChannel(DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 0, d, dusk, overcast);
  v[F.zenithG] = skyChannel(DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 1, d, dusk, overcast);
  v[F.zenithB] = skyChannel(DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 2, d, dusk, overcast);
  v[F.horizonR] = skyChannel(DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 0, d, dusk, overcast);
  v[F.horizonG] = skyChannel(DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 1, d, dusk, overcast);
  v[F.horizonB] = skyChannel(DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 2, d, dusk, overcast);
  v[F.share] = mix(SKY.nightShare, SKY.dayShare, d);
  const clear = clamp01(1 - cloud / STARS.maxCloudCover);
  const night = 1 - d;
  v[F.stars] = night * night * clear;
  // The moon: up, lit, not washed out by the day, not behind clouds.
  const up = input.moonElevationDeg > 0 ? 1 : 0;
  v[F.moon] = up * clamp01(input.moonIllumination) * night * clamp01(1 - cloud);
  v[F.moonLit] = clamp01(input.moonIllumination);
  v[F.moonWaxing] = input.moonWaxing ? 1 : 0;
  const east = input.moonShadowX < 0 ? 1 : input.moonShadowX > 0 ? -1 : 0;
  v[F.moonX] = 0.5 + clamp01(Math.abs(input.moonShadowX)) * east * MOON.swingShare;
  const high = clamp01(input.moonElevationDeg / BALANCE.calendar.moonMaxElevationDeg);
  v[F.moonY] = mix(MOON.topShare, MOON.bottomShare, high);
  const sunUp = input.sunElevationDeg > 0 ? clamp01(input.sunStrength) : 0;
  v[F.glitter] = sunUp * clamp01(1 - cloud);
  v[F.sunlight] = sunUp * clamp01(1 - cloud * SKY.overcastShare);
  // The sun's mirror path: east → right like the moon; a high sun's lies nearer the viewer, shorter and wider.
  const sunEast = input.sunShadowX < 0 ? 1 : input.sunShadowX > 0 ? -1 : 0;
  v[F.sunX] = 0.5 + clamp01(Math.abs(input.sunShadowX)) * sunEast * GLITTER.swingShare;
  const sunHigh = clamp01(input.sunElevationDeg / SUN_MAX_ELEVATION_DEG);
  v[F.sunY] = mix(GLITTER.lowTop, GLITTER.highTop, sunHigh);
  v[F.sunPath] = mix(GLITTER.lowLength, GLITTER.highLength, sunHigh);
  v[F.sunPathWidth] = mix(GLITTER.lowHalfWidth, GLITTER.highHalfWidth, sunHigh);
  return out;
}

/**
 * One channel of a sky colour: night (dimmed to `SKY.nightBrightness`) to day by the daylight `d`, the twilight
 * colour laid over it (less under clouds), then the grey of the clouds – as bright as the light allows.
 */
function skyChannel(day: readonly number[], duskColour: readonly number[], night: readonly number[], c: number, d: number, dusk: number, overcast: number): number {
  const nightK = SKY.nightBrightness;
  const base = mix((night[c] ?? 0) * nightK, day[c] ?? 0, d);
  const lit = mix(base, duskColour[c] ?? 0, dusk * (1 - overcast));
  return mix(lit, (OVERCAST[c] ?? 0) * mix(nightK, 1, d) * mix(nightK * nightK, 1, d), overcast);
}
