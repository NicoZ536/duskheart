#version 300 es
precision highp float;
// Present pass: nearest sampling of the internal target (sharp pixels).
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
void main() {
  outColor = vec4(texture(uScene, vUv).rgb, 1.0);
}
