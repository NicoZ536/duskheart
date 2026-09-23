#version 300 es
precision highp float;
// Unlit composition (until the lighting passes take over): the albedo as it is, the background
// colour where nothing was drawn. Writes the HDR target (hdr.glsl encoding).
#include "hdr.glsl"
uniform sampler2D uAlbedo;
uniform vec3 uBackground;
out vec4 oColor;
void main() {
  vec4 a = texelFetch(uAlbedo, ivec2(gl_FragCoord.xy), 0);
  oColor = encodeHdr(a.a > 0.5 ? a.rgb : uBackground);
}
