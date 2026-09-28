#version 300 es
precision highp float;
precision highp int;
// One step of the jump flood (M5-01): every texel looks at its own and eight neighbours' seeds `uStep` texels
// away and keeps the nearest – for the occluder and the water field at once (two attachments).
#include "jfa.glsl"

uniform sampler2D uSeeds;
uniform sampler2D uWater;
uniform int uStep;
uniform ivec2 uSize;

layout(location = 0) out vec4 oSeed;
layout(location = 1) out vec4 oWater;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pf = vec2(p);
  vec4 best = jfaNone();
  vec4 bestWater = jfaNone();
  float d = 1e20;
  float dw = 1e20;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = p + ivec2(x, y) * uStep;
      if (q.x < 0 || q.y < 0 || q.x >= uSize.x || q.y >= uSize.y) continue;
      vec4 e = texelFetch(uSeeds, q, 0);
      vec2 s = jfaDecode(e);
      if (s.x >= 0.0) {
        vec2 v = s - pf;
        float dd = dot(v, v);
        if (dd < d) {
          d = dd;
          best = e;
        }
      }
      vec4 w = texelFetch(uWater, q, 0);
      vec2 sw = jfaDecode(w);
      if (sw.x >= 0.0) {
        vec2 v = sw - pf;
        float dd = dot(v, v);
        if (dd < dw) {
          dw = dd;
          bestWater = w;
        }
      }
    }
  }
  oSeed = best;
  oWater = bestWater;
}
