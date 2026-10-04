#version 300 es
precision highp float;
precision highp int;
// Sprite → G-buffer (layout: gbuffer.glsl). Colour from the palette LUT, relief from the normal atlas, height above
// ground for upright layers, flash / tint / dither fade per instance; outlined sprites set a mask bit that the
// outline pass turns into a 1 px silhouette outline. World surface (M5-17 … M5-24, src/render/surface):
// - flutter: wind-flagged pixels of rigid sprites (banners, laundry, drying bundles) ripple row by row with the wind;
// - canopy see-through: crowns and roofs in front of the player dither out in a circle, the pattern anchored to the
//   world (it does not swim when the camera moves);
// - palette swap: a second palette row takes over pixel by pixel in the order of their ramp step (light first), then
//   by the sprite's seed (seasonal foliage) or a world-anchored cluster noise (`creep`: effects – corruption, frost);
//   `shed` dissolves canopy pixels instead;
// - weathered sprites: up-facing pixels catch snow (world-anchored clusters), rain makes them glossy;
// - white flash: unlit (emissive), so a hit reads at night too; softened with the flash-reduction option;
// - dither fade: the Bayer pattern is anchored to the sprite, so a fading figure does not shimmer as it moves;
// - ink smoke (M6-25, `materialize` flag, src/render/batch/materialize.ts): the shadow brood's fade dissolves it by a
//   rising smoke threshold instead – the body forms from the ground up and falls apart from the top, the band just
//   above the dissolving edge is its glowing violet rim (the variant's palette row colours it), so it decays into sparks.
//   Only the variant compiled with `DH_SMOKE` has it: the sprite batcher draws a frame with it only while one of the
//   frame's sprites materialises (M6-81, `SpriteBatcher.program`). A software rasteriser runs every branch of a shader,
//   taken or not – the smoke's three noise lookups and five texel fetches for every sprite pixel of every frame made a
//   SwiftShader frame of `sprites-5000` 40 % longer; without a materialising sprite the smoke changes no pixel.
#include "palette.glsl"
#include "bayer.glsl"
#include "world/surface.glsl"
#include "sway.glsl"

in vec2 vLocal;
flat in uvec4 vRect;
flat in uvec4 vMisc;
flat in uvec4 vSurface;
flat in vec4 vTint;
flat in vec2 vAnchor;
flat in vec2 vAnchorWorld;
flat in float vHeightBase;
flat in vec2 vRotation;
flat in vec2 vSway;              // wind sway of the top row [px along x] (0: none), sway share² of the bottom row (.vert)

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uAtlasNormal;
uniform sampler2D uPaletteLut;
uniform int uLayer;            // 0 ground, 1 water, 2 objects, 3 canopy
uniform vec2 uTargetSize;
uniform vec2 uOrigin;          // world px of target pixel (0, 0)
uniform vec3 uFade;            // canopy fade circle: centre (target px, y down), radius (0 = off); canopy
                               // layer: the whole sprite, flagged objects: their canopy pixels
uniform int uFlashIndex;       // palette index of the white flash
uniform float uFlashStrength;  // 1 = full white flash, less with the flash-reduction option
uniform vec4 uWeather;         // snow cover 0…1, wetness 0…1, time [s], flutter amplitude [px, signed downwind]

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oEmissive;

const uint FLAG_MIRROR = 1u;
const uint FLAG_OUTLINE = 2u;
const uint FLAG_FLASH = 4u;
const uint FLAG_WIND = 8u;
const uint FLAG_CANOPY_FADE = 16u;
const uint FLAG_MATERIALIZE = 32u;
const uint SURFACE_SWAP = 1u;
const uint SURFACE_SHED = 2u;
const uint SURFACE_WEATHERED = 4u;
const uint SURFACE_CREEP = 8u;
const int LAYER_WATER = 1;
const int LAYER_OBJECTS = 2;
const int LAYER_CANOPY = 3;
const float TAU = 6.2831853;
const float SNOW_GLOSS = DH_GLOSS_SNOW;

float heightAt(float relief, float row) {
  // Upright layers stand on their anchor line: each row above it is one pixel higher.
  float upright = uLayer >= LAYER_OBJECTS ? max(0.0, vAnchor.y - row - 0.5) : 0.0;
  return clamp((upright + relief + vHeightBase) / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0);
}

bool inFrame(ivec2 p) {
  return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, ivec2(vRect.zw)));
}

vec4 albedoAt(ivec2 p) {
  return inFrame(p) ? texelFetch(uAtlasAlbedo, ivec2(vRect.xy) + p, 0) : vec4(0.0);
}

bool windPixel(vec4 a) {
  return a.a > 0.5 && (uint(a.b * 255.0 + 0.5) & DH_MAT_WIND) != 0u;
}

