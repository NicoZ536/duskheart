#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
// Last step of the post chain (MASTERPROMPT §6.1 pass 9, HDR → LDR; src/render/passes/postPass.ts):
// 1. the picture is read through the distortion field (shock waves, heat, under water; M5-13) and the
//    state effects' sway (intoxication, poison, heat at the edges), whole pixels at a time; intoxication
//    adds a faint drifting double image;
// 2. exposure and tonemapping;
// 3. colour grading through the frame's 3D LUT (M5-14);
// 4. state effects (M5-15): fear's drain, heat and cold casts, the poison rim; vignette and fine grain;
//    the low-health rim with its heartbeat, fear's shadows at the edges; the frost rim and the eyelids
//    (M3-20); the Bayer transition.
// Grading, the grade's vignette and grain touch only drawn pixels: where nothing is drawn (outside the
// world, before it streams in) the background colour stays exact.
#include "hdr.glsl"
#include "bayer.glsl"
#include "atmosphere.glsl"
#include "distortion.glsl"
#include "post.glsl"
#include "grading.glsl"

uniform sampler2D uHdr;
uniform sampler2D uAlbedo;       // G0: coverage
uniform sampler2D uDistortion;   // offset field (distortion pass)
uniform sampler2D uNoise;
uniform sampler3D uLut;          // grade of the frame
uniform float uExposure;
/** Visible picture inside the target: offset x, y and size w, h [px] (the target has a 1 px border). */
uniform vec4 uView;
uniform vec2 uTargetSize;
uniform float uTime;
uniform int uDistort;            // 1 = the distortion field holds this frame's offsets
uniform int uGrade;              // 1 = grade through the LUT
uniform float uLid;
uniform float uFrost;
uniform vec2 uFear;              // tendril reach, colour drain
uniform vec2 uHurt;              // rim (with heartbeat), colour drain
uniform vec2 uHeatCold;          // heat, cold
uniform vec2 uPoison;            // rim (with swell), sway
uniform float uDrunk;
uniform float uVignette;         // grade + scene + exhaustion
uniform vec2 uGrain;             // amount, seed
uniform float uMotion;           // reduced motion scale
uniform vec4 uTransition;        // colour, cover
out vec4 oColor;

void main() {
  vec2 frag = floor(gl_FragCoord.xy);
  vec2 p = frag - uView.xy;
  vec2 size = uView.zw;
  ivec2 top = ivec2(uTargetSize) - 1;
  vec2 offset = stateOffset(p, size, uTime, uDrunk, uPoison.y, uHeatCold.x, uMotion, uNoise);
  float shine = 1.0;
  if (uDistort == 1) {
    ivec2 f0 = ivec2(frag);
    vec2 field = decodeOffset(texelFetch(uDistortion, f0, 0));
    // Neighbours east and south (GL rows run north): the divergence of the field in world orientation.
    vec2 east = decodeOffset(texelFetch(uDistortion, min(f0 + ivec2(1, 0), top), 0));
    vec2 south = decodeOffset(texelFetch(uDistortion, max(f0 - ivec2(0, 1), ivec2(0)), 0));
    shine = distortionShade((east.x - field.x) + (south.y - field.y));
    offset += vec2(field.x, -field.y);
  }
  ivec2 q = clamp(ivec2(frag + floor(offset + 0.5)), ivec2(0), top);
  vec3 c = decodeHdr(texelFetch(uHdr, q, 0)) * uExposure * shine;
  if (uDrunk > 0.0) {
    vec2 drift = vec2(sin(uTime * 0.9), cos(uTime * 0.7)) * uDrunk * DH_DRUNK_GHOST_PX * max(uMotion, 0.4);
    ivec2 g = clamp(q + ivec2(floor(drift + 0.5)), ivec2(0), top);
    c = mix(c, decodeHdr(texelFetch(uHdr, g, 0)) * uExposure, uDrunk * DH_DRUNK_GHOST);
  }
  c = tonemap(c);
  bool drawn = texelFetch(uAlbedo, q, 0).a > 0.5;
  // Screen-anchored: these masks belong to the picture, not to the world (no crawl while scrolling).
  float bayer = bayer4(frag);
  if (drawn && uGrade == 1) c = gradeLut(uLut, c);
  c = drain(c, max(uFear.y, uHurt.y));
  c = heatCast(c, uHeatCold.x);
  c = coldCast(c, uHeatCold.y);
  c = sickRim(c, p, size, uPoison.x, bayer);
  if (drawn) {
    c = vignette(c, p, size, uVignette, bayer);
    c = grain(c, p, uGrain.x, uGrain.y);
  }
  c = bloodRim(c, p, size, uHurt.x, bayer);
  c = fearShadows(c, p, size, uFear.x, uTime, uNoise, bayer);
  if (uFrost > 0.0) c = frostOver(c, p, size, uFrost, bayer);
  if (uLid > 0.0 && lidCovers(min(p.y, size.y - 1.0 - p.y), size.y, uLid, bayer)) c = LID_COLOR;
  if (uTransition.a > 0.0 && transitionCovers(p, size, uTransition.a, bayer4(floor(p * 0.5)))) c = uTransition.rgb;
  oColor = vec4(c, 1.0);
}
