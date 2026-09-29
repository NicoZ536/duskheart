// Wind sway of a sprite (M5-17; M5 review Minor 14): shared by the sprite G-buffer program and the sun silhouettes of
// the shadow pass, so a crown's shadow sways with the crown. Needs the surface strand's defines (DH_WIND_LEAN,
// DH_WIND_DEPTH_SHARE, DH_GUST_*; src/render/surface/params.ts) and DH_WIND_FREQUENCY (gbuffer.ts).
//
// A row at share `up` of the sprite's height above its anchor sways by up² of the top row's sway (the foot stays put).
// A quad carries that at its corners only – linear between them –, so the fragment stage moves each row's sampled column
// by the difference to its own up² (`swayRowShift`), and the vertex stage widens the quad by the largest such shift
// (`swayPad`: a quarter of the sway, half-way up).

const float SWAY_TAU = 6.2831853;

// Sway of the top row [px] of a sprite anchored at `anchorWorld` with wind amplitude `amplitude` [px] and phase `phase`,
// in the wind `wind` (x, y: the vector the sprites lean along; z: time [s]; w: gust strength 0…1): a steady lean downwind
// plus an oscillation, stronger where gust fronts roll over the meadow.
vec2 windSway(vec4 wind, vec2 anchorWorld, float amplitude, float phase) {
  float strength = length(wind.xy);
  float gust = 1.0;
  if (strength > 1e-4 && wind.w > 0.0) {
    // Gust fronts travel downwind: a wave along the wind direction, anchored to the world.
    float along = dot(anchorWorld, wind.xy / strength);
    gust = 1.0 + wind.w * DH_GUST_STRENGTH * sin((along - wind.z * DH_GUST_SPEED) * SWAY_TAU / DH_GUST_WAVELENGTH);
  }
  return vec2(wind.x, wind.y * DH_WIND_DEPTH_SHARE) * (amplitude * (DH_WIND_LEAN + (1.0 - DH_WIND_LEAN) * sin(wind.z * DH_WIND_FREQUENCY + phase)) * gust);
}

// Share of the height above the anchor of a sprite row at frame y `localY` (0 at the foot, 1 at the top row).
float swayUp(float localY, float anchorY) {
  return clamp((anchorY - localY) / max(1.0, anchorY), 0.0, 1.0);
}

// How far the vertex stage widens a swaying quad on each side [px].
float swayPad(float swayX) {
  return ceil(abs(swayX) * 0.25) + 1.0;
}

// Column shift [frame px, towards +x on screen] that puts row `localY` of a frame `height` px tall at its own up² of the
// sway `swayX` instead of the corners' linear shear (top corner: up 1; bottom corner: up² = `bottomUp2`).
float swayRowShift(float swayX, float bottomUp2, float localY, float height, float anchorY) {
  float up = swayUp(localY, anchorY);
  return swayX * (mix(1.0, bottomUp2, clamp(localY / height, 0.0, 1.0)) - up * up);
}
