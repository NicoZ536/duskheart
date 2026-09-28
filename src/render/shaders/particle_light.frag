#version 300 es
precision highp float;
precision highp int;
// Particle light (M5-11): the surface under the quad reflects the particle's glow, falling off smoothly with the
// distance to the particle (its height counts), added to the lit scene (additive blending; encodeHdr is linear).
#include "hdr.glsl"

uniform sampler2D uAlbedo;     // G0
uniform vec2 uTargetSize;
uniform float uRadius;

flat in vec3 vLight;
flat in vec3 vSource;

out vec4 oColor;

void main() {
  vec4 a = texelFetch(uAlbedo, ivec2(gl_FragCoord.xy), 0);
  if (a.a < 0.5) discard;
  vec2 pixel = vec2(floor(gl_FragCoord.x), uTargetSize.y - 1.0 - floor(gl_FragCoord.y));
  float d = length(vec3(pixel - vSource.xy, vSource.z)) / uRadius;
  if (d >= 1.0) discard;
  float x = 1.0 - d * d;
  oColor = vec4(encodeHdr(a.rgb * vLight * x * x).rgb, 0.0);
}