// Seed of the sprite 0…1 from its anchor (the same for every frame of it).
float spriteSeed() {
  return cellHash(ivec2(vAnchorWorld), 101u);
}

#ifdef DH_SMOKE
// Front noise 0…1 of the column at world x (world-anchored 2 px columns, rolling with the time): the same all down the
// column. The CPU mirror is `smokeFront` of materialize.ts.
float smokeFront(float x, float seconds) {
  return clusterNoise(vec2(x, seconds * DH_SMOKE_RISE), DH_SMOKE_WAVELENGTH, DH_SMOKE_DETAIL, DH_SMOKE_CELL, DH_SMOKE_SALT);
}

// Smoke threshold 0…1 of a pixel whose cluster row lies `rowShare` down its frame in a column with front noise `front`:
// mostly the height (the body forms from the ground up), the front noise makes the edge wavy. It never falls down a column,
// so a column's body is one run from its foot – nothing of it floats above the front (`smokeThreshold`).
float smokeThreshold(float rowShare, float front) {
  return rowShare * DH_SMOKE_HEIGHT_WEIGHT + front * (1.0 - DH_SMOKE_HEIGHT_WEIGHT);
}

// Px of ink smoke rising above the front in the column at world x: whole clusters, 0 … DH_SMOKE_TONGUE_PX
// (`smokeTonguePx`).
float smokeTongue(float x, float seconds) {
  float n = clusterNoise(vec2(x, seconds * DH_SMOKE_TONGUE_DRIFT), DH_SMOKE_TONGUE_WAVELENGTH, DH_SMOKE_TONGUE_DETAIL, DH_SMOKE_CELL, DH_SMOKE_TONGUE_SALT);
  return floor(n * (DH_SMOKE_TONGUE_PX / DH_SMOKE_CELL + 1.0)) * DH_SMOKE_CELL;
}

// Row share of the smoke cluster the pixel at world `world` (row `localY` of a frame `height` px high) lies in: the row of
// the cluster's centre in the rising field, not the pixel's own – a 2 × 2 cluster forms and dissolves whole, no row of it
// alone (`smokeRowShare` of materialize.ts).
float smokeRowShare(vec2 world, float localY, float height, float seconds) {
  float y = world.y + seconds * DH_SMOKE_RISE;
  float centre = (floor(y / DH_SMOKE_CELL) + 0.5) * DH_SMOKE_CELL;
  return (localY + centre - y) / height;
}

// World point of the frame's pixel `q` (by the anchor, like `world` in main).
vec2 smokeWorld(ivec2 q, bool mirrored) {
  vec2 local = vec2(q) + 0.5;
  return vAnchorWorld + vec2(mirrored ? vAnchor.x - local.x : local.x - vAnchor.x, local.y - vAnchor.y);
}

// The cluster threshold of the frame's pixel `q`.
float smokeThresholdAt(ivec2 q, bool mirrored, float height, float seconds) {
  vec2 w = smokeWorld(q, mirrored);
  return smokeThreshold(smokeRowShare(w, float(q.y) + 0.5, height, seconds), smokeFront(w.x, seconds));
}

// Whether the frame's opaque pixel `q` shows at `fade` by its cluster: as body (at or below the front) or as the tongue of
// smoke above it (`materializePixel` of materialize.ts); the threshold falls by DH_SMOKE_HEIGHT_WEIGHT / height per px up.
bool smokeShowsAt(ivec2 q, bool mirrored, float height, float seconds, float fade) {
  float below = (smokeThresholdAt(q, mirrored, height, seconds) - fade) * height / DH_SMOKE_HEIGHT_WEIGHT;
  return below >= 0.0 || -below <= smokeTongue(smokeWorld(q, mirrored).x, seconds);
}
#endif

