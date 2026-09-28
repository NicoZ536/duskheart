// Distortion field (MASTERPROMPT §6.1 pass 9 "Verzerrungspuffer (Schockwellen, Hitze, Unterwasser)",
// M5-13). Constants: src/render/passes/distortionPass.ts; profile mirrored in src/render/post/distortion.ts.
//
// The field stores the sampling offset of every pixel [world px, y south], split into signed halves so
// that overlapping sources add up with plain additive blending in RGBA8: r = +x, g = −x, b = +y, a = −y,
// each / DH_DISTORTION_RANGE.

vec4 encodeOffset(vec2 o) {
  vec2 n = clamp(o / DH_DISTORTION_RANGE, -1.0, 1.0);
  return vec4(max(n.x, 0.0), max(-n.x, 0.0), max(n.y, 0.0), max(-n.y, 0.0));
}

vec2 decodeOffset(vec4 e) {
  return vec2(e.r - e.g, e.b - e.a) * DH_DISTORTION_RANGE;
}

// Radial sampling offset of a shock wave ring at u = (distance − radius) / width (src/render/post/distortion.ts).
float shockwaveProfile(float u) {
  if (abs(u) >= 1.0) return 0.0;
  return -sin(3.14159265 * u) * (1.0 - u * u);
}

// Heat haze: rows sway sideways in a pattern that rises with time (−1…1). The phase noise is stretched
// along the rows (DH_HEAT_ROW_STRETCH): a row moves as one band, so the sway bends the picture without
// crumpling it (a sway that changed quickly along x would gather and spread light – ripples, noise).
float heatSway(sampler2D noise, vec2 world, float time) {
  vec2 q = vec2(world.x / DH_HEAT_ROW_STRETCH, world.y + time * DH_HEAT_RISE);
  float n = texture(noise, q / DH_HEAT_TILE).b;
  return sin(world.y * DH_HEAT_ROWS + time * DH_HEAT_SPEED + n * 6.2831853);
}

// Brightness of a pixel whose offset field diverges by `divergence` [px/px]: reading a wider stretch of the
// picture gathers its light, reading a narrower one (magnified) spreads it; the gentle bends of heat and
// water (below DH_CAUSTIC_DEAD) leave it alone. Mirrors distortionPass.ts `distortionShade`.
float distortionShade(float divergence) {
  float d = sign(divergence) * max(abs(divergence) - DH_CAUSTIC_DEAD, 0.0);
  return clamp(1.0 + DH_CAUSTIC_GAIN * d, DH_CAUSTIC_MIN, DH_CAUSTIC_MAX);
}
