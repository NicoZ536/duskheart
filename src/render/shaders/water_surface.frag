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
//   stars and the moon with its glitter path –, broken by the waves; without the mirror (Niedrig, Mittel) the plain
//   sky tint; by day the sun's glitter: streaks along the wave crests on the sun's mirror path, where the sun reaches
//   the water;
// - shore foam along the distance field, surging, with a broken second line, white water under waterfalls and foam
//   on high wave crests; still water mirrors no water (the pool under a waterfall mirrors the fall like the rock beside
//   it, not the pool above it);
// - figures in the water: below their waterline they are seen through the water (the immersion mask);
// - winter: frozen water and glacier ice with cracks, thin ice growing from the shore in a hard frost.
// Everything stays on whole pixels (displacements, reflections, foam, glints are per pixel and thresholded).
// The frame's values in one vec4 array (one upload; layout: WATER_FRAME in src/render/passes/waterPass.ts) and the
// mirrored sky as the scene holds it (SKY_FIELD in src/render/water/state.ts). The drifting fields (caustics, the small
// waves' trains), the flicker clock and the motion clock come integrated from the CPU (world/drift.ts): a change of wind
// or of the accessibility options changes their speed, never their place. Every number is a parameter
// (src/render/water/params.ts); the literals left are pixel geometry (centres, halves, neighbours) and the codes below.
uniform vec4 uFrame[DH_WATER_FRAME_VEC4S];
uniform vec4 uSky[5];
uniform vec3 uDaylight;            // the frame's ambient (colour × strength): the daylight on a flat, sunlit pixel
#define uOrigin (uFrame[0].xy)          // world px of target pixel (0, 0), top-left
#define uTargetSize (uFrame[0].zw)
#define uViewSize (uFrame[1].xy)        // the visible image [px]
// The motion clock: presentation time × the motion scale of the settings (reduced motion), integrated [s] – the caustics'
// cell wobble, the surf and the waterline's wobble run on it; every speed on it is whole turns per period (no seam).
#define uMotionTime (uFrame[1].z / DH_DRIFT_UNITS)
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
// The drifting values come in whole 1/DH_DRIFT_UNITS px (or s).
#define uFlickerTime (uFrame[6].w / DH_DRIFT_UNITS)     // presentation time at the flicker rate (flash reduction: a quarter) [s]
#define uCausticDrift (uFrame[7] / DH_DRIFT_UNITS)      // offsets of the caustics' two layers (xy, zw) [world px]
#define uTravel (uFrame[8].xyz / DH_DRIFT_UNITS)        // travel of the three ambient trains [px, modulo DH_TRAVEL_WAVES wavelengths]
#define uSunShare (uFrame[8].w)          // share of the daylight that comes from the sun (0: no sun)
#define uSkyZenith (uSky[0].xyz)
#define uSunlight (uSky[0].w)
#define uSkyHorizon (uSky[1].xyz)
#define uSkyShare (uSky[1].w)
#define uStars (uSky[2].x * uFrame[6].x)
#define uGlitter (uSky[2].y * uFrame[6].x)
#define uMoonWaxing (int(uSky[2].z))
// Moon: screen px x, y (1-px border), brightness (none without the mirror), lit fraction.
#define uMoon (vec4(uSky[3].xy * uViewSize + 1.0, uSky[2].w * uFrame[6].x, uSky[3].z))
// The sun's mirror point [screen px, 1-px border] and its path: length [px] and half width at the near end [px].
#define uSunMirror (uSky[4].xy * uViewSize + 1.0)
#define uSunPath (vec2(uSky[4].z * uViewSize.y, uSky[4].w * uViewSize.x))
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
uniform vec4 uImmerseD[DH_MAX_IMMERSIONS];   // body frame anchor in the frame x, y; mirrored (0: floats in the water)

out vec4 oColor;

const float TAU = 6.2831853;
const float PI = 3.14159265;
const float SQRT2 = 1.4142136;
const vec3 LUMA = DH_LUMA;
// Foam codes of foamAt and fallFoam: solid foam, shaded foam (the band's ragged rim, the broken outer line), none.
const float FOAM_SOLID = 1.0;
const float FOAM_SHADED = 0.75;
// Nearest-point distances start beyond any cell of a 3 × 3 search.
const float FAR = 8.0;
// Wind below this length has no direction (the trains run east then).
const float CALM_WIND = 0.01;

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
  float l = dot(lit, LUMA) / max(dot(albedo, LUMA), DH_FLOOR_ALBEDO_LUMA);
  vec3 ratio = lit / max(albedo, vec3(DH_FLOOR_ALBEDO_CHANNEL));
  vec3 hue = ratio / max(dot(ratio, LUMA), DH_FLOOR_HUE_LUMA);
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

