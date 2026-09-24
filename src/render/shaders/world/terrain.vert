#version 300 es
precision highp float;
precision highp int;
// Static terrain mesh of one world chunk (M2-28; layout: src/render/world/terrainMesh.ts): one
// instance per 16×16 frame on whole target pixels, drawn into the G-buffer before the sprites.
// Instances of one tile are consecutive, so ground, overlays and cliff pieces stack in order.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in uvec4 aTile;    // tile x, y in the chunk, palette row, flags
layout(location = 2) in uvec2 aRect;    // atlas x, y of the frame
layout(location = 3) in uvec4 aShade;   // level + kind, AO edges, water corners, wall row
layout(location = 4) in uvec4 aBlend;   // neighbouring biome row, neighbours carrying it

uniform vec2 uChunkOffset;   // chunk's top-left world px minus the target origin (whole pixels)
uniform vec2 uTargetSize;    // target size in px

out vec2 vLocal;             // tile px (0…16), y down
flat out uvec2 vRect;
flat out uint vRow;
flat out uint vFlags;
flat out uvec4 vShade;
flat out uvec2 vBlend;

void main() {
  vec2 local = aCorner * DH_TILE_SIZE;
  vec2 target = uChunkOffset + vec2(aTile.xy) * DH_TILE_SIZE + local;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vRow = aTile.z;
  vFlags = aTile.w;
  vShade = aShade;
  vBlend = aBlend.xy;
}
