// Sun and moon light at a pixel (M5-02 … M5-04): the silhouette shadow target of the shadow pass (placement: its own
// frame `uShadowFrame`; sdf.glsl must be included first, with shadow_noise.glsl), wind-driven cloud shadows and the occluders' ambient
// occlusion. Shared by the composition and the render debugger's `sun` view.

uniform vec3 uShadowVec;     // where shadows fall (unit x, y; +y south) and their length per unit height
uniform vec4 uClouds;        // cover 0…1, field offset x, y [world px, within half the field's period of 0], 0

// Value noise whose lattice repeats every `period` cells (shadow_noise.glsl `valueNoise` on a wrapped lattice): the
// cloud field's offset wraps modulo its period without a seam (world/drift.ts). The lattice is wrapped in integers (a
// float `mod` may round a multiple of the period to the period itself); lattice indices are never below −period (the
// offset lies within half a period of 0, the world starts at 0), so `c + period` keeps `%` on non-negative numbers.
float cloudNoise(vec2 p, int period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 a = (ivec2(i) + period) % period;
  ivec2 b = (a + 1) % period;
  return mix(mix(lightHash(vec2(a)), lightHash(vec2(b.x, a.y)), f.x), mix(lightHash(vec2(a.x, b.y)), lightHash(vec2(b)), f.x), f.y);
}

// Share of the sun a cloud leaves at world point `world` (1 = clear sky). The field drifts with the wind (uClouds.yz).
float cloudShade(vec2 world) {
  float cover = uClouds.x;
  if (cover <= 0.0) return 1.0;
  vec2 p = (world + uClouds.yz) / DH_CLOUD_SCALE;
  float n = 0.55 * cloudNoise(p, DH_CLOUD_PERIOD_0) + 0.3 * cloudNoise(p * DH_CLOUD_OCTAVE_1 + vec2(17.1, 5.3), DH_CLOUD_PERIOD_1) + 0.15 * cloudNoise(p * DH_CLOUD_OCTAVE_2 + vec2(3.7, 11.9), DH_CLOUD_PERIOD_2);
  float threshold = mix(DH_CLOUD_T_CLEAR, DH_CLOUD_T_CLOSED, cover);
  return 1.0 - DH_CLOUD_DENSITY * smoothstep(threshold - DH_CLOUD_EDGE, threshold + DH_CLOUD_EDGE, n);
}

uniform vec4 uShadowFrame;   // world px of the silhouette target's top-left corner, its size (light/shadowFrame.ts)

// Texel of the silhouette target under world point `world` (the target reaches beyond the flood frame on the side the
// shadows fall to, M5 review Minor 1), and whether it lies in the target.
ivec2 shadowTexel(vec2 world) {
  vec2 q = world - uShadowFrame.xy;
  return ivec2(floor(q.x), floor(uShadowFrame.w - q.y));
}

bool shadowInside(ivec2 t) {
  return t.x >= 0 && t.y >= 0 && float(t.x) < uShadowFrame.z && float(t.y) < uShadowFrame.w;
}

// One tap of the silhouette target: the light it lets through to a receiver at height `z` (1 = unshadowed); casters up
// to `tolerance` px above the receiver do not count.
vec3 sunTap(sampler2D map, vec2 world, float z, float tolerance) {
  ivec2 t = shadowTexel(world);
  if (!shadowInside(t)) return vec3(1.0);
  vec4 s = texelFetch(map, t, 0);
  return s.a * DH_GBUFFER_HEIGHT_RANGE > z + tolerance ? s.rgb : vec3(1.0);
}

// Height tolerance of a receiver against the stored caster heights: DH_SUN_HEIGHT_EPSILON (8-bit rounding), for crowns
// and roofs (material canopy) the roof slab's thickness – they lie on top of their own volume (the build grid's roof
// slab under a roof tile's pixels, the crown's own mass), which must not shade them.
float sunTolerance(vec4 g1) {
  return gbufferHasMaterial(g1, DH_MAT_CANOPY) ? DH_ROOF_SLAB : DH_SUN_HEIGHT_EPSILON;
}

// Light of the sun or moon reaching a receiver at ground point `ground`, height `z` (both absolute): the caster
// silhouettes are stored where they project onto the ground plane, so the receiver looks where its own point would
// project and compares heights. The penumbra widens with the height of the caster above the receiver.
vec3 sunVisibility(sampler2D map, vec2 ground, float z, float tolerance) {
  vec2 at = ground + uShadowVec.xy * (uShadowVec.z * z);
  ivec2 t = shadowTexel(at);
  if (!shadowInside(t)) return vec3(1.0);
  vec4 centre = texelFetch(map, t, 0);
  float above = centre.a * DH_GBUFFER_HEIGHT_RANGE - z;
  float r = clamp(above / 16.0 * DH_SUN_PENUMBRA_PER16, 1.0, DH_SUN_MAX_PENUMBRA);
  vec3 sum = sunTap(map, at, z, tolerance) * 2.0;
  sum += sunTap(map, at + vec2(r, 0.0), z, tolerance);
  sum += sunTap(map, at - vec2(r, 0.0), z, tolerance);
  sum += sunTap(map, at + vec2(0.0, r), z, tolerance);
  sum += sunTap(map, at - vec2(0.0, r), z, tolerance);
  return sum / 6.0;
}

// Ambient occlusion of a receiver at ground point `ground`, height `z` by the nearest occluder of the distance field
// (sdf.glsl): full at an occluder's foot, gone at DH_AO_RADIUS px and DH_AO_REACH_HEIGHT px above the ground.
float sdfOcclusion(sampler2D distanceField, sampler2D info, sampler2D mask, vec2 ground, float z) {
  ivec2 t = sdfTexel(ground);
  if (!sdfInside(t)) return 1.0;
  float d = decodeScalar(texelFetch(distanceField, t, 0), DH_SDF_MAX_DISTANCE);
  if (d >= DH_AO_RADIUS) return 1.0;
  vec4 occ = sdfOccluder(info, t);
  float top = occ.y > 0.5 ? DH_STRUCTURAL_TOP : max(occ.x, occ.z);
  float groundHere = sdfOccluder(mask, t).w;
  if (top <= z + 1.0) return 1.0;
  float above = max(0.0, z - groundHere);
  float near = 1.0 - smoothstep(0.0, DH_AO_RADIUS, d);
  return 1.0 - DH_AO_STRENGTH * near * (1.0 - smoothstep(0.0, DH_AO_REACH_HEIGHT, above));
}
