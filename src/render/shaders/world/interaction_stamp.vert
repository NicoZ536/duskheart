#version 300 es
precision highp float;
precision highp int;
// Interaction texture, step 2 (M5-17, M5-19): one quad per figure pressing the grass (kind 0) or per footprint
// (kind 1), in texel space of the world-anchored texture (texel row y = world y − origin y, no flip).
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec4 aStamp;    // centre x, y [world px], radius [px], strength 0…1
layout(location = 2) in vec2 aKind;     // kind (0 grass push, 1 footprint), side of the foot (−1, +1)

uniform vec2 uOrigin;                   // world px of texel (0, 0)
uniform vec2 uSize;                     // texture size in texels

out vec2 vWorld;
flat out vec4 vStamp;
flat out vec2 vKind;

void main() {
  float r = aStamp.z + 1.0;
  vec2 world = floor(aStamp.xy) + (aCorner * 2.0 - 1.0) * r;
  vec2 t = world - uOrigin;
  gl_Position = vec4(t / uSize * 2.0 - 1.0, 0.0, 1.0);
  vWorld = world;
  vStamp = aStamp;
  vKind = aKind;
}
