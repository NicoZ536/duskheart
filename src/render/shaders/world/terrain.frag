#version 300 es
precision highp float;
precision highp int;
// World terrain → G-buffer (M2-28; layout: gbuffer.glsl, instances: src/render/world/terrainMesh.ts).
// The tilesets are flat (no baked normals), so the height field of the chunk shades them here:
// - Height: 16 px per level; wall pieces fall from their edge to their foot and face south.
// - Ambient occlusion at wall feet and beside higher ground, cave floors beside rock: the palette
//   index moves down its own ramp (hue-shifted shadow colours, §4.3) by up to two steps, the edge of
//   the shade Bayer-dithered and anchored to the world (tile pixels are whole world pixels).
// - Water darkens with its distance to the shore (corner depths interpolated over the tile).
// - Rock tops in caves sink to the darkest colours of their ramps.
// - Waterfalls (a river over a wall): the water frame turned on its side, so its wave dashes become
//   streaks, scrolling down with the time; foam (lighter steps) at the lip and the foot.
#include "palette.glsl"
#include "bayer.glsl"

in vec2 vLocal;
flat in uvec2 vRect;
flat in uint vRow;
flat in uint vFlags;
flat in uvec4 vShade;
flat in uvec2 vBlend;

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uAtlasNormal;
uniform sampler2D uPaletteLut;
uniform float uTime;           // presentation time [s] (waterfalls)

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oEmissive;

const uint FLAG_MIRROR = 1u;
const uint FLAG_WATER = 2u;
const uint KIND_WALL = 2u;
const uint KIND_RAMP = 3u;
const uint KIND_STAIRS = 4u;
const uint KIND_ROCK_TOP = 5u;
const uint KIND_WATERFALL = 6u;
const uint AO_N = 1u;
const uint AO_E = 2u;
const uint AO_S = 4u;
const uint AO_W = 8u;
const uint AO_NE = 16u;
const uint AO_SE = 32u;
const uint AO_SW = 64u;
const uint AO_NW = 128u;
// One step darker / lighter in the index's own ramp (the ends stay), palette index 1…64.
const int DARKER[64] = int[64](DH_DARKER_INDICES);
const int LIGHTER[64] = int[64](DH_LIGHTER_INDICES);

// Moves `index` by `steps` along its ramp: positive = darker, negative = lighter.
int shift(int index, int steps) {
  int i = index;
  for (int k = 0; k < steps; k++) i = DARKER[clamp(i, 1, 64) - 1];
  for (int k = 0; k < -steps; k++) i = LIGHTER[clamp(i, 1, 64) - 1];
  return i;
}

// Closeness 0…1 of the pixel p (tile px, y down) to the flagged edges and corners: 1 at the edge,
// 0 at `reach` px from it. `north` is the reach of the north edge (the foot of a wall reaches further).
float edgeCloseness(uint bits, vec2 p, float north, float reach) {
  float t = DH_TILE_SIZE;
  float a = 0.0;
  if ((bits & AO_N) != 0u) a = max(a, 1.0 - p.y / north);
  if ((bits & AO_S) != 0u) a = max(a, 1.0 - (t - p.y) / reach);
  if ((bits & AO_E) != 0u) a = max(a, 1.0 - (t - p.x) / reach);
  if ((bits & AO_W) != 0u) a = max(a, 1.0 - p.x / reach);
  if ((bits & AO_NE) != 0u) a = max(a, 1.0 - length(vec2(t - p.x, p.y)) / reach);
  if ((bits & AO_NW) != 0u) a = max(a, 1.0 - length(vec2(p.x, p.y)) / reach);
  if ((bits & AO_SE) != 0u) a = max(a, 1.0 - length(vec2(t - p.x, t - p.y)) / reach);
  if ((bits & AO_SW) != 0u) a = max(a, 1.0 - length(vec2(p.x, t - p.y)) / reach);
  return clamp(a, 0.0, 1.0);
}

// Occlusion 0…1: full at the foot of a wall (north edge), `DH_AO_SIDE_STRENGTH` beside higher ground.
float occlusion(uint bits, vec2 p) {
  float foot = (bits & AO_N) != 0u ? 1.0 - p.y / DH_AO_FOOT_PX : 0.0;
  return clamp(max(foot, edgeCloseness(bits & ~AO_N, p, DH_AO_FOOT_PX, DH_AO_SIDE_PX) * DH_AO_SIDE_STRENGTH), 0.0, 1.0);
}

// Whole ramp steps of a shade: flat bands, only the middle of each step is dithered (a narrow seam
// of ordered dither between two flat colours, like the light bands of the composition).
int shadeSteps(float shade, float threshold) {
  float whole = floor(shade);
  float t = clamp((shade - whole - 0.5) * DH_SHADE_SHARPNESS + 0.5, 0.0, 1.0);
  return int(whole) + (t > threshold ? 1 : 0);
}

