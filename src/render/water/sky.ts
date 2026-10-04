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

/** Share 0…1 of twilight colours: 0 in full day and deep night, 1 halfway through dawn or dusk. */
export function twilightShare(daylight: number): number {
  const d = clamp01(daylight);
  return clamp01(4 * d * (1 - d));
}

/** Slots of the sky's scratch registers (`skyChannelInto`): daylight, twilight share, overcast. */
const K_DAY = 0;
const K_DUSK = 1;
const K_OVERCAST = 2;
const SKY_REGISTERS = new Float64Array(3);

/**
 * Fills `out` with the mirrored sky of `input`. Every mix and clamp is written out in place (the formulas of `mix`,
 * `clamp01` and `twilightShare`, the same numbers): the game view samples the sky every few ticks in code V8 has not
 * inlined, where a floating-point argument would be a new number per call (§30, ADR-0167).
 */
export function waterSkyInto(out: WaterSky, input: WaterSkyInput): WaterSky {
  const v = out.values;
  if (input.underground) {
    v.fill(0);
    v[F.moonLit] = 1;
    v[F.moonX] = 0.5;
    return out;
  }
  const daylight = input.daylight;
  const d = daylight < 0 ? 0 : daylight > 1 ? 1 : daylight;
  const twilight = 4 * d * (1 - d);
  const dusk = twilight < 0 ? 0 : twilight > 1 ? 1 : twilight;
  const cover = input.cloudCover;
  const cloud = cover < 0 ? 0 : cover > 1 ? 1 : cover;
  const overcast = cloud * SKY.overcastShare;
  const k = SKY_REGISTERS;
  k[K_DAY] = d;
  k[K_DUSK] = dusk;
  k[K_OVERCAST] = overcast;
  skyChannelInto(v, F.zenithR, DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 0, k);
  skyChannelInto(v, F.zenithG, DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 1, k);
  skyChannelInto(v, F.zenithB, DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, 2, k);
  skyChannelInto(v, F.horizonR, DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 0, k);
  skyChannelInto(v, F.horizonG, DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 1, k);
  skyChannelInto(v, F.horizonB, DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, 2, k);
  v[F.share] = SKY.nightShare + (SKY.dayShare - SKY.nightShare) * d;
  const starry = 1 - cloud / STARS.maxCloudCover;
  const clear = starry < 0 ? 0 : starry > 1 ? 1 : starry;
  const night = 1 - d;
  v[F.stars] = night * night * clear;
  // The moon: up, lit, not washed out by the day, not behind clouds.
  const up = input.moonElevationDeg > 0 ? 1 : 0;
  const illumination = input.moonIllumination;
  const lit = illumination < 0 ? 0 : illumination > 1 ? 1 : illumination;
  const open = 1 - cloud;
  const unclouded = open < 0 ? 0 : open > 1 ? 1 : open;
  v[F.moon] = up * lit * night * unclouded;
  v[F.moonLit] = lit;
  v[F.moonWaxing] = input.moonWaxing ? 1 : 0;
  const moonShadowX = input.moonShadowX;
  const east = moonShadowX < 0 ? 1 : moonShadowX > 0 ? -1 : 0;
  const moonSwing = Math.abs(moonShadowX);
  v[F.moonX] = 0.5 + (moonSwing > 1 ? 1 : moonSwing) * east * MOON.swingShare;
  const moonHigh = input.moonElevationDeg / BALANCE.calendar.moonMaxElevationDeg;
  const high = moonHigh < 0 ? 0 : moonHigh > 1 ? 1 : moonHigh;
  v[F.moonY] = MOON.topShare + (MOON.bottomShare - MOON.topShare) * high;
  const strength = input.sunStrength;
  const sunUp = input.sunElevationDeg > 0 ? (strength < 0 ? 0 : strength > 1 ? 1 : strength) : 0;
  v[F.glitter] = sunUp * unclouded;
  const bright = 1 - cloud * SKY.overcastShare;
  v[F.sunlight] = sunUp * (bright < 0 ? 0 : bright > 1 ? 1 : bright);
  // The sun's mirror path: east → right like the moon; a high sun's lies nearer the viewer, shorter and wider.
  const sunShadowX = input.sunShadowX;
  const sunEast = sunShadowX < 0 ? 1 : sunShadowX > 0 ? -1 : 0;
  const sunSwing = Math.abs(sunShadowX);
  v[F.sunX] = 0.5 + (sunSwing > 1 ? 1 : sunSwing) * sunEast * GLITTER.swingShare;
  const sunRise = input.sunElevationDeg / SUN_MAX_ELEVATION_DEG;
  const sunHigh = sunRise < 0 ? 0 : sunRise > 1 ? 1 : sunRise;
  v[F.sunY] = GLITTER.lowTop + (GLITTER.highTop - GLITTER.lowTop) * sunHigh;
  v[F.sunPath] = GLITTER.lowLength + (GLITTER.highLength - GLITTER.lowLength) * sunHigh;
  v[F.sunPathWidth] = GLITTER.lowHalfWidth + (GLITTER.highHalfWidth - GLITTER.lowHalfWidth) * sunHigh;
  return out;
}

/**
 * One channel of a sky colour into `v[slot]`: night (dimmed to `SKY.nightBrightness`) to day by the daylight `k[K_DAY]`,
 * the twilight colour laid over it (less under clouds), then the grey of the clouds – as bright as the light allows.
 * Written out with `mix(a, b, t) = a + (b − a) · t`; the numbers come in registers `k`, the result goes into `v`.
 */
function skyChannelInto(v: Float32Array, slot: number, day: readonly number[], duskColour: readonly number[], night: readonly number[], c: number, k: Float64Array): void {
  const d = k[K_DAY] as number;
  const dusk = k[K_DUSK] as number;
  const overcast = k[K_OVERCAST] as number;
  const nightK = SKY.nightBrightness;
  // The colours have three channels (`paletteRgb`): read without a default, which would make each a new number (§30).
  const dark = (night[c] as number) * nightK;
  const base = dark + ((day[c] as number) - dark) * d;
  const lit = base + ((duskColour[c] as number) - base) * (dusk * (1 - overcast));
  const grey = (OVERCAST[c] as number) * (nightK + (1 - nightK) * d) * (nightK * nightK + (1 - nightK * nightK) * d);
  v[slot] = lit + (grey - lit) * overcast;
}
