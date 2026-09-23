#version 300 es
precision highp float;
// Point and spot lights as screen quads (MASTERPROMPT §6.1 pass 5): one instance per light (layout:
// src/render/light/lightBatch.ts). The quad covers every pixel whose reconstructed world position
// can lie within the radius – a pixel z px above the ground shows z px higher on screen, so the
// quad reaches up by height + radius (at most the G-buffer's height range).
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec4 aGeom;     // footprint x, y (world px), height, radius
layout(location = 2) in vec3 aColor;    // colour × intensity × flicker
layout(location = 3) in vec4 aCone;     // cone axis x, y (unit, y south), cos outer, cos inner

uniform vec2 uOrigin;       // world px of target pixel (0, 0), top-left, whole pixels
uniform vec2 uTargetSize;   // target size in px

flat out vec4 vGeom;
flat out vec3 vColor;
flat out vec4 vCone;

void main() {
  float radius = aGeom.w;
  float lift = min(aGeom.z + radius, DH_GBUFFER_HEIGHT_RANGE);
  vec2 lo = vec2(aGeom.x - radius, aGeom.y - radius - lift);
  vec2 hi = aGeom.xy + radius;
  vec2 target = mix(lo, hi, aCorner) - uOrigin;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vGeom = aGeom;
  vColor = aColor;
  vCone = aCone;
}
