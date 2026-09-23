// G-buffer layout (src/render/gbuffer.ts, ADR-0011). All attachments RGBA8.
//   G0 albedo:   rgb = palette colour (after palette row, flash, tint), a = coverage (1 = drawn)
//   G1 normal:   rg = normal xy (0.5 + 0.5·n, +x right, +y up on screen), b = height above ground
//                / DH_GBUFFER_HEIGHT_RANGE px, a = material bits / 255
//   G2 emissive: r = emissive intensity / DH_EMISSIVE_RANGE, g = gloss, b = wetness,
//                a = mask bits / 255 (DH_MASK_WATER: water layer, DH_MASK_OUTLINE: interaction outline)

vec3 gbufferNormal(vec4 g1) {
  vec2 xy = g1.rg * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

float gbufferHeight(vec4 g1) {
  return g1.b * DH_GBUFFER_HEIGHT_RANGE;
}

uint gbufferMaterial(vec4 g1) {
  return uint(g1.a * 255.0 + 0.5);
}

float gbufferEmissive(vec4 g2) {
  return g2.r * DH_EMISSIVE_RANGE;
}

bool gbufferHasMaterial(vec4 g1, uint bit) {
  return (gbufferMaterial(g1) & bit) != 0u;
}

bool gbufferHasMask(vec4 g2, uint bit) {
  return (uint(g2.a * 255.0 + 0.5) & bit) != 0u;
}