// Water depth 0…3 at p, bilinear between the corner depths (NW, NE, SW, SE).
float waterDepth(uint corners, vec2 p) {
  vec4 c = vec4(float(corners & 3u), float((corners >> 2u) & 3u), float((corners >> 4u) & 3u), float((corners >> 6u) & 3u));
  vec2 f = p / DH_TILE_SIZE;
  return mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y);
}

void main() {
  int last = int(DH_TILE_SIZE) - 1;
  ivec2 pi = clamp(ivec2(floor(vLocal)), ivec2(0), ivec2(last));
  vec2 p = vec2(pi) + 0.5;
  ivec2 src = pi;
  bool mirror = (vFlags & FLAG_MIRROR) != 0u;
  if (mirror) src.x = last - src.x;
  uint kind = vShade.x >> 3u;
  if (kind == KIND_WATERFALL) {
    // Turned on its side (dashes become streaks) and scrolled down; whole pixels per step.
    int fall = int(floor(uTime * DH_WATERFALL_SPEED));
    src = ivec2((pi.y - fall) & last, pi.x);
  }
  ivec2 texel = ivec2(vRect) + src;
  vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
  if (a.a < 0.5) discard;
  vec4 n = texelFetch(uAtlasNormal, texel, 0);
  float level = float(vShade.x & 7u);
  float threshold = bayer4(vec2(pi));

  // Shade in palette ramp steps.
  float shade = occlusion(vShade.y, p) * DH_AO_MAX_STEPS;
  bool water = (vFlags & FLAG_WATER) != 0u;
  if (water) shade += clamp(waterDepth(vShade.z, p) - DH_WATER_SHALLOW_DEPTH, 0.0, DH_WATER_MAX_STEPS);
  if (kind == KIND_ROCK_TOP) shade += DH_ROCK_TOP_STEPS;
  float height = level * DH_LEVEL_PX;
  vec2 nxy = n.rg * 2.0 - 1.0;
  if (mirror) nxy.x = -nxy.x;
  if (kind == KIND_WALL || kind == KIND_RAMP || kind == KIND_STAIRS || kind == KIND_WATERFALL) {
    float row = float(vShade.w & 7u);
    float rows = float((vShade.w >> 3u) & 7u);
    // Distance below the edge in px; the foot of the wall lies `rows` levels under it.
    float below = (row - 1.0) * DH_LEVEL_PX + p.y;
    height = (level + rows) * DH_LEVEL_PX - below;
    nxy = kind == KIND_WALL || kind == KIND_WATERFALL ? DH_WALL_NORMAL : DH_SLOPE_NORMAL;
    // Contact shadow at the foot of a sheer wall.
    if (kind == KIND_WALL && row >= rows) shade += max(0.0, 1.0 - (DH_TILE_SIZE - p.y) / DH_WALL_FOOT_PX);
    if (kind == KIND_WATERFALL) {
      shade = 0.0;
      // Foam: lighter at the lip, lightest where the water hits the pool.
      if (row <= 1.0) shade -= max(0.0, 1.0 - p.y / DH_FOAM_LIP_PX);
      if (row >= rows) shade -= DH_FOAM_FOOT_STEPS * max(0.0, 1.0 - (DH_TILE_SIZE - p.y) / DH_FOAM_FOOT_PX);
    }
  }
  int steps = shade >= 0.0 ? shadeSteps(shade, threshold) : -shadeSteps(-shade, threshold);
  int index = shift(paletteIndexOf(a.r), steps);
  uint material = uint(a.b * 255.0 + 0.5);
  float gloss = (material & DH_MAT_METAL) != 0u ? DH_GLOSS_METAL : (material & DH_MAT_ICE) != 0u ? DH_GLOSS_ICE : (water || (material & DH_MAT_WET) != 0u) ? DH_GLOSS_WET : 0.0;
  // Biome border: near an edge to another biome's row, a Bayer-dithered share of pixels takes that row
  // (half at the edge), so two tints of one ground dissolve into each other.
  int row = int(vRow);
  if (vBlend.y != 0u) {
    float share = DH_BIOME_BLEND_EDGE * edgeCloseness(vBlend.y, p, DH_BIOME_BLEND_PX, DH_BIOME_BLEND_PX);
    // Dithered in 2×2 px cells: the fringe keeps the clusters of at least two pixels of docs/ART.md §2.2.
    if (share > bayer4(floor(vec2(pi) / DH_BIOME_BLEND_CELL) + DH_BIOME_BLEND_OFFSET)) row = int(vBlend.x);
  }
  oAlbedo = vec4(paletteColor(uPaletteLut, index, row), 1.0);
  oNormal = vec4(nxy * 0.5 + 0.5, clamp((n.b * DH_ATLAS_HEIGHT_RANGE + height) / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0), float(material) / 255.0);
  oEmissive = vec4(a.g / DH_EMISSIVE_RANGE, gloss, water || (material & DH_MAT_WET) != 0u ? 1.0 : 0.0, water ? float(DH_MASK_WATER) / 255.0 : 0.0);
}
