#version 300 es
precision highp float;
precision highp int;
// Render debugger views `sun` and `wolken` (M5-02/M5-03): the light of sun or moon that reaches each pixel of the frame –
// the silhouette shadows (stained glass in its colours), the cloud shadows and the ambient occlusion in the red channel's
// shade; or the cloud shadows alone. White = full sun.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "sdf.glsl"
#include "shadow_noise.glsl"
#include "shadow.glsl"

uniform sampler2D uNormal;
uniform sampler2D uSunShadow;
uniform sampler2D uDistance;
uniform sampler2D uInfo;
uniform sampler2D uMask;
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform int uHasSun;
uniform int uHasFields;
uniform int uCloudsOnly;       // 1: the cloud shadows alone (view `wolken`)

out vec4 oColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 g1 = texelFetch(uNormal, p, 0);
  float z = gbufferHeight(g1);
  vec2 screen = uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec2 ground = uHasFields == 1 ? sdfGroundPoint(uMask, screen, z) : vec2(screen.x, screen.y + z);
  if (uCloudsOnly == 1) {
    oColor = vec4(vec3(uHasSun == 1 ? cloudShade(ground) : 1.0), 1.0);
    return;
  }
  vec3 sun = uHasSun == 1 ? sunVisibility(uSunShadow, ground, z, sunTolerance(g1)) * cloudShade(ground) : vec3(1.0);
  float ao = uHasFields == 1 ? sdfOcclusion(uDistance, uInfo, uMask, ground, z) : 1.0;
  oColor = vec4(sun * mix(0.35, 1.0, ao), 1.0);
}
