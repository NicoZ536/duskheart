#version 300 es
precision highp float;
// One occluder footprint into the mask (layout: sdf.glsl). Blended with MAX: overlapping footprints keep the
// highest top per channel, and a structural or terrain footprint does not erase the decor above it; alpha is the
// height of the ground (terrain records only). A roof marks the structural channel with DH_ROOF_MARK (a wall under it
// keeps its 1), an opening in a wall (window, open door) with DH_OPENING_MARK.
flat in vec4 vKind;
flat in vec2 vHalf;
in vec2 vLocal;

out vec4 oMask;

void main() {
  bool ellipse = mod(vKind.z, 2.0) > 0.5;
  // Pixel centres inside the footprint: an ellipse by its equation, a rectangle by its box (rounded outward by
  // less than half a pixel, so a 0.5-px edge still covers the pixel it cuts through).
  if (ellipse) {
    if (dot(vLocal, vLocal) > 1.0) discard;
  } else {
    vec2 slack = 0.49 / max(vHalf, vec2(0.5));
    if (abs(vLocal.x) > 1.0 + slack.x || abs(vLocal.y) > 1.0 + slack.y) discard;
  }
  float top = clamp(vKind.x / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0);
  float cls = vKind.y;
  vec4 m = vec4(0.0);
  if (cls > DH_OCC_OPENING - 0.5) m.g = DH_OPENING_MARK;
  else if (cls > DH_OCC_ROOF - 0.5) m.g = DH_ROOF_MARK;
  else if (cls > DH_OCC_TERRAIN - 0.5) m.b = top;
  else if (cls > DH_OCC_STRUCTURAL - 0.5) m.g = 1.0;
  else m.r = top;
  // The ground under the footprint (terrain records; 0 for the rest, which MAX leaves alone).
  m.a = clamp(vKind.w / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0);
  oMask = m;
}
