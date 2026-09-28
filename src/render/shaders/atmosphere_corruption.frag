#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
// Corruption (MASTERPROMPT §6.2 "Verderbnis: Paletten-Shift + animierte emissive Adern im Boden", M5-22;
// src/render/post/corruption.ts): inside the corrupted area – a world-anchored noise field above a
// threshold that falls with the region's strength, its edge dithered on the Bayer grid – every lit pixel
// is scaled by the ratio of its corrupted to its painted albedo (the palette row `verderbnis` via the
// 32³ lookup), and the isolines of a second noise field crack the flat ground – dark cracks around glowing
// cores, measured in pixels so they stay unbroken, a pulse running along them. Light sources (emissive pixels) keep their colour: fire stays warm.
// Water keeps its own look (the water pass draws over it; a corrupted lake bed would read as a smudge).
// Veins lie only in the terrain itself: flat pixels at the height of a terrain level, not on crowns,
// trunks, walls, rocks, grass or anything standing up.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "bayer.glsl"
#include "atmosphere.glsl"

uniform sampler2D uScene;    // copy of the HDR target
uniform sampler2D uAlbedo;   // G0
uniform sampler2D uNormal;   // G1
uniform sampler2D uSurface;  // G2
uniform sampler2D uNoise;
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

// Distance [px] of ground point `g` to the nearest vein: the vein field's value and its central-difference
// gradient.
float veinDistanceAt(vec2 g) {
  float n = noiseAt(uNoise, g, DH_VEIN_TILE_PX).a;
  float dx = noiseAt(uNoise, g + vec2(DH_VEIN_STEP, 0.0), DH_VEIN_TILE_PX).a - noiseAt(uNoise, g - vec2(DH_VEIN_STEP, 0.0), DH_VEIN_TILE_PX).a;
  float dy = noiseAt(uNoise, g + vec2(0.0, DH_VEIN_STEP), DH_VEIN_TILE_PX).a - noiseAt(uNoise, g - vec2(0.0, DH_VEIN_STEP), DH_VEIN_TILE_PX).a;
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
  vec2 ground = world + vec2(0.0, h);
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
  // Veins: the terrain's flat ground only, deep enough inside the patch.
  vec2 nxy = g1.rg * 2.0 - 1.0;
  float level = h - DH_VEIN_LEVEL_PX * floor(h / DH_VEIN_LEVEL_PX + 0.5);
  bool standing = gbufferHasMaterial(g1, DH_MAT_CANOPY) || gbufferHasMaterial(g1, DH_MAT_OCCLUDER) || gbufferHasMaterial(g1, DH_MAT_WIND);
  bool onGround = dot(nxy, nxy) < DH_VEIN_FLAT && abs(level) < DH_VEIN_LEVEL_TOLERANCE && !standing;
  if (onGround && spread > threshold + DH_VEIN_DEPTH * (1.0 - strength)) {
    vec4 v = noiseAt(uNoise, ground, DH_VEIN_TILE_PX);
    // Distance in units of the local width: the vein swells, thins and breaks along its course.
    float d = veinDistanceAt(ground) / veinSwell(v.b);
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
