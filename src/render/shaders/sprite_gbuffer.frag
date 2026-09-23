#version 300 es
precision highp float;
precision highp int;
// Sprite → G-buffer (layout: gbuffer.glsl). Colour from the palette LUT, relief from the normal
// atlas, height above ground for upright layers, flash / tint / dither fade per instance; outlined
// sprites set a mask bit that the outline pass turns into a 1 px silhouette outline.
#include "palette.glsl"
#include "bayer.glsl"

in vec2 vLocal;
flat in uvec4 vRect;
flat in uvec4 vMisc;
flat in vec4 vTint;
flat in vec2 vAnchor;
flat in float vHeightBase;
flat in vec2 vRotation;

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uAtlasNormal;
uniform sampler2D uPaletteLut;
uniform int uLayer;            // 0 ground, 1 water, 2 objects, 3 canopy
uniform vec2 uTargetSize;
uniform vec3 uFade;            // canopy fade circle: centre (target px, y down), radius (0 = off)
uniform int uFlashIndex;       // palette index of the white flash

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oEmissive;

const uint FLAG_MIRROR = 1u;
const uint FLAG_OUTLINE = 2u;
const uint FLAG_FLASH = 4u;
const int LAYER_WATER = 1;
const int LAYER_OBJECTS = 2;
const int LAYER_CANOPY = 3;
// Inner part of the canopy fade circle that is fully see-through.
const float FADE_CORE = 0.55;

float heightAt(float relief, float row) {
  // Upright layers stand on their anchor line: each row above it is one pixel higher.
  float upright = uLayer >= LAYER_OBJECTS ? max(0.0, vAnchor.y - row - 0.5) : 0.0;
  return clamp((upright + relief + vHeightBase) / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0);
}

void main() {
  float threshold = bayer4(gl_FragCoord.xy);
  // Whole-sprite dither fade (0 = opaque … 255 = gone).
  if (float(vMisc.w) / 255.0 > threshold) discard;
  if (uLayer == LAYER_CANOPY && uFade.z > 0.0) {
    vec2 p = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
    float d = length(p - uFade.xy) / uFade.z;
    if (d < 1.0 && smoothstep(FADE_CORE, 1.0, d) < threshold) discard;
  }
  uint flags = vMisc.y;
  ivec2 p = clamp(ivec2(floor(vLocal)), ivec2(0), ivec2(vRect.zw) - 1);
  ivec2 texel = ivec2(vRect.xy) + p;
  vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
  if (a.a < 0.5) discard;
  vec4 n = texelFetch(uAtlasNormal, texel, 0);
  vec3 color = (flags & FLAG_FLASH) != 0u ? paletteColor(uPaletteLut, uFlashIndex, 0) : paletteColor(uPaletteLut, paletteIndexOf(a.r), int(vMisc.x));
  color = mix(color, vTint.rgb, vTint.a);
  // Normal: mirrored with the sprite, rotated with it (screen y down → normal y up: angle negated).
  vec2 nxy = n.rg * 2.0 - 1.0;
  if ((flags & FLAG_MIRROR) != 0u) nxy.x = -nxy.x;
  nxy = vec2(vRotation.x * nxy.x + vRotation.y * nxy.y, -vRotation.y * nxy.x + vRotation.x * nxy.y);
  uint material = uint(a.b * 255.0 + 0.5);
  float gloss = (material & DH_MAT_METAL) != 0u ? DH_GLOSS_METAL : (material & DH_MAT_ICE) != 0u ? DH_GLOSS_ICE : (material & DH_MAT_WET) != 0u ? DH_GLOSS_WET : 0.0;
  float emissive = a.g * (1.0 + float(vMisc.z) / 255.0 * DH_EMISSIVE_BOOST_MAX);
  oAlbedo = vec4(color, 1.0);
  oNormal = vec4(nxy * 0.5 + 0.5, heightAt(n.b * DH_ATLAS_HEIGHT_RANGE, float(p.y)), float(material) / 255.0);
  uint mask = (uLayer == LAYER_WATER ? DH_MASK_WATER : 0u) | ((flags & FLAG_OUTLINE) != 0u ? DH_MASK_OUTLINE : 0u);
  oEmissive = vec4(emissive / DH_EMISSIVE_RANGE, gloss, (material & DH_MAT_WET) != 0u ? 1.0 : 0.0, float(mask) / 255.0);
}
