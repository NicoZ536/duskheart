// Light bands (MASTERPROMPT §6.1 pass 6 "optional 6–10 Lichtbänder mit 4×4-Bayer-Dither"): the light
// is quantised to `levels` steps per unit on its brightest channel, keeping its hue. `threshold` is
// the rounding threshold of the pixel: 0.5 = plain rounding, `bandThreshold(bayer)` = ordered dither
// over the middle DH_BAND_DITHER_SPREAD of each step, so every band keeps a flat core and only the
// transitions are dithered. Mirrors src/render/light/banding.ts.
float bandThreshold(float bayer) {
  return 0.5 + (bayer - 0.5) * DH_BAND_DITHER_SPREAD;
}

float lightBandLevel(float peak, float levels, float threshold) {
  return floor(peak * levels + threshold) / levels;
}

vec3 lightBands(vec3 c, float levels, float threshold) {
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= 0.0) return c;
  return c * (lightBandLevel(peak, levels, threshold) / peak);
}

// A daylight factor in steps of 1/DH_DAY_STEPS (M5 review Minor 6): ambient occlusion, the sun's penumbra and cloud
// edges change at pixel size with the pixel's Bayer threshold, like the light bands; 1 stays 1. Mirrors
// `daylightStep` in src/render/light/banding.ts.
float daylightStep(float v, float threshold) {
  return min(1.0, lightBandLevel(v, DH_DAY_STEPS, threshold));
}

// Share of the point light a pixel keeps over its daylight `day` (M5 review M1) while the scene's daylight stands at
// `level` (its ambient's brightest channel, 0 … 1): by day what the daylight lights fully gains nothing more and a room or a
// shadow gains in the measure of its darkness (a soft add instead of doubling the light); at dusk and night, when the
// scene's own daylight is low, the point light keeps nearly all of it. Mirrors `pointOverDaylight` in banding.ts.
float pointOverDaylight(vec3 day, float level) {
  return 1.0 - DH_POINT_DAY_SUPPRESSION * clamp(max(max(day.r, day.g), day.b), 0.0, 1.0) * level;
}
