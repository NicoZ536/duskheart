// Seeds of the jump flood (M5-01): a texel's nearest seed as 16-bit texel coordinates in an RGBA8 texel (x high,
// x low, y high, y low) – exact on every device, no float render target needed. 0xFFFF in both is "no seed".

const float JFA_NONE = 65535.0;

vec4 jfaEncode(vec2 seed) {
  vec2 hi = floor(seed / 256.0);
  vec2 lo = seed - hi * 256.0;
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

vec4 jfaNone() {
  return vec4(1.0);
}

// Seed texel coordinates, or (−1, −1) for none.
vec2 jfaDecode(vec4 e) {
  vec4 b = floor(e * 255.0 + 0.5);
  vec2 s = vec2(b.x * 256.0 + b.y, b.z * 256.0 + b.w);
  return s.x >= JFA_NONE ? vec2(-1.0) : s;
}
