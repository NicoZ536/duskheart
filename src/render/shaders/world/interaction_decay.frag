#version 300 es
precision highp float;
precision highp int;
// Interaction texture, step 1 (M5-17, src/render/surface/interactionPass.ts): last frame's grass pressure, moved by
// the camera's whole-pixel shift (the texture is anchored to the world) and faded towards zero (the grass springs
// back behind a figure). The footprint channel starts empty; the prints are stamped anew every frame.
uniform sampler2D uPrevious;
uniform ivec2 uShift;          // world px the texture origin moved since the last frame
uniform float uDecay;          // share of the pressure left after this frame

out vec4 oValue;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy) + uShift;
  ivec2 size = textureSize(uPrevious, 0);
  float pressure = any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, size)) ? 0.0 : texelFetch(uPrevious, t, 0).r;
  // Values under one 8-bit step are gone (no residue that never fades in the RGBA8 target).
  pressure *= uDecay;
  oValue = vec4(pressure < 1.5 / 255.0 ? 0.0 : pressure, 0.0, 0.0, 1.0);
}
