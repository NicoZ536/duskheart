#version 300 es
precision highp float;
precision highp int;
// Composition (MASTERPROMPT §6.1 pass 6): albedo × light + emission + glints into the HDR target.
// Light = daylight (sky light × ambient occlusion – less under a roof – + the sun's or moon's directed light with normal mapping,
// silhouette shadows and cloud shadows; M5-02 … M5-04; with dither on, ambient occlusion, penumbra and cloud edges in
// dithered steps) + the light pass's point/spot light added softly over it – by day a pixel the daylight lights fully
// gains nothing more, a shadow or a room in the measure of its darkness; at dusk and night nearly all of it –, the latter optionally
// in bands with a 4×4 Bayer dither anchored to the world (the pattern does not swim when the camera scrolls). Each
// light group is reflected with its spectral colour (spectral.glsl, ADR-0018): the warm torch light turns lit grass
// golden, the cool ambient keeps the darkness blue; a warm point light shifts from orange towards warm yellow as its
// (banded) level rises. Sky and sun add up to the ambient on a flat, sunlit pixel – the palette colours exactly as
// painted by day. Sunlight through a stained-glass pane is reflected in the pane's own hue (M5-68, `reflectGlassLight`):
// on warm boards the blue pane's patch stays blue instead of turning teal. Emission tops the reflected light up to the
// pixel's own glow – a flame under its own torch light is not lit twice.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "bayer.glsl"
#include "composite.glsl"
#include "composite_daylight.glsl"
#include "spectral.glsl"
#include "sdf.glsl"
#include "sdf_ring.glsl"
#include "shadow_noise.glsl"
#include "shadow.glsl"

uniform sampler2D uAlbedo;     // G0
uniform sampler2D uSurface;    // G2: emission
uniform sampler2D uNormal;     // G1: normal, height
uniform sampler2D uDiffuse;    // light pass: point/spot light
uniform sampler2D uSpecular;   // light pass: glints
uniform sampler2D uSunShadow;  // shadow pass: silhouettes
uniform sampler2D uDistance;   // occluder pass: distance field
uniform sampler2D uInfo;       // occluder pass: nearest occluder
uniform sampler2D uMask;       // occluder pass: mask
uniform vec3 uBackground;      // colour where nothing was drawn
uniform vec3 uSkyLight;        // ambient light that comes from the sky (daytime, biome, weather, cave)
uniform vec3 uDirLight;        // ambient light that comes from the sun or moon (sky + directed = the ambient)
uniform float uDayLevel;       // the scene's daylight: the ambient's brightest channel, 0 … 1 (the point light's soft add)
uniform vec3 uDirDir;          // unit direction towards the sun or moon (screen space of the normals)
uniform float uDirRelief;      // relief strength of its normal mapping
uniform int uHasDir;           // 1 = a directed light shines
uniform int uHasSun;           // 1 = the shadow pass drew this frame's silhouettes
uniform int uHasFields;        // 1 = the occluder pass drew this frame's distance field (ambient occlusion)
uniform int uLit;              // 1 = the light pass ran this frame; 0 = unlit (albedo as it is)
uniform float uBands;          // light levels per unit, 0 = no banding
uniform int uDither;           // 1 = Bayer dither between bands, 0 = rounding
uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;

out vec4 oColor;

// Light of a stained-glass pane (M5-68): reflected with the spectral share DH_GLASS_SPECTRAL instead of the daylight's
// (1: the light's colour × the surface's reflectance under it – the pane's own hue, no trace of the boards' brown in
// what it adds; the sky light on the same pixel keeps it). Black without light. Mirrors `reflectGlassLight` in
// src/render/light/glass.ts.
vec3 reflectGlassLight(vec3 albedo, vec3 light) {
  if (!(light.r + light.g + light.b > 0.0)) return vec3(0.0);
  return mix(albedo * light, light * lightReflectance(albedo, light), DH_GLASS_SPECTRAL);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAlbedo, p, 0);
  vec3 albedo = a.a > 0.5 ? a.rgb : uBackground;
  // G2 stores emission / DH_EMISSIVE_RANGE in 8 bits; snapping to 1/DH_EMISSION_STEPS recovers the
  // authored levels (1.0 would come back as 1.0039 and lift a plain flame one step off its palette colour).
  float emission = floor(gbufferEmissive(texelFetch(uSurface, p, 0)) * DH_EMISSION_STEPS + 0.5) / DH_EMISSION_STEPS;
  vec3 lit = albedo;
  vec3 glint = vec3(0.0);
  if (uLit == 1) {
    vec2 screen = uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
    bool dither = uDither == 1;
    float threshold = dither ? bandThreshold(bayer4(floor(screen))) : 0.5;
    vec4 g1 = texelFetch(uNormal, p, 0);
    float z = gbufferHeight(g1);
    // Beyond the flood frame (the tall pixels at the bottom of the view) the occluder ring knows the ground's level.
    vec2 ground = uHasFields == 1 ? groundPointAt(uMask, screen, z) : vec2(screen.x, screen.y + z);
    float ao = uHasFields == 1 ? sdfOcclusion(uDistance, uInfo, uMask, ground, z) : 1.0;
    // Daylight factors at pixel size: ambient occlusion, penumbra and cloud edges in dithered steps (smooth without dither).
    if (dither) ao = daylightStep(ao, threshold);
    // Under a roof the sky reaches the floor and what stands on it only in part; roofs and crowns lie on top of it.
    float here = uHasFields == 1 ? occluderAt(uMask, ground).w : 0.0;
    bool top = gbufferHasMaterial(g1, DH_MAT_CANOPY) && z > here + DH_SUN_HEIGHT_EPSILON;
    float roof = uHasFields == 1 && !top && roofedAt(uMask, ground) ? DH_ROOF_SKY : 1.0;
    vec3 day = uSkyLight * ao * roof;
    // The part of the daylight that came through a stained-glass pane (coloured sun visibility, `glassTint`).
    vec3 glassLight = vec3(0.0);
    if (uHasDir == 1) {
      float shade = max(0.0, 1.0 + uDirRelief * (dot(gbufferNormal(g1), uDirDir) - uDirDir.z));
      vec3 sun = uHasSun == 1 ? sunVisibility(uSunShadow, ground, z, sunTolerance(g1)) : vec3(1.0);
      float cloud = cloudShade(ground);
      if (dither) {
        sun = lightBands(sun, DH_DAY_STEPS, threshold);
        cloud = daylightStep(cloud, threshold);
      }
      vec3 direct = uDirLight * shade * sun * cloud;
      day += direct;
      if (glassTint(min(min(sun.r, sun.g), sun.b), max(max(sun.r, sun.g), sun.b)) > 0.5) glassLight = direct;
    }
    // The point light adds softly over the daylight (no doubled light by day); then its bands.
    float over = pointOverDaylight(day, uDayLevel);
    vec3 dynamic = decodeHdr(texelFetch(uDiffuse, p, 0)) * over;
    glint = decodeHdr(texelFetch(uSpecular, p, 0)) * over;
    if (uBands > 0.0) {
      dynamic = lightBands(dynamic, uBands, threshold);
      glint = lightBands(glint, uBands, threshold);
    }
    lit = reflectLight(albedo, day - glassLight) + reflectGlassLight(albedo, glassLight) + reflectLight(albedo, warmLight(dynamic));
  }
  oColor = encodeHdr(max(lit, albedo * emission) + glint);
}