void main() {
  uint flags = vMisc.y;
  // Wind sway per row (M5 review Minor 14, sprite_gbuffer.vert): each row sways by its own up² instead of the corners'
  // linear shear – the column sampled moves by the difference; beyond the frame nothing is drawn.
  vec2 sampled = vLocal;
  if (vSway.x != 0.0) {
    float shift = swayRowShift(vSway.x, vSway.y, vLocal.y, float(vRect.w), vAnchor.y);
    sampled.x += (flags & FLAG_MIRROR) != 0u ? -shift : shift;
    if (sampled.x < 0.0 || sampled.x >= float(vRect.z)) discard;
  }
  ivec2 p = clamp(ivec2(floor(sampled)), ivec2(0), ivec2(vRect.zw) - 1);
  // Whole-sprite dither fade (0 = opaque … 255 = gone), anchored to the sprite's own pixels; a materialising sprite
  // dissolves by its smoke threshold below instead (only in the variant with `DH_SMOKE`: without it no sprite smokes).
#ifdef DH_SMOKE
  bool smoke = (flags & FLAG_MATERIALIZE) != 0u;
#else
  const bool smoke = false;
#endif
  if (!smoke) {
    if (float(vMisc.w) / 255.0 > bayer4(vec2(p))) discard;
  }
  bool mirrored = (flags & FLAG_MIRROR) != 0u;
  // Flutter of wind pixels on sprites that do not sway as a whole: each row shifts with a travelling wave.
  float flutter = uWeather.w;
  if ((flags & FLAG_WIND) == 0u && abs(flutter) >= 0.5) {
    float wave = sin(uWeather.z * DH_FLUTTER_HZ * TAU - float(p.y) * TAU / DH_FLUTTER_ROWS + spriteSeed() * TAU);
    int shift = int(round(flutter * (0.5 + 0.5 * wave)));
    if (mirrored) shift = -shift;
    if (shift != 0) {
      vec4 from = albedoAt(p - ivec2(shift, 0));
      if (windPixel(from)) p -= ivec2(shift, 0);
      else if (windPixel(albedoAt(p))) discard;
    }
  }
  ivec2 texel = ivec2(vRect.xy) + p;
  vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
  if (a.a < 0.5) discard;
  uint material = uint(a.b * 255.0 + 0.5);
  bool canopy = (material & DH_MAT_CANOPY) != 0u;
  // World pixel of this sprite pixel (patterns that stay on the sprite while it sways or the camera moves).
  vec2 local = vec2(p) + 0.5;
  vec2 world = vAnchorWorld + vec2(mirrored ? vAnchor.x - local.x : local.x - vAnchor.x, local.y - vAnchor.y);
  bool rim = false;
#ifdef DH_SMOKE
  float fade = float(vMisc.w) / 255.0;
  bool tongue = false;
  if (smoke && fade > 0.0) {
    float height = float(vRect.w);
    float threshold = smokeThresholdAt(p, mirrored, height, uWeather.z);
    // Px below the front (negative: above it). Above it only the column's tongue of ink smoke shows; the body's top cluster
    // is the glowing rim.
    float below = (threshold - fade) * height / DH_SMOKE_HEIGHT_WEIGHT;
    if (below < 0.0 && -below > smokeTongue(world.x, uWeather.z)) discard;
    tongue = below < 0.0;
    rim = threshold < fade + DH_SMOKE_HEIGHT_WEIGHT * DH_SMOKE_RIM_PX / height && !tongue;
    // The crumb rule (`materializeMask`): a pixel alone in its 2 × 2 cluster – the silhouette cut its partners away – stays
    // only beside a shown pixel of a neighbouring cluster, and never as rim: no single glowing pixel, none without a
    // neighbour (§4.5 "keine verwaisten Einzelpixel").
    vec2 field = world + vec2(0.0, uWeather.z * DH_SMOKE_RISE);
    int dxWorld = mod(field.x, DH_SMOKE_CELL) < DH_SMOKE_CELL * 0.5 ? 1 : -1;
    int dy = mod(field.y, DH_SMOKE_CELL) < DH_SMOKE_CELL * 0.5 ? 1 : -1;
    int dx = mirrored ? -dxWorld : dxWorld;
    bool alone = albedoAt(p + ivec2(dx, 0)).a < 0.5 && albedoAt(p + ivec2(0, dy)).a < 0.5 && albedoAt(p + ivec2(dx, dy)).a < 0.5;
    if (alone) {
      bool beside = albedoAt(p - ivec2(dx, 0)).a > 0.5 && smokeShowsAt(p - ivec2(dx, 0), mirrored, height, uWeather.z, fade);
      bool above = albedoAt(p - ivec2(0, dy)).a > 0.5 && smokeShowsAt(p - ivec2(0, dy), mirrored, height, uWeather.z, fade);
      if (!beside && !above) discard;
      rim = false;
    }
    // Smoke is ink, not light: an eye under it does not glow.
    if (tongue) a.g = 0.0;
  }
#endif
  bool fades = uLayer == LAYER_CANOPY || ((flags & FLAG_CANOPY_FADE) != 0u && canopy);
  if (fades && uFade.z > 0.0) {
    vec2 q = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
    float d = length(q - uFade.xy) / uFade.z;
    if (d < 1.0 && smoothstep(DH_FADE_CORE, 1.0, d) < bayer4(floor(uOrigin + q))) discard;
  }
  int index = paletteIndexOf(a.r);
  int row = int(vMisc.x);
  uint surface = vSurface.z;
  float blend = float(vSurface.y) / 255.0;
  if ((surface & (SURFACE_SWAP | SURFACE_SHED)) != 0u && blend > 0.0) {
    // Light steps first (the sunlit outer leaves turn before the shaded ones), then the sprite's seed: a forest turns
    // tree by tree, cluster by cluster. An effect creeps over the sprite in world-anchored clusters instead.
    float threshold = (surface & SURFACE_CREEP) != 0u
      ? mix(clusterNoise(world, DH_CREEP_WAVELENGTH, DH_CREEP_DETAIL, 1.0, 131u), 1.0 - rampRank(index), DH_CREEP_RANK_WEIGHT) * 0.98 + 0.01
      : mix(spriteSeed(), 1.0 - rampRank(index), DH_SEASON_RANK_WEIGHT) * 0.98 + 0.01;
    if (blend > threshold) {
      if ((surface & SURFACE_SHED) != 0u) {
        if (canopy) discard;
      } else {
        row = int(vSurface.x);
      }
    }
  }
  vec4 n = texelFetch(uAtlasNormal, texel, 0);
  vec3 color = paletteColor(uPaletteLut, index, row);
#ifdef DH_SMOKE
  // The smoke's rim takes the brood's glow colour in its palette row (a biome variant's rim is the variant's), its tongues the
  // dark violet of the ink.
  if (rim) color = paletteColor(uPaletteLut, DH_SMOKE_RIM_INDEX, row);
  if (tongue) color = paletteColor(uPaletteLut, DH_SMOKE_TONGUE_INDEX, row);
#endif
  // A tint is paint, it does not reach the pixels that are light (the composite lights emission as albedo × emission):
  // a creature sunk into the dark keeps its glowing eyes (§12.2 "Gegner im Dunkeln sind nur als Augen erkennbar") and
  // the smoke its glowing rim.
  if (a.g <= 0.0 && !rim) color = mix(color, vTint.rgb, vTint.a);
  // Normal: mirrored with the sprite, rotated with it (screen y down → normal y up: angle negated).
  vec2 nxy = n.rg * 2.0 - 1.0;
  if (mirrored) nxy.x = -nxy.x;
  nxy = vec2(vRotation.x * nxy.x + vRotation.y * nxy.y, -vRotation.y * nxy.x + vRotation.x * nxy.y);
  float gloss = (material & DH_MAT_METAL) != 0u ? DH_GLOSS_METAL : (material & DH_MAT_ICE) != 0u ? DH_GLOSS_ICE : (material & DH_MAT_WET) != 0u ? DH_GLOSS_WET : 0.0;
  float wetness = (material & DH_MAT_WET) != 0u ? 1.0 : 0.0;
  uint mask = (uLayer == LAYER_WATER ? DH_MASK_WATER : 0u) | ((flags & FLAG_OUTLINE) != 0u ? DH_MASK_OUTLINE : 0u);
  if ((surface & SURFACE_WEATHERED) != 0u) {
    float cover = uWeather.x;
    if (cover > 0.0) {
      // How far the pixel faces the sky: its normal, the flat top of a roof or crown, a top edge of the silhouette.
      float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
      bool topEdge = !(albedoAt(p - ivec2(0, 1)).a > 0.5);
      float up = max(nxy.y, 0.0) + (canopy ? 0.35 * nz : 0.0) + (topEdge ? 0.6 : 0.0);
      float noise = clusterNoise(world, DH_SNOW_WAVELENGTH * 0.5, DH_SNOW_DETAIL, 1.0, 11u);
      if (spriteSnow(cover, up, noise) > 0.5) {
        int snow = topEdge || nxy.y > 0.45 ? DH_SNOW_LIGHT : nxy.y < 0.05 ? DH_SNOW_SHADE : DH_SNOW_BASE;
        color = paletteColor(uPaletteLut, snow, 0);
        mask |= DH_MASK_SNOW;
        gloss = max(gloss, SNOW_GLOSS);
      }
    }
    float wet = uWeather.y;
    if (wet > 0.0 && (mask & DH_MASK_SNOW) == 0u) {
      gloss = max(gloss, wet * DH_WET_SPRITE_GLOSS * (0.6 + 0.4 * max(nxy.y, 0.0)));
      wetness = max(wetness, wet);
    }
  }
  float emissive = a.g * (1.0 + float(vMisc.z) / 255.0 * DH_EMISSIVE_BOOST_MAX);
#ifdef DH_SMOKE
  if (rim) emissive = max(emissive, DH_SMOKE_EDGE_GLOW);
#endif
  if ((flags & FLAG_FLASH) != 0u) {
    // The hit flash is light, not paint: emissive white, unlit by the night (softened by the flash-reduction option).
    color = mix(color, paletteColor(uPaletteLut, uFlashIndex, 0), uFlashStrength);
    emissive = max(emissive, uFlashStrength);
  }
  oAlbedo = vec4(color, 1.0);
  oNormal = vec4(nxy * 0.5 + 0.5, heightAt(n.b * DH_ATLAS_HEIGHT_RANGE, float(p.y)), float(material) / 255.0);
  oEmissive = vec4(emissive / DH_EMISSIVE_RANGE, gloss, wetness, float(mask) / 255.0);
}
