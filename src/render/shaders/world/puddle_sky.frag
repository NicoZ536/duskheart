#version 300 es
precision highp float;
precision highp int;
// Sky sheen of puddles (M5-20): a puddle mirrors the sky – a share of the ambient light is added on puddle pixels
// (pale by day, a faint blue at night, nothing in caves).
#include "hdr.glsl"
#include "gbuffer.glsl"

uniform sampler2D uSurface;    // G2: mask bits
uniform vec3 uSky;             // ambient light × mirror share

out vec4 oColor;

void main() {
  if (!gbufferHasMask(texelFetch(uSurface, ivec2(gl_FragCoord.xy), 0), DH_MASK_PUDDLE)) discard;
  oColor = encodeHdr(uSky);
}
