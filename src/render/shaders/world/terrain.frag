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
// World surface (M5-19, M5-20, src/render/surface): all patterns anchored to the world (they do not swim with the
// camera) and cut in cell clusters (no single-pixel speckle).
// - Snow settles on open ground as the cover grows – the painted snow tileset shows through a cluster mask – and
//   takes the terrain's shading; footprints (interaction texture, G) press blue shadows into snow.
// - Rain darkens soft ground in growing patches and makes it glossy; puddles gather in the hollows of a noise field:
//   darker, flat, very glossy and marked for the puddle mirror (G2.A `puddle`), with a shadowed north bank and a
//   lighter south lip.
// Settling snow, wet patches and puddles follow the frame's weather (`uSurface`): while cover, wetness and puddle fill
// are all 0 they change no pixel, and the pass draws with the variant compiled without them (`DH_SURFACE_WEATHER`
// undefined, src/render/world/terrainPass.ts) – a software rasteriser (the headless browser of the E2E tests) runs every
// branch of a shader, taken or not. Snow ground and its footprints are in both variants.
#include "palette.glsl"
#include "bayer.glsl"
#include "world/surface.glsl"

in vec2 vLocal;
flat in uvec2 vRect;
flat in uint vRow;
flat in uint vFlags;
flat in uvec4 vShade;
flat in uvec2 vBlend;
flat in uvec2 vTile;
flat in uint vGround;

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uAtlasNormal;
uniform sampler2D uPaletteLut;
uniform float uTime;           // presentation time [s] (waterfalls)
uniform vec2 uChunkWorld;      // world px of the chunk's top-left corner
uniform vec4 uSurface;         // snow cover, wetness, puddle fill (0…1), 0
uniform sampler2D uInteraction;  // G = footprints (world-anchored, 1 texel = 1 px)
uniform vec4 uInteractionRect;   // world px of texel (0, 0), size in texels (z = 0: none)
uniform ivec4 uSnowFrames[2];  // atlas x, y of the snow tileset's full-tile variants 0…3 (x < 0: no snow tileset)
uniform vec3 uSnowWeights;     // cumulative share of variants 0, 1, 2 (the rest is variant 3)

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
const uint KIND_GROUND = 0u;
const uint KIND_RIM = 1u;
const float SNOW_GLOSS = 0.2;
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

// Occlusion 0…1: the cast shadow at the foot of a wall (north edge) – full over its core, then fading out
// (src/render/world/shading.ts `wallFootShadow`) –, `DH_AO_SIDE_STRENGTH` beside higher ground.
float occlusion(uint bits, vec2 p) {
  float foot = (bits & AO_N) != 0u ? clamp((DH_AO_FOOT_PX - p.y) / (DH_AO_FOOT_PX - DH_AO_FOOT_CORE_PX), 0.0, 1.0) : 0.0;
  return clamp(max(foot, edgeCloseness(bits & ~AO_N, p, DH_AO_FOOT_PX, DH_AO_SIDE_PX) * DH_AO_SIDE_STRENGTH), 0.0, 1.0);
}

// Whole ramp steps of a shade: flat bands, only the middle of each step is dithered (a narrow seam
// of ordered dither between two flat colours, like the light bands of the composition).
int shadeSteps(float shade, float threshold) {
  float whole = floor(shade);
  float t = clamp((shade - whole - 0.5) * DH_SHADE_SHARPNESS + 0.5, 0.0, 1.0);
  return int(whole) + (t > threshold ? 1 : 0);
}

// Footprint strength at world px `w` (interaction texture G), 0 without prints.
float footprintAt(vec2 w) {
  vec2 t = floor(w - uInteractionRect.xy);
  if (uInteractionRect.z <= 0.0 || any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, uInteractionRect.zw))) return 0.0;
  return texelFetch(uInteraction, ivec2(t), 0).g;
}

// Palette index of the painted snow at world px `w` (the snow tileset's full tiles, a variant per world tile).
int snowIndexAt(vec2 w) {
  if (uSnowFrames[0].x < 0) return DH_SNOW_BASE;
  ivec2 tile = ivec2(floor(w / DH_TILE_SIZE));
  float h = cellHash(tile, 53u);
  int v = h < uSnowWeights.x ? 0 : h < uSnowWeights.y ? 1 : h < uSnowWeights.z ? 2 : 3;
  ivec4 pair = uSnowFrames[v / 2];
  ivec2 origin = (v & 1) == 0 ? pair.xy : pair.zw;
  ivec2 q = ivec2(mod(floor(w), DH_TILE_SIZE));
  if (cellHash(tile, 59u) < 0.5) q.x = int(DH_TILE_SIZE) - 1 - q.x;
  vec4 a = texelFetch(uAtlasAlbedo, origin + q, 0);
  return a.a < 0.5 ? DH_SNOW_BASE : paletteIndexOf(a.r);
}

// Whether palette index `i` belongs to a soil or plant ramp (earth, grass, foliage, sand) – not to rock.
bool soilIndex(int i) {
  return (i >= DH_SOIL_EARTH.x && i <= DH_SOIL_EARTH.y) || (i >= DH_SOIL_PLANT.x && i <= DH_SOIL_PLANT.y) || (i >= DH_SOIL_SAND.x && i <= DH_SOIL_SAND.y);
}

