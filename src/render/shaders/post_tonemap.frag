#version 300 es
precision highp float;
// Last step of the post chain (MASTERPROMPT §6.1 pass 9, HDR → LDR): exposure and tonemapping into
// the LDR target the presentation scales to the screen. Further post passes (distortion, bloom,
// grading, states, vignette, grain) run before it on the HDR target.
#include "hdr.glsl"
#include "post.glsl"
uniform sampler2D uHdr;
uniform float uExposure;
out vec4 oColor;
void main() {
  vec3 c = decodeHdr(texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0)) * uExposure;
  oColor = vec4(tonemap(c), 1.0);
}
