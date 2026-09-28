#version 300 es
precision highp float;
precision highp int;
// Fog density of the frame (atmosphere pass, M5-10): one value per internal pixel, 0 where nothing is
// drawn. The render debugger shows it as `fog`.
#include "gbuffer.glsl"
#include "atmosphere.glsl"
#include "fog.glsl"

uniform sampler2D uAlbedo;   // G0: coverage
uniform sampler2D uNormal;   // G1: height above the ground
uniform sampler2D uSurface;  // G2: emission (glowing pixels shine through)
uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform float uTime;
uniform vec4 uFog;           // density, thickness [px], wind, floor [px above level 0]

out vec4 oFog;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(uAlbedo, p, 0).a < 0.5) {
    oFog = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize);
  float h = gbufferHeight(texelFetch(uNormal, p, 0));
  vec2 ground = world + vec2(0.0, h);
  float a = fogAmount(uFog.x, fogPattern(uNoise, ground, uTime, uFog.z)) * fogHeightFade(h, uFog.y, uFog.w);
  if (gbufferEmissive(texelFetch(uSurface, p, 0)) > 0.0) a *= DH_FOG_EMISSIVE;
  oFog = vec4(a, 0.0, 0.0, 1.0);
}
