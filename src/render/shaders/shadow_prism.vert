#version 300 es
precision highp float;
// Raised terrain as upright blocks in the sun-shadow target (M5-02): a footprint of height `top` casts the area its
// sides and top sweep along the shadow vector. One instance per occluder record (src/render/light/occluders.ts);
// records without the prism flag are skipped.
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBox;      // centre x, y, half extents
layout(location = 2) in vec4 aKind;     // top, class, shape + 2 × prism, ground

uniform vec4 uShadowFrame; // world px of the shadow target's top-left corner, its size (light/shadowFrame.ts)
uniform vec3 uShadow;

out vec2 vWorld;
flat out vec4 vBox;
flat out float vTop;

void main() {
  vec2 lo = aBox.xy - aBox.zw;
  vec2 hi = aBox.xy + aBox.zw;
  vec2 reach = uShadow.xy * (uShadow.z * aKind.x);
  vec2 a = min(lo, lo + reach) - 1.0;
  vec2 b = max(hi, hi + reach) + 1.0;
  vec2 world = mix(a, b, aCorner);
  if (aKind.z < 1.5) world = vec2(-1e6);
  vec2 q = (world - uShadowFrame.xy) / uShadowFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  vWorld = world;
  vBox = vec4(lo, hi);
  vTop = aKind.x;
}
