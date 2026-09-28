#version 300 es
precision highp float;
precision highp int;
// Bloom, step 4: the glow of all four levels over the scene (read from the HDR copy, written into the
// HDR target). The glow is quantised in fine steps with a world-anchored Bayer seam: its soft falloff over
// dark ground reads as pixel-art rings, not as 8-bit banding.
#include "hdr.glsl"
#include "bayer.glsl"
#include "atmosphere.glsl"

uniform sampler2D uScene;    // copy of the HDR target
uniform sampler2D uBloom;    // first level after the up steps
uniform vec2 uBloomSize;
uniform float uIntensity;
uniform vec2 uOrigin;
uniform vec2 uTargetSize;

out vec4 oColor;

void main() {
  vec3 c = decodeHdr(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0));
  vec3 glow = decodeHdr(texture(uBloom, gl_FragCoord.xy * 0.5 / uBloomSize)) * uIntensity;
  float peak = max(max(glow.r, glow.g), glow.b);
  if (peak > 0.0) {
    float bayer = bayer4(worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize));
    glow *= orderedSteps(peak, DH_BLOOM_STEPS, bayer) / peak;
  }
  oColor = encodeHdr(c + glow);
}
