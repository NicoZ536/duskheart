#version 300 es
precision highp float;
// M0 test scene: palette ramps lit by a wandering warm light with pixel-sized banding + Bayer dither.
#include "bayer.glsl"
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPalette;   // 64×1 palette texture
uniform vec2 uSize;           // internal resolution
uniform float uTime;
uniform vec2 uLight;          // light centre in internal px
void main() {
  vec2 px = floor(vUv * uSize);
  float band = floor(px.y / (uSize.y / 12.0));
  float step = floor(px.x / (uSize.x / 6.0));
  float idx = band * 6.0 + step;
  vec3 albedo = texture(uPalette, vec2((clamp(idx, 0.0, 63.0) + 0.5) / 64.0, 0.5)).rgb;
  float d = length(px - uLight) / 90.0;
  float light = 0.12 + 1.1 * clamp(1.0 - d * d, 0.0, 1.0);
  float levels = 8.0;
  light = floor(light * levels + bayer4(px)) / levels;
  vec3 warm = vec3(1.0, 0.82, 0.6);
  outColor = vec4(albedo * light * mix(vec3(0.55, 0.6, 0.9), warm, clamp(light, 0.0, 1.0)), 1.0);
}
