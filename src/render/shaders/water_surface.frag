#version 300 es
precision highp float;
precision highp int;
// Water (MASTERPROMPT §6.1 pass 7, M5-07 … M5-09, M5-23 "Sterne in Wasserspiegelungen"; parameters:
// src/render/water/params.ts). Reads the lit scene (a copy of the HDR target), the G-buffer, the wave field, the tile
// grid of the water and the water's distance field, and writes the water back into the HDR target:
// - the ground under the water, displaced by the waves in whole pixels (refraction), in the colour of its depth
//   (absorption towards deep water, turquoise shallows), with caustics in the sunny shallows;
// - the mirror of what stands above the shoreline (a height-field search up the column: an object pixel of height H
//   above the water mirrors 2·H below itself), else of the sky – its colours by daytime and weather, at night the
//   stars and the moon with its glitter path –, broken by the waves; the sun's glitter by day;
// - shore foam along the distance field, surging, with a broken second line, white water under waterfalls and foam
//   on high wave crests;
// - figures in the water: below their waterline they are seen through the water (the immersion mask);
// - winter: frozen water and glacier ice with cracks, thin ice growing from the shore in a hard frost.
// Everything stays on whole pixels (displacements, reflections, foam, glints are per pixel and thresholded).
// The frame's values in one vec4 array (one upload; layout: WATER_FRAME in src/render/passes/waterPass.ts) and the
// mirrored sky as the scene holds it (SKY_FIELD in src/render/water/state.ts).
uniform vec4 uFrame[DH_WATER_FRAME_VEC4S];
uniform vec4 uSky[4];
#define uOrigin (uFrame[0].xy)          // world px of target pixel (0, 0), top-left
#define uTargetSize (uFrame[0].zw)
#define uViewSize (uFrame[1].xy)        // the visible image [px]
#define uTime (uFrame[1].z)
#define uMotion (uFrame[1].w)           // ambient wave scale (reduced motion)
#define uWind (uFrame[2].xyz)           // direction x, y (unit), strength 0…1
#define uShoreIce (uFrame[2].w)         // width of the shore ice [px], 0 = none
#define uFieldFrame (uFrame[3])         // wave field: world px of its north-west corner, size [texels]
#define uTileFrame (uFrame[4])          // tile grid (water.glsl)
#define uWaves (int(uFrame[5].x))       // 1 = the wave field is valid
#define uTilesKnown (int(uFrame[5].y))
#define uHasShore (int(uFrame[5].z))    // 1 = the distance field is this frame's
#define uRefraction (int(uFrame[5].w))
#define uReflection (int(uFrame[6].x))
#define uCaustics (int(uFrame[6].y))
#define uImmerseCount (int(uFrame[6].z))
#define uSkyZenith (uSky[0].xyz)
#define uSunlight (uSky[0].w)
#define uSkyHorizon (uSky[1].xyz)
#define uSkyShare (uSky[1].w)
#define uStars (uSky[2].x * uFrame[6].x)
#define uGlitter (uSky[2].y * uFrame[6].x)
#define uMoonWaxing (int(uSky[2].z))
// Moon: screen px x, y (1-px border), brightness (none without the mirror), lit fraction.
#define uMoon (vec4(uSky[3].xy * uViewSize + 1.0, uSky[2].w * uFrame[6].x, uSky[3].z))
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "palette.glsl"
#include "water.glsl"

uniform sampler2D uScene;          // lit scene before this pass (HDR, encodeHdr)
uniform sampler2D uAlbedo;         // G0
uniform sampler2D uNormal;         // G1: height, material
uniform sampler2D uSurface;        // G2: mask bits
uniform sampler2D uField;          // wave field (water.glsl)
uniform sampler2D uShore;          // water distance field of the occluder pass (R16F / RG8 scalar)
uniform vec4 uSdfFrame;            // its placement: world px of the north-west corner, size [px]
uniform sampler2D uAtlas;          // albedo atlas (body frames under water)
uniform sampler2D uPalette;        // palette LUT
uniform vec4 uImmerseA[DH_MAX_IMMERSIONS];   // anchor x, y [screen px], half width, top [px above the anchor]
uniform vec4 uImmerseB[DH_MAX_IMMERSIONS];   // waterline [px above the anchor], sink [px], mirror, palette row
uniform vec4 uImmerseC[DH_MAX_IMMERSIONS];   // body frame: atlas x, y, w, h (w = 0: none)
uniform vec4 uImmerseD[DH_MAX_IMMERSIONS];   // body frame anchor in the frame x, y

out vec4 oColor;

const float TAU = 6.2831853;
const vec3 LUMA = vec3(0.3, 0.55, 0.15);

// ---------------------------------------------------------------------------------------------------------------
// Pixels, light

// GL texel of the pixel `s` counted from the top-left.
ivec2 glTexel(ivec2 s) {
  return ivec2(s.x, int(uTargetSize.y) - 1 - s.y);
}

