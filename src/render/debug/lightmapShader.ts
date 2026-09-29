/**
 * Fragment shader of the render debugger's light map views (`lightmapPass.ts`, M3-21): per internal pixel
 * the gameplay light – point samples of `GameplayLightMap.levelAt` on a fine lattice (a few pixels apart,
 * bilinear in between) – next to the light the renderer drew there (ambient of the frame plus the
 * brightest channel of the point lights' diffuse light; every light colour has a brightest channel of 1,
 * so for a flat pixel that is intensity × falloff, the value the light map computes).
 *
 * Output (RGBA8): R = gameplay / DH_LM_RANGE, G = rendered / DH_LM_RANGE, B = 0 where both agree within
 * DH_LM_TOLERANCE, 1 where they differ, ½ where the pixel is not comparable (a sprite above the ground or a
 * tilted surface: the renderer lights it at its height and with its normal, the map lights the ground).
 *
 * Shadows (M5-28): the light pass keeps its bookkeeping in the alpha channels (lighting_point.frag) – the light the
 * decor occluders (trunks, rocks, furniture) took away is added back (the map ignores their shadows, §12.1), and a
 * pixel in a partial shadow of walls and cliffs or within a tile of them (the map resolves occlusion per tile there,
 * the renderer per pixel) is not comparable. Ground is flat and stands at the ground height of its occluder-mask texel
 * (a raised level's top stands 16 px per level high in the G-buffer).
 * It is a debug-only program, so its source lives here and is added to the shader library on first use
 * (`ShaderSourceStore.register`, kept across hot reloads) instead of the shader folder.
 */

/** File name the source is registered under in the shader library. */
export const LIGHTMAP_SHADER_FILE = 'debug/lightmap.frag';

/** GLSL source (includes `hdr.glsl` and `gbuffer.glsl` of the library). */
export const LIGHTMAP_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
// Render debugger: gameplay light map against the rendered light (src/render/debug/lightmapShader.ts).
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "sdf.glsl"

uniform sampler2D uLight;      // diffuse light of the point lights (lighting pass); a = light the decor shadows took away
uniform sampler2D uSpecular;   // glints of the lighting pass; a = how uncertain the comparison is (walls and cliffs near)
uniform sampler2D uNormal;     // G1: normal xy, height, material
uniform sampler2D uLattice;    // gameplay light on the lattice (R32F); texel (i, j) = world px uLattice0 + (i, j) · uStep
uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;      // target size in px
uniform vec2 uLattice0;        // world px of the first lattice point
uniform float uStep;           // lattice spacing [px]
uniform ivec2 uLatticeCount;   // lattice points per axis
uniform float uAmbient;        // ambient light the renderer adds (0: compare the sources alone)
uniform float uLightRan;       // 1 when the lighting pass drew this frame
uniform sampler2D uMask;       // occluder mask of the frame (a = height of the ground, sdf.glsl)
uniform int uHasMask;          // 1 when the occluder pass ran this frame
out vec4 oColor;

// The alpha channel of the light target on the scale of its colour (encodeLight of lighting.glsl).
float lightAlpha(vec4 e) {
#if DH_FLOAT_TARGETS
  return e.a;
#else
  return e.a * DH_HDR_FALLBACK_RANGE;
#endif
}

float latticeLevel(ivec2 t) {
  return texelFetch(uLattice, clamp(t, ivec2(0), uLatticeCount - 1), 0).r;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  // Pixel centre in world px (target row 0 is the top row), as the lighting pass reconstructs it.
  vec2 world = uOrigin + vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec2 uv = (world - uLattice0) / uStep;
  vec2 base = floor(uv);
  vec2 f = uv - base;
  ivec2 t = ivec2(base);
  float a = latticeLevel(t);
  float b = latticeLevel(t + ivec2(1, 0));
  float c = latticeLevel(t + ivec2(0, 1));
  float d = latticeLevel(t + ivec2(1, 1));
  float top = a + (b - a) * f.x;
  float bottom = c + (d - c) * f.x;
  float gameplay = top + (bottom - top) * f.y;
  vec4 diffuse = texelFetch(uLight, p, 0);
  vec3 lit = decodeHdr(diffuse) * uLightRan;
  float rendered = uAmbient + max(max(lit.r, lit.g), lit.b) + lightAlpha(diffuse) * uLightRan;
  bool unsure = lightAlpha(texelFetch(uSpecular, p, 0)) * uLightRan > DH_LM_UNSURE;
  vec4 g1 = texelFetch(uNormal, p, 0);
  float floorZ = uHasMask == 1 ? sdfGroundHeight(uMask, world) : 0.0;
  bool ground = abs(gbufferHeight(g1) - floorZ) <= DH_LM_GROUND && gbufferNormal(g1).z >= DH_LM_FLAT_NZ && !unsure;
  float mark = ground ? (abs(gameplay - rendered) > DH_LM_TOLERANCE ? 1.0 : 0.0) : 0.5;
  oColor = vec4(clamp(gameplay / DH_LM_RANGE, 0.0, 1.0), clamp(rendered / DH_LM_RANGE, 0.0, 1.0), mark, 1.0);
}
`;
