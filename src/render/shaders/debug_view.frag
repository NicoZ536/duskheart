#version 300 es
precision highp float;
precision highp int;
// Render debugger: shows one buffer as colours (MASTERPROMPT §6.3 "Render-Debugger").
#include "hdr.glsl"
#include "gbuffer.glsl"
uniform sampler2D uSource;
uniform sampler2D uAlbedo;     // for modes that tint by the albedo (emissive)
uniform int uMode;
uniform float uScale;          // range of scalar modes, bit of mask mode
out vec4 oColor;

const int MODE_RGB = 0;
const int MODE_NORMAL = 1;
const int MODE_BLUE = 2;       // one channel as grey: b
const int MODE_ALPHA = 3;
const int MODE_RED = 4;
const int MODE_GREEN = 5;
const int MODE_MATERIAL = 6;
const int MODE_EMISSIVE = 7;
const int MODE_HDR = 8;
const int MODE_SCALAR = 9;     // R16F (or its RG8 encoding) / uScale
const int MODE_MASK = 10;      // alpha as bit field: white where bit uScale is set

vec3 materialColor(uint m) {
  vec3 c = vec3(0.0);
  if ((m & DH_MAT_METAL) != 0u) c += vec3(0.75, 0.75, 0.85);
  if ((m & DH_MAT_WET) != 0u) c += vec3(0.1, 0.3, 0.9);
  if ((m & DH_MAT_ICE) != 0u) c += vec3(0.4, 0.9, 1.0);
  if ((m & DH_MAT_WIND) != 0u) c += vec3(0.2, 0.8, 0.2);
  if ((m & DH_MAT_CANOPY) != 0u) c += vec3(0.9, 0.5, 0.1);
  return min(c, vec3(1.0));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uSource, p, 0);
  vec3 c;
  if (uMode == MODE_NORMAL) c = gbufferNormal(s) * 0.5 + 0.5;
  else if (uMode == MODE_BLUE) c = vec3(s.b);
  else if (uMode == MODE_ALPHA) c = vec3(s.a);
  else if (uMode == MODE_RED) c = vec3(s.r);
  else if (uMode == MODE_GREEN) c = vec3(s.g);
  else if (uMode == MODE_MATERIAL) c = materialColor(gbufferMaterial(s));
  else if (uMode == MODE_EMISSIVE) c = texelFetch(uAlbedo, p, 0).rgb * min(1.0, gbufferEmissive(s));
  else if (uMode == MODE_HDR) c = clamp(decodeHdr(s), 0.0, 1.0);
  else if (uMode == MODE_SCALAR) c = vec3(clamp(decodeScalar(s, uScale) / uScale, 0.0, 1.0));
  else if (uMode == MODE_MASK) c = vec3(gbufferHasMask(s, uint(uScale)) ? 1.0 : 0.0);
  else c = s.rgb;
  oColor = vec4(c, 1.0);
}