bool inTarget(ivec2 s) {
  return s.x >= 0 && s.y >= 0 && float(s.x) < uTargetSize.x && float(s.y) < uTargetSize.y;
}

bool waterPixel(ivec2 s) {
  return inTarget(s) && gbufferHasMask(texelFetch(uSurface, glTexel(s), 0), DH_MASK_WATER);
}

vec3 sceneAt(ivec2 s) {
  return decodeHdr(texelFetch(uScene, glTexel(s), 0));
}

// Light on a pixel: its lit colour over its albedo (ambient, sun, shadows, point lights – everything the light pass
// and the composition gave it). The brightness is the ratio of the luminances; the hue of the per-channel ratio is
// taken only at DH_LIGHT_HUE – on a saturated albedo (turquoise shallows) the spectral reflection of the composition
// would otherwise tint white foam far beyond the light's own colour.
vec3 lightOf(vec3 lit, vec3 albedo) {
  float l = dot(lit, LUMA) / max(dot(albedo, LUMA), 0.02);
  vec3 ratio = lit / max(albedo, vec3(0.04));
  vec3 hue = ratio / max(dot(ratio, LUMA), 1e-3);
  return clamp(l * mix(vec3(1.0), hue, DH_LIGHT_HUE), 0.0, DH_HDR_FALLBACK_RANGE);
}

// ---------------------------------------------------------------------------------------------------------------
// Waves

// Height of the wave field at texel `d` counted from the north-west corner (0 outside).
float fieldTexel(ivec2 d) {
  ivec2 size = ivec2(uFieldFrame.zw);
  if (d.x < 0 || d.y < 0 || d.x >= size.x || d.y >= size.y) return 0.0;
  return unpackHeight(texelFetch(uField, ivec2(d.x, size.y - 1 - d.y), 0).rg);
}

// Height (z) and slope (xy, height per px × DH_WAVE_SLOPE) of the wave field at world point `world`.
vec3 fieldAt(vec2 world) {
  if (uWaves == 0) return vec3(0.0);
  vec2 f = (world - uFieldFrame.xy) / DH_WAVE_TEXEL - 0.5;
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 c = ivec2(i);
  float a = fieldTexel(c);
  float b = fieldTexel(c + ivec2(1, 0));
  float e = fieldTexel(c + ivec2(0, 1));
  float g = fieldTexel(c + ivec2(1, 1));
  float h = mix(mix(a, b, t.x), mix(e, g, t.x), t.y);
  vec2 slope = vec2(mix(b - a, g - e, t.y), mix(e - a, g - b, t.x)) / DH_WAVE_TEXEL * DH_WAVE_SLOPE;
  return vec3(slope, h);
}

// Slope of one ambient wave train: wavelength `wl`, angle `a` against the wind.
vec2 ambientTrain(vec2 world, vec2 wind, float wl, float a, float w, float phase) {
  vec2 d = vec2(wind.x * cos(a) - wind.y * sin(a), wind.x * sin(a) + wind.y * cos(a));
  vec2 side = vec2(-d.y, d.x);
  // A slow warp across the train bends its crests (no ruled lines).
  float warp = 1.3 * sin(dot(world, side) * TAU / (wl * 3.7) + phase);
  float x = (dot(world, d) - uTime * DH_AMBIENT_SPEED) * TAU / wl + warp + phase;
  return d * cos(x) * w;
}

// Slope of the small wind waves at world point `world`.
vec2 ambientSlope(vec2 world) {
  vec2 wind = length(uWind.xy) > 0.01 ? normalize(uWind.xy) : vec2(1.0, 0.0);
  vec2 s = ambientTrain(world, wind, DH_AMBIENT_WL0, DH_AMBIENT_A0, DH_AMBIENT_W0, 0.0)
         + ambientTrain(world, wind, DH_AMBIENT_WL1, DH_AMBIENT_A1, DH_AMBIENT_W1, 1.7)
         + ambientTrain(world, wind, DH_AMBIENT_WL2, DH_AMBIENT_A2, DH_AMBIENT_W2, 4.1);
  return s * mix(DH_AMBIENT_CALM, DH_AMBIENT_WINDY, uWind.z) * uMotion;
}

// ---------------------------------------------------------------------------------------------------------------
// Shore distance and depth

