// Value noise of the light strand (M5-03): cloud shadows and canopy flecks, anchored to the world.

float lightHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = lightHash(i);
  float b = lightHash(i + vec2(1.0, 0.0));
  float c = lightHash(i + vec2(0.0, 1.0));
  float d = lightHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
