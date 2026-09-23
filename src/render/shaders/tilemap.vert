#version 300 es
precision highp float;
precision highp int;
// Static ground mesh of one chunk (MASTERPROMPT §6.1 passes 1–2): one instance per tile (layout:
// src/render/tilemap/chunkMesh.ts), 16×16 quads on whole target pixels, drawn into the G-buffer
// before the sprites. Neighbouring chunks meet exactly: every corner is an integer pixel position.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in uvec4 aTile;    // tile x, y in the chunk, palette row, flags
layout(location = 2) in uvec2 aRect;    // atlas x, y of the tile frame

uniform vec2 uChunkOffset;   // chunk's top-left world px minus the target origin (whole pixels)
uniform vec2 uTargetSize;    // target size in px

out vec2 vLocal;             // frame px
flat out uvec2 vRect;
flat out uint vRow;
flat out uint vFlags;

void main() {
  vec2 local = aCorner * DH_TILE_SIZE;
  vec2 target = uChunkOffset + vec2(aTile.xy) * DH_TILE_SIZE + local;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vRow = aTile.z;
  vFlags = aTile.w;
}
