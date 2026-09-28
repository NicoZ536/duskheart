// Occluder mask and distance fields of the occluder pass (src/render/passes/occluderPass.ts, M5-01). The targets
// cover the frame plus DH_SDF_MARGIN px on every side; texel (0, 0) is the bottom-left (GL), the world's north is
// up. Needs hdr.glsl (scalar encoding of the R16F fields and their RG8 fallback).
//   mask (RGBA8):   r = top of decor occluders / DH_GBUFFER_HEIGHT_RANGE, g = structural (1; DH_ROOF_MARK under a
//                   roof of the build grid, DH_OPENING_MARK in a wall's opening), b = terrain top /
//                   DH_GBUFFER_HEIGHT_RANGE (raised levels, cliff faces), a = height of the ground / range (the
//                   level a pixel there stands on: the world is drawn without shifting raised levels up, so a
//                   pixel's ground point is its screen point moved south by its height above that ground)
//   sdf (R16F):     distance to the nearest occluder seed [px], capped at DH_SDF_MAX_DISTANCE
//   info (RGBA8):   the mask at that seed (what the nearest occluder is)
//   water (R16F):   distance of a water pixel to the nearest shore pixel [px] (0 on land), capped likewise

uniform vec4 uSdfFrame;   // world px of the targets' top-left corner (xy), their size in px (zw)

// Texel of the targets under world point `world` (may lie outside: see sdfInside).
ivec2 sdfTexel(vec2 world) {
  vec2 q = world - uSdfFrame.xy;
  return ivec2(floor(q.x), floor(uSdfFrame.w - q.y));
}

// World point [px] of the centre of texel `t`.
vec2 sdfWorld(ivec2 t) {
  return uSdfFrame.xy + vec2(float(t.x) + 0.5, uSdfFrame.w - float(t.y) - 0.5);
}

bool sdfInside(ivec2 t) {
  return t.x >= 0 && t.y >= 0 && float(t.x) < uSdfFrame.z && float(t.y) < uSdfFrame.w;
}

// Distance field sample [px] (DH_SDF_MAX_DISTANCE outside the targets: open ground).
float sdfDistance(sampler2D field, ivec2 t) {
  if (!sdfInside(t)) return DH_SDF_MAX_DISTANCE;
  return decodeScalar(texelFetch(field, t, 0), DH_SDF_MAX_DISTANCE);
}

// What occludes at a mask or info texel: x = decor top [px], y = structural (0/1), z = terrain top [px],
// w = ground height [px].
vec4 sdfOccluder(sampler2D maskOrInfo, ivec2 t) {
  if (!sdfInside(t)) return vec4(0.0);
  vec4 m = texelFetch(maskOrInfo, t, 0);
  return vec4(m.r * DH_GBUFFER_HEIGHT_RANGE, step(0.5, m.g), m.b * DH_GBUFFER_HEIGHT_RANGE, m.a * DH_GBUFFER_HEIGHT_RANGE);
}

// Whether a roof of the build grid covers world point `world` (the mask's structural channel at DH_ROOF_MARK or above).
bool sdfRoofed(sampler2D mask, vec2 world) {
  ivec2 t = sdfTexel(world);
  if (!sdfInside(t)) return false;
  return texelFetch(mask, t, 0).g > 0.5 * DH_ROOF_MARK;
}

// Whether texel `t` of the mask lies in an opening of a wall (a window, an open door or gate).
bool sdfOpening(sampler2D mask, ivec2 t) {
  if (!sdfInside(t)) return false;
  float g = texelFetch(mask, t, 0).g;
  return g > 0.5 * (DH_ROOF_MARK + DH_OPENING_MARK) && g < 0.5;
}

// Whether an occluder stands at a mask texel (decoded by sdfOccluder).
bool sdfOccupied(vec4 occ) {
  return occ.y > 0.5 || occ.x > occ.z + DH_SDF_SEED_EPSILON || occ.z > occ.w + DH_SDF_SEED_EPSILON;
}

// Height of the ground at world point `world` [px above level 0].
float sdfGroundHeight(sampler2D mask, vec2 world) {
  return sdfOccluder(mask, sdfTexel(world)).w;
}

// Ground point [world px] of a pixel at `screen` (world px of its centre) with G-buffer height `z`: the screen point
// moved south by the pixel's height above the ground it stands on – which lies at that ground point (two steps of
// the fixed point; a pixel of flat ground stays where it is).
vec2 sdfGroundPoint(sampler2D mask, vec2 screen, float z) {
  vec2 g = vec2(screen.x, screen.y + max(0.0, z - sdfGroundHeight(mask, screen)));
  g.y = screen.y + max(0.0, z - sdfGroundHeight(mask, g));
  return vec2(screen.x, screen.y + max(0.0, z - sdfGroundHeight(mask, g)));
}
