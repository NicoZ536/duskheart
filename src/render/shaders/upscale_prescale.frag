#version 300 es
precision highp float;
// Sharp upscaling, step 1 (MASTERPROMPT §4.2): integer nearest pre-scale of the visible part of the
// bordered scene. uOffset = 1 px border + subpixel camera fraction (GL orientation, y up).
uniform sampler2D uScene;
uniform vec2 uOffset;
uniform float uScale;      // integer factor
uniform vec2 uViewport;    // lower-left corner of the destination rectangle (window px)
out vec4 oColor;
void main() {
  vec2 src = uOffset + (gl_FragCoord.xy - uViewport) / uScale;
  oColor = vec4(texelFetch(uScene, ivec2(floor(src)), 0).rgb, 1.0);
}
