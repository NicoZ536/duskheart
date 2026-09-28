#version 300 es
precision highp float;
precision highp int;
// Heat shimmer (M5-21): each pixel of the column shows the pixel beside it, shifted sideways by whole pixels along a
// wave that climbs with time – strongest in the middle of the column just above the flames, fading to its sides and
// top. The picture stays pixel-sharp (no filtering). Reads a copy of the lit scene, writes the lit scene.
uniform sampler2D uScene;      // copy of the HDR target
uniform vec2 uTargetSize;
uniform float uTime;

flat in vec4 vRect;
flat in vec2 vParams;

out vec4 oColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float fromTop = uTargetSize.y - gl_FragCoord.y;
  float across = clamp((gl_FragCoord.x - vRect.x) / max(1.0, vRect.z), 0.0, 1.0);
  float up = clamp((vRect.y + vRect.w - fromTop) / max(1.0, vRect.w), 0.0, 1.0);
  float envelope = sin(3.14159265 * across) * (1.0 - up) * smoothstep(0.0, 0.15, up);
  float wave = sin(fromTop * DH_SHIMMER_WAVE + uTime * DH_SHIMMER_SPEED + vParams.y);
  float shift = floor(vParams.x * envelope * wave + 0.5);
  ivec2 size = ivec2(uTargetSize) - 1;
  oColor = texelFetch(uScene, clamp(p + ivec2(int(shift), 0), ivec2(0), size), 0);
}
