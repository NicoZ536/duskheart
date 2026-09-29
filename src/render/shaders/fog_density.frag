#version 300 es
precision highp float;
precision highp int;
// Fog density of the frame (atmosphere pass, M5-10): one value per internal pixel, 0 where nothing is
// drawn. The render debugger shows it as `fog`.
//   r = density, g = 1 where the pixel shows open air, 0 in a roofed room (fog_composite.frag lights the room's fog with
//   the sky's share through the roof and keeps its scattered light apart from the open air's).
// The layers are anchored to the ground under each pixel: its screen point moved south by its height above the ground
// it stands on (`groundPointAt`: the occluder mask in the flood frame, the occluder ring beyond it – the tall pixels at the
// bottom of the view stand on ground below it, M5-44; raised levels are drawn where they lie), so the banks run on
// across level edges and the bottom of the view. Under a roof – a room of the build grid, with roof DH_FOG_ROOM_PX on
// every side (not the strip of a wall's tile outside the wall) – the air is still: its fog is DH_FOG_ROOFED of the open
// air's. What a pixel shows is the air in front of it (`fogIndoors`): roofs and crowns above their ground lie in the open
// air; a wall's or a window's face shows the air past its band – south of an east–west run, beside a north–south run,
// diagonally at a corner: the side walls seen from inside show the room (M5-49); the floor of a doorway lies in the open
// air.
#include "hdr.glsl"
#include "gbuffer.glsl"
#include "atmosphere.glsl"
#include "fog.glsl"
#include "sdf.glsl"
#include "sdf_ring.glsl"

uniform sampler2D uAlbedo;   // G0: coverage
uniform sampler2D uNormal;   // G1: height above the ground
uniform sampler2D uSurface;  // G2: emission (glowing pixels shine through)
uniform sampler2D uNoise;
uniform sampler2D uMask;     // occluder pass: mask (ground heights, walls, roofs), read while uHasFields is 1
uniform int uHasFields;      // 1 = the occluder pass drew this frame's mask (and, with uHasRing, its ring)
uniform vec2 uOrigin;
uniform vec2 uTargetSize;
uniform vec3 uFog;           // density, thickness [px], floor [px above level 0]; the drift: uFogDrift (fog.glsl)

out vec4 oFog;

// Directions of the probes past a wall's band, in steps of DH_FOG_FACE_PX: south (the face of an east–west run), east and
// west (beside a north–south run), south-east and south-west (a corner).
const vec2 FACE_PROBES[5] = vec2[5](vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));

// The mask's structural channel at world point `w` (the ring beyond the flood frame, 0 beyond both): 1 a wall, closed door
// or gate; DH_OPENING_MARK an opening of a wall (a window, an open door or gate); DH_ROOF_MARK a roof; 0 open ground.
float fogStructure(vec2 w) {
  ivec2 t = sdfTexel(w);
  if (sdfInside(t)) return texelFetch(uMask, t, 0).g;
  ivec2 r = ringTexel(w);
  return ringInside(r) ? texelFetch(uRing, r, 0).g : 0.0;
}

// Whether structural value `g` is the band of a wall piece: a wall, a closed door or gate, or an opening.
bool fogBand(float g) {
  return g > 0.5 * (DH_ROOF_MARK + DH_OPENING_MARK);
}

// Whether the air at world point `air` lies in a roofed room: roof there and DH_FOG_ROOM_PX away on every side.
bool fogRoomAir(vec2 air) {
  const float r = DH_FOG_ROOM_PX;
  return roofedAt(uMask, air) && roofedAt(uMask, air + vec2(r, 0.0)) && roofedAt(uMask, air - vec2(r, 0.0)) && roofedAt(uMask, air + vec2(0.0, r)) && roofedAt(uMask, air - vec2(0.0, r));
}

// Whether a pixel whose ground point is `ground` shows a room's air. `top`: a roof or crown above its ground (open air);
// `raised`: the pixel stands above its ground (a wall's face, a window, a door leaf – not the floor).
bool fogIndoors(vec2 ground, bool top, bool raised) {
  if (top) return false;
  float g = fogStructure(ground);
  if (!fogBand(g)) return fogRoomAir(ground);
  // The floor of a doorway (an opening's band seen on the ground): the door stands open, the air flows through.
  if (!raised && g < 0.5) return false;
  // A wall's or a window's face: the first probe past the band that lies in a room decides.
  for (int i = 0; i < 5; i++) {
    vec2 q = ground + DH_FOG_FACE_PX * FACE_PROBES[i];
    if (!fogBand(fogStructure(q)) && fogRoomAir(q)) return true;
  }
  return false;
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
  vec2 ground = fields ? groundPointAt(uMask, world, h) : world + vec2(0.0, h);
  float a = fogAmount(uFog.x, fogPattern(uNoise, ground)) * fogHeightFade(h, uFog.y, uFog.z);
  if (gbufferEmissive(texelFetch(uSurface, p, 0)) > 0.0) a *= DH_FOG_EMISSIVE;
  float open = 1.0;
  if (fields) {
    bool raised = h > occluderAt(uMask, ground).w + DH_SUN_HEIGHT_EPSILON;
    bool top = raised && gbufferHasMaterial(g1, DH_MAT_CANOPY);
    if (fogIndoors(ground, top, raised)) {
      a *= DH_FOG_ROOFED;
      open = 0.0;
    }
  }
  oFog = vec4(a, open, 0.0, 1.0);
}
