#version 300 es
precision highp float;
precision highp int;
// A sun caster of the build grid (M5-02, M5-05): the pixel lies in the block's shadow when some height t between its
// bottom and top projects a point of its footprint onto it (p − t · shadow ∈ footprint); the highest such t is the
// caster height stored (a = t / DH_GBUFFER_HEIGHT_RANGE, MAX blended) and rgb the light let through (MIN blended):
// nothing behind a wall or a roof, a clear roof's glass, and for a window the pane its sprite shows where the ray
// crosses the window's plane – coloured glass colours the light, clear glass lets it through grey, the frame blocks it,
// a hole lets it pass.
#include "gbuffer.glsl"
#include "palette.glsl"
#include "shadow_glass.glsl"
#include "shadow_ground.glsl"

in vec2 vWorld;
flat in vec4 vBox;
flat in vec4 vSpan;
flat in vec4 vPane;
flat in vec4 vFrame;

uniform vec3 uShadow;
uniform sampler2D uAtlasAlbedo;
uniform sampler2D uClass;        // per atlas texel: 1 casts a silhouette, 2 glass
uniform sampler2D uPaletteLut;

out vec4 oShadow;

const int KIND_CLEAR_GLASS = 1;
const int KIND_PANE = 2;
const float CLASS_GLASS_BIT = 2.0;
// A shadow component below this counts as parallel to an axis (a ray along a wall's plane).
const float PARALLEL = 1e-5;

// Heights t with lo ≤ p − t · s ≤ hi on one axis (all heights when s = 0 and p lies inside).
vec2 interval(float p, float s, float lo, float hi) {
  if (abs(s) < PARALLEL) return p >= lo && p <= hi ? vec2(-1e9, 1e9) : vec2(1.0, -1.0);
  float t0 = (p - hi) / s;
  float t1 = (p - lo) / s;
  return vec2(min(t0, t1), max(t0, t1));
}

void main() {
  vec2 s = uShadow.xy * uShadow.z;
  vec2 ix = interval(vWorld.x, s.x, vBox.x, vBox.z);
  vec2 iy = interval(vWorld.y, s.y, vBox.y, vBox.w);
  float from = max(max(ix.x, iy.x), vSpan.x);
  float to = min(min(ix.y, iy.y), vSpan.y);
  if (from > to || shadowUnderGround(to)) discard;
  vec3 through = vec3(0.0);
  int kind = int(vSpan.z + 0.5);
  if (kind == KIND_CLEAR_GLASS) {
    through = vec3(DH_GLASS_TRANSMISSION);
  } else if (kind == KIND_PANE) {
    // Where the ray crosses the window's plane – the middle of its wall band across the pane's axis, within the wall's
    // height: the pane's texel at that place and height. The same for every block of the window (its knot and the arms
    // to its neighbours share the band), so a ray through two of them samples one texel – MIN of two texels had turned
    // the blue pane teal and darkened its neighbours (M5-58). A ray along the plane: the middle of its path in the block.
    bool alongY = vSpan.w > 0.5;
    float across = alongY ? s.x : s.y;
    float plane = alongY ? 0.5 * (vBox.x + vBox.z) : 0.5 * (vBox.y + vBox.w);
    float t = abs(across) < PARALLEL ? 0.5 * (from + to) : clamp(((alongY ? vWorld.x : vWorld.y) - plane) / across, vSpan.x, vSpan.y);
    vec2 src = vWorld - s * t;
    float along = alongY ? src.y : src.x;
    ivec2 cell = ivec2(int(floor(along - vPane.x)), int(floor(vPane.w - (t - vSpan.x))));
    ivec2 size = ivec2(vFrame.yz);
    if (cell.x >= 0 && cell.y >= 0 && cell.x < size.x && cell.y < size.y) {
      ivec2 texel = ivec2(vPane.yz) + cell;
      vec4 a = texelFetch(uAtlasAlbedo, texel, 0);
      // A hole (an open window) lets the sun pass.
      if (a.a < 0.5) discard;
      uint material = uint(a.b * 255.0 + 0.5);
      float cls = floor(texelFetch(uClass, texel, 0).r * 255.0 + 0.5);
      bool glass = mod(floor(cls / CLASS_GLASS_BIT), 2.0) > 0.5 && (material & DH_MAT_WET) != 0u;
      // Clear glass (painted with the ramp of DH_GLASS_CLEAR_*: the sky's reflex) lets the sun through grey, a coloured
      // pane its own hue (M5-58).
      int index = paletteIndexOf(a.r);
      bool clearPane = index >= DH_GLASS_CLEAR_FIRST && index <= DH_GLASS_CLEAR_LAST;
      if (glass) through = clearPane ? vec3(DH_GLASS_TRANSMISSION) : glassThrough(paletteColor(uPaletteLut, index, int(vFrame.x + 0.5)));
    }
  }
  oShadow = vec4(through, clamp(to / DH_GBUFFER_HEIGHT_RANGE, 0.0, 1.0));
}
