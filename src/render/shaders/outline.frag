#version 300 es
precision highp float;
precision highp int;
// Interaction outline (MASTERPROMPT §4.6, §6.2 "Outline-Shader für Interaktion"; M5-24): 1 px in the accent colour
// around the combined silhouette of every sprite flagged `outline` (G-buffer mask bit) – only where it is in front,
// so the outline hugs what the player sees of the thing –, drawn over the final image, never darkened by the lighting
// and readable at night. A glint (the accent's lighter step) runs diagonally along it, anchored to the world (the
// pattern does not swim with the camera); with reduced motion it stands still.
#include "palette.glsl"
#include "gbuffer.glsl"
uniform sampler2D uMask;         // G2
uniform sampler2D uPaletteLut;
uniform int uAccentIndex;
uniform int uGlintIndex;         // lighter step of the accent's ramp
uniform vec2 uOrigin;            // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;
uniform float uTime;             // presentation time [s]; the glint's phase
out vec4 oColor;

bool outlined(ivec2 p) {
  ivec2 size = textureSize(uMask, 0);
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return false;
  return gbufferHasMask(texelFetch(uMask, p, 0), DH_MASK_OUTLINE);
}

// Diagonal glint bands, `DH_GLINT_WIDTH` px wide every `DH_GLINT_SPACING` px (src/render/surface/rules.ts `outlineGlint`).
bool glint(vec2 world) {
  float v = (world.x + world.y) / DH_GLINT_SPACING - uTime / DH_GLINT_SECONDS;
  return fract(v) < DH_GLINT_WIDTH / DH_GLINT_SPACING;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (outlined(p)) discard;
  if (!(outlined(p + ivec2(1, 0)) || outlined(p - ivec2(1, 0)) || outlined(p + ivec2(0, 1)) || outlined(p - ivec2(0, 1)))) discard;
  vec2 world = floor(uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y));
  oColor = vec4(paletteColor(uPaletteLut, glint(world) ? uGlintIndex : uAccentIndex, 0), 1.0);
}
