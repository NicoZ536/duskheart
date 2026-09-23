#version 300 es
precision highp float;
precision highp int;
// Ground tiles → G-buffer (layout: gbuffer.glsl), the channels the sprite shader writes for its
// ground layer: palette colour, relief normal and height, material bits, emission, gloss, wetness.
// Texels are fetched, never filtered, so no neighbouring atlas frame bleeds into a tile edge.
#include "palette.glsl"

in vec2 vLocal;
flat in uvec2 vRect;
flat in uint vRow;
flat in uint vFlags;

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uAtlasNormal;
uniform sampler2D uPaletteLut;

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oEmissive;

const uint FLAG_MIRROR = 1u;

void main() {
  int last = int(DH_TILE_SIZE) - 1;
  ivec2 p = clamp(ivec2(floor(vLocal)), ivec2(0), ivec2(last));
  bool mirror = (vFlags & FLAG_MIRROR) != 0u;
  if (mirror) p.x = last - p.x;
  ivec2 texel = ivec2(vRect) + p;
  vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
  if (a.a < 0.5) discard;
  vec4 n = texelFetch(uAtlasNormal, texel, 0);
  vec2 nxy = n.rg * 2.0 - 1.0;
  if (mirror) nxy.x = -nxy.x;
  uint material = uint(a.b * 255.0 + 0.5);
  float gloss = (material & DH_MAT_METAL) != 0u ? DH_GLOSS_METAL : (material & DH_MAT_ICE) != 0u ? DH_GLOSS_ICE : (material & DH_MAT_WET) != 0u ? DH_GLOSS_WET : 0.0;
  oAlbedo = vec4(paletteColor(uPaletteLut, paletteIndexOf(a.r), int(vRow)), 1.0);
  oNormal = vec4(nxy * 0.5 + 0.5, clamp(n.b * DH_ATLAS_HEIGHT_RANGE / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0), float(material) / 255.0);
  oEmissive = vec4(a.g / DH_EMISSIVE_RANGE, gloss, (material & DH_MAT_WET) != 0u ? 1.0 : 0.0, 0.0);
}
