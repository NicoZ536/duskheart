#version 300 es
precision highp float;
// Last step of the post chain (MASTERPROMPT §6.1 pass 9, HDR → LDR): exposure and tonemapping into
// the LDR target the presentation scales to the screen, then the player's picture-wide state effects
// (eyelids of a blink, frost at the edges; src/render/passes/postPass.ts). Further post passes
// (distortion, bloom, grading, vignette, grain) run before it on the HDR target.
#include "hdr.glsl"
#include "post.glsl"
#include "bayer.glsl"
uniform sampler2D uHdr;
uniform float uExposure;
/** Visible picture inside the target: offset x, y and size w, h [px] (the target has a 1 px border). */
uniform vec4 uView;
uniform float uLid;
uniform float uFrost;
out vec4 oColor;
void main() {
  vec3 c = decodeHdr(texelFetch(uHdr, ivec2(gl_FragCoord.xy), 0)) * uExposure;
  c = tonemap(c);
  vec2 p = floor(gl_FragCoord.xy) - uView.xy;
  float threshold = bayer4(floor(gl_FragCoord.xy));
  if (uFrost > 0.0) c = frostOver(c, p, uView.zw, uFrost, threshold);
  if (uLid > 0.0 && lidCovers(min(p.y, uView.w - 1.0 - p.y), uView.w, uLid, threshold)) c = LID_COLOR;
  oColor = vec4(c, 1.0);
}
