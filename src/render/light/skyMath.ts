/**
 * The arithmetic of sky, sun and moon (M5-02 … M5-04): pure functions shared by the scene filler
 * (`world/skyScene.ts`), the passes and the unit tests.
 *
 * - **Daylight split:** the ambient light of the frame (`scene.env`, colour × strength) is divided into the light of
 *   the sky and the directed light of sun or moon. On a flat, unshadowed pixel both add up to the ambient exactly,
 *   so the palette colours stay as painted by day; in a shadow only the (cooler) sky part remains.
 * - **Light direction:** the unit vector towards sun or moon in the screen space of the normal maps, from the
 *   calendar's shadow vector (shadows fall away from the light) and elevation.
 * - **Silhouette shear:** where a caster pixel's shadow falls (the pass does the same per vertex).
 * - **Cloud drift:** the offset of the cloud field, moving downwind.
 */
import { CLOUDS, DAYLIGHT, MOONLIGHT_PARAMS } from './params';
import type { DirectionalLight, SkyState } from './sky';

const DEG_TO_RAD = Math.PI / 180;

/** A mutable RGB triple. */
export interface Rgb3 {
  r: number;
  g: number;
  b: number;
}

/**
 * Splits the ambient `ambient` (linear colour × strength) into sky light and directed light: `share` of it arrives as
 * directed light with the hue shift `warmth` (> 0: warmer than the ambient, its sky part cooler by the same amount;
 * < 0: cooler, like the moon), the rest as sky light. Writes the tints (multipliers of the ambient colour) into `out`; the two parts sum to the
 * ambient on a flat unshadowed pixel.
 */
export function splitDaylight(share: number, warmth: number, out: DirectionalLight): DirectionalLight {
  const s = Math.max(0, Math.min(1, share));
  out.share = s;
  if (s <= 0) {
    out.dirR = out.dirG = out.dirB = 0;
    out.skyR = out.skyG = out.skyB = 1;
    return out;
  }
  const sky = 1 - s;
  // The sky part leans blue by `warmth` (relative), the directed part takes the complement: sky + dir = 1 per channel.
  // A negative warmth (the moon) makes the directed part the cooler one. Limited so that no part goes negative.
  const limit = s / Math.max(sky, 1e-6);
  const w = Math.max(-limit, Math.min(warmth, limit));
  out.skyR = sky * (1 - w);
  out.skyG = sky;
  out.skyB = sky * (1 + w);
  out.dirR = 1 - out.skyR;
  out.dirG = 1 - out.skyG;
  out.dirB = 1 - out.skyB;
  return out;
}

/**
 * Unit direction towards a light (screen space of the normal maps: +x right, +y up, +z towards the viewer) whose
 * shadows fall along (shadowX, shadowY) (+y south) at `elevationDeg`: the light stands opposite its shadows; height
 * shows as screen-up in the 3/4 view (the light pass's convention: y = height − southward, z = height).
 */
export function lightDirection(shadowX: number, shadowY: number, elevationDeg: number, out: DirectionalLight): DirectionalLight {
  const e = Math.max(0, elevationDeg) * DEG_TO_RAD;
  const c = Math.cos(e);
  const s = Math.sin(e);
  const hx = -shadowX * c;
  const hy = -shadowY * c;
  const x = hx;
  const y = s - hy;
  const z = Math.max(s, 0.05);
  const len = Math.sqrt(x * x + y * y + z * z);
  out.lx = x / len;
  out.ly = y / len;
  out.lz = z / len;
  return out;
}

/** Share of the ambient that the sun sends as directed light at elevation `elevationDeg` with shadow strength `strength`. */
export function sunShare(elevationDeg: number, strength: number, lightFactor: number): number {
  const low = Math.max(0, Math.min(1, elevationDeg / DAYLIGHT.lowSunDeg));
  // Overcast skies scatter the sun: the weather's daylight factor below `clearFrom` moves light from the sun into the
  // sky, at `overcastBelow` none is left – a cloudy day keeps its sun between the clouds, rain has none.
  const d = DAYLIGHT.scatter;
  const scatter = Math.max(0, Math.min(1, (lightFactor - d.overcastBelow) / (d.clearFrom - d.overcastBelow)));
  return (1 - DAYLIGHT.skyShare) * low * Math.max(0, Math.min(1, strength)) * scatter;
}

/** Share of the night ambient the moon sends as directed light (strength already includes its phase). */
export function moonShare(strength: number, fullMoonStrength: number): number {
  if (!(fullMoonStrength > 0)) return 0;
  return MOONLIGHT_PARAMS.directedShareFullMoon * Math.max(0, Math.min(1, strength / fullMoonStrength));
}

/** Where the shadow of a caster point at (x, groundY) with height `h` falls on the ground plane (shadow vector, length per unit height). */
export function shearedShadowPoint(x: number, groundY: number, h: number, shadowX: number, shadowY: number, length: number): [number, number] {
  return [x + shadowX * length * h, groundY + shadowY * length * h];
}

/** Offset of the cloud field at presentation time `time` [s] for a wind blowing towards (windX, windY) at strength 0…1. */
export function cloudOffset(windX: number, windY: number, strength: number, time: number, out: { offsetX: number; offsetY: number }): void {
  const len = Math.sqrt(windX * windX + windY * windY);
  const s = Math.max(0, Math.min(1, strength));
  const speed = CLOUDS.calmSpeedPxPerSecond + (CLOUDS.speedPxPerSecond - CLOUDS.calmSpeedPxPerSecond) * s;
  const dx = len > 0 ? windX / len : 1;
  const dy = len > 0 ? windY / len : 0;
  // The field moves downwind: a point of the field seen at world p now was at p − offset; offset grows with the wind.
  out.offsetX = -dx * speed * time;
  out.offsetY = -dy * speed * time;
}

/** Cloud cover of a sky with the weather's cloudiness `cloudiness` (0 clear … 1 overcast). */
export function cloudCover(cloudiness: number): number {
  const c = Math.max(0, Math.min(1, cloudiness));
  return CLOUDS.clearCover + (CLOUDS.overcastCover - CLOUDS.clearCover) * c;
}

/**
 * Sky light and directed light of the frame (linear colour × strength) for the composition: the ambient `r, g, b`
 * split by the sky's tints – all of it sky light while no directed light shines.
 */
export function daylightParts(r: number, g: number, b: number, sky: Pick<SkyState, 'hasDirectional' | 'directional'>, skyOut: Rgb3, dirOut: Rgb3): void {
  const d = sky.directional;
  const dir = sky.hasDirectional;
  skyOut.r = r * (dir ? d.skyR : 1);
  skyOut.g = g * (dir ? d.skyG : 1);
  skyOut.b = b * (dir ? d.skyB : 1);
  dirOut.r = dir ? r * d.dirR : 0;
  dirOut.g = dir ? g * d.dirG : 0;
  dirOut.b = dir ? b * d.dirB : 0;
}
