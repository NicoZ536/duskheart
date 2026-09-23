#version 300 es
precision highp float;
precision highp int;
// Pixel text: the R8 glyph atlas holds 0 or 255 per texel (hard-thresholded bake). Ink texels get
// the ink colour. Shadow: a blank texel whose neighbour TEXT_SHADOW_OFFSET rows up is ink gets the
// effect colour (drop shadow below the glyph). Outline: every blank texel next to ink
// (8-neighbourhood) gets the effect colour. Rectangles ignore the atlas.
uniform highp sampler2D uGlyphs;

in vec2 vLocal;
flat in ivec2 vCell;
flat in ivec2 vSize;
flat in uint vMode;
flat in vec4 vColor;
flat in vec4 vEffect;

out vec4 outColor;

float ink(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= vSize.x || p.y >= vSize.y) return 0.0;
  return texelFetch(uGlyphs, vCell + p, 0).r;
}

void main() {
  if (vMode == uint(TEXT_MODE_RECT)) {
    outColor = vColor;
    return;
  }
  ivec2 p = ivec2(floor(vLocal));
  if (ink(p) > 0.5) {
    outColor = vColor;
    return;
  }
  float effect = 0.0;
  if (vMode == uint(TEXT_MODE_SHADOW)) {
    effect = ink(p - ivec2(0, TEXT_SHADOW_OFFSET));
  } else if (vMode == uint(TEXT_MODE_OUTLINE)) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) effect = max(effect, ink(p + ivec2(dx, dy)));
    }
  }
  if (effect < 0.5) discard;
  outColor = vEffect;
}
