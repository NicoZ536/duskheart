#version 300 es
precision highp float;
// Distortion sources (M5-13): one instanced quad per shock wave ring (covering radius + width) or heat
// area (its ellipse), in world px.
layout(location = 0) in vec2 aCorner;   // 0…1
layout(location = 1) in vec4 aShape;    // centre x, y, a (ring radius | half width), b (ring width | half height)
layout(location = 2) in vec2 aKind;     // kind (0 shock wave, 1 heat), strength [px]

uniform vec2 uOrigin;
uniform vec2 uTargetSize;

flat out vec4 vShape;
flat out vec2 vKind;

void main() {
  vec2 extent = aKind.x < 0.5 ? vec2(aShape.z + aShape.w) : aShape.zw;
  vec2 world = aShape.xy + (aCorner * 2.0 - 1.0) * extent;
  vec2 t = (world - uOrigin) / uTargetSize;
  gl_Position = vec4(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
  vShape = aShape;
  vKind = aKind;
}
