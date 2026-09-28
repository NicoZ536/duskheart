// World surface (M5-17 … M5-20, src/render/surface/params.ts): world-anchored cluster noise, the rank of a palette
// index in its ramp, and the scalar rules of snow, wetness and puddles. Shared by the sprite and the terrain program;
// the scalar functions are mirrored by src/render/surface/rules.ts (tests/unit/render/schnee.test.ts
// evaluates them against it).

// Position of every palette index in its ramp, 0 (darkest) … 1 (lightest); index 1 at position 0.
const float DH_RANK[64] = float[64](DH_RAMP_RANKS);

float rampRank(int index) {
  return DH_RANK[clamp(index, 1, 64) - 1];
}

// Integer hash of a world cell (lowbias32), 0…1. Negative cells wrap like the TypeScript mirror (uint32).
float cellHash(ivec2 c, uint salt) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ salt * 0xcb1ab31fu;
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return float(h >> 8) / 16777216.0;
}

// Smooth value noise of wavelength `wave` px at world px `p`, 0…1.
float valueNoise(vec2 p, float wave, uint salt) {
  vec2 g = p / wave;
  vec2 i = floor(g);
  vec2 f = g - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = cellHash(c, salt);
  float b = cellHash(c + ivec2(1, 0), salt);
  float d = cellHash(c + ivec2(0, 1), salt);
  float e = cellHash(c + ivec2(1, 1), salt);
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

// Spread of the blended value noise around 0.5 (its distribution is close to a logistic one of this scale): the
// cluster noise is flattened with the logistic function, so a threshold t covers about the share t of the ground.
const float NOISE_SPREAD = 0.093;

// Cluster noise 0…1 at world px `p`: evaluated at the centre of its `cell`-px cell (clusters of cell × cell pixels,
// never single-pixel speckle), a broad field with a finer one on top, evened out to a near-uniform distribution.
float clusterNoise(vec2 p, float wave, float detail, float cell, uint salt) {
  vec2 q = (floor(p / cell) + 0.5) * cell;
  float n = 0.7 * valueNoise(q, wave, salt) + 0.3 * valueNoise(q, detail, salt + 7u);
  return 1.0 / (1.0 + exp(-(n - 0.5) / NOISE_SPREAD));
}

// Snow line: a place with noise `n` lies under snow at cover `cover` (0…1). The noisiest places get snow last; a full
// cover leaves nothing bare.
float snowLine(float cover, float n) {
  return cover >= 1.0 ? 1.0 : cover * 1.15 - 0.15 > n ? 1.0 : 0.0;
}

// Snow on a sprite pixel: `up` = how far it faces the sky (normal up, flat tops of roofs and crowns, top edges), `n` its
// cluster noise. Nothing below `DH_SNOW_SPRITE_FROM` cover; up-facing pixels first.
float spriteSnow(float cover, float up, float n) {
  float c = (cover - DH_SNOW_SPRITE_FROM) / (1.0 - DH_SNOW_SPRITE_FROM);
  return c > 0.0 && up > DH_SNOW_UP_FROM && c * (0.35 + up) > 0.3 + 0.55 * n ? 1.0 : 0.0;
}

// Puddle: a hollow with noise `n` holds water at fill `fill` (0…1), at most `DH_PUDDLE_COVER` of the ground.
float puddleAt(float fill, float n) {
  return fill > 0.0 && n < fill * DH_PUDDLE_COVER ? 1.0 : 0.0;
}

// Wet patch: with the ground's wetness `wet`, a place with noise `n` is darkened (wet ground darkens in patches, not
// in a dither over the whole picture).
float wetPatch(float wet, float n) {
  return wet >= 1.0 ? 1.0 : wet * 1.25 - 0.25 > n ? 1.0 : 0.0;
}
