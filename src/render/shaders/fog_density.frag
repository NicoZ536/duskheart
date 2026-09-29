#version 300 es
precision highp float;
precision highp int;
// Fog density of the frame (atmosphere pass, M5-10): one value per internal pixel, 0 where nothing is
// drawn. The render debugger shows it as `fog`.
//   r = density, g = 1 where the pixel shows open air, 0 in a roofed room (fog_composite.frag lights the room's fog with
//   the sky's share through the roof and keeps its scattered light apart from the open air's).
// The layers are anchored to the ground under each pixel: its screen point moved south by its height above the ground
// of its occluder-mask texel (`sdfGroundPoint`; raised levels are drawn where they lie), so the banks run on across level
// edges. Under a roof – a room of the build grid, with roof DH_FOG_ROOM_PX on every side (not the strip of a wall's tile
// outside the wall) – the air is still: its fog is DH_FOG_ROOFED of the open air's. What a pixel shows is the air in
// front of it: for a wall, the air south of its band (the view looks north onto the walls' south faces); roofs and
// crowns above their ground lie in the open air.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "atmosphere.glsl"
#include "fog.glsl"
#include "sdf.glsl"

uniform sampler2D uAlbedo;   // G0: coverage
uniform sampler2D uNormal;   // G1: height above the ground
uniform sampler2D uSurface;  // G2: emission (glowing pixels shine through)
uniform sampler2D uNoise;
uniform sampler2D uMask;     // occluder pass: mask (ground heights, walls, roofs), read while uHasFields is 1
uniform int uHasFields;      // 1 = the occluder pass drew this frame's mask
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform vec3 uFog;           // density, thickness [px], floor [px above level 0]; the drift: uFogDrift (fog.glsl)

out vec4 oFog;

// Whether a wall of the build grid (a closed door, massive rock) stands at world point `w`.
bool fogWall(vec2 w) {
  return sdfOccluder(uMask, sdfTexel(w)).y > 0.5;
}

// Whether the air at world point `air` lies in a roofed room: roof there and DH_FOG_ROOM_PX away on every side.
bool fogIndoors(vec2 air) {
  const float r = DH_FOG_ROOM_PX;
  return sdfRoofed(uMask, air) && sdfRoofed(uMask, air + vec2(r, 0.0)) && sdfRoofed(uMask, air - vec2(r, 0.0)) && sdfRoofed(uMask, air + vec2(0.0, r)) && sdfRoofed(uMask, air - vec2(0.0, r));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(uAlbedo, p, 0).a < 0.5) {
    oFog = vec4(0.0, 1.0, 0.0, 1.0);
    return;
  }
  vec2 world = worldPixel(gl_FragCoord.xy, uOrigin, uTargetSize);
  vec4 g1 = texelFetch(uNormal, p, 0);
  float h = gbufferHeight(g1);
  bool fields = uHasFields == 1;
  vec2 ground = fields ? sdfGroundPoint(uMask, world, h) : world + vec2(0.0, h);
  float a = fogAmount(uFog.x, fogPattern(uNoise, ground)) * fogHeightFade(h, uFog.y, uFog.z);
  if (gbufferEmissive(texelFetch(uSurface, p, 0)) > 0.0) a *= DH_FOG_EMISSIVE;
  float open = 1.0;
  if (fields) {
    bool top = gbufferHasMaterial(g1, DH_MAT_CANOPY) && h > sdfGroundHeight(uMask, ground) + DH_SUN_HEIGHT_EPSILON;
    vec2 air = fogWall(ground) ? ground + vec2(0.0, DH_FOG_FACE_PX) : ground;
    if (!top && fogIndoors(air)) {
      a *= DH_FOG_ROOFED;
      open = 0.0;
    }
  }
  oFog = vec4(a, open, 0.0, 1.0);
}
