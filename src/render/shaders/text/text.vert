#version 300 es
precision highp float;
precision highp int;
// Instanced pixel-text quads (instance layout: src/render/text/textBatch.ts). One instance is a
// glyph cell (bitmap + 1 texel transparent ring) or a solid rectangle, placed on whole target px.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in ivec2 aPos;     // top-left, target px (y down)
layout(location = 2) in uvec4 aBox;     // size w, h [px]; atlas cell x, y [texels]
layout(location = 3) in uint aMode;     // TEXT_MODE_*
layout(location = 4) in vec4 aColor;    // ink colour
layout(location = 5) in vec4 aEffect;   // shadow / outline colour

uniform vec2 uTarget;  // target size in px

out vec2 vLocal;
flat out ivec2 vCell;
flat out ivec2 vSize;
flat out uint vMode;
flat out vec4 vColor;
flat out vec4 vEffect;

void main() {
  vec2 size = vec2(aBox.xy);
  vLocal = aCorner * size;
  vCell = ivec2(aBox.zw);
  vSize = ivec2(aBox.xy);
  vMode = aMode;
  vColor = aColor;
  vEffect = aEffect;
  vec2 p = vec2(aPos) + vLocal;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
}
