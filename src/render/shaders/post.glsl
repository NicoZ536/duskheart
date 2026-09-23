// Tonemapping (MASTERPROMPT §6.1 pass 9, M1-19): identity up to 1 – palette colours under full light
// stay exact – and a hue-preserving shoulder above: the brightest channel holds at 1 while the others
// rise towards white with the overexposure (a blazing fire burns white instead of clipping into a
// hue shift). Mirrors src/render/passes/postPass.ts `tonemap`.
float tonemapWhite(float peak) {
  return peak <= 1.0 ? 0.0 : (1.0 - 1.0 / peak) * DH_TONEMAP_WHITE;
}

vec3 tonemap(vec3 c) {
  c = max(c, vec3(0.0));
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= 1.0) return c;
  return mix(c / peak, vec3(1.0), tonemapWhite(peak));
}
