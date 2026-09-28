#version 300 es
precision highp float;
precision highp int;
// Particle light (M5-11, §6.2 "emissive Partikel werfen in Ultra Licht", setting `particleLights`): every glowing
// particle lights the surfaces around the ground point below it – one instanced quad per record, `uRadius` px around
// its footprint; dead, idle and unlit particles produce no quad. Colour and flicker as the particle itself glows.
#include "particle_common.glsl"

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPos;
layout(location = 2) in vec4 aVel;
layout(location = 3) in vec4 aMeta;

uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform vec2 uCamera;
uniform vec4 uWeatherBox;
uniform vec4 uWeatherLayers[DH_PARTICLE_WEATHER_LAYERS];
uniform int uWeatherSky;
uniform float uTime;
uniform float uFlicker;
uniform sampler2D uPalette;
uniform float uRadius;         // reach of one particle's light [px]
uniform float uIntensity;      // light of one particle at its footprint [light level per unit of glow]

flat out vec3 vLight;          // light colour × strength
flat out vec3 vSource;         // footprint (target px, top-left origin) and height of the particle [px]

const vec4 HIDDEN = vec4(2.0, 2.0, 2.0, 1.0);

void main() {
  int kind = int(aMeta.x + 0.5);
  vec4 r1 = kindRow(kind, 1);
  if (r1.w <= 0.0) { gl_Position = HIDDEN; return; }
  float ageFrac;
  vec2 ground;
  if (aMeta.w > 0.5) {
    float cycle = floor(aMeta.z / DH_WEATHER_STATE_SLOTS);
    int state = int(aMeta.z - cycle * DH_WEATHER_STATE_SLOTS + 0.5);
    if (uWeatherSky == 0 || state == DH_WEATHER_IDLE) { gl_Position = HIDDEN; return; }
    vec4 layer = uWeatherLayers[clamp(int(aMeta.w + 0.5) - 1, 0, DH_PARTICLE_WEATHER_LAYERS - 1)];
    ageFrac = state == DH_WEATHER_LANDED ? clamp(aPos.w / max(aVel.w, 1e-3), 0.0, 1.0) : 0.0;
    ground = uCamera + wrapWeather(aPos.xy - uCamera * layer.x, uWeatherBox.xyz);
  } else {
    if (aPos.w >= aVel.w || aPos.w < 0.0) { gl_Position = HIDDEN; return; }
    ageFrac = clamp(aPos.w / max(aVel.w, 1e-3), 0.0, 1.0);
    ground = aPos.xy;
  }
  vec4 r2 = kindRow(kind, 2);
  vec4 r3 = kindRow(kind, 3);
  int count = int(r3.x + 0.5);
  int ci = min(count - 1, int(ageFrac * float(count)));
  float index = ci == 0 ? r2.x : ci == 1 ? r2.y : ci == 2 ? r2.z : r2.w;
  vec3 color = texelFetch(uPalette, ivec2(int(index + 0.5) - 1, 0), 0).rgb;
  float seed = aMeta.y;
  float flicker = 1.0 - r3.w * uFlicker * (0.5 + 0.5 * sin(uTime * (17.0 + 11.0 * seed) + seed * 37.0));
  float alpha = mix(r3.y, r3.z, ageFrac);
  vLight = color * r1.w * flicker * alpha * uIntensity;
  vec2 foot = floor(ground - uOrigin + 0.5);
  vSource = vec3(foot, max(0.0, aPos.z));
  vec2 corner = foot + (aCorner * 2.0 - 1.0) * uRadius;
  vec2 clip = corner / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
