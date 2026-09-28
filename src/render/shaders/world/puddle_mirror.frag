#version 300 es
precision highp float;
precision highp int;
// Mirror images of the lights in puddles (M5-20), added to the lit scene on puddle pixels only (G2 mask bit): a
// vertical streak of short horizontal dashes, as pixel-art water shows a reflection – widest at the mirror point,
// broken into lines towards its ends, wobbling sideways while rain falls on the water. Three brightness steps, no
// smooth ramp.
#include "hdr.glsl"
#include "gbuffer.glsl"

in vec2 vWorld;
flat in vec4 vMirror;
flat in vec3 vColor;

uniform sampler2D uSurface;    // G2: mask bits
uniform float uRipple;         // sideways wobble [px]
uniform float uTime;           // presentation time [s]
uniform float uRippleSpeed;    // [rad/s]

out vec4 oColor;

void main() {
  if (!gbufferHasMask(texelFetch(uSurface, ivec2(gl_FragCoord.xy), 0), DH_MASK_PUDDLE)) discard;
  vec2 px = floor(vWorld) + 0.5;
  vec2 d = px - (floor(vMirror.xy) + 0.5);
  float along = abs(d.y) / max(1.0, vMirror.w);
  if (along >= 1.0) discard;
  // Every other row is a gap in the outer part of the streak.
  if (along > 0.3 && mod(floor(px.y), 2.0) > 0.5) discard;
  float wobble = uRipple * sin(px.y * 1.7 + uTime * uRippleSpeed);
  float width = vMirror.z * (1.0 - 0.65 * along);
  float across = abs(d.x - floor(wobble + 0.5)) / max(0.5, width);
  if (across >= 1.0) discard;
  float level = (1.0 - along) * (1.0 - 0.5 * across);
  level = floor(level * 3.0 + 0.5) / 3.0;
  if (level <= 0.0) discard;
  oColor = encodeHdr(vColor * level);
}
