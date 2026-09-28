#version 300 es
precision highp float;
precision highp int;
// Interaction texture, step 2 (M5-17, M5-19), blended with MAX: a figure's push is a round dome in R (full at its feet,
// zero at its radius) – the grass leans down its slope; a footprint is a small dent in G (a sole, 2 × 3 px).
in vec2 vWorld;
flat in vec4 vStamp;
flat in vec2 vKind;

out vec4 oValue;

void main() {
  vec2 d = floor(vWorld) + 0.5 - (floor(vStamp.xy) + 0.5);
  if (vKind.x < 0.5) {
    float x = length(d) / max(1.0, vStamp.z);
    if (x >= 1.0) discard;
    float dome = 1.0 - x * x;
    oValue = vec4(vStamp.w * dome, 0.0, 0.0, 0.0);
  } else {
    // Sole of one foot: 2 px wide and 3 px long with the outer heel corner cut (the side says which foot).
    if (d.x < -1.0 || d.x > 0.0 || abs(d.y) > 1.0) discard;
    if (d.y > 0.5 && (vKind.y < 0.0 ? d.x < -0.5 : d.x > -0.5)) discard;
    oValue = vec4(0.0, vStamp.w, 0.0, 0.0);
  }
}
