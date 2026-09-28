// GPU particles (M5-11, src/render/particles): the kind table and the hashes shared by the update and draw programs.
// Record layout (src/render/particles/layout.ts): pos = (x, y, height, age), vel = (vx, vy, vz up, life),
// meta = (kind, seed, phase, layer). Kind table rows (src/render/particles/kinds.ts):
//   0 shape, size min, size max, growth       1 line length per speed, line min, line max, emissive
//   2 colours 1–4 (palette indices)            3 colours used, opacity birth, opacity death, flicker
//   4 gravity, drag, wind share, swirl         5 swirl rate, ground contact, splash kind, –
//   6 life min, life max, –, –

uniform vec4 uKinds[DH_PARTICLE_KIND_VEC4S];

vec4 kindRow(int kind, int row) {
  return uKinds[kind * DH_PARTICLE_KIND_ROWS + row];
}

// PCG hash (one round): well mixed 32-bit output for sequential inputs.
uint particleHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float hashUnit(uint h) {
  return float(h >> 8u) / 16777216.0;
}

// Swirl of the air [px/s] at ground point p: two crossed waves drifting with time, phase from the particle's seed –
// smoke curls, snow sways, sparks wobble; smooth in space and time, no texture.
vec2 particleSwirl(vec2 p, float seed, float amplitude, float rate, float time) {
  if (amplitude <= 0.0) return vec2(0.0);
  float w = 6.2831853 * rate;
  return amplitude * vec2(sin(p.y * 0.047 + time * w + seed * 6.2831853), cos(p.x * 0.053 + time * w * 0.83 + seed * 10.9));
}

// Wraps a layer-space offset from the camera into the weather box (half width, top, bottom).
vec2 wrapWeather(vec2 q, vec3 box) {
  float w = 2.0 * box.x;
  float h = box.z - box.y;
  return vec2(q.x - w * floor((q.x + box.x) / w), q.y - h * floor((q.y - box.y) / h));
}
