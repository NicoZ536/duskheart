#version 300 es
precision highp float;
precision highp int;
// Point and spot lights as screen quads (MASTERPROMPT §6.1 pass 5): one instance per light (layout:
// src/render/light/lightBatch.ts). The quad covers every pixel whose reconstructed world position
// can lie within the radius – a pixel z px above the ground shows z px higher on screen, so the
// quad reaches up by the light's height + radius (at most the G-buffer's height range). A light stands on
// the ground under its footprint (a raised level adds 16 px per level, read from the occluder mask); the world is
// drawn without shifting raised levels up, so only heights above the ground show as screen-up.
#include "hdr.glsl"
#include "sdf.glsl"

layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec4 aGeom;     // footprint x, y (world px), height above its ground, radius
layout(location = 2) in vec3 aColor;    // colour × intensity × flicker
layout(location = 3) in vec4 aCone;     // cone axis x, y (unit, y south), cos outer, cos inner

uniform vec2 uOrigin;       // world px of target pixel (0, 0), top-left, whole pixels
uniform vec2 uTargetSize;   // target size in px
uniform sampler2D uMask;    // occluder mask (terrain top under the light)
uniform int uHasMask;       // 1 when the occluder pass ran this frame

flat out vec4 vGeom;
flat out vec3 vColor;
flat out vec4 vCone;
flat out float vBase;       // ground under the light [px above level 0]
flat out float vHousing;    // top of the decor footprint the light burns in [px], −1: it stands free (M5-35, housingTop)
flat out float vRoofed;     // 1 when a roof of the build grid covers the light

// Top of the decor footprint a light burns in [px], −1 when it stands free: the footprint under its ground point `at`,
// else the nearest within DH_HOUSING_EDGE px that rises above the flame at height `flame` (a hearth's fire at the back
// edge of its ring's ellipse). Its rays pass that footprint (lightShadow).
float housingTop(vec2 at, float flame) {
  vec4 m = sdfOccluder(uMask, sdfTexel(at));
  if (m.x > m.z + DH_SDF_SEED_EPSILON) return m.x;
  float top = -1.0;
  int nearest = DH_HOUSING_EDGE * DH_HOUSING_EDGE * 2 + 1;
  for (int j = -DH_HOUSING_EDGE; j <= DH_HOUSING_EDGE; j++) {
    for (int i = -DH_HOUSING_EDGE; i <= DH_HOUSING_EDGE; i++) {
      vec4 n = sdfOccluder(uMask, sdfTexel(at + vec2(float(i), float(j))));
      int d = i * i + j * j;
      if (d < nearest && n.x > n.z + DH_SDF_SEED_EPSILON && n.x > flame) {
        nearest = d;
        top = n.x;
      }
    }
  }
  return top;
}

void main() {
  float radius = aGeom.w;
  vec4 at = uHasMask == 1 ? sdfOccluder(uMask, sdfTexel(aGeom.xy)) : vec4(0.0);
  float base = at.w;
  float lift = min(aGeom.z + radius, DH_GBUFFER_HEIGHT_RANGE);
  vec2 lo = vec2(aGeom.x - radius, aGeom.y - radius - lift);
  vec2 hi = aGeom.xy + radius;
  vec2 target = mix(lo, hi, aCorner) - uOrigin;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vGeom = aGeom;
  vColor = aColor;
  vCone = aCone;
  vBase = base;
  vHousing = uHasMask == 1 ? housingTop(aGeom.xy, base + aGeom.z) : -1.0;
  vRoofed = uHasMask == 1 && sdfRoofed(uMask, aGeom.xy) ? 1.0 : 0.0;
}
