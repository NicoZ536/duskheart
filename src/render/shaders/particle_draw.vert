#version 300 es
precision highp float;
precision highp int;
// GPU particles, drawn (M5-11, M5-12): one instanced quad per particle record, covering exactly the whole pixels of
// its shape (src/render/particles/layout.ts). Look from the kind table: colour stepped over the life (palette), size
// and opacity over the life, emissive glow with flicker – or the light of the scene at the particle's footprint:
// ambient plus the light pass's point light there – added softly over the ambient like in the composition (M5-41: at
// sunlit noon a flake beside the hearth gains nothing, at night nearly all of it, in a cave all) –, reflected with the
// spectral colour like every surface (spectral.glsl), plus a lightning flash. Weather particles are drawn around the
// camera with the parallax of their layer; dead, idle and (in caves) weather particles produce no quad.
#include "hdr.glsl"
#include "spectral.glsl"
#include "composite_daylight.glsl"
#include "particle_common.glsl"

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPos;
layout(location = 2) in vec4 aVel;
layout(location = 3) in vec4 aMeta;

uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left, whole pixels
uniform vec2 uTargetSize;
uniform vec2 uCamera;          // view centre [world px]
uniform vec4 uWeatherBox;      // half width, top, bottom [px, layer space]
uniform vec4 uWeatherLayers[DH_PARTICLE_WEATHER_LAYERS];  // parallax, cumulative share, size, opacity
uniform int uWeatherSky;       // 0: no sky above the camera – weather particles hidden
uniform float uTime;
uniform float uFlicker;        // scale of the kinds' flicker (flash reduction lowers it)
uniform sampler2D uPalette;    // palette LUT, row 0
uniform sampler2D uLight;      // light pass: point light (HDR-encoded)
uniform int uLit;              // 1: the light pass ran; 0: unlit (colours as painted)
uniform vec3 uAmbient;
uniform float uDayLevel;       // the scene's daylight: the ambient's brightest channel, 0 … 1 (the point light's soft add)
uniform vec3 uFlash;           // light of a lightning flash

flat out ivec2 vAnchor;        // target pixel of the particle (top-left origin)
flat out int vShape;
flat out vec4 vGeom;           // shape size [px], line: tail offset x, y [px], splash frame
flat out vec4 vColor;          // HDR colour, opacity

const vec4 HIDDEN = vec4(2.0, 2.0, 2.0, 1.0);

