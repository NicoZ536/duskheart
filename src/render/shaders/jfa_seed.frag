#version 300 es
precision highp float;
precision highp int;
// Seeds of the two distance fields (M5-01, src/render/passes/occluderPass.ts):
// - occluders: every mask texel that stands out – structural, a decor top above the terrain, or a terrain top
//   above one of its four neighbours (the rim of a raised level or cliff; its inside is only reached across the rim);
// - water: every drawn texel of the frame that is not water (the shore and the land behind it).
#include "gbuffer.glsl"
#include "jfa.glsl"

uniform sampler2D uMask;       // occluder mask (sdf.glsl)
uniform sampler2D uSurface;    // G2 of the frame: mask bits (water)
uniform ivec2 uSize;           // size of the flood targets [px]
uniform int uMargin;           // margin of the flood targets around the frame [px]
uniform ivec2 uFrameSize;      // size of the frame (G-buffer) [px]

layout(location = 0) out vec4 oSeed;
layout(location = 1) out vec4 oWater;

float terrainAt(ivec2 t, float fallback) {
  if (t.x < 0 || t.y < 0 || t.x >= uSize.x || t.y >= uSize.y) return fallback;
  return texelFetch(uMask, t, 0).b;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 m = texelFetch(uMask, p, 0);
  float eps = DH_SDF_SEED_EPSILON / DH_GBUFFER_HEIGHT_RANGE;
  float lowest = min(min(terrainAt(p + ivec2(1, 0), m.b), terrainAt(p - ivec2(1, 0), m.b)), min(terrainAt(p + ivec2(0, 1), m.b), terrainAt(p - ivec2(0, 1), m.b)));
  bool seed = m.g > 0.5 || m.r > m.b + eps || m.b > lowest + eps;
  oSeed = seed ? jfaEncode(vec2(p)) : jfaNone();
  ivec2 f = p - ivec2(uMargin);
  bool inFrame = f.x >= 0 && f.y >= 0 && f.x < uFrameSize.x && f.y < uFrameSize.y;
  bool land = inFrame && !gbufferHasMask(texelFetch(uSurface, f, 0), DH_MASK_WATER);
  oWater = land ? jfaEncode(vec2(p)) : jfaNone();
}
