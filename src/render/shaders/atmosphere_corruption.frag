#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
// Corruption (MASTERPROMPT §6.2 "Verderbnis: Paletten-Shift + animierte emissive Adern im Boden", M5-22;
// src/render/post/corruption.ts): inside the corrupted area – a world-anchored noise field above a
// threshold that falls with the region's strength, its edge dithered on the Bayer grid – every lit pixel
// is scaled by the ratio of its corrupted to its painted albedo (the palette row `verderbnis` via the
// 32³ lookup), and the isolines of a second noise field crack the flat ground – dark cracks around glowing
// cores, measured in pixels so they stay unbroken, a pulse running along them. The field is the sum of two lookups at
// incommensurate tiles (M5-55): no vein pattern repeats within sight. Light sources (emissive pixels) keep their colour: fire stays warm.
// Water keeps its own look (the water pass draws over it; a corrupted lake bed would read as a smudge).
// Veins lie only in the terrain itself: its open ground (G2.A `terrain`, written by world/terrain.frag – no sprite
// carries the bit, so figures, items, flat decor, crowns, trunks, walls and rocks never crack) where it lies flat.
// The patches are anchored to the ground under each pixel: a terrain pixel is its own ground point (raised levels are
// drawn where they lie), anything standing is moved south by its height above the ground it stands on (`groundPointAt`:
// the occluder mask in the flood frame, the occluder ring beyond it – the crowns at the bottom of the view stand on
// ground below it, M5-44) – a tree on a plateau shows the patch of the plateau it stands on.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "bayer.glsl"
#include "atmosphere.glsl"
#include "sdf.glsl"
#include "sdf_ring.glsl"

uniform sampler2D uScene;    // copy of the HDR target
uniform sampler2D uAlbedo;   // G0
uniform sampler2D uNormal;   // G1
uniform sampler2D uSurface;  // G2
uniform sampler2D uNoise;
uniform sampler2D uMask;     // occluder pass: mask (ground heights), read while uHasFields is 1
uniform int uHasFields;      // 1 = the occluder pass drew this frame's mask (and, with uHasRing, its ring)
uniform sampler3D uShift;    // palette shift, 32³, nearest
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform float uTime;
uniform float uStrength;
uniform float uPulse;        // pulse speed (0 with reduced motion: the veins glow steadily)

out vec4 oColor;

const vec3 VEIN_EDGE = vec3(148.0, 53.0, 168.0) / 255.0;   // verderb.3
const vec3 VEIN_CORE = vec3(201.0, 107.0, 214.0) / 255.0;  // verderb.4

// Mirror src/render/post/corruption.ts `corruptionThreshold`, `corruptionSpread`, `veinDistance`, `veinSwell`.
float corruptionThreshold(float strength) {
  float s = clamp(strength, 0.0, 1.0);
  return -DH_CORRUPTION_EDGE + (1.0 + 2.0 * DH_CORRUPTION_EDGE) * (1.0 - s);
}
float corruptionSpread(float n) {
  return clamp((n - 0.5) * DH_CORRUPTION_CONTRAST + 0.5, 0.0, 1.0);
}
float veinDistance(float n, float gradient) {
  return abs(n - 0.5) / max(gradient, DH_VEIN_MIN_GRADIENT);
}
float veinSwell(float b) {
  return mix(DH_VEIN_SWELL_MIN, DH_VEIN_SWELL_MAX, smoothstep(DH_VEIN_SWELL_FROM, DH_VEIN_SWELL_TO, b));
}

// The vein field's second lookup at ground point `g` (M5-55, `VEIN_FIELD`): the vein channel at an incommensurate tile,
// turned and shifted.
float veinSecond(vec2 g) {
  vec2 q = vec2(DH_VEIN_COS * g.x - DH_VEIN_SIN * g.y, DH_VEIN_SIN * g.x + DH_VEIN_COS * g.y) + vec2(DH_VEIN_OFFSET_X, DH_VEIN_OFFSET_Y);
  return noiseAt(uNoise, q, DH_VEIN_TILE2_PX).a;
}

