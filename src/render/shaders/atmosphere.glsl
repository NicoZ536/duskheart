// Shared helpers of the atmosphere and post passes (M5-10 … M5-22): world anchoring and the tiling noise
// texture (src/render/post/noise.ts: R, G soft fBm · B finer fBm · A smooth vein field), sampled with linear
// filtering and repeat wrapping.

// World px (y south) of a fragment of a target whose pixel (0, 0) – the top-left corner including the
// 1 px border – shows world px `origin` (CameraSnap.originX/Y).
vec2 worldPixel(vec2 fragCoord, vec2 origin, vec2 targetSize) {
  return floor(origin + vec2(fragCoord.x, targetSize.y - fragCoord.y));
}

// The noise tile over world px, one tile every `tilePx` px.
vec4 noiseAt(sampler2D noise, vec2 world, float tilePx) {
  return texture(noise, world / tilePx);
}

// Ordered quantisation of a smooth value into `steps` levels: flat cores, the 4×4 Bayer threshold only
// in the middle half of each step (the light bands' rule, ADR-0012) – smooth gradients become pixel-art
// bands with dithered seams instead of 8-bit rings.
float orderedSteps(float v, float steps, float bayer) {
  return floor(v * steps + 0.25 + 0.5 * bayer) / steps;
}
