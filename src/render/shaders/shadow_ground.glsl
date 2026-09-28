// Ground under a texel of the sun-shadow target (M5-02): the target and the occluder mask share their placement (frame
// plus margin), so the mask's ground height (alpha) at the fragment's own texel is the ground a receiver there stands
// on. A caster point no higher than that ground can shadow nothing standing on it – it is dropped, so its opaque black
// cannot darken the light a higher caster lets through there (MIN blending: the stained glass over a raised level).

uniform sampler2D uMask;   // occluder mask (sdf.glsl layout)
uniform int uHasMask;      // 1 when the occluder pass ran this frame

// Whether a caster point `height` px above level 0 lies on or under the ground of this fragment's texel.
bool shadowUnderGround(float height) {
  if (uHasMask != 1) return false;
  float ground = texelFetch(uMask, ivec2(gl_FragCoord.xy), 0).a * DH_GBUFFER_HEIGHT_RANGE;
  return height <= ground + DH_SUN_HEIGHT_EPSILON;
}
