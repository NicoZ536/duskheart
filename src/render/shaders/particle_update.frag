#version 300 es
precision mediump float;
// The particle step writes by transform feedback with the rasteriser off; WebGL2 still links a fragment stage.
out vec4 oColor;
void main() {
  oColor = vec4(0.0);
}
