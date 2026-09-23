#version 300 es
precision highp float;
precision highp int;
// Point/spot light contribution per internal pixel (MASTERPROMPT §6.1 pass 5): soft falloff over
// the distance between the light and the pixel's reconstructed world position, soft cone edge,
// normal mapping with the light height, glints on glossy pixels. Additive into the light target
// (G-buffer reading via gbuffer.glsl, HDR writing via hdr.glsl encodeHdr).
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "lighting.glsl"

flat in vec4 vGeom;
flat in vec3 vColor;
flat in vec4 vCone;

uniform sampler2D uNormal;     // G1: normal, height, material
uniform sampler2D uSurface;    // G2: emission, gloss, wetness, masks
uniform vec2 uOrigin;
uniform vec2 uTargetSize;

layout(location = 0) out vec4 oDiffuse;
layout(location = 1) out vec4 oSpecular;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 g1 = texelFetch(uNormal, p, 0);
  float z = gbufferHeight(g1);
  // Pixel centre in world px (target row 0 is the top row); a pixel z px above the ground stands on
  // the ground point z px further south (3/4 view: height shows as screen-up).
  vec2 screen = uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec3 toLight = vec3(vGeom.x - screen.x, vGeom.y - (screen.y + z), vGeom.z - z);
  float f = lightFalloff(length(toLight), vGeom.w);
  vec2 away = -toLight.xy;
  float len = length(away);
  float cosAngle = len < DH_LIGHT_CONE_EPSILON ? 1.0 : dot(away / len, vCone.xy);
  f *= lightCone(cosAngle, vCone.z, vCone.w);
  if (f <= 0.0) discard;
  // Direction to the light in screen space (+y up): the light shows at (x, y − height) on screen.
  vec3 l = normalize(vec3(toLight.x, toLight.z - toLight.y, max(toLight.z, DH_LIGHT_MIN_NORMAL_HEIGHT)));
  vec3 n = gbufferNormal(g1);
  vec3 c = vColor * f;
  oDiffuse = encodeHdr(c * lightShade(n, l));
  oSpecular = encodeHdr(c * lightSpecular(n, l, texelFetch(uSurface, p, 0).g));
}
