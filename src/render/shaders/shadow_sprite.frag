#version 300 es
precision highp float;
precision highp int;
// A silhouette pixel into the sun-shadow target (M5-02, M5-03): rgb = the light it lets through (0: opaque), a = the
// height of the casting pixel / DH_GBUFFER_HEIGHT_RANGE. Blended with MIN on rgb and MAX on alpha: the darkest
// transmission and the highest caster win. Crowns (material canopy) let the sun through in world-anchored flecks that
// sway with the wind (M5-03 "Blätterdach-Sprenkel"). Walls, doors, windows and roofs of the build grid do not cast here
// (their class map bit is clear): the grid casts them as blocks (shadow_block.*), glass included.
#include "gbuffer.glsl"
#include "shadow_noise.glsl"
#include "shadow_ground.glsl"

in vec2 vLocal;
flat in uvec4 vRect;
flat in float vBase;
flat in float vAnchorY;

uniform sampler2D uAtlasAlbedo;
uniform sampler2D uClass;        // per atlas texel: 1 casts a silhouette
uniform vec4 uSdfFrame;
uniform vec4 uWind;              // wind x, y (strength as length), time [s], 0

out vec4 oShadow;

const float CLASS_CASTER = 1.0;

void main() {
  ivec2 p = clamp(ivec2(floor(vLocal)), ivec2(0), ivec2(vRect.zw) - 1);
  ivec2 texel = ivec2(vRect.xy) + p;
  vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
  if (a.a < 0.5) discard;
  float cls = floor(texelFetch(uClass, texel, 0).r * 255.0 + 0.5);
  if (mod(cls, 2.0) < CLASS_CASTER) discard;
  uint material = uint(a.b * 255.0 + 0.5);
  vec2 world = uSdfFrame.xy + vec2(gl_FragCoord.x, uSdfFrame.w - gl_FragCoord.y);
  if ((material & DH_MAT_CANOPY) != 0u) {
    // Rounded flecks where the noise peaks; they sway with the wind (whole pixels: the flecks stay crisp).
    float sway = sin(uWind.z * DH_DAPPLE_FREQUENCY + dot(world, vec2(0.013, 0.021))) * DH_DAPPLE_SWAY;
    if (valueNoise(floor(world + uWind.xy * sway) / DH_DAPPLE_CELL) > DH_DAPPLE_THRESHOLD) discard;
  }
  float height = vBase + max(0.0, vAnchorY - float(p.y) - 0.5);
  if (shadowUnderGround(height)) discard;
  oShadow = vec4(vec3(0.0), clamp(height / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0));
}
