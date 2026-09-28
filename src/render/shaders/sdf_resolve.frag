#version 300 es
precision highp float;
precision highp int;
// Distance fields from the flooded seeds (M5-01; layout: sdf.glsl): the distance to the nearest occluder seed and
// what that occluder is (the mask at the seed), and the distance of water to the shore.
#include "hdr.glsl"
#include "jfa.glsl"

uniform sampler2D uSeeds;
uniform sampler2D uWater;
uniform sampler2D uMask;

layout(location = 0) out vec4 oDistance;
layout(location = 1) out vec4 oInfo;
layout(location = 2) out vec4 oWater;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pf = vec2(p);
  vec2 s = jfaDecode(texelFetch(uSeeds, p, 0));
  bool found = s.x >= 0.0;
  float d = found ? min(length(s - pf), DH_SDF_MAX_DISTANCE) : DH_SDF_MAX_DISTANCE;
  oDistance = encodeScalar(d, DH_SDF_MAX_DISTANCE);
  oInfo = found ? texelFetch(uMask, ivec2(s), 0) : vec4(0.0);
  vec2 w = jfaDecode(texelFetch(uWater, p, 0));
  oWater = encodeScalar(w.x >= 0.0 ? min(length(w - pf), DH_SDF_MAX_DISTANCE) : DH_SDF_MAX_DISTANCE, DH_SDF_MAX_DISTANCE);
}
