#version 300 es
precision highp float;
precision highp int;
// Fog over the lit scene (atmosphere pass, M5-10): premultiplied, blended as src + dst · (1 − a) into the
// HDR target (linear in the RGBA8 fallback too). The density is quantised into fine bands with a
// world-anchored Bayer seam – pixel fog, no smooth 8-bit gradient. The fog colour is lit by the ambient
// light (pale by day, deep blue at night, black in caves – there only the scattered light shows it).
//
// Lights scatter in the fog ("Lichter streuen im Nebel"): the point and spot light the light pass left at
// the pixel – averaged with four diagonal neighbours, so the glow is smooth rather than the relief of the
// lit ground – times the density. The light pass traces its shadows through the occluder distance field,
// so the glow ends where the light ends: none bleeds through a wall. Quantised in fine steps.
#include "hdr.glsl"
#include "bayer.glsl"
#include "atmosphere.glsl"
#include "fog.glsl"

uniform sampler2D uFog;      // density (fog_density.frag)
uniform sampler2D uLight;    // light pass: diffuse point/spot light (encodeHdr scale)
uniform int uScatter;        // 1 = the light pass ran this frame
uniform vec3 uFogColor;      // fog colour × ambient light
uniform vec2 uOrigin;
uniform vec2 uTargetSize;

out vec4 oColor;

vec3 lightAt(ivec2 p, ivec2 top) {
  return decodeHdr(texelFetch(uLight, clamp(p, ivec2(0), top), 0));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uFog, p, 0).r;
  if (d <= 0.0) {
    oColor = vec4(0.0);
    return;
  }
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize);
  float bayer = bayer4(world);
  float a = orderedSteps(d, DH_FOG_STEPS, bayer) * DH_FOG_OPACITY;
  vec3 c = uFogColor * a;
  if (uScatter == 1) {
    ivec2 top = ivec2(uTargetSize) - 1;
    const int t = DH_SCATTER_TAP;
    vec3 l = lightAt(p, top) * 2.0;
    l += lightAt(p + ivec2(t, t), top) + lightAt(p + ivec2(-t, t), top);
    l += lightAt(p + ivec2(t, -t), top) + lightAt(p + ivec2(-t, -t), top);
    l /= 6.0;
    float peak = max(max(l.r, l.g), l.b);
    if (peak > 0.0) {
      float s = orderedSteps(fogScatter(d, peak) / DH_SCATTER_RANGE, DH_SCATTER_STEPS, bayer) * DH_SCATTER_RANGE;
      c += l / peak * s;
    }
  }
  oColor = vec4(encodeHdr(c).rgb, a);
}
