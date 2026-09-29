// Ground under a texel of the sun-shadow target (M5-02): the occluder mask's ground height (alpha) at the fragment's world
// point is the ground a receiver there stands on. A caster point no higher than that ground can shadow nothing standing
// on it – it is dropped, so its opaque black cannot darken the light a higher caster lets through there (MIN blending:
// the stained glass over a raised level). The target reaches beyond the mask (light/shadowFrame.ts): there the ground is
// unknown and nothing is dropped.

uniform sampler2D uMask;    // occluder mask (sdf.glsl layout)
uniform int uHasMask;       // 1 when the occluder pass ran this frame
uniform vec4 uSdfFrame;     // world px of the mask's top-left corner, its size (sdf.glsl)
uniform vec4 uShadowFrame;  // world px of the shadow target's top-left corner, its size

// World point of this fragment's texel centre in the shadow target.
vec2 shadowFragWorld() {
  return uShadowFrame.xy + vec2(gl_FragCoord.x, uShadowFrame.w - gl_FragCoord.y);
}

// Whether a caster point `height` px above level 0 lies on or under the ground of this fragment's texel.
bool shadowUnderGround(float height) {
  if (uHasMask != 1) return false;
  vec2 q = shadowFragWorld() - uSdfFrame.xy;
  ivec2 t = ivec2(floor(q.x), floor(uSdfFrame.w - q.y));
  if (t.x < 0 || t.y < 0 || float(t.x) >= uSdfFrame.z || float(t.y) >= uSdfFrame.w) return false;
  float ground = texelFetch(uMask, t, 0).a * DH_GBUFFER_HEIGHT_RANGE;
  return height <= ground + DH_SUN_HEIGHT_EPSILON;
}