// The small wind waves at a world point: three trains, each running along its direction (the wind turned by the
// train's angle) – their slope and, for the sun's glints along their crests, each train's phase and direction.
struct Ambient {
  vec2 slope;   // slope of the small waves (× the reduced motion's scale)
  vec3 phase;   // phase of each train [rad]: its slope along its direction goes with cos(phase)
  vec2 d0;
  vec2 d1;
  vec2 d2;
};

vec2 trainDirection(vec2 wind, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(wind.x * c - wind.y * s, wind.x * s + wind.y * c);
}

// Phase of a train (direction `d`, wavelength `wl`, travelled `travel` px) at world point `world`; a slow warp across
// the train bends its crests (no ruled lines).
float trainPhase(vec2 world, vec2 d, float wl, float travel, float phase) {
  vec2 side = vec2(-d.y, d.x);
  float warp = DH_AMBIENT_WARP * sin(dot(world, side) * TAU / (wl * DH_AMBIENT_WARP_SPAN) + phase);
  return (dot(world, d) - travel) * TAU / wl + warp + phase;
}

// Largest slope of the small waves in the wind of the moment (full motion).
float ambientAmplitude() {
  return mix(DH_AMBIENT_CALM, DH_AMBIENT_WINDY, uWind.z);
}

Ambient ambientWaves(vec2 world) {
  vec2 wind = length(uWind.xy) > CALM_WIND ? normalize(uWind.xy) : vec2(1.0, 0.0);
  Ambient a;
  a.d0 = trainDirection(wind, DH_AMBIENT_A0);
  a.d1 = trainDirection(wind, DH_AMBIENT_A1);
  a.d2 = trainDirection(wind, DH_AMBIENT_A2);
  a.phase = vec3(trainPhase(world, a.d0, DH_AMBIENT_WL0, uTravel.x, DH_AMBIENT_P0),
                 trainPhase(world, a.d1, DH_AMBIENT_WL1, uTravel.y, DH_AMBIENT_P1),
                 trainPhase(world, a.d2, DH_AMBIENT_WL2, uTravel.z, DH_AMBIENT_P2));
  vec2 s = a.d0 * (cos(a.phase.x) * DH_AMBIENT_W0) + a.d1 * (cos(a.phase.y) * DH_AMBIENT_W1) + a.d2 * (cos(a.phase.z) * DH_AMBIENT_W2);
  a.slope = s * ambientAmplitude() * uMotion;
  return a;
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
        return max(float(r) * (k >= 4 ? SQRT2 : 1.0), tiles);
      }
    }
  }
  drawn = float(DH_SHORE_SEARCH);
  return max(float(DH_SHORE_SEARCH) + 1.0, tiles);
}

