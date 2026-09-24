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
 * It is a debug-only program, so its source lives here and is added to the shader library on first use
 * (`ShaderSourceStore.set`) instead of the shader folder.
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

uniform sampler2D uLight;      // diffuse light of the point lights (lighting pass)
uniform sampler2D uNormal;     // G1: normal xy, height, material
uniform sampler2D uLattice;    // gameplay light on the lattice (R32F); texel (i, j) = world px uLattice0 + (i, j) · uStep
uniform vec2 uOrigin;          // world px of target pixel (0, 0), top-left
uniform vec2 uTargetSize;      // target size in px
uniform vec2 uLattice0;        // world px of the first lattice point
uniform float uStep;           // lattice spacing [px]
uniform ivec2 uLatticeCount;   // lattice points per axis
uniform float uAmbient;        // ambient light the renderer adds (0: compare the sources alone)
uniform float uLightRan;       // 1 when the lighting pass drew this frame
out vec4 oColor;

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
  vec3 lit = decodeHdr(texelFetch(uLight, p, 0)) * uLightRan;
  float rendered = uAmbient + max(max(lit.r, lit.g), lit.b);
  vec4 g1 = texelFetch(uNormal, p, 0);
  bool ground = gbufferHeight(g1) <= 0.0 && gbufferNormal(g1).z >= DH_LM_FLAT_NZ;
  float mark = ground ? (abs(gameplay - rendered) > DH_LM_TOLERANCE ? 1.0 : 0.0) : 0.5;
  oColor = vec4(clamp(gameplay / DH_LM_RANGE, 0.0, 1.0), clamp(rendered / DH_LM_RANGE, 0.0, 1.0), mark, 1.0);
}
`;
