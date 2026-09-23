// HDR target encodings (src/render/gl/formats.ts, ADR-0011). With float render targets the values
// are stored as they are; without them RGBA16F targets are RGBA8 holding value / range (linear, so
// additive light accumulation and linear filtering keep working) and R16F targets are RG8 holding
// value / range as 16-bit fixed point.

vec4 encodeHdr(vec3 c) {
#if DH_FLOAT_TARGETS
  return vec4(c, 1.0);
#else
  return vec4(clamp(c / DH_HDR_FALLBACK_RANGE, 0.0, 1.0), 1.0);
#endif
}

vec3 decodeHdr(vec4 e) {
#if DH_FLOAT_TARGETS
  return e.rgb;
#else
  return e.rgb * DH_HDR_FALLBACK_RANGE;
#endif
}

vec4 encodeScalar(float v, float range) {
#if DH_FLOAT_TARGETS
  return vec4(v, 0.0, 0.0, 1.0);
#else
  float u = floor(clamp(v / range, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec4(hi / 255.0, (u - hi * 256.0) / 255.0, 0.0, 1.0);
#endif
}

float decodeScalar(vec4 e, float range) {
#if DH_FLOAT_TARGETS
  return e.r;
#else
  return (floor(e.r * 255.0 + 0.5) * 256.0 + floor(e.g * 255.0 + 0.5)) / 65535.0 * range;
#endif
}