// Depth share 0 (shore) … 1 (deep) of a water pixel.
float depthShare(float dist, vec4 tile) {
  float d = clamp((dist - 1.0) / DH_DEPTH_FULL, 0.0, 1.0);
  if (uTilesKnown == 1 && tile.r > 0.5 && tile.r < 1.5) d = min(d, DH_SHALLOW_CLASS_DEPTH);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Caustics, foam

// Distance to the nearest cell edge of a Voronoi field (F2 − F1) in cell units, each cell's point swinging around the
// cell's centre by DH_CAUSTIC_WOBBLE at the phases `wobble` (x, y [rad]; 0: at rest). With a `period` > 0 its lattice
// repeats every `period` cells (a drifting field wraps its offset without a seam; wrapped in integers, cells never below
// −period: the offset lies within half a period of 0, the world starts at 0).
float voronoiEdge(vec2 p, vec2 wobble, uint salt, int period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float f1 = FAR;
  float f2 = FAR;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(i) + ivec2(x, y);
      if (period > 0) c = (c + period) % period;
      float h1 = waterHash(c, salt);
      float h2 = waterHash(c, salt + 7u);
      vec2 o = vec2(0.5) + DH_CAUSTIC_WOBBLE * vec2(sin(wobble.x + TAU * h1), cos(wobble.y + TAU * h2));
      float d = length(vec2(float(x), float(y)) + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return f2 - f1;
}

// The bent lattice coordinates of a caustic layer at `q` [px] (world point plus the layer's drift): warped by up to
// DH_CAUSTIC_WARP px in waves of frequency `freq` [rad/px] – whole waves per lattice `period` [px], so the bend repeats
// with the lattice (reduced into one period first: small arguments for sin) – light focused by the waves runs in curves,
// not in the straight seams of cracks.
vec2 causticBend(vec2 q, float freq, float period) {
  vec2 r = mod(q, period) * freq;
  return q + DH_CAUSTIC_WARP * vec2(sin(r.y), cos(r.x));
}

// Caustic light 0…2 at world pixel `world` (two drifting layers of faint lines; 2 where they cross). The cells wobble on
// the motion clock (reduced motion slows them, M5-47).
float causticAt(vec2 world) {
  vec2 qa = causticBend(world + uCausticDrift.xy, DH_CAUSTIC_WARP_FREQ.x, DH_CAUSTIC_PERIOD_PX.x);
  vec2 qb = causticBend(world + uCausticDrift.zw + DH_CAUSTIC_LAYER_OFFSET, DH_CAUSTIC_WARP_FREQ.y, DH_CAUSTIC_PERIOD_PX.y);
  float a = voronoiEdge(qa / DH_CAUSTIC_CELL, uMotionTime * DH_CAUSTIC_WOBBLE_A, 3u, DH_CAUSTIC_PERIOD) < DH_CAUSTIC_LINE ? 1.0 : 0.0;
  float b = voronoiEdge(qb / DH_CAUSTIC_CELL_B, uMotionTime * DH_CAUSTIC_WOBBLE_B, 5u, DH_CAUSTIC_PERIOD) < DH_CAUSTIC_LINE_B ? 1.0 : 0.0;
  return a + b;
}

// Foam at a water pixel `dist` px from its shore: FOAM_SOLID, FOAM_SHADED or 0. The surf runs up and back on the motion
// clock (reduced motion slows it, M5-47).
float foamAt(float dist, vec2 world, float crest) {
  float wave = sin(uMotionTime * DH_FOAM_SURGE_RATE - (world.x + world.y) * DH_FOAM_SURGE_PHASE);
  float surge = DH_FOAM_SURGE * (0.5 + 0.5 * wave);
  ivec2 px = ivec2(floor(world));
  float foam = 0.0;
  float edge = DH_FOAM_WIDTH + surge;
  if (dist <= edge) foam = dist > edge - DH_FOAM_RIM && waterHash(px, 9u) < DH_FOAM_RIM_SHADE ? FOAM_SHADED : FOAM_SOLID;
  float outer = DH_FOAM_OUTER + surge * DH_FOAM_OUTER_SURGE;
  if (abs(dist - outer) < DH_FOAM_OUTER_HALF && waterHash(ivec2(floor(world / DH_FOAM_CELL)), 11u) < DH_FOAM_OUTER_SHARE) foam = max(foam, FOAM_SHADED);
  if (crest > DH_FOAM_CREST && waterHash(px, 13u) < clamp((crest - DH_FOAM_CREST) * DH_FOAM_CREST_RAMP, 0.0, DH_FOAM_CREST_MAX)) foam = max(foam, FOAM_SOLID);
  return foam;
}

// White water below a waterfall: the column above decides – falling water (a water pixel tilted like a wall)
// within DH_FALL_REACH px above churns the pool, thinning out away from it; land or the picture's edge first: none.
// FOAM_SOLID, FOAM_SHADED or 0.
float fallFoam(ivec2 s) {
  for (int k = 1; k <= DH_FALL_REACH; k++) {
    ivec2 q = s - ivec2(0, k);
    if (!waterPixel(q)) return 0.0;
    if (length(gbufferNormal(texelFetch(uNormal, glTexel(q), 0)).xy) > DH_FALL_TILT) {
      float share = DH_FALL_SHARE * (1.0 - float(k - 1) / float(DH_FALL_REACH));
      ivec2 px = s + ivec2(floor(uOrigin));
      float slot = floor(uFlickerTime * DH_FALL_FLICKER + waterHash(px, 82u) * DH_FALL_SLOT_SPREAD);
      float roll = waterHash(px + int(slot) * DH_FALL_SLOT_STRIDE, 83u);
      return roll < share ? FOAM_SOLID : (roll < share * (1.0 + DH_FALL_SHADE) ? FOAM_SHADED : 0.0);
    }
  }
  return 0.0;
}

// ---------------------------------------------------------------------------------------------------------------
// Sky, stars, moon

// A star of the mirrored star field at sky pixel `q` (0 where there is none).
float starAt(vec2 q) {
  ivec2 cell = ivec2(floor(q / DH_STAR_CELL));
  if (waterHash(cell, 31u) >= DH_STAR_DENSITY) return 0.0;
  float span = DH_STAR_CELL - 2.0 * DH_STAR_MARGIN;
  vec2 star = vec2(cell) * DH_STAR_CELL + DH_STAR_MARGIN + floor(vec2(waterHash(cell, 32u), waterHash(cell, 33u)) * span);
  vec2 d = abs(floor(q) - star);
  float twinkle = 1.0 - DH_STAR_TWINKLE_DEPTH * (0.5 + 0.5 * sin(uFlickerTime * DH_STAR_TWINKLE_SPEED + TAU * waterHash(cell, 34u)));
  float level = mix(DH_STAR_MIN_LEVEL, 1.0, waterHash(cell, 35u));
  if (d.x < 0.5 && d.y < 0.5) return level * twinkle;
  // The cross: the four side neighbours (|dx| + |dy| = 1).
  if (waterHash(cell, 36u) < DH_STAR_BRIGHT_SHARE && d.x + d.y < 1.5) return DH_STAR_CROSS * level * twinkle;
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
    float width = mix(r * DH_MOON_PATH_START, DH_MOON_PATH_WIDTH, s);
    if (abs(d.x) < width) {
      ivec2 px = ivec2(floor(sp));
      float slot = floor(uFlickerTime * DH_MOON_PATH_FLICKER + waterHash(px, 41u) * DH_MOON_SLOT_SPREAD);
      float chance = DH_MOON_PATH_SPARKLE * (1.0 - s) * (1.0 - abs(d.x) / width) * (DH_MOON_PATH_CALM + DH_MOON_PATH_SLOPE * slope);
      if (waterHash(px + int(slot) * DH_MOON_SLOT_STRIDE, 42u) < chance) return DH_MOON_PATH_LEVEL;
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

// How much of the sun reaches a water pixel whose light is `light` (its lit colour over its albedo, luminance) under a
// daylight of luminance `level` of which `share` comes from the sun: 0 in full shade (the sky part alone reaches it),
// 1 in full sun (sky and sun) – a tree's, a house's and a cloud's shadow all tell in the light.
float sunSeen(float light, float level, float share) {
  if (share <= 0.0 || level <= 0.0) return 0.0;
  return clamp((light / level - (1.0 - share)) / share, 0.0, 1.0);
}

// Weight 0…1 of the sun's mirror path at (`dx`, `dy`) px from its mirror point (y towards the viewer): an oval from the
// mirror point over `len` px towards the viewer, `halfWidth` px wide at its near end and DH_GLITTER_START_WIDTH of that
// at the mirror point – 1 in its middle, falling off to 0 at its rim.
float glitterPath(float dx, float dy, float len, float halfWidth) {
  if (len <= 0.0 || halfWidth <= 0.0) return 0.0;
  float along = dy / len;
  if (along <= 0.0 || along >= 1.0) return 0.0;
  float across = dx / (halfWidth * mix(DH_GLITTER_START_WIDTH, 1.0, along));
  float middle = 2.0 * along - 1.0;
  return clamp(1.0 - across * across - middle * middle, 0.0, 1.0);
}

// The count 0 … DH_TRAVEL_WAVES − 1 of the crest nearest to phase `x` of a train (`target`: the phase of its crest line,
// 0 or π): its crests counted along its direction, modulo the waves per travel period. The travel's wrap moves every
// count by exactly DH_TRAVEL_WAVES, so a crest keeps its count – and its sparkle – across the wrap (M5-42).
float crestIndex(float x, float target) {
  float k = floor((x - target) / TAU + 0.5);
  return k - DH_TRAVEL_WAVES * floor(k / DH_TRAVEL_WAVES);
}

// A glint of the ambient train with direction `d`, wavelength `wl` and phase `x` at world pixel `world`: on the line
// where its flank faces `toward` most (its slope along `d` goes with cos(x): cos(x) = ±1 there), one pixel wide, cut
// into DH_GLITTER_SEGMENT-px segments along the crest – every other one may sparkle (a gap between two streaks), over
// DH_GLITTER_MIN_LENGTH to all of its length (never a lone pixel); each sparkles in its own time slots with `chance`.
bool trainGlint(vec2 world, vec2 d, float wl, float x, vec2 toward, float chance, uint salt) {
  float facing = dot(d, toward);
  float target = facing >= 0.0 ? 0.0 : PI;
  float off = mod(x - target + PI, TAU) - PI;
  if (abs(off) * wl / TAU > 0.5 * DH_GLITTER_LINE) return false;
  float along = dot(world, vec2(-d.y, d.x)) / DH_GLITTER_SEGMENT;
  float segment = floor(along);
  if (mod(segment, 2.0) > 0.5) return false;
  ivec2 cell = ivec2(int(crestIndex(x, target)), int(segment));
  float slot = floor(uFlickerTime * DH_GLITTER_FLICKER + waterHash(cell, salt) * DH_GLITTER_SLOT_SPREAD);
  ivec2 roll = cell + int(slot) * DH_GLITTER_SLOT_STRIDE;
  if (along - segment > mix(DH_GLITTER_MIN_LENGTH, 1.0, waterHash(roll, salt + 2u))) return false;
  return waterHash(roll, salt + 1u) < chance * abs(facing);
}

// Sun glitter 0…1 (share of the glint colour) at screen pixel `sp` / world pixel `world` whose light lets `seen` of the
// sun through: streaks along the crests of the small waves (`a`) on the sun's mirror path, where the waves face its
// mirror point enough – never in the shade, never a starfield.
float sunGlitter(vec2 sp, vec2 world, Ambient a, float seen) {
  float sun = smoothstep(DH_GLITTER_SUN_FROM, DH_GLITTER_SUN_FULL, seen) * uGlitter;
  if (sun <= 0.0) return 0.0;
  vec2 d = floor(sp) + 0.5 - uSunMirror;
  float path = glitterPath(d.x, d.y, uSunPath.x, uSunPath.y);
  if (path <= 0.0) return 0.0;
  vec2 toward = -normalize(d);
  // The waves as a whole must lean towards the mirror point – less at the path's rim, calmer waves (reduced motion) less.
  float facing = dot(a.slope, toward) / ambientAmplitude();
  if (facing < mix(DH_GLITTER_FACING_RIM, DH_GLITTER_FACING_AXIS, path)) return 0.0;
  float chance = DH_GLITTER_SHARE * path;
  // The streaks follow the crests of the train whose crests run most nearly across the picture (the swell rolling
  // towards the viewer): dashes of one direction, not a thicket of lines in three.
  float y0 = abs(a.d0.y);
  float y1 = abs(a.d1.y);
  float y2 = abs(a.d2.y);
  bool glint = y1 >= y0 && y1 >= y2 ? trainGlint(world, a.d1, DH_AMBIENT_WL1, a.phase.y, toward, chance, 23u)
             : y2 >= y0 ? trainGlint(world, a.d2, DH_AMBIENT_WL2, a.phase.z, toward, chance, 25u)
             : trainGlint(world, a.d0, DH_AMBIENT_WL0, a.phase.x, toward, chance, 21u);
  return glint ? DH_GLITTER_COVER * sun : 0.0;
}

// ---------------------------------------------------------------------------------------------------------------
// Reflection of objects above the shoreline

// The figure in the water whose drawing covers screen pixel `sp` (down to its reach under its feet, `uImmerseB.y`), or −1.
// Its heights count from its feet under the surface: it mirrors about its waterline.
int figureAt(vec2 sp) {
  for (int i = 0; i < DH_MAX_IMMERSIONS; i++) {
    if (i >= uImmerseCount) break;
    vec4 a = uImmerseA[i];
    if (abs(sp.x - a.x) <= a.z && sp.y >= a.y - a.w && sp.y <= a.y + uImmerseB[i].y + 0.5) return i;
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
  // Below a waterfall the search starts at the surface: the distance field counts the falling water as water, so `from`
  // lay beyond the fall's own mirror (pool pixels a fall's height below its foot mirror its face) – and where it began
  // near enough, beside the banks, the face showed in wedges. Looked for every half level up to `from` (a face is a level
  // high at least, nothing but water lies nearer), as far as a mirror can reach (half the search).
  float start = max(1.0, floor(from));
  for (float k = DH_LEVEL_PX * 0.5; k < start && k <= DH_REFLECT_MAX * 0.5; k += DH_LEVEL_PX * 0.5) {
    ivec2 c = ivec2(s.x + dx, s.y - int(k));
    if (c.y < 0) break;
    if (waterPixel(c) && length(gbufferNormal(texelFetch(uNormal, glTexel(c), 0)).xy) > DH_FALL_TILT) {
      start = 1.0;
      break;
    }
  }
  // Every pixel up to DH_REFLECT_FINE px (the base of what stands at the water), then every DH_REFLECT_STEP px: an
  // exact match within the tolerance is still met, 2h − d grows by one per pixel up an upright object.
  for (float d = start; d <= DH_REFLECT_MAX; d += d < DH_REFLECT_FINE ? 1.0 : DH_REFLECT_STEP) {
    ivec2 q = ivec2(s.x + dx, s.y - int(d));
    if (q.y < 0) return vec4(0.0);
    if (q.x < 0 || float(q.x) >= uTargetSize.x) return vec4(0.0);
    vec4 g1 = texelFetch(uNormal, glTexel(q), 0);
    float h = gbufferHeight(g1) - surface;
    if (h < DH_REFLECT_MIN_HEIGHT) continue;
    int figure = figureAt(vec2(q) + 0.5);
    // A swimmer is not mirrored (its body shows under the surface instead), nor a creature that floats in the water (the
    // jellyfish: what is drawn above its line is its body at and under the surface, nothing of it stands over the water):
    // the search looks past it.
    if (figure >= 0 && (uImmerseC[figure].z > 0.0 || uImmerseD[figure].z < 0.5)) continue;
    if (figure >= 0) h -= uImmerseB[figure].x;
    // A pixel h above the surface mirrors 2h below its own place on the screen: it is this water pixel's mirror when
    // it lies d = 2h above it. Only an exact match counts – a part that floats above the ground (a hand, the rim of a
    // crown) would otherwise smear its colour down over every water pixel between.
    if (abs(2.0 * h - d) > DH_REFLECT_TOLERANCE) continue;
    // A water surface higher up (the pool above a fall) does not mirror – the sky shows: in the scene copy it is still its
    // ground. Falling water does, like the rock beside it (M6 gate round 2 `gruenhain-nacht`: with the fall left out the
    // pool under it showed the starlit sky in a rectangular notch of the cliff's dark mirror band).
    if (waterPixel(q) && length(gbufferNormal(g1).xy) <= DH_FALL_TILT) return vec4(0.0);
    float fade = (1.0 - smoothstep(DH_REFLECT_MAX - DH_REFLECT_FADE, DH_REFLECT_MAX, d)) * smoothstep(0.0, DH_REFLECT_FADE * 0.5, float(q.y));
    return vec4(sceneAt(q), fade);
  }
  return vec4(0.0);
}

// ---------------------------------------------------------------------------------------------------------------
// Ice

// Crack codes of crackAt: a crack's core, a hairline (0: none).
const float CRACK_CORE = 1.0;
const float CRACK_HAIR = 0.5;
// Hash stride of a pair of plates (the crack between two plates hashes the same from either side).
const int PAIR_STRIDE = 31;

// Crack at world pixel `world`: CRACK_CORE, CRACK_HAIR or 0 – the edges between the plates of a Voronoi field
// (`share` of them cracked) and, with `hairs`, fine hairlines inside the plates.
float crackAt(vec2 world, float share, bool hairs) {
  vec2 p = world / DH_ICE_PLATE;
  vec2 i = floor(p);
  vec2 f = p - i;
  float f1 = FAR;
  float f2 = FAR;
  ivec2 c1 = ivec2(0);
  ivec2 c2 = ivec2(0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 c = ivec2(i) + ivec2(x, y);
      vec2 o = vec2(waterHash(c, 51u), waterHash(c, 52u)) * DH_ICE_JITTER + 0.5 * (1.0 - DH_ICE_JITTER);
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
  if ((f2 - f1) * DH_ICE_PLATE < DH_ICE_CRACK_WIDTH * 2.0 && waterHash(lo * PAIR_STRIDE + hi, 53u) < share) return CRACK_CORE;
  if (!hairs) return 0.0;
  float hair = voronoiEdge((world + DH_ICE_HAIR_OFFSET) / DH_ICE_HAIR, vec2(0.0), 57u, 0) * DH_ICE_HAIR;
  if (hair < DH_ICE_CRACK_WIDTH && waterHash(ivec2(floor(world / DH_ICE_HAIR)), 58u) < DH_ICE_HAIR_SHARE) return CRACK_HAIR;
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
  if (crack >= CRACK_CORE) c = mix(base, DH_COL_ICE_CRACK * light, strength);
  else if (crack >= CRACK_HAIR) c = mix(base, DH_COL_ICE_CRACK * light, DH_ICE_HAIR_STRENGTH * strength);
  else if (crackAt(px + vec2(0.0, 1.0), share, false) >= CRACK_CORE) c = mix(base, DH_COL_ICE_LIP * light, DH_ICE_LIP_STRENGTH * strength);
  return mix(c, skyAt(sp, 0.0), DH_ICE_SKY);
}

// Ragged reach of the shore ice at world pixel `world` [px]: value noise over cells of DH_ICE_EDGE_CELL px (bilinear,
// so the rim of the ice is one ragged line, not a row of blocks).
float shoreIceReach(vec2 world) {
  vec2 p = world / DH_ICE_EDGE_CELL;
  vec2 i = floor(p);
  vec2 t = p - i;
  t = smoothstep(0.0, 1.0, t);
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
    float wobble = floor(sin(uMotionTime * DH_IMMERSE_WOBBLE_SPEED + floor(sp.x) * DH_IMMERSE_WOBBLE_PHASE) * DH_IMMERSE_WOBBLE + 0.5);
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
// of its own colour, fading with the depth under the surface. `body` is lit, `light` the light on the water, `reflected`
// what the surface of `water` mirrors (`waterColour`): it lies over whatever is under the surface – a body there takes
// the place of the light coming up from below, never of the mirror, so it shows no darker than that (at night, when the
// sky's mirror is most of what the water shows, a dark outline under the surface came out as a black hole, M6 gate round 2
// `kreaturen-kueste-nacht`).
vec3 throughWater(vec3 body, vec3 light, vec3 water, float below, vec3 reflected) {
  float albedo = clamp(dot(body, LUMA) / max(dot(light, LUMA), DH_FLOOR_LIGHT_LUMA), 0.0, 1.0);
  vec3 shape = mix(water, DH_COL_IMMERSE * light, DH_IMMERSE_TINT * mix(DH_IMMERSE_TINT_FLOOR, 1.0, albedo));
  shape = mix(shape, body, DH_IMMERSE_BODY);
  return max(mix(water, shape, DH_IMMERSE_VISIBILITY * exp(-DH_IMMERSE_FADE * below)), reflected);
}

// ---------------------------------------------------------------------------------------------------------------
// The water colour

// Water over `ground` at screen pixel `sp` / world point `world`, lit by `light`, `depth` 0…1, wave `slope`; `mirrored`:
// how much of an object above the shoreline shows in it (0: the sky); `reflected`: the part of the colour its surface
// mirrors (sky or object, times the mirror's share).
vec3 waterColour(vec3 ground, vec3 light, float depth, vec2 sp, vec2 world, vec2 slope, vec3 field, float surface, ivec2 s, bool reflect_, bool calm, bool skyOnly, float drawn, out float mirrored, out vec3 reflected) {
  mirrored = 0.0;
  vec3 c = ground;
  // Caustics: lines of focused sunlight on the ground of the shallows, fading towards the depth in a few steps (whole
  // lines, no speckle).
  if (uCaustics == 1 && !calm && uSunlight > 0.0 && depth < DH_CAUSTIC_MAX_DEPTH) {
    float k = ceil((1.0 - depth / DH_CAUSTIC_MAX_DEPTH) * DH_CAUSTIC_STEPS) / DH_CAUSTIC_STEPS * uSunlight;
    float caustic = causticAt(floor(world) + 0.5);
    if (caustic > 0.5) c = mix(c, DH_COL_CAUSTIC * light, min(DH_CAUSTIC_STRENGTH * caustic * k, DH_CAUSTIC_MAX_COVER));
  }
  // Depth: absorption towards the colour of deep water, turquoise in the shallows.
  c = mix(c, DH_COL_DEEP * light, DH_DEPTH_ABSORB * smoothstep(0.0, 1.0, depth));
  c = mix(c, DH_COL_SHALLOW * light, DH_SHALLOW_TINT * (1.0 - smoothstep(0.0, DH_SHALLOW_FADE, depth)));
  // Wave shading (whole pixels, thresholded): the small wind waves – slopes facing the sky a step lighter, slopes
  // turned away a step darker –, the rings of the interactive field as 1-px contour lines – a light line where the
  // field rises through DH_RIPPLE_CREST, a dark one where it sinks through its negative (`reach`: how much the height
  // changes to the next pixel – the contour passes this pixel when it lies within that of the level) – and the flanks
  // of its big waves (a bow wave, a splash) as solid light and dark bands.
  float facing = dot(slope - field.xy, DH_WAVE_TO_SKY);
  float fieldFacing = dot(field.xy, DH_WAVE_TO_SKY);
  float reach = max(abs(field.x), abs(field.y)) / DH_WAVE_SLOPE;
  bool crest = field.z >= DH_RIPPLE_CREST && field.z - reach < DH_RIPPLE_CREST;
  bool trough = field.z <= -DH_RIPPLE_CREST && field.z + reach > -DH_RIPPLE_CREST;
  if (facing > DH_WAVE_LIGHT || crest || fieldFacing > DH_WAVE_FLANK) c = mix(c, DH_COL_SHALLOW * light, DH_RIPPLE_LIGHT);
  else if (facing < -DH_WAVE_LIGHT || trough || fieldFacing < -DH_WAVE_FLANK) c *= DH_RIPPLE_DARK;
  // Mirror: what stands above the shoreline, else the sky; waves shift it sideways. Without the mirror (Niedrig,
  // Mittel) the plain sky tint stays (skyAt shows no stars and no moon then) – the water keeps its daylight colour.
  float tilt = length(slope);
  int dx = reflect_ ? int(clamp(floor(slope.x * DH_REFLECT_DISTORT + 0.5), -DH_REFLECT_MAX_DISTORT, DH_REFLECT_MAX_DISTORT)) : 0;
  float dy = reflect_ ? clamp(floor(slope.y * DH_REFLECT_DISTORT + 0.5), -DH_REFLECT_MAX_DISTORT, DH_REFLECT_MAX_DISTORT) : 0.0;
  // The search starts where something other than water may stand above (the field's error and the sideways shift off).
  vec4 object = !reflect_ || skyOnly ? vec4(0.0) : objectReflection(s, surface, dx, drawn - 1.0 - float(abs(dx)));
  mirrored = object.a;
  vec3 sky = skyAt(sp + vec2(float(dx), dy), tilt);
  float share = mix(uSkyShare, DH_REFLECT_SHARE, object.a) * (1.0 - DH_REFLECT_TILT_LOSS * clamp(tilt / DH_REFLECT_TILT_FULL, 0.0, 1.0));
  reflected = mix(sky, object.rgb, object.a) * share;
  return mix(c, mix(sky, object.rgb, object.a), share);
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
  bool ice = !water && frozenTile && gbufferHasMaterial(g1, DH_MAT_ICE) && abs(gbufferHeight(g1) - tile.a * DH_LEVEL_PX) < DH_ICE_LEVEL_TOLERANCE;
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
  Ambient ambient = ambientWaves(world);
  vec2 slope = ambient.slope + field.xy;

  if (!water) {
    // A wading figure's drawn pixel below its waterline: seen through the water of the nearest water pixel.
    ivec2 w = s;
    for (int k = 1; k <= DH_IMMERSE_SEARCH; k++) {
      if (waterPixel(s + ivec2(0, k))) { w = s + ivec2(0, k); break; }
      if (waterPixel(s + ivec2(k, 0))) { w = s + ivec2(k, 0); break; }
      if (waterPixel(s - ivec2(k, 0))) { w = s - ivec2(k, 0); break; }
    }
    vec3 ground = w == s ? DH_COL_DEEP * light : sceneAt(w);
    vec3 wlight = w == s ? light : lightOf(ground, texelFetch(uAlbedo, glTexel(w), 0).rgb);
    float wsurface = w == s ? surface : gbufferHeight(texelFetch(uNormal, glTexel(w), 0));
    float overMirrored;
    vec3 overReflected;
    vec3 over = waterColour(ground, wlight, DH_IMMERSE_WATER_DEPTH, sp, world, slope, field, wsurface, s, reflect_, true, true, 0.0, overMirrored, overReflected);
    ivec2 q = s + ivec2(int(clamp(floor(slope.x * DH_REFRACT_PER_SLOPE + 0.5), -1.0, 1.0)), 0);
    vec3 body = !waterPixel(q) ? sceneAt(q) : lit;
    vec3 c = throughWater(body, light, over, below, overReflected);
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
  float mirrored;
  vec3 reflected;
  vec3 c = waterColour(ground, light, depth, sp, world, slope, field, surface, s, reflect_, calm, body.a > 0.5, drawn, mirrored, reflected);
  if (body.a > 0.5) c = throughWater(body.rgb * light, light, c, below, reflected);

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
  if (foam >= FOAM_SOLID || glint) c = mix(c, DH_COL_FOAM * light, DH_FOAM_COVER);
  else if (foam >= FOAM_SHADED) c = mix(c, DH_COL_FOAM_SHADE * light, DH_FOAM_SHADE_COVER);

  // Sun glitter: streaks along the wave crests on the sun's mirror path, where the sun reaches the water and no object
  // mirrors in it; below the bloom's knee (a crisp streak, no halo).
  if (uGlitter > 0.0 && foam < FOAM_SHADED && mirrored < 0.5 && !calm) {
    float seen = sunSeen(dot(lit, LUMA) / max(dot(albedo, LUMA), DH_FLOOR_ALBEDO_LUMA), dot(uDaylight, LUMA), uSunShare);
    float glitter = sunGlitter(sp, world, ambient, seen);
    if (glitter > 0.0) c = mix(c, DH_COL_GLITTER * DH_GLITTER_LEVEL, glitter);
  }
  oColor = encodeHdr(c);
}
