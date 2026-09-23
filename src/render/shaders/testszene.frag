#version 300 es
precision highp float;
// M0 test scene on the M1 pipeline: palette ramps lit by a wandering warm light with pixel-sized
// banding + Bayer dither, written to the HDR target (1 px border around the view).
#include "bayer.glsl"
#include "palette.glsl"
#include "hdr.glsl"
out vec4 oColor;
uniform sampler2D uPaletteLut;
uniform vec2 uSize;           // visible view size (internal px, without border)
uniform vec2 uLight;          // light centre in view px (y up)
const float BANDS_Y = 12.0;
const float STEPS_X = 6.0;
const float LIGHT_RADIUS = 90.0;
const float AMBIENT = 0.12;
const float LIGHT_GAIN = 1.1;
const float LEVELS = 8.0;
const vec3 COOL = vec3(0.55, 0.6, 0.9);
const vec3 WARM = vec3(1.0, 0.82, 0.6);
void main() {
  vec2 px = floor(gl_FragCoord.xy) - 1.0;
  float band = floor(px.y / (uSize.y / BANDS_Y));
  float step = floor(px.x / (uSize.x / STEPS_X));
  int idx = int(clamp(band * STEPS_X + step, 0.0, 63.0));
  vec3 albedo = paletteColor(uPaletteLut, idx + 1, 0);
  float d = length(px - uLight) / LIGHT_RADIUS;
  float light = AMBIENT + LIGHT_GAIN * clamp(1.0 - d * d, 0.0, 1.0);
  light = floor(light * LEVELS + bayer4(px)) / LEVELS;
  oColor = encodeHdr(albedo * light * mix(COOL, WARM, clamp(light, 0.0, 1.0)));
}
