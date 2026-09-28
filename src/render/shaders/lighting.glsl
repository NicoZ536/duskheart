// Light model of the lighting pass (src/render/light/falloff.ts). `lightFalloff` and `lightCone`
// mirror the canonical model src/engine/lightFalloff.ts statement by statement – the gameplay light
// map evaluates the same formulas (tests/unit/render/falloff.test.ts runs this source against it).

// Soft distance falloff (1 − x²)² / (1 + core · x²), x = d / r: 1 at the light, 0 at the radius with
// zero slope, a hot core and a long soft tail.
float lightFalloff(float distance, float radius) {
  if (!(radius > 0.0)) return 0.0;
  float x = distance / radius;
  float w = max(0.0, 1.0 - x * x);
  return (w * w) / (1.0 + DH_LIGHT_FALLOFF_CORE * x * x);
}

// Soft cone edge from the cosine between cone axis and the direction light → pixel.
float lightCone(float cosAngle, float cosOuter, float cosInner) {
  return smoothstep(cosOuter, cosInner, cosAngle);
}

// Normal mapping relative to a flat surface: a flat pixel (n = +z) gets exactly the falloff, pixels
// turned towards the light brighten, those turned away darken. n and l are unit vectors in screen
// space (+x right, +y up, +z towards the viewer).
float lightShade(vec3 n, vec3 l) {
  return max(0.0, 1.0 + DH_LIGHT_RELIEF * (dot(n, l) - l.z));
}

// Blinn-Phong glint of glossy pixels (metal, ice, wet) for a viewer straight in front of the screen.
float lightSpecular(vec3 n, vec3 l, float gloss) {
  if (gloss <= 0.0) return 0.0;
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  return gloss * DH_LIGHT_SPECULAR * pow(max(dot(n, h), 0.0), DH_LIGHT_SHININESS);
}

// Light target encoding with a fourth channel (the lightmap comparison's bookkeeping, M5-28): the light's colour
// like encodeHdr, the alpha on the same scale.
vec4 encodeLight(vec3 c, float a) {
#if DH_FLOAT_TARGETS
  return vec4(c, a);
#else
  return clamp(vec4(c, a) / DH_HDR_FALLBACK_RANGE, 0.0, 1.0);
#endif
}

float decodeLightAlpha(vec4 e) {
#if DH_FLOAT_TARGETS
  return e.a;
#else
  return e.a * DH_HDR_FALLBACK_RANGE;
#endif
}

// Near field of a flame (M5-31): what stands right under the light – a torch's staff, a lamp's post, the stones at
// its foot – is lit from above only, so it keeps a share of the light. The near field is a narrow cone under the
// flame: its radius grows with the drop from the flame (`drop` px), so a figure beside a carried torch stays lit.
// `upright` = the pixel stands above its ground (a sprite).
float flameNearField(float horizontal, bool upright, float drop) {
  if (!upright || drop <= 0.0) return 1.0;
  float radius = DH_FLAME_NEAR_RADIUS + drop * DH_FLAME_NEAR_SPREAD;
  return mix(DH_FLAME_NEAR_FLOOR, 1.0, smoothstep(0.5 * radius, radius, horizontal));
}