// Distance of the water pixel `s` (world point `world`, tile `tile`) to its shore [px]. The distance field counts
// everything drawn over the water as shore – a tree crown standing in front of a lake, a figure in the water – so
// the tile grid bounds it from below: the tile's distance to the nearest land tile [px] less half a tile diagonal and
// the reach of the coast art into a water tile (DH_SHORE_SLACK). `drawn`: the distance to the nearest pixel that is
// not water as drawn (no bound; nothing nearer stands above the water pixel – where the mirror search starts).
float shoreDistance(ivec2 s, vec2 world, vec4 tile, out float drawn) {
  float tiles = uTilesKnown == 1 && tile.r > 0.5 ? tile.b - DH_SHORE_SLACK : 0.0;
  if (uHasShore == 1) {
    vec2 q = world - uSdfFrame.xy;
    ivec2 t = ivec2(floor(q.x), floor(uSdfFrame.w - q.y));
    if (t.x >= 0 && t.y >= 0 && float(t.x) < uSdfFrame.z && float(t.y) < uSdfFrame.w) {
      drawn = decodeScalar(texelFetch(uShore, t, 0), DH_SHORE_RANGE);
      return max(drawn, tiles);
    }
  }
  // Without the distance field: the nearest non-water pixel in eight directions (short reach), then the tile grid.
  for (int r = 1; r <= DH_SHORE_SEARCH; r++) {
    for (int k = 0; k < 8; k++) {
      ivec2 dir = ivec2(k == 0 || k == 4 || k == 5 ? 1 : (k == 2 || k == 6 || k == 7 ? -1 : 0), k == 1 || k == 4 || k == 6 ? 1 : (k == 3 || k == 5 || k == 7 ? -1 : 0));
      ivec2 q = s + dir * r;
      if (inTarget(q) && !waterPixel(q)) {
        drawn = float(r);
        return max(float(r) * (k >= 4 ? 1.41 : 1.0), tiles);
      }
    }
  }
  drawn = float(DH_SHORE_SEARCH);
  return max(float(DH_SHORE_SEARCH) + 1.0, tiles);
}

