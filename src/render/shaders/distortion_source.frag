#version 300 es
precision highp float;
precision highp int;
// Offsets of one distortion source (M5-13), added into the distortion field.
// - Shock wave: along the ray from the centre, `shockwaveProfile` across the ring.
// - Heat area: rows sway sideways, strongest in the middle of the ellipse, fading to its rim.
#include "atmosphere.glsl"
#include "distortion.glsl"

uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform float uTime;
uniform float uShockScale;   // screen shake setting
uniform float uMotion;       // reduced motion

flat in vec4 vShape;
flat in vec2 vKind;
out vec4 oOffset;

void main() {
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize) + 0.5;
  vec2 v = world - vShape.xy;
  vec2 o = vec2(0.0);
  if (vKind.x < 0.5) {
    float d = length(v);
    float u = (d - vShape.z) / vShape.w;
    if (d > 0.0) o = v / d * shockwaveProfile(u) * vKind.y * uShockScale;
  } else {
    vec2 q = v / vShape.zw;
    float r = dot(q, q);
    if (r >= 1.0) discard;
    float m = (1.0 - r) * (1.0 - r);
    o.x = heatSway(uNoise, world, uTime) * vKind.y * m * uMotion;
  }
  oOffset = encodeOffset(o);
}
