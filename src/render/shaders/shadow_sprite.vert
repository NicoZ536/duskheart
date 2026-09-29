#version 300 es
precision highp float;
precision highp int;
// Sun/moon silhouettes (M5-02, §6.1 pass 4): every sprite of the objects and canopy layers stands as a billboard on
// its anchor line; each of its pixels is projected along the shadow vector by its height above the ground plane
// (the anchor's height base + its height above the anchor) – the silhouette sheared and stretched by the sun's
// position. Instance layout: src/render/batch/spriteLayout.ts (the sprite batcher's buffer).
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aPos;
layout(location = 2) in vec4 aParams;   // height base px, wind amplitude px, wind phase, rotation
layout(location = 3) in uvec4 aRect;
layout(location = 4) in ivec2 aAnchor;
layout(location = 6) in uvec4 aMisc;    // palette row, flags, emissive boost, dither fade

uniform vec4 uShadowFrame; // world px of the shadow target's top-left corner, its size (light/shadowFrame.ts)
uniform vec3 uShadow;      // shadow direction x, y (unit, +y south), length per unit height
uniform vec4 uWind;        // the sprites' wind (sprite_gbuffer.vert, `bindSpriteSurface`): vector, time [s], gusts

#include "sway.glsl"

const uint FLAG_MIRROR = 1u;
const uint FLAG_WIND = 8u;

out vec2 vLocal;
flat out uvec4 vRect;
flat out float vBase;
flat out float vAnchorY;
flat out vec2 vSway;       // as sprite_gbuffer.vert: sway of the top row along the frame's x [px] (mirrored: negated;
                           // 0: none), sway share² of the bottom row

void main() {
  vec2 local = aCorner * vec2(aRect.zw);
  vec2 anchor = vec2(aAnchor);
  vec2 anchorWorld = floor(aPos + 0.5);
  // A swaying crown's silhouette sways with it (M5 review Minor 14): the same sway on the ground plane, per row.
  vec2 sway = vec2(0.0);
  vSway = vec2(0.0);
  if ((aMisc.y & FLAG_WIND) != 0u) {
    sway = windSway(uWind, anchorWorld, aParams.y, aParams.z);
    if (aParams.w == 0.0 && abs(sway.x) > 0.0 && anchor.y >= 1.0) {
      float bottomUp = swayUp(float(aRect.w), anchor.y);
      vSway = vec2((aMisc.y & FLAG_MIRROR) != 0u ? -sway.x : sway.x, bottomUp * bottomUp);
      local.x += (aCorner.x * 2.0 - 1.0) * swayPad(sway.x);
    }
  }
  vec2 rel = local - anchor;
  if ((aMisc.y & FLAG_MIRROR) != 0u) rel.x = -rel.x;
  float up = swayUp(local.y, anchor.y);
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  rel = vec2(c * rel.x - s * rel.y, s * rel.x + c * rel.y);
  // Height above the ground plane of level 0: the anchor's base plus the height above the anchor line.
  float h = aParams.x - rel.y;
  vec2 world = anchorWorld + vec2(rel.x, 0.0) + sway * (up * up) + uShadow.xy * (uShadow.z * h);
  vec2 q = (world - uShadowFrame.xy) / uShadowFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vBase = aParams.x;
  vAnchorY = anchor.y;
}
