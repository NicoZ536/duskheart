#version 300 es
precision highp float;
precision highp int;
// GPU particles, drawn (M5-11): which pixels of the quad the particle's shape covers – a block, a snowflake, a round
// puff with a half-covered rim, a splash crown in three frames, a digital line (one pixel per step along its major
// axis, fading towards the tail) – and its colour premultiplied by its opacity in eight steps (flat translucency, no
// smooth ramps). Blending ONE / ONE_MINUS_SRC_ALPHA into the HDR target (encodeHdr is linear, so blending the encoded
// values is blending the values).
#include "hdr.glsl"

uniform vec2 uTargetSize;

flat in ivec2 vAnchor;
flat in int vShape;
flat in vec4 vGeom;
flat in vec4 vColor;

out vec4 oColor;

float coverage(ivec2 rel) {
  if (vShape == DH_SHAPE_PUNKT) return 1.0;
  if (vShape == DH_SHAPE_FLOCKE) {
    if (vGeom.x >= 3.0) return abs(rel.x) + abs(rel.y) <= 1 ? 1.0 : 0.0;
    return 1.0;
  }
  if (vShape == DH_SHAPE_SCHEIBE) {
    float r = max(1.0, vGeom.x) * 0.5;
    float d = length(vec2(rel));
    return d <= r - 0.5 ? 1.0 : d <= r + 0.25 ? 0.5 : 0.0;
  }
  if (vShape == DH_SHAPE_SCHWADE) {
    vec2 r = vec2(rel);
    float along = dot(r, vGeom.zw) / max(0.5, vGeom.y * 0.5);
    float across = dot(r, vec2(-vGeom.w, vGeom.z)) / max(0.5, vGeom.x * 0.5);
    float e = along * along + across * across;
    return e <= DH_WISP_CORE ? 1.0 : e <= 1.0 ? 0.5 : 0.0;
  }
  if (vShape == DH_SHAPE_SPRITZER) {
    int frame = int(vGeom.w + 0.5);
    if (frame == 0) return rel == ivec2(0, 0) || rel == ivec2(0, -1) ? 1.0 : 0.0;
    if (frame == 1) return rel == ivec2(-1, -1) || rel == ivec2(1, -1) || rel == ivec2(0, 0) ? 1.0 : 0.0;
    return rel == ivec2(-2, -2) || rel == ivec2(2, -2) ? 1.0 : 0.0;
  }
  // Line from the head (0, 0) to the tail: one pixel per step along the major axis.
  vec2 tail = vGeom.yz;
  float major = max(abs(tail.x), abs(tail.y));
  if (major < 0.5) return rel == ivec2(0, 0) ? 1.0 : 0.0;
  bool xMajor = abs(tail.x) >= abs(tail.y);
  float along = xMajor ? float(rel.x) * sign(tail.x) : float(rel.y) * sign(tail.y);
  if (along < 0.0 || along > major) return 0.0;
  float across = xMajor ? float(rel.y) : float(rel.x);
  float expect = floor(along * (xMajor ? tail.y : tail.x) / major + 0.5);
  if (abs(across - expect) > 0.1) return 0.0;
  return 1.0 - DH_LINE_TAIL_FADE * along / major;
}

void main() {
  ivec2 pixel = ivec2(int(gl_FragCoord.x), int(uTargetSize.y - gl_FragCoord.y));
  float a = vColor.a * coverage(pixel - vAnchor);
  a = floor(a * DH_PARTICLE_ALPHA_STEPS + 0.5) / DH_PARTICLE_ALPHA_STEPS;
  if (a <= 0.0) discard;
  oColor = vec4(encodeHdr(vColor.rgb).rgb * a, a);
}
