// Palette LUT (src/render/palette/lut.ts): 64 columns (palette index 1…64) × rows (variants).
// Index 0 means transparent and never reaches these functions.

// Palette index stored in an 8-bit channel (atlas albedo R).
int paletteIndexOf(float encoded) {
  return int(encoded * 255.0 + 0.5);
}

// Colour of palette index `index` (1…64) in palette row `row`.
vec3 paletteColor(sampler2D lut, int index, int row) {
  return texelFetch(lut, ivec2(clamp(index, 1, 64) - 1, row), 0).rgb;
}
