#version 300 es
precision highp float;
// Bloom, step 1 (MASTERPROMPT §6.1 pass 9 "Bloom (Schwelle, 4 Stufen, interne Auflösung)", M5-13):
// the bright part of the HDR scene, averaged over 2 × 2 pixels into the first level (half the internal
// resolution). Only what exceeds DH_BLOOM_THRESHOLD glows (soft knee below it, never below 1: colours at
// full daylight stay exactly as painted); the input is capped at the RGBA8 fallback's range so both
// encodings bloom alike.
#include "hdr.glsl"

uniform sampler2D uHdr;
uniform ivec2 uSourceMax;    // largest texel index of the HDR target

out vec4 oColor;

// Share of a colour with brightest channel `peak` that glows (mirror of `bloomShare` in bloomPass.ts).
float bloomShare(float peak) {
  float soft = clamp(peak - DH_BLOOM_THRESHOLD + DH_BLOOM_KNEE, 0.0, 2.0 * DH_BLOOM_KNEE);
  soft = soft * soft / (4.0 * DH_BLOOM_KNEE);
  return max(soft, peak - DH_BLOOM_THRESHOLD) / max(peak, 0.0001);
}

vec3 brightPart(vec3 c) {
  c = min(c, vec3(DH_HDR_FALLBACK_RANGE));
  return c * bloomShare(max(max(c.r, c.g), c.b));
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  vec3 sum = brightPart(decodeHdr(texelFetch(uHdr, min(base, uSourceMax), 0)));
  sum += brightPart(decodeHdr(texelFetch(uHdr, min(base + ivec2(1, 0), uSourceMax), 0)));
  sum += brightPart(decodeHdr(texelFetch(uHdr, min(base + ivec2(0, 1), uSourceMax), 0)));
  sum += brightPart(decodeHdr(texelFetch(uHdr, min(base + ivec2(1, 1), uSourceMax), 0)));
  oColor = encodeHdr(sum * 0.25);
}
