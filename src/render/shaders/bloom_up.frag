#version 300 es
precision highp float;
// Bloom, step 3: one level up – the level below, spread with an eight-tap tent, plus this level's own
// downsampled light. After three steps the first level holds all four.
#include "hdr.glsl"

uniform sampler2D uLower;
uniform vec2 uLowerTexel;    // 1 / size of the level below
uniform sampler2D uSame;     // this level's downsampled light
uniform vec2 uSize;          // size of this level

out vec4 oColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 h = uLowerTexel;
  vec3 sum = decodeHdr(texture(uLower, uv + vec2(-2.0 * h.x, 0.0)));
  sum += decodeHdr(texture(uLower, uv + vec2(-h.x, h.y))) * 2.0;
  sum += decodeHdr(texture(uLower, uv + vec2(0.0, 2.0 * h.y)));
  sum += decodeHdr(texture(uLower, uv + vec2(h.x, h.y))) * 2.0;
  sum += decodeHdr(texture(uLower, uv + vec2(2.0 * h.x, 0.0)));
  sum += decodeHdr(texture(uLower, uv + vec2(h.x, -h.y))) * 2.0;
  sum += decodeHdr(texture(uLower, uv + vec2(0.0, -2.0 * h.y)));
  sum += decodeHdr(texture(uLower, uv + vec2(-h.x, -h.y))) * 2.0;
  oColor = encodeHdr(sum / 12.0 + decodeHdr(texelFetch(uSame, ivec2(gl_FragCoord.xy), 0)));
}