bool snowyAt(vec2 w, float cover) {
  return snowLine(cover, clusterNoise(w, DH_SNOW_WAVELENGTH, DH_SNOW_DETAIL, DH_SNOW_CELL, 11u)) > 0.5;
}

bool puddleAtWorld(vec2 w, float fill) {
  return puddleAt(fill, clusterNoise(w, DH_PUDDLE_WAVELENGTH, DH_PUDDLE_WAVELENGTH * 0.3, DH_PUDDLE_CELL, 23u)) > 0.5;
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
  int painted = paletteIndexOf(a.r);
  int index = shift(painted, steps);
  uint material = uint(a.b * 255.0 + 0.5);
  float gloss = (material & DH_MAT_METAL) != 0u ? DH_GLOSS_METAL : (material & DH_MAT_ICE) != 0u ? DH_GLOSS_ICE : (water || (material & DH_MAT_WET) != 0u) ? DH_GLOSS_WET : 0.0;
  float wetness = water || (material & DH_MAT_WET) != 0u ? 1.0 : 0.0;
  uint mask = water ? DH_MASK_WATER : 0u;
  // World surface: snow, footprints, wet patches and puddles on open ground.
  vec2 world = uChunkWorld + vec2(vTile) * DH_TILE_SIZE + p;
  bool open = !water && (kind == KIND_GROUND || kind == KIND_RIM || kind == KIND_RAMP || kind == KIND_STAIRS);
  bool snowy = open && (vGround & DH_GROUND_SNOW) != 0u;
#ifdef DH_SURFACE_WEATHER
  float cover = uSurface.x;
  // Rim frames carry rock faces as well as the plateau's turf: snow settles only on their soil and plant pixels.
  bool settles = open && (kind != KIND_RIM || soilIndex(painted));
  if (settles && !snowy && cover > 0.0 && (vGround & DH_GROUND_CATCHES_SNOW) != 0u && snowyAt(world, cover)) {
    // Settled snow: the painted snow shows, shaded like the ground beneath (AO at wall feet). The layer has a thickness
    // in the 3/4 view: where it ends to the south its front shows as a bluer band, where it ends to the north its top
    // edge catches the light.
    bool front = cover < 1.0 && !snowyAt(world + vec2(0.0, DH_SNOW_CELL), cover);
    bool crest = cover < 1.0 && !front && !snowyAt(world - vec2(0.0, DH_SNOW_CELL), cover);
    index = shift(front ? DH_SNOW_SHADE : crest ? DH_SNOW_LIGHT : snowIndexAt(world), steps);
    snowy = true;
  }
#endif
  if (snowy) {
    mask |= DH_MASK_SNOW;
    gloss = max(gloss, SNOW_GLOSS);
    // Footprints: a dent of blue shadow – two steps while fresh, one while it fades –, its north wall one step deeper,
    // the snow pushed up at its south lip one step lighter (the 3/4 view sees into the dent from the south).
    float print = footprintAt(world);
    if (print > 0.0) {
      int depth = print > 0.5 ? 2 : print > 0.15 ? 1 : 0;
      if (depth > 0 && footprintAt(world - vec2(0.0, 1.0)) <= 0.0) depth++;
      index = shift(index, depth);
    } else if (footprintAt(world - vec2(0.0, 1.0)) > 0.5) {
      index = shift(index, -1);
    }
  }
#ifdef DH_SURFACE_WEATHER
  else if (open && (vGround & DH_GROUND_WETS) != 0u) {
    float wet = uSurface.y;
    float fill = uSurface.z;
    if (fill > 0.0 && kind == KIND_GROUND && (vGround & DH_GROUND_PUDDLES) != 0u && puddleAtWorld(world, fill)) {
      // Puddle: dark still water on flat ground; the north bank shades it, the south lip catches the light.
      int bank = puddleAtWorld(world - vec2(0.0, DH_PUDDLE_CELL), fill) ? 0 : 1;
      int lip = puddleAtWorld(world + vec2(0.0, DH_PUDDLE_CELL), fill) ? 0 : -1;
      index = shift(painted, DH_PUDDLE_STEPS + bank + lip);
      nxy = vec2(0.0);
      gloss = DH_PUDDLE_GLOSS;
      wetness = 1.0;
      mask |= DH_MASK_PUDDLE;
    } else if (wet > 0.0) {
      if (wetPatch(wet, clusterNoise(world, DH_PUDDLE_WAVELENGTH * 0.6, DH_SNOW_DETAIL, DH_PUDDLE_CELL, 37u)) > 0.5) index = shift(index, int(DH_WET_DARKEN_STEPS));
      gloss = max(gloss, wet * DH_WET_GLOSS);
      wetness = max(wetness, wet);
    }
  }
#endif
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
  oEmissive = vec4(a.g / DH_EMISSIVE_RANGE, gloss, wetness, float(mask) / 255.0);
}
