#version 300 es
precision highp float;
precision highp int;
// Mirror images of the lights in puddles (M5-20, src/render/surface/puddlePass.ts): one quad per light around its
// mirror point – a light at footprint (x, y) and height h shows in a level water surface at (x, y + h) in the 3/4 view.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec4 aMirror;   // mirror point x, y [world px], half width, half length [px]
layout(location = 2) in vec3 aColor;    // light colour × intensity × flicker × mirror strength

uniform vec2 uOrigin;      // world px of target pixel (0, 0)
uniform vec2 uTargetSize;
uniform float uRipple;     // sideways wobble of the image [px] (rain on the water)

out vec2 vWorld;
flat out vec4 vMirror;
flat out vec3 vColor;

void main() {
  vec2 ext = aMirror.zw + vec2(uRipple + 1.0, 1.0);
  vec2 world = floor(aMirror.xy) + (aCorner * 2.0 - 1.0) * ext;
  vec2 t = (world - uOrigin) / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(t.x, -t.y, 0.0, 1.0);
  vWorld = world;
  vMirror = aMirror;
  vColor = aColor;
}
