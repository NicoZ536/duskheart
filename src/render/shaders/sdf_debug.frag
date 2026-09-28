#version 300 es
precision highp float;
precision highp int;
// Render debugger view `sdf` (M5-01): the occluder distance field as grey with a contour every 8 px, the
// occluders themselves by class (decor ochre by height, structural red, raised terrain violet by level), roofs of the
// build grid tinted teal, openings of walls (windows, open doors) pale yellow, and the water's distance to the shore
// in blues. Frame-sized: frame pixel p shows flood texel p + margin.
#include "hdr.glsl"
#include "sdf.glsl"

uniform sampler2D uDistance;
uniform sampler2D uMask;
uniform sampler2D uWater;
uniform int uMargin;

out vec4 oColor;

const float CONTOUR_PX = 8.0;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy) + ivec2(uMargin);
  float d = sdfDistance(uDistance, t);
  vec4 occ = sdfOccluder(uMask, t);
  float w = decodeScalar(texelFetch(uWater, t, 0), DH_SDF_MAX_DISTANCE);
  float shade = 1.0 - d / DH_SDF_MAX_DISTANCE;
  vec3 c = vec3(0.08 + 0.55 * shade * shade);
  if (fract(d / CONTOUR_PX) < 0.14 && d < DH_SDF_MAX_DISTANCE - 1.0) c += 0.12;
  if (w > 0.0) {
    float k = clamp(w / 24.0, 0.0, 1.0);
    c = mix(vec3(0.55, 0.85, 1.0), vec3(0.05, 0.15, 0.45), k);
    if (fract(w / 4.0) < 0.2 && w < 24.0) c += 0.1;
  }
  if (sdfOccupied(occ) || occ.z > 0.0) {
    if (occ.y > 0.5) c = vec3(0.9, 0.18, 0.15);
    else if (occ.x > occ.z + DH_SDF_SEED_EPSILON) c = mix(vec3(0.55, 0.38, 0.12), vec3(1.0, 0.82, 0.35), clamp((occ.x - occ.z) / 64.0, 0.0, 1.0));
    else if (occ.z > 0.0) c = mix(c, mix(vec3(0.35, 0.2, 0.55), vec3(0.85, 0.6, 1.0), clamp(occ.z / 64.0, 0.0, 1.0)), 0.55);
  }
  // Roof cover of the build grid (no occluder: a light under it does not reach roofs and crowns from outside).
  if (occ.y < 0.5 && texelFetch(uMask, t, 0).g > 0.5 * DH_ROOF_MARK) c = mix(c, vec3(0.2, 0.65, 0.6), 0.35);
  // Openings of walls (windows, open doors): light passes, the light map comparison skips light through them.
  if (sdfOpening(uMask, t)) c = vec3(0.95, 0.85, 0.35);
  oColor = vec4(c, 1.0);
}
