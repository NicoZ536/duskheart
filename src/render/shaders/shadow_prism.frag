#version 300 es
precision highp float;
precision highp int;
// A terrain block's shadow (M5-02): the pixel is shadowed by the block when some height t in [0, top] projects a
// point of its footprint onto it (p − t · shadow ∈ footprint); the highest such t is the caster height stored.
#include "shadow_ground.glsl"

in vec2 vWorld;
flat in vec4 vBox;
flat in float vTop;

uniform vec3 uShadow;

out vec4 oShadow;

// Heights t with lo ≤ p − t · s ≤ hi on one axis (all heights when s = 0 and p lies inside).
vec2 interval(float p, float s, float lo, float hi) {
  if (abs(s) < 1e-5) return p >= lo && p <= hi ? vec2(-1e9, 1e9) : vec2(1.0, -1.0);
  float t0 = (p - hi) / s;
  float t1 = (p - lo) / s;
  return vec2(min(t0, t1), max(t0, t1));
}

void main() {
  vec2 s = uShadow.xy * uShadow.z;
  vec2 ix = interval(vWorld.x, s.x, vBox.x, vBox.z);
  vec2 iy = interval(vWorld.y, s.y, vBox.y, vBox.w);
  float from = max(max(ix.x, iy.x), 0.0);
  float to = min(min(ix.y, iy.y), vTop);
  if (from > to || shadowUnderGround(to)) discard;
  oShadow = vec4(vec3(0.0), clamp(to / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0));
}
