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
