#version 300 es
precision highp float;
// Sharp upscaling, step 2: linear from the integer pre-scaled image to the output rectangle.
// Only pixel boundaries get blended (at most one output pixel wide), pixels stay square.
uniform sampler2D uImage;
uniform vec2 uViewport;    // lower-left corner of the output rectangle (window px)
uniform vec2 uSize;        // output rectangle size
out vec4 oColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - uViewport) / uSize;
  oColor = vec4(texture(uImage, uv).rgb, 1.0);
}
