#version 300 es
precision highp float;
precision highp int;
// Halved light buffer (MASTERPROMPT §6.3 "bei Frame-Einbrüchen dynamisch Lichtpuffer halbieren", M5-26): the light pass
// lit the first pixel of each uDivisor × uDivisor block; this pass writes the full-resolution light target from it.
// Edge-aware: a pixel between blocks takes the light of the neighbouring block whose lit pixel stands at the most
// similar height in the G-buffer (ties keep its own block) – a trunk keeps the light of the trunk, the ground beside it
// its own, no light bleeds across an object's silhouette. The texels are copied as they are (float or the RGBA8
// encoding of `encodeLight`), both attachments at once.
#include "gbuffer.glsl"

uniform sampler2D uHalfDiffuse;
uniform sampler2D uHalfSpecular;
uniform sampler2D uNormal;     // G1: height of each full-resolution pixel
uniform int uDivisor;

layout(location = 0) out vec4 oDiffuse;
layout(location = 1) out vec4 oSpecular;

// Heights closer than this count as equal [px]: half a step of G1's 8-bit height (DH_GBUFFER_HEIGHT_RANGE / 255).
const float SAME_HEIGHT = 0.5 * DH_GBUFFER_HEIGHT_RANGE / 255.0;

float heightAt(ivec2 p) {
  return gbufferHeight(texelFetch(uNormal, p, 0));
}

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uHalfDiffuse, 0) - 1;
  float z = heightAt(q);
  ivec2 home = q / uDivisor;
  // Offset of q inside its block: 0 is the lit pixel itself; beyond it the next block's lit pixel is as near.
  ivec2 away = ivec2(q.x > home.x * uDivisor ? 1 : 0, q.y > home.y * uDivisor ? 1 : 0);
  ivec2 best = home;
  float bestDz = abs(heightAt(clamp(home, ivec2(0), last) * uDivisor) - z);
  for (int j = 0; j <= 1; j++) {
    for (int i = 0; i <= 1; i++) {
      if (i + j == 0) continue;
      ivec2 c = clamp(home + ivec2(i * away.x, j * away.y), ivec2(0), last);
      float dz = abs(heightAt(c * uDivisor) - z);
      if (dz + SAME_HEIGHT < bestDz) {
        bestDz = dz;
        best = c;
      }
    }
  }
  best = clamp(best, ivec2(0), last);
  oDiffuse = texelFetch(uHalfDiffuse, best, 0);
  oSpecular = texelFetch(uHalfSpecular, best, 0);
}
