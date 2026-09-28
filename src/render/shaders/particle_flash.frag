#version 300 es
precision highp float;
precision highp int;
// Lightning flash (M5-12, §6.1 pass 8 "Blitz (Vollbildblitz …)"): for the moments of a strike every drawn surface
// reflects the cold light of the lightning – its albedo times the flash – and a flat veil of the same light lies over
// the whole picture (the lit air and rain; the sky outside the world lights up too), added to the lit scene (additive
// blending; encodeHdr is linear).
#include "hdr.glsl"

uniform sampler2D uAlbedo;   // G0
uniform vec3 uFlash;         // flash colour × strength
uniform vec3 uVeil;          // flash colour × strength × veil share

out vec4 oColor;

void main() {
  vec4 a = texelFetch(uAlbedo, ivec2(gl_FragCoord.xy), 0);
  vec3 lit = a.a < 0.5 ? vec3(0.0) : a.rgb * uFlash;
  oColor = vec4(encodeHdr(lit + uVeil).rgb, 0.0);
}
