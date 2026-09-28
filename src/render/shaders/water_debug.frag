#version 300 es
precision highp float;
precision highp int;
// Render debugger view `wellen` (M5-09): the interactive wave field under the picture – crests warm, troughs blue,
// calm water grey, land (where the tile grid holds the field at 0) dark; the frame of the field follows the camera.
uniform vec4 uFrames[2];       // the field: world px of its north-west corner, size [texels]; the tile grid (water.glsl)
#define uFieldFrame (uFrames[0])
#define uTileFrame (uFrames[1])
#include "water.glsl"

uniform sampler2D uField;
uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;

out vec4 oColor;

void main() {
  vec2 sp = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec2 world = uOrigin + sp;
  vec2 f = (world - uFieldFrame.xy) / DH_WAVE_TEXEL;
  ivec2 d = ivec2(floor(f));
  ivec2 size = ivec2(uFieldFrame.zw);
  if (d.x < 0 || d.y < 0 || d.x >= size.x || d.y >= size.y) {
    oColor = vec4(0.05, 0.0, 0.05, 1.0);
    return;
  }
  if (!waterOpenAt(world)) {
    oColor = vec4(0.12, 0.1, 0.08, 1.0);
    return;
  }
  float h = unpackHeight(texelFetch(uField, ivec2(d.x, size.y - 1 - d.y), 0).rg);
  float k = clamp(abs(h) * 1.5, 0.0, 1.0);
  vec3 calm = vec3(0.35, 0.38, 0.42);
  oColor = vec4(mix(calm, h > 0.0 ? vec3(1.0, 0.85, 0.5) : vec3(0.15, 0.35, 1.0), k), 1.0);
}
