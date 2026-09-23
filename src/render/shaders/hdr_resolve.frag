#version 300 es
precision highp float;
// HDR → LDR (decode + clamp) until the post chain with tonemapping replaces it.
#include "hdr.glsl"
uniform sampler2D uHdr;
out vec4 oColor;
void main() {
  oColor = vec4(clamp(decodeHdr(texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0)), 0.0, 1.0), 1.0);
}