// Housing of a light (M5-35): whether a receiver belongs to the body a light burns in – a kiln's chamber, a furnace's
// shaft, a lamp's case. The light's ground point `to` lies in a decor footprint of the occluder mask (the vertex stage
// found it: `housed`), and the receiver – a pixel of an occluder standing above its ground – stands on that footprint:
// the part of its column between where it is drawn (`screen`) and its ground point (`ground`, DH_HOUSING_GRACE px
// further for relief; without end for a pixel at the atlas's height cap `capped`, whose true height is unknown) that
// comes nearest the light's row is joined to the light by footprint texels (only the last DH_HOUSING_GRACE px may
// lie outside). Such a body is lit through its openings only.
bool lightHousing(sampler2D mask, vec2 screen, vec2 ground, bool capped, vec2 to) {
  float south = capped ? max(to.y, screen.y) : ground.y + DH_HOUSING_GRACE;
  vec2 p = vec2(screen.x, clamp(to.y, screen.y, south));
  vec2 span = p - to;
  float len = length(span);
  if (len > float(DH_HOUSING_SPAN)) return false;
  vec2 dir = len > 0.0 ? span / len : vec2(0.0);
  for (int i = 0; i <= DH_HOUSING_SPAN; i++) {
    float t = float(i);
    if (t > len) break;
    vec4 m = sdfOccluder(mask, sdfTexel(to + dir * t));
    if (!(m.x > m.z + DH_SDF_SEED_EPSILON)) return i > 0 && len - t <= DH_HOUSING_GRACE;
  }
  return true;
}

// Share of a light that reaches a receiver past the occluders (M5-05, §6.1 pass 5 "weiche SDF-Schatten"): a march
// through the occluder distance field (sdf.glsl) from the receiver's ground point `from` (height `zFrom`) to the
// light's ground point `to` (height `zTo`, standing on terrain of height `base`). Walls, closed doors and solid rock
// block every ray; a raised level blocks a light standing lower (the gameplay light map's rule, §12.1); decor
// blocks a ray below its top (only with `decorShadows`: the quality levels "Mittel" and up – walls and cliffs block at
// every level, like the gameplay light map). Penumbra min(k · d / t) when `soft`. A pixel of an occluder (`own`: the G-buffer's
// occluder bit) stands on its footprint or – pushed south by its relief – in front of it: it first leaves that
// footprint, met within DH_PS_OWN_GRACE px, and counts its penumbra from where it left, so a table or a rock is lit
// on its top and on the faces towards the light. A wall met on the way stops the light (the room's light does not
// reach the outer face of its front wall), unless the pixel stands in that wall (`ownWall`). The light's own housing
// (decor of top `housingTop` around a light burning inside a body; −1: none) lets it through: the fire shines out of
// its openings all round, and the body is lit dimly instead (`lightHousing`). A pixel of a cliff face
// (its ground point in a raised level whose top is above the pixel) faces out of that level: it leaves the level the
// same way before the level counts.
// Returns (visibility, visibility behind the structural occluders alone – traced past decor only with `bookkeeping`, the
// light map comparison's frames, M5-28; otherwise the march ends at the first decor that stops the light).
vec2 lightShadow(sampler2D distanceField, sampler2D info, sampler2D mask, vec2 from, float zFrom, bool own, bool ownWall, vec2 to, float zTo, float base, float housingTop, bool soft, bool decorShadows, bool bookkeeping) {
  vec2 span = to - from;
  float len = length(span);
  float end = len - DH_PS_CLEARANCE;
  if (end <= DH_PS_START) return vec2(1.0);
  vec2 dir = span / len;
  float res = 1.0;
  float resStructural = 1.0;
  float t = DH_PS_START;
  vec4 start = sdfOccluder(mask, sdfTexel(from));
  bool face = start.z > zFrom + DH_PS_HEIGHT_EPSILON && start.z > start.w + DH_SDF_SEED_EPSILON;
  bool inside = own || face;
  float origin = 0.0;
  for (int i = 0; i < DH_PS_MAX_STEPS; i++) {
    if (t >= end) break;
    ivec2 q = sdfTexel(from + dir * t);
    if (!sdfInside(q)) break;
    if (inside) {
      // In (or within DH_PS_OWN_GRACE px of) the own footprint: step on until the mask is free of decor. A wall met
      // on the way stops the light – unless the pixel stands in that wall itself (a north–south wall's own pixels).
      vec4 m = sdfOccluder(mask, q);
      if (m.y > 0.5 && !ownWall) {
        res = 0.0;
        resStructural = 0.0;
        break;
      }
      bool inOwn = own && (m.y > 0.5 || m.x > m.z + DH_SDF_SEED_EPSILON);
      bool inFace = face && m.z > zFrom + DH_PS_HEIGHT_EPSILON;
      if (inOwn || inFace || t < DH_PS_OWN_GRACE) {
        t += DH_PS_MIN_STEP;
        continue;
      }
      inside = false;
      origin = t;
    }
    float d = decodeScalar(texelFetch(distanceField, q, 0), DH_SDF_MAX_DISTANCE);
    vec4 occ = sdfOccluder(info, q);
    float rayHeight = mix(zFrom, zTo, t / len);
    bool structural = occ.y > 0.5 || occ.z > base + DH_PS_HEIGHT_EPSILON;
    bool decor = decorShadows && occ.x > occ.z + DH_SDF_SEED_EPSILON && occ.x > rayHeight + DH_PS_HEIGHT_EPSILON && abs(occ.x - housingTop) > DH_HOUSING_SAME_TOP;
    if (structural || decor) {
      if (d < 0.5) {
        res = 0.0;
        if (structural || !bookkeeping) {
          if (structural) resStructural = 0.0;
          break;
        }
        // Decor stops the light here; the walls and cliffs further on still decide what the gameplay light map
        // sees (the comparison adds the light decor took back, M5-28).
        t += DH_PS_MIN_STEP;
        continue;
      }
      float penumbra = soft ? clamp(DH_PS_SOFTNESS * d / max(t - origin, DH_PS_MIN_STEP), 0.0, 1.0) : 1.0;
      res = min(res, penumbra);
      if (structural) resStructural = min(resStructural, penumbra);
    }
    t += max(d, DH_PS_MIN_STEP);
  }
  return vec2(smoothstep(0.0, 1.0, res), smoothstep(0.0, 1.0, resStructural));
}