// The vein field at ground point `g` (`veinField` in corruption.ts): the vein channel at the vein tile mixed with its
// second lookup – the sum of two smooth fields whose tiles meet nowhere within sight, so the veins do not repeat.
float veinField(vec2 g) {
  return mix(noiseAt(uNoise, g, DH_VEIN_TILE_PX).a, veinSecond(g), DH_VEIN_WEIGHT);
}

// Distance [px] of ground point `g` to the nearest vein: the vein field's value (`first`: its vein-tile channel there,
// fetched by the caller) and its central-difference gradient.
float veinDistanceAt(vec2 g, float first) {
  float n = mix(first, veinSecond(g), DH_VEIN_WEIGHT);
  float dx = veinField(g + vec2(DH_VEIN_STEP, 0.0)) - veinField(g - vec2(DH_VEIN_STEP, 0.0));
  float dy = veinField(g + vec2(0.0, DH_VEIN_STEP)) - veinField(g - vec2(0.0, DH_VEIN_STEP));
  return veinDistance(n, length(vec2(dx, dy)) / (2.0 * DH_VEIN_STEP));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = decodeHdr(texelFetch(uScene, p, 0));
  vec4 a = texelFetch(uAlbedo, p, 0);
  if (a.a < 0.5) {
    oColor = encodeHdr(c);
    return;
  }
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize);
  vec4 g1 = texelFetch(uNormal, p, 0);
  vec4 g2 = texelFetch(uSurface, p, 0);
  if (gbufferHasMask(g2, DH_MASK_WATER)) {
    oColor = encodeHdr(c);
    return;
  }
  float h = gbufferHeight(g1);
  bool terrain = gbufferHasMask(g2, DH_MASK_TERRAIN);
  // Without the occluder pass a standing pixel's ground is taken at level 0 (its height counted from there).
  vec2 ground = terrain ? world : uHasFields == 1 ? groundPointAt(uMask, world, h) : world + vec2(0.0, h);
  float strength = clamp(uStrength, 0.0, 1.0);
  float spread = corruptionSpread(noiseAt(uNoise, ground, DH_CORRUPTION_PATCH_PX).r);
  float threshold = corruptionThreshold(strength);
  if (spread <= threshold + (bayer4(world) - 0.5) * DH_CORRUPTION_EDGE) {
    oColor = encodeHdr(c);
    return;
  }
  if (gbufferEmissive(g2) <= 0.0) {
    ivec3 key = ivec3(floor(a.rgb * 255.0 + 0.5)) >> DH_CORRUPTION_KEY_SHIFT;
    vec3 shifted = texelFetch(uShift, key, 0).rgb;
    c *= (shifted + DH_CORRUPTION_EPS) / (a.rgb + DH_CORRUPTION_EPS);
  }
  // Veins: the terrain's flat open ground only (ramps and stairs slope), deep enough inside the patch.
  vec2 nxy = g1.rg * 2.0 - 1.0;
  if (terrain && dot(nxy, nxy) < DH_VEIN_FLAT && spread > threshold + DH_VEIN_DEPTH * (1.0 - strength)) {
    vec4 v = noiseAt(uNoise, ground, DH_VEIN_TILE_PX);
    // Distance in units of the local width: the vein swells, thins and breaks along its course.
    float d = veinDistanceAt(ground, v.a) / veinSwell(v.b);
    if (d < mix(DH_VEIN_CORE_THIN, DH_VEIN_CORE_WIDE, strength)) {
      float pulse = 0.5 + 0.5 * sin(v.g * DH_VEIN_PHASES - uTime * uPulse);
      float glow = DH_VEIN_GLOW * (DH_VEIN_REST + (1.0 - DH_VEIN_REST) * pulse);
      c = max(c * DH_VEIN_DARK, (d < DH_VEIN_HOT ? VEIN_CORE : VEIN_EDGE) * glow);
    } else if (d < mix(DH_VEIN_CRACK_THIN, DH_VEIN_CRACK_WIDE, strength)) {
      c *= DH_VEIN_DARK;
    }
  }
  oColor = encodeHdr(c);
}
