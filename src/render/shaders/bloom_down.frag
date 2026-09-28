#version 300 es
precision highp float;
// Bloom, step 2: one level down (half size) with the dual filter – the centre and four diagonal
// neighbours, read bilinearly between texels (five fetches cover a 4 × 4 footprint).
#include "hdr.glsl"

uniform sampler2D uSource;
uniform vec2 uSourceTexel;   // 1 / source size

out vec4 oColor;

void main() {
  vec2 uv = gl_FragCoord.xy * 2.0 * uSourceTexel;
  vec2 h = uSourceTexel;
  vec3 sum = decodeHdr(texture(uSource, uv)) * 4.0;
  sum += decodeHdr(texture(uSource, uv - h));
  sum += decodeHdr(texture(uSource, uv + h));
  sum += decodeHdr(texture(uSource, uv + vec2(h.x, -h.y)));
  sum += decodeHdr(texture(uSource, uv + vec2(-h.x, h.y)));
  oColor = encodeHdr(sum * 0.125);
}
