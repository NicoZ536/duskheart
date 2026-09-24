// Spectral light colour (M1-26, ADR-0018; mirrored by src/render/light/spectral.ts): the reflected
// colour of a saturated light leans towards the light's own hue – a flame's red-heavy spectrum turns
// lit grass golden instead of lime, the narrow blue of the night ambient turns it blue-grey instead
// of green-black. White and grey light stay the exact RGB product (palette colours under full
// daylight unchanged). DH_SPECTRAL_WEIGHT (< 1) keeps a trace of every material's own colour. Linear
// in the light's intensity, so each light group is reflected on its own and the results add up.

// Share of the spectral term for a light with darkest channel `lo` and brightest `hi`: its saturation
// (0 = white/grey, 1 = pure hue) times DH_SPECTRAL_WEIGHT.
float spectralShare(float lo, float hi) {
  return hi > 0.0 ? (1.0 - lo / hi) * DH_SPECTRAL_WEIGHT : 0.0;
}

// Surface reflectance under a light: the albedo weighted with the light's spectrum.
float lightReflectance(vec3 albedo, vec3 light) {
  return dot(albedo, light) / (light.r + light.g + light.b);
}

// Colour reflected by `albedo` under `light` (linear, HDR): the RGB product blended, by the light's
// spectral share, towards the light colour scaled with the surface's reflectance.
vec3 reflectLight(vec3 albedo, vec3 light) {
  float hi = max(max(light.r, light.g), light.b);
  if (hi <= 0.0) return vec3(0.0);
  float share = spectralShare(min(min(light.r, light.g), light.b), hi);
  return mix(albedo * light, light * lightReflectance(albedo, light), share);
}

// Warm hue shift of the point light (§4.3 "Lichter Richtung Warmgelb"): the more a warm light rises,
// the further its green climbs towards its red – orange at the rim of a torch's pool, golden at its
// heart. Share of the green-to-red gap closed: grows with the level `r` (smoothstep between
// DH_WARM_SHIFT_START_LEVEL and DH_WARM_SHIFT_FULL_LEVEL) and with the warmth (r − b) / r; white and
// grey light stay unchanged.
float warmShare(float r, float b) {
  if (r <= 0.0) return 0.0;
  return DH_WARM_SHIFT * smoothstep(DH_WARM_SHIFT_START_LEVEL, DH_WARM_SHIFT_FULL_LEVEL, r) * clamp((r - b) / r, 0.0, 1.0);
}

// The light with its warm hue shift; only a light whose red is its brightest channel is shifted, its
// brightest channel (light bands, gameplay light level) and blue stay.
vec3 warmLight(vec3 light) {
  if (light.r < light.g || light.r < light.b) return light;
  return vec3(light.r, light.g + (light.r - light.g) * warmShare(light.r, light.b), light.b);
}
