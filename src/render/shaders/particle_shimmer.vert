#version 300 es
precision highp float;
precision highp int;
// Heat shimmer (M5-21, §6.2 "Feuer … Hitzeflimmern"): one instanced quad per column of hot air over a fire, in target
// pixels (src/render/particles/shimmer.ts). The fragment stage displaces the picture behind it.
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;    // left, top, width, height [target px, top-left origin]
layout(location = 2) in vec2 aParams;  // strength [px], phase [rad]

uniform vec2 uTargetSize;

flat out vec4 vRect;
flat out vec2 vParams;

void main() {
  vec2 corner = aRect.xy + aCorner * aRect.zw;
  vec2 clip = corner / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vRect = aRect;
  vParams = aParams;
}
