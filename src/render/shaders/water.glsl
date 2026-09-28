// Water strand (M5-07 … M5-09): shared helpers of the wave simulation and the water surface. Numbers come from
// src/render/water/params.ts as #defines; the scalar functions mirror src/render/water/waves.ts line by line
// (tests/unit/render/wellen-gleichung.test.ts evaluates them against it).
//
// Wave field (RGBA8, two textures ping-pong): rg = height, ba = previous height, each 16-bit fixed point over
// ±DH_WAVE_RANGE. Texel (i, j) lies at world px (origin.x + (i + 0.5) · DH_WAVE_TEXEL, origin.y + (rows − j − 0.5) ·
// DH_WAVE_TEXEL): row 0 is the southern row, like every render target of the pipeline.

// One step of the discrete wave equation at one texel (waves.ts waveStep): `edges` = sum of the four side neighbours,
// `corners` = sum of the four diagonal ones – the isotropic nine-point Laplacian (rings stay round).
float waveStep(float h, float prev, float edges, float corners, float damping) {
  return (2.0 * h - prev + (DH_WAVE_SPEED2 * (4.0 * edges + corners - 20.0 * h)) / 6.0) * damping;
}

// Shape of an impulse: 1 at its centre, 0 with zero slope at `radius` – at least DH_IMPULSE_MIN_RADIUS texels, so no kick
// excites the grid's own checkerboard (waves.ts impulseProfile).
float impulseProfile(float d, float radius) {
  float x = d / max(radius, DH_IMPULSE_MIN_RADIUS);
  if (x >= 1.0) return 0.0;
  float k = 1.0 - x * x;
  return k * k;
}

// A height as two bytes of a 16-bit fixed-point value (waves.ts packHeight).
vec2 packHeight(float v) {
  float t = clamp(v / DH_WAVE_RANGE * 0.5 + 0.5, 0.0, 1.0);
  float u = floor(t * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}

// The height of two packed bytes (waves.ts unpackHeight).
float unpackHeight(vec2 e) {
  vec2 b = floor(e * 255.0 + 0.5);
  return ((b.x * 256.0 + b.y) / 65535.0 - 0.5) * 2.0 * DH_WAVE_RANGE;
}

// Integer hash of a world cell (stable for negative coordinates, the same on every GPU).
uint waterHashU(ivec2 c, uint salt) {
  uvec2 q = uvec2(c) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y ^ (salt * 2654435761u)) * 1597334673u;
  return n ^ (n >> 16u);
}

// Hash of a world cell as 0…1.
float waterHash(ivec2 c, uint salt) {
  return float(waterHashU(c, salt) & 0xFFFFFFu) / 16777215.0;
}

// Tile grid of the water (src/render/water/state.ts WATER_TILE): r = depth class (0 none, 1 shallow, 2 deep),
// g = flags, b = distance from the tile centre to the nearest land tile [px], a = level. uTileFrame: grid's north-west tile (xy), size in tiles (zw).
// A shader that packs its frame values into a vec4 array defines uTileFrame / uTilesKnown as macros before the include.
uniform sampler2D uTiles;
#ifndef uTileFrame
uniform vec4 uTileFrame;
#endif
#ifndef uTilesKnown
uniform int uTilesKnown;
#endif

const float WATER_FLAG_FROZEN = 1.0;
const float WATER_FLAG_ICE_GROUND = 16.0;

// The grid's texel of world point `world`, or (−1, −1) outside it.
ivec2 waterTileTexel(vec2 world) {
  vec2 t = floor(world / DH_WATER_TILE_PX) - uTileFrame.xy;
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uTileFrame.z || t.y >= uTileFrame.w) return ivec2(-1);
  return ivec2(int(t.x), int(uTileFrame.w - 1.0 - t.y));
}

// The tile under world point `world` as bytes (depth, flags, shore, level); all 0 outside the grid.
vec4 waterTile(vec2 world) {
  ivec2 t = waterTileTexel(world);
  if (t.x < 0) return vec4(0.0);
  return floor(texelFetch(uTiles, t, 0) * 255.0 + 0.5);
}

bool waterTileFlag(vec4 tile, float flag) {
  return mod(floor(tile.g / flag), 2.0) > 0.5;
}

// Whether the wave field may move at world point `world`: open water (or no grid: the G-buffer decides later).
bool waterOpenAt(vec2 world) {
  if (uTilesKnown == 0) return true;
  vec4 tile = waterTile(world);
  return tile.r > 0.5 && !waterTileFlag(tile, WATER_FLAG_FROZEN);
}
