// Occluder ring (M5 review M2, `OCCLUDER_RING` in src/render/light/params.ts): the scene's walls, closed doors and gates,
// raised terrain and roofs (terrain and build grid; decor left out) beyond the flood frame of sdf.glsl – which must be
// included first –, in the mask's layout at DH_RING_TEXEL px per texel. Texel (0, 0) is the bottom-left like the mask's.
// The ring reaches OCCLUDER_RING.reachPx beyond the view on every side and the G-buffer's height range further south.

uniform sampler2D uRing;
uniform vec4 uRingFrame;   // world px of the ring's top-left corner (xy), its size in texels (zw)
uniform int uHasRing;      // 1 when the occluder pass drew the ring this frame

// Ring texel under world point `world` (may lie outside: see ringInside).
ivec2 ringTexel(vec2 world) {
  vec2 q = (world - uRingFrame.xy) / DH_RING_TEXEL;
  return ivec2(floor(q.x), floor(uRingFrame.w - q.y));
}

bool ringInside(ivec2 t) {
  return uHasRing == 1 && t.x >= 0 && t.y >= 0 && float(t.x) < uRingFrame.z && float(t.y) < uRingFrame.w;
}

// Whether the occluders at world point `world` are known: the flood frame's mask, or the ring beyond it.
bool occluderKnown(vec2 world) {
  return sdfInside(sdfTexel(world)) || ringInside(ringTexel(world));
}

// What occludes at world point `world` (sdfOccluder's layout: x = decor top – inside the flood frame only –, y =
// structural 0/1, z = terrain top, w = ground height [px]): the mask where the flood frame reaches, the ring beyond it,
// nothing beyond both.
vec4 occluderAt(sampler2D mask, vec2 world) {
  ivec2 t = sdfTexel(world);
  if (sdfInside(t)) return sdfOccluder(mask, t);
  ivec2 r = ringTexel(world);
  if (!ringInside(r)) return vec4(0.0);
  vec4 m = texelFetch(uRing, r, 0);
  return vec4(0.0, step(0.5, m.g), m.b * DH_GBUFFER_HEIGHT_RANGE, m.a * DH_GBUFFER_HEIGHT_RANGE);
}

// Whether a roof of the build grid covers world point `world` (sdfRoofed, with the ring beyond the flood frame).
bool roofedAt(sampler2D mask, vec2 world) {
  ivec2 t = sdfTexel(world);
  if (sdfInside(t)) return texelFetch(mask, t, 0).g > 0.5 * DH_ROOF_MARK;
  ivec2 r = ringTexel(world);
  return ringInside(r) && texelFetch(uRing, r, 0).g > 0.5 * DH_ROOF_MARK;
}

// Ground point of a pixel at `screen` with G-buffer height `z` (sdfGroundPoint, with the ring's ground heights beyond
// the flood frame: the tall pixels at the bottom of the view stand on ground below it).
vec2 groundPointAt(sampler2D mask, vec2 screen, float z) {
  vec2 g = vec2(screen.x, screen.y + max(0.0, z - occluderAt(mask, screen).w));
  g.y = screen.y + max(0.0, z - occluderAt(mask, g).w);
  return vec2(screen.x, screen.y + max(0.0, z - occluderAt(mask, g).w));
}
