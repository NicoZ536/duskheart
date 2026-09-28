#version 300 es
precision highp float;
precision highp int;
// View-wide distortion (M5-10 "Hitzeflimmern", M5-13 "Unterwasser"): heat shimmer in patches that rise
// with the hot air (a hot biome at midday, a heat wave), and the slow sway of the picture under water.
#include "atmosphere.glsl"
#include "distortion.glsl"

uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform float uTime;
uniform float uHeat;         // 0…1
uniform float uUnderwater;   // 0…1
uniform float uMotion;       // reduced motion

out vec4 oOffset;

void main() {
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize);
  vec2 o = vec2(0.0);
  if (uHeat > 0.0) {
    float spot = noiseAt(uNoise, world + vec2(0.0, uTime * DH_HEAT_RISE * 0.5), DH_HEAT_PATCH_TILE).r;
    float m = smoothstep(DH_HEAT_PATCH_FROM, DH_HEAT_PATCH_FROM + 0.2, spot);
    o.x += heatSway(uNoise, world, uTime) * m * uHeat * DH_HEAT_MAX_PX;
  }
  if (uUnderwater > 0.0) {
    o.x += sin(world.y * DH_WATER_ROWS + uTime * DH_WATER_SPEED) * DH_WATER_SWAY_PX * uUnderwater;
    o.y += sin(world.x * DH_WATER_COLUMNS + uTime * DH_WATER_SPEED * 0.8) * DH_WATER_SWAY_PX * 0.5 * uUnderwater;
  }
  oOffset = encodeOffset(o * uMotion);
}
