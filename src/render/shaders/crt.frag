#version 300 es
precision highp float;
// Optional CRT filter of the presentation (MASTERPROMPT §6.1 pass 10 "optionaler CRT-Filter (standardmäßig
// aus)", M5-16; src/render/post/crtPass.ts): replaces the linear step of the sharp upscaling. The integer
// pre-scaled picture is bent onto a slightly curved screen, every internal pixel row becomes a scanline
// (bright in its middle, dark at its seams), an aperture grille splits the columns into red, green and blue,
// the corners darken and round off. Mirrors `crtCurve` / `crtScanline` in crtPass.ts.
uniform sampler2D uImage;    // integer pre-scaled picture (linear filtering)
uniform vec2 uViewport;      // lower-left corner of the output rectangle (window px)
uniform vec2 uSize;          // output rectangle size
uniform float uRows;         // internal rows of the picture (270)

out vec4 oColor;

vec2 crtCurve(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + dot(c, c) * DH_CRT_CURVE;
  return c * 0.5 + 0.5;
}

float crtScanline(float rowFraction) {
  float s = sin(3.14159265 * rowFraction);
  return 1.0 - DH_CRT_SCANLINE * (1.0 - s * s);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uViewport) / uSize;
  vec2 bent = crtCurve(uv);
  if (bent.x < 0.0 || bent.y < 0.0 || bent.x > 1.0 || bent.y > 1.0) {
    oColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 c = texture(uImage, bent).rgb;
  c *= crtScanline(fract(bent.y * uRows));
  int column = int(mod(floor(gl_FragCoord.x), 3.0));
  vec3 mask = vec3(1.0 - DH_CRT_MASK);
  mask[column] = 1.0 + DH_CRT_MASK;
  c *= mask;
  vec2 edge = min(bent, 1.0 - bent) * uSize / min(uSize.x, uSize.y);
  float corner = smoothstep(0.0, DH_CRT_CORNER, min(edge.x, edge.y));
  vec2 v = bent * 2.0 - 1.0;
  float shade = 1.0 - DH_CRT_VIGNETTE * dot(v * v, vec2(0.5));
  oColor = vec4(min(c * DH_CRT_GAIN * shade * corner, vec3(1.0)), 1.0);
}
