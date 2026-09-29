#version 300 es
precision highp float;
// Occluder footprints into the occluder mask (M5-01; records: src/render/light/occluders.ts). One instance per
// footprint: a quad around its box in the targets of the occluder pass (frame + margin), or in its coarse ring.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec4 aBox;      // centre x, y [world px], half extents x, y
layout(location = 2) in vec4 aKind;     // top [px above level 0], class, shape (0 rect, 1 ellipse) + 2 × prism, ground [px]

uniform vec4 uSdfFrame;   // world px of the targets' top-left corner, their size [world px]
uniform vec2 uSlack;      // how far the quad reaches beyond the box [px], the tolerance of a rectangle's edge [px]

out vec2 vLocal;          // position in the footprint, −1…1 per axis at its box
flat out vec4 vKind;
flat out vec2 vHalf;

void main() {
  // Slack around the box so thin footprints (a 1.5-px trunk) still cover their texel centres: half a pixel in the mask,
  // half a texel in the coarse occluder ring (M5 review M2).
  vec2 ext = aBox.zw + uSlack.x;
  vec2 world = aBox.xy + (aCorner * 2.0 - 1.0) * ext;
  vec2 q = (world - uSdfFrame.xy) / uSdfFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  vLocal = (aCorner * 2.0 - 1.0) * ext / aBox.zw;
  vKind = aKind;
  vHalf = aBox.zw;
}
