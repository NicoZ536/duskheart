#version 300 es
precision highp float;
precision highp int;
// Composition (MASTERPROMPT §6.1 pass 6): albedo × light + emission + glints into the HDR target.
// Light = ambient + the light pass's point/spot light, the latter optionally in bands with a 4×4
// Bayer dither anchored to the world (the pattern does not swim when the camera scrolls). Emission
// tops the light up to the pixel's own glow – a flame under its own torch light is not lit twice.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "bayer.glsl"
#include "composite.glsl"

uniform sampler2D uAlbedo;     // G0
uniform sampler2D uSurface;    // G2: emission
uniform sampler2D uDiffuse;    // light pass: point/spot light
uniform sampler2D uSpecular;   // light pass: glints
uniform vec3 uBackground;      // colour where nothing was drawn
uniform vec3 uAmbient;         // ambient light (daytime, biome, weather, cave)
uniform int uLit;              // 1 = the light pass ran this frame; 0 = unlit (light 1)
uniform float uBands;          // light levels per unit, 0 = no banding
uniform int uDither;           // 1 = Bayer dither between bands, 0 = rounding
uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;

out vec4 oColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAlbedo, p, 0);
  vec3 albedo = a.a > 0.5 ? a.rgb : uBackground;
  // G2 stores emission / DH_EMISSIVE_RANGE in 8 bits; snapping to 1/DH_EMISSION_STEPS recovers the
  // authored levels (1.0 would come back as 1.0039 and lift a plain flame one step off its palette colour).
  float emission = floor(gbufferEmissive(texelFetch(uSurface, p, 0)) * DH_EMISSION_STEPS + 0.5) / DH_EMISSION_STEPS;
  vec3 light = vec3(1.0);
  vec3 glint = vec3(0.0);
  if (uLit == 1) {
    vec3 dynamic = decodeHdr(texelFetch(uDiffuse, p, 0));
    glint = decodeHdr(texelFetch(uSpecular, p, 0));
    if (uBands > 0.0) {
      vec2 world = floor(uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y));
      float threshold = uDither == 1 ? bandThreshold(bayer4(world)) : 0.5;
      dynamic = lightBands(dynamic, uBands, threshold);
      glint = lightBands(glint, uBands, threshold);
    }
    light = uAmbient + dynamic;
  }
  oColor = encodeHdr(albedo * max(light, vec3(emission)) + glint);
}
