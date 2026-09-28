#version 300 es
precision highp float;
precision highp int;
// One step of the interactive wave field (M5-09; CPU mirror: src/render/water/waves.ts WaveField.step): the discrete
// wave equation (nine-point Laplacian) on the world-anchored grid around the camera. The field follows the camera in whole texels – texel p
// of this step reads texel p + uShift of the last field –, land holds the height at 0 (the shore reflects), a texel
// beside land loses more (the bank swallows the ring), and the frame's impulses (figures, raindrops, arrows, fish)
// kick the new height. Layout of the field: water.glsl.
uniform vec4 uFrames[2];           // the field: world px of its north-west corner, size [texels]; the tile grid (water.glsl)
#define uFieldFrame (uFrames[0])
#define uTileFrame (uFrames[1])
#include "water.glsl"

uniform sampler2D uField;          // the last field: rg = height, ba = previous height
uniform ivec2 uSize;               // field size [texels]
uniform ivec2 uShift;              // texel p here = texel p + uShift of uField
uniform int uImpulseCount;
uniform vec4 uImpulses[DH_MAX_IMPULSES];   // centre x, y [texels of this field, row 0 south], radius [texels], strength

out vec4 oField;

// World px of the centre of texel t of this field.
vec2 fieldWorld(ivec2 t) {
  return uFieldFrame.xy + vec2(float(t.x) + 0.5, uFieldFrame.w - float(t.y) - 0.5) * DH_WAVE_TEXEL;
}

bool landAt(ivec2 t) {
  return !waterOpenAt(fieldWorld(t));
}

float heightOf(ivec2 s) {
  if (s.x < 0 || s.y < 0 || s.x >= uSize.x || s.y >= uSize.y) return 0.0;
  return unpackHeight(texelFetch(uField, s, 0).rg);
}

float previousOf(ivec2 s) {
  if (s.x < 0 || s.y < 0 || s.x >= uSize.x || s.y >= uSize.y) return 0.0;
  return unpackHeight(texelFetch(uField, s, 0).ba);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (landAt(p)) {
    oField = vec4(packHeight(0.0), packHeight(0.0));
    return;
  }
  ivec2 s = p + uShift;
  float h = heightOf(s);
  bool shore = landAt(p + ivec2(1, 0)) || landAt(p - ivec2(1, 0)) || landAt(p + ivec2(0, 1)) || landAt(p - ivec2(0, 1));
  float damping = shore ? DH_WAVE_DAMPING * DH_WAVE_SHORE_DAMPING : DH_WAVE_DAMPING;
  float edges = heightOf(s + ivec2(0, 1)) + heightOf(s - ivec2(0, 1)) + heightOf(s + ivec2(1, 0)) + heightOf(s - ivec2(1, 0));
  float corners = heightOf(s + ivec2(1, 1)) + heightOf(s + ivec2(-1, 1)) + heightOf(s + ivec2(1, -1)) + heightOf(s + ivec2(-1, -1));
  float next = waveStep(h, previousOf(s), edges, corners, damping);
  vec2 c = vec2(p) + 0.5;
  for (int i = 0; i < DH_MAX_IMPULSES; i++) {
    if (i >= uImpulseCount) break;
    vec4 k = uImpulses[i];
    next += k.w * impulseProfile(length(c - k.xy), k.z);
  }
  oField = vec4(packHeight(next), packHeight(h));
}