void main() {
  int kind = int(aMeta.x + 0.5);
  bool weather = aMeta.w > 0.5;
  float ageFrac;
  float sizeScale = 1.0;
  float alphaScale = 1.0;
  vec2 ground;
  if (weather) {
    float cycle = floor(aMeta.z / DH_WEATHER_STATE_SLOTS);
    int state = int(aMeta.z - cycle * DH_WEATHER_STATE_SLOTS + 0.5);
    if (uWeatherSky == 0 || state == DH_WEATHER_IDLE) { gl_Position = HIDDEN; return; }
    vec4 layer = uWeatherLayers[clamp(int(aMeta.w + 0.5) - 1, 0, DH_PARTICLE_WEATHER_LAYERS - 1)];
    sizeScale = layer.z;
    alphaScale = layer.w;
    ageFrac = state == DH_WEATHER_LANDED ? clamp(aPos.w / max(aVel.w, 1e-3), 0.0, 1.0) : 0.0;
    ground = uCamera + wrapWeather(aPos.xy - uCamera * layer.x, uWeatherBox.xyz);
  } else {
    if (aPos.w >= aVel.w || aPos.w < 0.0) { gl_Position = HIDDEN; return; }
    ageFrac = clamp(aPos.w / max(aVel.w, 1e-3), 0.0, 1.0);
    ground = aPos.xy;
  }
  vec4 r0 = kindRow(kind, 0);
  vec4 r1 = kindRow(kind, 1);
  vec4 r2 = kindRow(kind, 2);
  vec4 r3 = kindRow(kind, 3);
  int shape = int(r0.x + 0.5);
  float seed = aMeta.y;
  float size = mix(r0.y, r0.z, seed) * mix(1.0, r0.w, ageFrac) * sizeScale;
  vec2 screen = vec2(ground.x, ground.y - aPos.z) - uOrigin;
  ivec2 anchor = ivec2(floor(screen + 0.5));
  // Quad in target pixels (pixel edges) around the anchor, by shape.
  vec2 lo = vec2(anchor);
  vec2 hi = lo + 1.0;
  vec4 geom = vec4(size, 0.0, 0.0, 0.0);
  if (shape == DH_SHAPE_PUNKT) {
    float n = max(1.0, floor(size + 0.5));
    lo -= floor((n - 1.0) * 0.5);
    hi = lo + n;
    geom.x = n;
  } else if (shape == DH_SHAPE_FLOCKE) {
    float n = max(1.0, floor(size + 0.5));
    geom.x = n;
    if (n >= 3.0) { lo -= 1.0; hi += 1.0; } else if (n >= 2.0) { hi += 1.0; }
  } else if (shape == DH_SHAPE_SCHEIBE) {
    float r = ceil(max(1.0, size) * 0.5);
    lo -= r;
    hi += r;
  } else if (shape == DH_SHAPE_SCHWADE) {
    // Wisp: an ellipse `size` px thick, stretched along the screen velocity like a line.
    vec2 sv = vec2(aVel.x, aVel.y - aVel.z);
    float speed = length(sv);
    vec2 dir = speed > 0.0 ? sv / speed : vec2(1.0, 0.0);
    float len = clamp(speed * r1.x, r1.y, r1.z) * sizeScale;
    vec2 reach = ceil(abs(dir) * len * 0.5 + abs(dir.yx) * size * 0.5);
    lo -= reach;
    hi += reach;
    geom = vec4(size, len, dir);
  } else if (shape == DH_SHAPE_SPRITZER) {
    lo += vec2(-2.0, -2.0);
    hi += vec2(2.0, 0.0);
    geom.w = floor(clamp(ageFrac, 0.0, 0.999) * 3.0);
  } else {
    // Line: head at the anchor, tail against the screen velocity (height counts upwards: screen y − z).
    vec2 sv = vec2(aVel.x, aVel.y - aVel.z);
    float speed = length(sv);
    float len = clamp(speed * r1.x, r1.y, r1.z) * sizeScale;
    vec2 tail = speed > 0.0 ? floor(-sv / speed * (max(1.0, len) - 1.0) + 0.5) : vec2(0.0);
    geom.yz = tail;
    lo = vec2(anchor) + min(vec2(0.0), tail);
    hi = vec2(anchor) + max(vec2(0.0), tail) + 1.0;
  }
  // Colour over the life (stepped), opacity over the life.
  int count = int(r3.x + 0.5);
  int ci = min(count - 1, int(ageFrac * float(count)));
  float index = ci == 0 ? r2.x : ci == 1 ? r2.y : ci == 2 ? r2.z : r2.w;
  vec3 albedo = texelFetch(uPalette, ivec2(int(index + 0.5) - 1, 0), 0).rgb;
  float alpha = mix(r3.y, r3.z, ageFrac) * alphaScale;
  vec3 color;
  float glow = r1.w;
  float flicker = 1.0 - r3.w * uFlicker * (0.5 + 0.5 * sin(uTime * (17.0 + 11.0 * seed) + seed * 37.0));
  if (glow > 0.0) {
    color = albedo * glow * flicker;
  } else if (uLit == 1) {
    ivec2 foot = clamp(ivec2(anchor.x, int(uTargetSize.y) - 1 - (anchor.y + int(floor(aPos.z + 0.5)))), ivec2(0), ivec2(uTargetSize) - 1);
    vec3 point = decodeHdr(texelFetch(uLight, foot, 0)) * pointOverDaylight(uAmbient, uDayLevel);
    color = reflectLight(albedo, uAmbient) + reflectLight(albedo, warmLight(point)) + albedo * uFlash;
  } else {
    color = albedo;
  }
  vAnchor = anchor;
  vShape = shape;
  vGeom = geom;
  vColor = vec4(color, alpha);
  vec2 corner = mix(lo, hi, aCorner);
  vec2 clip = corner / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
