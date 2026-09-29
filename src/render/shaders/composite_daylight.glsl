// The point light over the daylight (M5 review M1, M5-41): share of the point light a pixel keeps over its daylight
// `day` while the scene's daylight stands at `level` (its ambient's brightest channel, 0 … 1: `dayLevel` in
// src/render/light/banding.ts, uploaded as `uDayLevel`). By day what the daylight lights fully gains nothing more and a
// room or a shadow gains in the measure of its darkness (a soft add instead of doubling the light); at dusk and night,
// when the scene's own daylight is low, the point light keeps nearly all of it. Shared by every program that adds the
// light pass's light to something the daylight lights: the composition (its pixel's daylight), the GPU particles and
// their light (the ambient) and the fog's scattered light (the ambient). Needs `DH_POINT_DAY_SUPPRESSION`
// (`pointOverDaylightDefines`, part of `lightStrandDefines`). Mirrors `pointOverDaylight` in banding.ts.

// The share by the daylight's brightest channel `peak` (the scalar core, compared with the TypeScript mirror).
float pointOverPeak(float peak, float level) {
  return 1.0 - DH_POINT_DAY_SUPPRESSION * clamp(peak, 0.0, 1.0) * level;
}

float pointOverDaylight(vec3 day, float level) {
  return pointOverPeak(max(max(day.r, day.g), day.b), level);
}