// Depth share 0 (shore) … 1 (deep) of a water pixel.
float depthShare(float dist, vec4 tile) {
  float d = clamp((dist - 1.0) / DH_DEPTH_FULL, 0.0, 1.0);
  if (uTilesKnown == 1 && tile.r > 0.5 && tile.r < 1.5) d = min(d, 0.45);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Caustics, foam

// Distance to the nearest cell edge of a Voronoi field (F2 − F1) with drifting points, in cell units.
float voronoiEdge(vec2 p, float t, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(i) + ivec2(x, y);
      float h1 = waterHash(c, salt);
      float h2 = waterHash(c, salt + 7u);
      vec2 o = vec2(0.5) + 0.38 * vec2(sin(t * 0.8 + TAU * h1), cos(t * 0.6 + TAU * h2));
      float d = length(vec2(float(x), float(y)) + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return f2 - f1;
}

// Caustic light 0…2 at world pixel `world` (two drifting layers of bright lines; 2 where they cross).
float causticAt(vec2 world) {
  vec2 drift = uWind.xy * DH_CAUSTIC_DRIFT * uTime;
  float a = voronoiEdge((world + drift) / DH_CAUSTIC_CELL, uTime, 3u) < DH_CAUSTIC_LINE ? 1.0 : 0.0;
  float b = voronoiEdge((world - drift * 0.6 + vec2(31.0, 17.0)) / (DH_CAUSTIC_CELL * 0.63), uTime * 1.3, 5u) < DH_CAUSTIC_LINE * 1.2 ? 1.0 : 0.0;
  return a + b;
}

// Foam 0 (none), 0.75 (shaded foam) or 1 at a water pixel `dist` px from its shore.
float foamAt(float dist, vec2 world, float crest) {
  float wave = sin(uTime * TAU / DH_FOAM_PERIOD - (world.x + world.y) * 0.045);
  float surge = DH_FOAM_SURGE * (0.5 + 0.5 * wave);
  ivec2 px = ivec2(floor(world));
  float foam = 0.0;
  float edge = DH_FOAM_WIDTH + surge;
  if (dist <= edge) foam = dist > edge - 1.0 && waterHash(px, 9u) < 0.35 ? 0.75 : 1.0;
  float outer = DH_FOAM_OUTER + surge * 0.8;
  if (abs(dist - outer) < 0.7 && waterHash(ivec2(floor(world / DH_FOAM_CELL)), 11u) < DH_FOAM_OUTER_SHARE) foam = max(foam, 0.75);
  if (crest > DH_FOAM_CREST && waterHash(px, 13u) < clamp((crest - DH_FOAM_CREST) * 2.5, 0.0, 0.9)) foam = max(foam, 1.0);
  return foam;
}

// White water below a waterfall: the column above decides – falling water (a water pixel tilted like a wall)
// within DH_FALL_REACH px above churns the pool, thinning out away from it; land or the picture's edge first: none.
// 1 = foam, 0.75 = shaded foam, 0 = none.
float fallFoam(ivec2 s) {
  for (int k = 1; k <= DH_FALL_REACH; k++) {
    ivec2 q = s - ivec2(0, k);
    if (!waterPixel(q)) return 0.0;
    if (length(gbufferNormal(texelFetch(uNormal, glTexel(q), 0)).xy) > DH_FALL_TILT) {
      float share = DH_FALL_SHARE * (1.0 - float(k - 1) / float(DH_FALL_REACH));
      ivec2 px = s + ivec2(floor(uOrigin));
      float slot = floor(uTime * DH_FALL_FLICKER + waterHash(px, 82u) * 4.0);
      float roll = waterHash(px + ivec2(int(slot) * 5, int(slot) * 7), 83u);
      return roll < share ? 1.0 : (roll < share * 1.5 ? 0.75 : 0.0);
    }
  }
  return 0.0;
}

// ---------------------------------------------------------------------------------------------------------------
// Sky, stars, moon

// The glitter roll of world pixel `p` in the current time slot (each pixel has its own phase): a glint where it lies
// below the pixel's chance.
float glintRoll(ivec2 p) {
  float slot = floor(uTime * DH_GLITTER_FLICKER + waterHash(p, 21u) * 8.0);
  return waterHash(p + ivec2(int(slot) * 7, int(slot) * 3), 24u);
}

// A star of the mirrored star field at sky pixel `q` (0 where there is none).
float starAt(vec2 q) {
  ivec2 cell = ivec2(floor(q / DH_STAR_CELL));
  if (waterHash(cell, 31u) >= DH_STAR_DENSITY) return 0.0;
  float span = DH_STAR_CELL - 2.0;
  vec2 star = vec2(cell) * DH_STAR_CELL + 1.0 + floor(vec2(waterHash(cell, 32u), waterHash(cell, 33u)) * span);
  vec2 d = abs(floor(q) - star);
  float twinkle = 1.0 - DH_STAR_TWINKLE_DEPTH * (0.5 + 0.5 * sin(uTime * DH_STAR_TWINKLE_SPEED + TAU * waterHash(cell, 34u)));
  float level = 0.55 + 0.45 * waterHash(cell, 35u);
  if (d.x < 0.5 && d.y < 0.5) return level * twinkle;
  if (waterHash(cell, 36u) < DH_STAR_BRIGHT_SHARE && d.x + d.y < 1.5) return 0.4 * level * twinkle;
  return 0.0;
}

// The moon's disc and its glitter path at screen pixel `sp` (brightness 0…1 of the moon colour).
float moonAt(vec2 sp, float slope) {
  if (uMoon.z <= 0.0) return 0.0;
  vec2 d = floor(sp) + 0.5 - uMoon.xy;
  float r = DH_MOON_RADIUS;
  if (dot(d, d) <= r * r) {
    float half_ = sqrt(max(r * r - d.y * d.y, 0.25));
    float nx = d.x / half_;
    float k = 1.0 - 2.0 * uMoon.w;
    bool lit = uMoonWaxing == 1 ? nx >= k : nx <= -k;
    return lit ? 1.0 : DH_MOON_DARK;
  }
  float along = d.y - r;
  if (along > 0.0 && along < DH_MOON_PATH) {
    float s = along / DH_MOON_PATH;
    float width = mix(r * 0.6, DH_MOON_PATH_WIDTH, s);
    if (abs(d.x) < width) {
      ivec2 px = ivec2(floor(sp));
      float slot = floor(uTime * 4.0 + waterHash(px, 41u) * 4.0);
      float chance = DH_MOON_PATH_SPARKLE * (1.0 - s) * (1.0 - abs(d.x) / width) * (0.6 + 2.0 * slope);
      if (waterHash(px + ivec2(int(slot) * 13, 0), 42u) < chance) return 0.75;
    }
  }
  return 0.0;
}

// The mirrored sky at screen pixel `sp`, displaced to `q` by the waves.
vec3 skyAt(vec2 q, float slope) {
  float v = clamp(q.y / uTargetSize.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, v);
  if (uStars > 0.0) c += DH_COL_STAR * (DH_STAR_BRIGHTNESS * uStars * starAt(q + floor(uOrigin * DH_SKY_PARALLAX)));
  if (uMoon.z > 0.0) c += DH_COL_MOON * (DH_MOON_BRIGHTNESS * uMoon.z * moonAt(q, slope));
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Reflection of objects above the shoreline

// The figure in the water whose drawing covers screen pixel `sp`, or −1. Its heights count from its feet under the
// surface: it mirrors about its waterline.
int figureAt(vec2 sp) {
  for (int i = 0; i < DH_MAX_IMMERSIONS; i++) {
    if (i >= uImmerseCount) break;
    vec4 a = uImmerseA[i];
    if (abs(sp.x - a.x) <= a.z && sp.y >= a.y - a.w && sp.y <= a.y + 0.5) return i;
  }
  return -1;
}

// Whether screen pixel `sp` lies within `margin` px of a figure in the water (its drawing and what is under water).
bool nearFigure(vec2 sp, float margin) {
  for (int i = 0; i < DH_MAX_IMMERSIONS; i++) {
    if (i >= uImmerseCount) break;
    vec4 a = uImmerseA[i];
    if (abs(sp.x - a.x) <= a.z + margin && sp.y >= a.y - a.w - margin && sp.y <= a.y + uImmerseB[i].y + margin) return true;
  }
  return false;
}

// The reflection above water pixel `s` of surface height `surface`: colour and strength (0 = nothing, the sky shows).
// `from`: where the search starts [px] – nothing but water lies nearer (the distance to what is drawn over the water).
vec4 objectReflection(ivec2 s, float surface, int dx, float from) {
  // Every pixel up to DH_REFLECT_FINE px (the base of what stands at the water), then every DH_REFLECT_STEP px: an
  // exact match within the tolerance is still met, 2h − d grows by one per pixel up an upright object.
  for (float d = max(1.0, floor(from)); d <= DH_REFLECT_MAX; d += d < DH_REFLECT_FINE ? 1.0 : DH_REFLECT_STEP) {
    ivec2 q = ivec2(s.x + dx, s.y - int(d));
    if (q.y < 0) return vec4(0.0);
    if (q.x < 0 || float(q.x) >= uTargetSize.x) return vec4(0.0);
    vec4 g1 = texelFetch(uNormal, glTexel(q), 0);
    float h = gbufferHeight(g1) - surface;
    if (h < 0.75) continue;
    int figure = figureAt(vec2(q) + 0.5);
    // A swimmer is not mirrored (its body shows under the surface instead): the search looks past it.
    if (figure >= 0 && uImmerseC[figure].z > 0.0) continue;
    if (figure >= 0) h -= uImmerseB[figure].x;
    // A pixel h above the surface mirrors 2h below its own place on the screen: it is this water pixel's mirror when
    // it lies d = 2h above it. Only an exact match counts – a part that floats above the ground (a hand, the rim of a
    // crown) would otherwise smear its colour down over every water pixel between.
    if (abs(2.0 * h - d) > DH_REFLECT_TOLERANCE) continue;
    float fade = (1.0 - smoothstep(DH_REFLECT_MAX - DH_REFLECT_FADE, DH_REFLECT_MAX, d)) * smoothstep(0.0, DH_REFLECT_FADE * 0.5, float(q.y));
    return vec4(sceneAt(q), fade);
  }
  return vec4(0.0);
}

// ---------------------------------------------------------------------------------------------------------------
// Ice

// Crack at world pixel `world`: 1 core, 0.5 hairline, 0 none – the edges between the plates of a Voronoi field
// (`share` of them cracked) and, with `hairs`, fine hairlines inside the plates.
float crackAt(vec2 world, float share, bool hairs) {
  vec2 p = world / DH_ICE_PLATE;
  vec2 i = floor(p);
  vec2 f = p - i;
  float f1 = 8.0;
  float f2 = 8.0;
  ivec2 c1 = ivec2(0);
  ivec2 c2 = ivec2(0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(i) + ivec2(x, y);
      vec2 o = vec2(waterHash(c, 51u), waterHash(c, 52u)) * 0.8 + 0.1;
      float d = length(vec2(float(x), float(y)) + o - f);
      if (d < f1) {
        f2 = f1;
        c2 = c1;
        f1 = d;
        c1 = c;
      } else if (d < f2) {
        f2 = d;
        c2 = c;
      }
    }
  }
  ivec2 lo = min(c1, c2);
  ivec2 hi = max(c1, c2);
  if ((f2 - f1) * DH_ICE_PLATE < DH_ICE_CRACK_WIDTH * 2.0 && waterHash(lo * 31 + hi, 53u) < share) return 1.0;
  if (!hairs) return 0.0;
  float hair = voronoiEdge(world / DH_ICE_HAIR + vec2(13.0, 7.0), 0.0, 57u) * DH_ICE_HAIR;
  if (hair < DH_ICE_CRACK_WIDTH && waterHash(ivec2(floor(world / DH_ICE_HAIR)), 58u) < DH_ICE_HAIR_SHARE) return 0.5;
  return 0.0;
}

// Ice over `base` (lit ice or water) at world pixel `world`: cracks with a bright lip below them, a faint mirror of the
// sky. Ice on water cracks fully (`glacier` false); the old ice of a glacier shows fewer, fainter cracks.
vec3 iceSurface(vec3 base, vec3 light, vec2 world, vec2 sp, bool glacier) {
  vec2 px = floor(world) + 0.5;
  float share = glacier ? DH_ICE_GROUND_SHARE : DH_ICE_CRACK_SHARE;
  float strength = glacier ? DH_ICE_GROUND_STRENGTH : 1.0;
  float crack = crackAt(px, share, !glacier);
  vec3 c = base;
  if (crack > 0.75) c = mix(base, DH_COL_ICE_CRACK * light, strength);
  else if (crack > 0.25) c = mix(base, DH_COL_ICE_CRACK * light, 0.5 * strength);
  else if (crackAt(px + vec2(0.0, 1.0), share, false) > 0.75) c = mix(base, DH_COL_ICE_LIP * light, 0.7 * strength);
  return mix(c, skyAt(sp, 0.0), DH_ICE_SKY);
}

// Ragged reach of the shore ice at world pixel `world` [px]: value noise over cells of DH_ICE_EDGE_CELL px (bilinear,
// so the rim of the ice is one ragged line, not a row of blocks).
float shoreIceReach(vec2 world) {
  vec2 p = world / DH_ICE_EDGE_CELL;
  vec2 i = floor(p);
  vec2 t = p - i;
  t = t * t * (3.0 - 2.0 * t);
  ivec2 c = ivec2(i);
  float a = waterHash(c, 61u);
  float b = waterHash(c + ivec2(1, 0), 61u);
  float d = waterHash(c + ivec2(0, 1), 61u);
  float e = waterHash(c + ivec2(1, 1), 61u);
  float n = mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
  return uShoreIce * (DH_ICE_EDGE_MIN + DH_ICE_EDGE_SPREAD * n);
}

// ---------------------------------------------------------------------------------------------------------------
// Figures in the water

// The immersion (index) whose submerged part contains screen pixel `sp`, or −1; `below`: px under its waterline.
int immersionAt(vec2 sp, out float below, out float lineY) {
  below = 0.0;
  lineY = 0.0;
  for (int i = 0; i < DH_MAX_IMMERSIONS; i++) {
    if (i >= uImmerseCount) break;
    vec4 a = uImmerseA[i];
    vec4 b = uImmerseB[i];
    if (abs(sp.x - a.x) > a.z) continue;
    float wobble = floor(sin(uTime * DH_IMMERSE_WOBBLE_SPEED + floor(sp.x) * 0.9) * DH_IMMERSE_WOBBLE + 0.5);
    float line = a.y - b.x + wobble;
    float bottom = a.y + b.y;
    if (sp.y > line && sp.y <= bottom + 0.5) {
      below = sp.y - line;
      lineY = line;
      return i;
    }
  }
  return -1;
}

// The body frame of immersion `i` at screen pixel `sp` (displaced by `off`): palette colour, a = covered.
vec4 bodyAt(int i, vec2 sp, vec2 off) {
  vec4 a = uImmerseA[i];
  vec4 b = uImmerseB[i];
  vec4 fr = uImmerseC[i];
  vec4 an = uImmerseD[i];
  if (fr.z <= 0.0) return vec4(0.0);
  vec2 rel = floor(sp + off) + 0.5 - vec2(a.x, a.y + b.y);
  float lx = b.z > 0.5 ? an.x - rel.x : an.x + rel.x;
  float ly = an.y + rel.y;
  if (lx < 0.0 || ly < 0.0 || lx >= fr.z || ly >= fr.w) return vec4(0.0);
  vec4 texel = texelFetch(uAtlas, ivec2(fr.xy) + ivec2(floor(lx), floor(ly)), 0);
  if (texel.a < 0.5) return vec4(0.0);
  return vec4(paletteColor(uPalette, paletteIndexOf(texel.r), int(b.w)), 1.0);
}

// A submerged body seen through the water: the water takes its outline and most of its colour – what is left is a
// lighter shape (a body gives back more light than the water around it, a light one more than a dark one) with a hint
// of its own colour, fading with the depth under the surface. `body` is lit, `light` the light on the water.
vec3 throughWater(vec3 body, vec3 light, vec3 water, float below) {
  float albedo = clamp(dot(body, LUMA) / max(dot(light, LUMA), 0.05), 0.0, 1.0);
  vec3 shape = mix(water, DH_COL_IMMERSE * light, DH_IMMERSE_TINT * mix(DH_IMMERSE_TINT_FLOOR, 1.0, albedo));
  shape = mix(shape, body, DH_IMMERSE_BODY);
  return mix(water, shape, DH_IMMERSE_VISIBILITY * exp(-DH_IMMERSE_FADE * below));
}

// ---------------------------------------------------------------------------------------------------------------
// The water colour

// Water over `ground` at screen pixel `sp` / world point `world`, lit by `light`, `depth` 0…1, wave `slope`.
vec3 waterColour(vec3 ground, vec3 light, float depth, vec2 sp, vec2 world, vec2 slope, vec3 field, float surface, ivec2 s, bool reflect_, bool calm, bool skyOnly, float drawn) {
  vec3 c = ground;
  // Caustics: lines of focused sunlight on the ground of the shallows, fading towards the depth in a few steps (whole
  // lines, no speckle).
  if (uCaustics == 1 && !calm && uSunlight > 0.0 && depth < DH_CAUSTIC_MAX_DEPTH) {
    float k = ceil((1.0 - depth / DH_CAUSTIC_MAX_DEPTH) * DH_CAUSTIC_STEPS) / DH_CAUSTIC_STEPS * uSunlight;
    float caustic = causticAt(floor(world) + 0.5);
    if (caustic > 0.5) c = mix(c, DH_COL_CAUSTIC * light, min(DH_CAUSTIC_STRENGTH * caustic * k, 0.6));
  }
  // Depth: absorption towards the colour of deep water, turquoise in the shallows.
  c = mix(c, DH_COL_DEEP * light, DH_DEPTH_ABSORB * smoothstep(0.0, 1.0, depth));
  c = mix(c, DH_COL_SHALLOW * light, DH_SHALLOW_TINT * (1.0 - smoothstep(0.0, 0.33, depth)));
  // Wave shading (whole pixels, thresholded): the small wind waves – slopes facing the sky a step lighter, slopes
  // turned away a step darker –, the rings of the interactive field as 1-px contour lines – a light line where the
  // field rises through DH_RIPPLE_CREST, a dark one where it sinks through its negative (`reach`: how much the height
  // changes to the next pixel – the contour passes this pixel when it lies within that of the level) – and the flanks
  // of its big waves (a bow wave, a splash) as solid light and dark bands.
  vec2 toSky = vec2(-0.45, -0.89);
  float facing = dot(slope - field.xy, toSky);
  float fieldFacing = dot(field.xy, toSky);
  float reach = max(abs(field.x), abs(field.y)) / DH_WAVE_SLOPE;
  bool crest = field.z >= DH_RIPPLE_CREST && field.z - reach < DH_RIPPLE_CREST;
  bool trough = field.z <= -DH_RIPPLE_CREST && field.z + reach > -DH_RIPPLE_CREST;
  if (facing > DH_WAVE_LIGHT || crest || fieldFacing > DH_WAVE_FLANK) c = mix(c, DH_COL_SHALLOW * light, DH_RIPPLE_LIGHT);
  else if (facing < -DH_WAVE_LIGHT || trough || fieldFacing < -DH_WAVE_FLANK) c *= DH_RIPPLE_DARK;
  if (!reflect_) return c;
  // Mirror: what stands above the shoreline, else the sky; waves shift it sideways.
  float tilt = length(slope);
  int dx = int(clamp(floor(slope.x * DH_REFLECT_DISTORT + 0.5), -DH_REFLECT_MAX_DISTORT, DH_REFLECT_MAX_DISTORT));
  float dy = clamp(floor(slope.y * DH_REFLECT_DISTORT + 0.5), -DH_REFLECT_MAX_DISTORT, DH_REFLECT_MAX_DISTORT);
  // The search starts where something other than water may stand above (the field's error and the sideways shift off).
  vec4 object = skyOnly ? vec4(0.0) : objectReflection(s, surface, dx, drawn - 1.0 - float(abs(dx)));
  vec3 sky = skyAt(sp + vec2(float(dx), dy), tilt);
  vec3 mirrored = mix(sky, object.rgb, object.a);
  float share = mix(uSkyShare, DH_REFLECT_SHARE, object.a) * (1.0 - 0.5 * clamp(tilt * 2.0, 0.0, 1.0));
  return mix(c, mirrored, share);
}

void main() {
  ivec2 g = ivec2(gl_FragCoord.xy);
  ivec2 s = ivec2(g.x, int(uTargetSize.y) - 1 - g.y);
  vec2 sp = vec2(s) + 0.5;
  vec2 world = uOrigin + sp;
  vec4 g1 = texelFetch(uNormal, g, 0);
  vec4 g2 = texelFetch(uSurface, g, 0);
  bool water = gbufferHasMask(g2, DH_MASK_WATER);
  float below;
  float lineY;
  int immerse = immersionAt(sp, below, lineY);
  vec4 tile = waterTile(world);
  bool frozenTile = uTilesKnown == 1 && (waterTileFlag(tile, WATER_FLAG_FROZEN) || waterTileFlag(tile, WATER_FLAG_ICE_GROUND));
  bool ice = !water && frozenTile && gbufferHasMaterial(g1, DH_MAT_ICE) && abs(gbufferHeight(g1) - tile.a * DH_LEVEL_PX) < 2.0;
  if (!water && !ice && immerse < 0) discard;
  // Only a figure's own pixels on a water tile are under water (not the bank beside a wader).
  if (!water && !ice && uTilesKnown == 1 && tile.r < 0.5) discard;
  // A waterfall (water on a wall, facing south) keeps the terrain's own falling water.
  if (water && length(gbufferNormal(g1).xy) > DH_FALL_TILT) discard;
  vec3 lit = sceneAt(s);
  vec3 albedo = texelFetch(uAlbedo, g, 0).rgb;
  vec3 light = lightOf(lit, albedo);

  if (ice) {
    // Frozen water shows a little of the deep blue under it; glacier ice is ice all through.
    vec3 base = lit;
    if (waterTileFlag(tile, WATER_FLAG_FROZEN)) base = mix(base, DH_COL_ICE_DEEP * light, DH_ICE_DEEP_SHOW * clamp(tile.r * 0.5, 0.0, 1.0));
    oColor = encodeHdr(iceSurface(base, light, world, sp, !waterTileFlag(tile, WATER_FLAG_FROZEN)));
    return;
  }

  bool reflect_ = uReflection == 1;
  float surface = gbufferHeight(g1);
  vec3 field = fieldAt(world);
  vec2 slope = ambientSlope(world) + field.xy;

  if (!water) {
    // A wading figure's drawn pixel below its waterline: seen through the water of the nearest water pixel.
    ivec2 w = s;
    for (int k = 1; k <= 8; k++) {
      if (waterPixel(s + ivec2(0, k))) { w = s + ivec2(0, k); break; }
      if (waterPixel(s + ivec2(k, 0))) { w = s + ivec2(k, 0); break; }
      if (waterPixel(s - ivec2(k, 0))) { w = s - ivec2(k, 0); break; }
    }
    vec3 ground = w == s ? DH_COL_DEEP * light : sceneAt(w);
    vec3 wlight = w == s ? light : lightOf(ground, texelFetch(uAlbedo, glTexel(w), 0).rgb);
    float wsurface = w == s ? surface : gbufferHeight(texelFetch(uNormal, glTexel(w), 0));
    vec3 over = waterColour(ground, wlight, 0.2, sp, world, slope, field, wsurface, s, reflect_, true, true, 0.0);
    ivec2 q = s + ivec2(int(clamp(floor(slope.x * DH_REFRACT_PER_SLOPE + 0.5), -1.0, 1.0)), 0);
    vec3 body = !waterPixel(q) ? sceneAt(q) : lit;
    vec3 c = throughWater(body, light, over, below);
    // The waterline: a bright glint right under it.
    if (below <= DH_IMMERSE_GLINT) c = mix(c, DH_COL_FOAM * wlight, DH_FOAM_COVER);
    oColor = encodeHdr(c);
    return;
  }

  float drawn;
  float dist = shoreDistance(s, world, tile, drawn);
  float depth = depthShare(dist, tile);
  bool calm = nearFigure(sp, DH_IMMERSE_CLEAR);
  // Refraction: the ground shifts by whole pixels with the slope, never onto land.
  ivec2 q = s;
  if (uRefraction == 1) {
    vec2 off = clamp(floor(slope * DH_REFRACT_PER_SLOPE * mix(DH_REFRACT_SHALLOW, 1.0, depth) + 0.5), vec2(-DH_REFRACT_MAX), vec2(DH_REFRACT_MAX));
    ivec2 r = s + ivec2(off);
    if (waterPixel(r)) q = r;
  }
  vec3 ground = sceneAt(q);
  // A body under the surface (the swimmer's legs below its cut swim frame): there one looks through the surface.
  vec4 body = immerse >= 0 ? bodyAt(immerse, sp, uRefraction == 1 ? vec2(floor(slope.x * DH_REFRACT_PER_SLOPE + 0.5), 0.0) : vec2(0.0)) : vec4(0.0);
  vec3 c = waterColour(ground, light, depth, sp, world, slope, field, surface, s, reflect_, calm, body.a > 0.5, drawn);
  if (body.a > 0.5) c = throughWater(body.rgb * light, light, c, below);

  // Shore ice in a hard frost: thin plates from the bank outwards.
  if (uShoreIce > 0.0 && dist < shoreIceReach(world)) {
    float t = clamp(dist / max(uShoreIce, 1.0), 0.0, 1.0);
    vec3 plate = mix(DH_COL_ICE * light, c, DH_ICE_DEEP_SHOW * t);
    oColor = encodeHdr(iceSurface(mix(c, plate, mix(1.0, DH_ICE_EDGE_OPACITY, t)), light, world, sp, false));
    return;
  }

  // Foam on the shore, under a waterfall, around what stands in the water and on high crests; the glint along a
  // figure's waterline.
  float foam = calm ? 0.0 : max(foamAt(dist, world, field.z), fallFoam(s));
  bool glint = false;
  for (int i = 0; i < DH_MAX_IMMERSIONS; i++) {
    if (i >= uImmerseCount) break;
    // A wading figure's cut gets a glint along its waterline (a swimmer's frames paint their own ring).
    if (uImmerseC[i].z > 0.0) continue;
    vec4 a = uImmerseA[i];
    float line = a.y - uImmerseB[i].x;
    if (abs(sp.x - a.x) <= a.z + 1.0 && sp.y > line && sp.y <= line + DH_IMMERSE_GLINT + 0.5 && !waterPixel(s - ivec2(0, 1))) glint = true;
  }
  if (foam > 0.9 || glint) c = mix(c, DH_COL_FOAM * light, DH_FOAM_COVER);
  else if (foam > 0.5) c = mix(c, DH_COL_FOAM_SHADE * light, DH_FOAM_SHADE_COVER);

  // Sun glitter: short dashes on the crests of the small waves that face the sky, moving on now and then.
  if (reflect_ && uGlitter > 0.0 && foam < 0.5) {
    float crest = dot(slope, vec2(-0.45, -0.89)) / max(mix(DH_AMBIENT_CALM, DH_AMBIENT_WINDY, uWind.z) * uMotion, 1e-3);
    float chance = DH_GLITTER_SHARE * uGlitter * smoothstep(DH_GLITTER_FACING, DH_GLITTER_FULL_FACING, crest);
    ivec2 px = ivec2(floor(world));
    bool sparkle = glintRoll(px) < chance || glintRoll(px - ivec2(1, 0)) < chance || glintRoll(px - ivec2(2, 0)) < chance * DH_GLITTER_LONG;
    if (chance > 0.0 && sparkle) c += DH_COL_GLITTER * (DH_GLITTER_BRIGHTNESS * uGlitter);
  }
  oColor = encodeHdr(c);
}
