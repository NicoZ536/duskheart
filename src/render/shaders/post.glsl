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

// Eyelids of a blink (§11.1 "Lidschlag-Effekt", M3-20): they cover `lid` of the picture's half from the
// top and the bottom; the last DH_LID_SOFT_PX rows are dithered, and shut lids (1) cover everything.
// Mirrors postPass.ts `lidCovers`.
const vec3 LID_COLOR = vec3(13.0, 10.0, 20.0) / 255.0; // nacht.0
bool lidCovers(float dist, float height, float lid, float bayer) {
  float lidPx = clamp(lid, 0.0, 1.0) * (height * 0.5 + DH_LID_SOFT_PX);
  float t = clamp((lidPx - dist) / DH_LID_SOFT_PX, 0.0, 1.0);
  return t > bayer;
}

// Frost at the edges of a freezing player's picture (§11.2 "Unterkühlt … Frostrand", M3-20): ice creeps in
// DH_FROST_REACH_PX × frost from the nearest edge, stronger towards it (`frostShare`), in uneven fingers
// along the edge, laid over the picture where the share beats the Bayer threshold.
const vec3 FROST_COLOR = vec3(210.0, 231.0, 242.0) / 255.0; // eis.3
float frostShare(float dist, float frost) {
  float reach = DH_FROST_REACH_PX * clamp(frost, 0.0, 1.0);
  if (reach <= 0.0) return 0.0;
  float m = clamp(1.0 - dist / reach, 0.0, 1.0);
  return m * m;
}
float frostFinger(float along) {
  return 0.55 + 0.45 * fract(sin(floor(along / 3.0) * 12.9898) * 43758.5453);
}
vec3 frostOver(vec3 c, vec2 p, vec2 size, float frost, float bayer) {
  float dx = min(p.x, size.x - 1.0 - p.x);
  float dy = min(p.y, size.y - 1.0 - p.y);
  float share = dx < dy ? frostShare(dx / frostFinger(p.y), frost) : frostShare(dy / frostFinger(p.x), frost);
  return share > bayer ? mix(c, FROST_COLOR, DH_FROST_MIX) : c;
}
