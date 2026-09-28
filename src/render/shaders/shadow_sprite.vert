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

uniform vec4 uSdfFrame;    // world px of the shadow target's top-left corner, its size
uniform vec3 uShadow;      // shadow direction x, y (unit, +y south), length per unit height

const uint FLAG_MIRROR = 1u;

out vec2 vLocal;
flat out uvec4 vRect;
flat out float vBase;
flat out float vAnchorY;

void main() {
  vec2 local = aCorner * vec2(aRect.zw);
  vec2 anchor = vec2(aAnchor);
  vec2 rel = local - anchor;
  if ((aMisc.y & FLAG_MIRROR) != 0u) rel.x = -rel.x;
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  rel = vec2(c * rel.x - s * rel.y, s * rel.x + c * rel.y);
  // Height above the ground plane of level 0: the anchor's base plus the height above the anchor line.
  float h = aParams.x - rel.y;
  vec2 world = floor(aPos + 0.5) + vec2(rel.x, 0.0) + uShadow.xy * (uShadow.z * h);
  vec2 q = (world - uSdfFrame.xy) / uSdfFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vBase = aParams.x;
  vAnchorY = anchor.y;
}