// Whether the ray from a receiver's ground point `from` to the light's `to` passes an opening of a wall (a window, an
// open door): the gameplay map walks whole tiles through it, the renderer the pixel's ray – light through it is not
// comparable (M5-28).
bool throughOpening(sampler2D mask, vec2 from, vec2 to) {
  vec2 span = to - from;
  float len = length(span);
  vec2 dir = len > 0.0 ? span / len : vec2(0.0);
  for (float t = 0.0; t <= len; t += DH_LM_OPENING_STEP) {
    if (sdfOpening(mask, sdfTexel(from + dir * t))) return true;
  }
  return false;
}

// Whether a ground point stands within DH_LM_NEAR px of a wall, a closed door, solid rock or a raised level the light
// (standing on ground of height `base`) cannot see over – where the gameplay light map resolves occlusion per tile
// (bilinear between tile centres) and the renderer per pixel, so the two differ by construction (M5-28). The nearest
// occluder of the distance field may be decor in front of the wall (furniture along it): the mask is probed every
// DH_LM_PROBE px along eight directions as well (a wall band is thicker than the step).
bool nearStructural(sampler2D distanceField, sampler2D info, sampler2D mask, vec2 ground, float base) {
  ivec2 q = sdfTexel(ground);
  if (!sdfInside(q)) return false;
  vec4 occ = sdfOccluder(info, q);
  bool blocks = occ.y > 0.5 || occ.z > base + DH_PS_HEIGHT_EPSILON;
  if (blocks && decodeScalar(texelFetch(distanceField, q, 0), DH_SDF_MAX_DISTANCE) < DH_LM_NEAR) return true;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;  // k · π/4
    vec2 dir = vec2(cos(a), sin(a));
    for (float r = DH_LM_PROBE; r < DH_LM_NEAR + 0.5; r += DH_LM_PROBE) {
      vec4 m = sdfOccluder(mask, sdfTexel(ground + dir * r));
      if (m.y > 0.5 || m.z > base + DH_PS_HEIGHT_EPSILON) return true;
    }
  }
  return false;
}
