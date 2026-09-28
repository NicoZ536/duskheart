#version 300 es
precision highp float;
// Sun casters of the build grid as blocks in the sun-shadow target (M5-02, M5-05): a footprint between two heights –
// a wall from its ground to its top, a roof as a slab above the walls, a window as a pane – sweeps the area its sides,
// top and bottom cover along the shadow vector. One instance per record (src/render/light/sunCasters.ts).
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBox;     // centre x, y [world px], half extents
layout(location = 2) in vec4 aSpan;    // bottom, top [px above level 0], kind, axis of a pane (0 along x, 1 along y)
layout(location = 3) in vec4 aPane;    // world coordinate of the frame's column 0 along the axis, atlas x, y, foot row edge
layout(location = 4) in vec4 aFrame;   // palette row, frame width, height, 0

uniform vec4 uSdfFrame;   // world px of the shadow target's top-left corner, its size
uniform vec3 uShadow;     // shadow direction x, y (unit, +y south), length per unit height

out vec2 vWorld;
flat out vec4 vBox;
flat out vec4 vSpan;
flat out vec4 vPane;
flat out vec4 vFrame;

void main() {
  vec2 lo = aBox.xy - aBox.zw;
  vec2 hi = aBox.xy + aBox.zw;
  vec2 s = uShadow.xy * uShadow.z;
  vec2 low = s * aSpan.x;
  vec2 high = s * aSpan.y;
  vec2 a = min(lo + low, lo + high) - 1.0;
  vec2 b = max(hi + low, hi + high) + 1.0;
  vec2 world = mix(a, b, aCorner);
  vec2 q = (world - uSdfFrame.xy) / uSdfFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  vWorld = world;
  vBox = vec4(lo, hi);
  vSpan = aSpan;
  vPane = aPane;
  vFrame = aFrame;
}
