#version 300 es
precision highp float;
precision highp int;
// Interaction outline (MASTERPROMPT §4.6): 1 px in the accent colour around the combined silhouette
// of every sprite flagged `outline` (G-buffer mask bit), drawn over the final image, so it is never
// darkened by the lighting and stays readable at night.
#include "palette.glsl"
#include "gbuffer.glsl"
uniform sampler2D uMask;         // G2
uniform sampler2D uPaletteLut;
uniform int uAccentIndex;
out vec4 oColor;

bool outlined(ivec2 p) {
  ivec2 size = textureSize(uMask, 0);
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return false;
  return gbufferHasMask(texelFetch(uMask, p, 0), DH_MASK_OUTLINE);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (outlined(p)) discard;
  if (!(outlined(p + ivec2(1, 0)) || outlined(p - ivec2(1, 0)) || outlined(p + ivec2(0, 1)) || outlined(p - ivec2(0, 1)))) discard;
  oColor = vec4(paletteColor(uPaletteLut, uAccentIndex, 0), 1.0);
}
