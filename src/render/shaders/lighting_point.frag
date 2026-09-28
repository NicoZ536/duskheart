#version 300 es
precision highp float;
precision highp int;
// Point/spot light contribution per internal pixel (MASTERPROMPT §6.1 pass 5): soft falloff over
// the distance between the light and the pixel's reconstructed world position, soft cone edge,
// normal mapping with the light height, glints on glossy pixels, and shadows traced through the
// occluder distance field (M5-05: hard or soft by quality level). Additive into the light target
// (G-buffer reading via gbuffer.glsl, HDR writing via encodeLight).
//
// Alpha channels (the light map comparison, M5-28): diffuse.a = light the decor occluders took away
// (gameplay ignores their shadows, §12.1), specular.a = how uncertain the comparison is – a partial shadow of walls and
// cliffs (penumbra), a ground point within a tile of them or lit through an opening of a wall, where the gameplay map
// resolves occlusion per tile. A pixel the walls hide completely still writes that mark (and no light). Both are kept
// only in the frames the debugger compares (`uCompare`); otherwise the march ends at the first decor and specular.a
// stays 0.
//
// A light burning inside a body (a kiln, a furnace, a lamp's case: `lightHousing`) lights that body only through its
// openings; what stands right under a flame is lit from above only (`flameNearField`).
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "sdf.glsl"
#include "lighting.glsl"

flat in vec4 vGeom;
flat in vec3 vColor;
flat in vec4 vCone;
flat in float vBase;
flat in float vHousing;
flat in float vRoofed;

uniform sampler2D uNormal;     // G1: normal, height, material
uniform sampler2D uSurface;    // G2: emission, gloss, wetness, masks
uniform sampler2D uDistance;   // occluder distance field
uniform sampler2D uInfo;       // nearest occluder
uniform sampler2D uMask;       // occluder mask
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform int uShadows;          // 0 walls and cliffs only, 1 hard, 2 soft (quality level §6.3)
uniform int uHasMask;          // 1 when the occluder pass ran this frame
uniform int uCompare;          // 1 in the frames the light map debugger compares (its bookkeeping in the alphas, M5-28)
uniform int uDivisor;          // 1; 2 while the light buffer is halved (§6.3, M5-26): a fragment lights the first pixel of its 2×2 block

layout(location = 0) out vec4 oDiffuse;
layout(location = 1) out vec4 oSpecular;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uDivisor;
  vec4 g1 = texelFetch(uNormal, p, 0);
  float z = gbufferHeight(g1);
  // Pixel centre in world px (target row 0 is the top row); a pixel standing h px above its ground stands on
  // the ground point h px further south (3/4 view: height shows as screen-up; raised levels are not shifted).
  vec2 screen = uOrigin + vec2(float(p.x) + 0.5, uTargetSize.y - float(p.y) - 0.5);
  vec2 ground = uHasMask == 1 ? sdfGroundPoint(uMask, screen, z) : vec2(screen.x, screen.y + z);
  float zl = vBase + vGeom.z;
  vec3 toLight = vec3(vGeom.x - ground.x, vGeom.y - ground.y, zl - z);
  float f = lightFalloff(length(toLight), vGeom.w);
  vec2 away = -toLight.xy;
  float len = length(away);
  float cosAngle = len < DH_LIGHT_CONE_EPSILON ? 1.0 : dot(away / len, vCone.xy);
  f *= lightCone(cosAngle, vCone.z, vCone.w);
  if (f <= 0.0) discard;
  vec2 vis = vec2(1.0);
  vec4 here = uHasMask == 1 ? sdfOccluder(uMask, sdfTexel(ground)) : vec4(0.0);
  bool upright = z > here.w + DH_PS_HEIGHT_EPSILON;
  bool own = gbufferHasMaterial(g1, DH_MAT_OCCLUDER);
  float unsure = 0.0;
  // Roofs and crowns (material canopy, above their ground) lie above the walls: a light under a roof does not reach
  // their outside, a light in the open reaches them without the ground's shadows.
  bool top = upright && gbufferHasMaterial(g1, DH_MAT_CANOPY);
  if (top && vRoofed > 0.5) discard;
  if (uHasMask == 1 && !top) {
    // Walls, closed doors and cliffs block at every quality level (the gameplay light map's rule); trunks, rocks and
    // furniture cast shadows from "Mittel" up, soft from "Hoch" (§6.3).
    vis = lightShadow(uDistance, uInfo, uMask, ground, z, own, here.y > 0.5, vGeom.xy, zl, vBase, vHousing, uShadows == 2, uShadows > 0, uCompare == 1);
    if (uCompare == 1) {
      unsure = 4.0 * vis.y * (1.0 - vis.y) + (nearStructural(uDistance, uInfo, uMask, ground, vBase) ? 1.0 : 0.0);
      if (vis.y > 0.0 && throughOpening(uMask, ground, vGeom.xy)) unsure += 1.0;
    }
  }
  // The body a light burns in is lit through its openings only; what stands under an open flame from above only.
  bool capped = z - here.w >= DH_ATLAS_HEIGHT_RANGE - 0.5;
  if (own && upright && vHousing >= 0.0 && lightHousing(uMask, screen, ground, capped, vGeom.xy)) f *= DH_HOUSING_FLOOR;
  else f *= flameNearField(len, upright, zl - z);
  // Direction to the light in screen space (+y up): the light shows at (x, y − height) on screen.
  vec3 l = normalize(vec3(toLight.x, toLight.z - toLight.y, max(toLight.z, DH_LIGHT_MIN_NORMAL_HEIGHT)));
  vec3 n = gbufferNormal(g1);
  vec3 c = vColor * f;
  float peak = max(max(vColor.r, vColor.g), vColor.b) * f;
  oDiffuse = encodeLight(c * lightShade(n, l) * vis.x, peak * (vis.y - vis.x));
  oSpecular = encodeLight(c * lightSpecular(n, l, texelFetch(uSurface, p, 0).g) * vis.x, peak * unsure);
}
