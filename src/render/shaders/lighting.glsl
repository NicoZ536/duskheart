// Light model of the lighting pass (src/render/light/falloff.ts). `lightFalloff` and `lightCone`
// mirror the canonical model src/engine/lightFalloff.ts statement by statement – the gameplay light
// map evaluates the same formulas (tests/unit/render/falloff.test.ts runs this source against it).

// Soft distance falloff (1 − x²)² / (1 + core · x²), x = d / r: 1 at the light, 0 at the radius with
// zero slope, a hot core and a long soft tail.
float lightFalloff(float distance, float radius) {
  if (!(radius > 0.0)) return 0.0;
  float x = distance / radius;
  float w = max(0.0, 1.0 - x * x);
  return (w * w) / (1.0 + DH_LIGHT_FALLOFF_CORE * x * x);
}

// Soft cone edge from the cosine between cone axis and the direction light → pixel.
float lightCone(float cosAngle, float cosOuter, float cosInner) {
  return smoothstep(cosOuter, cosInner, cosAngle);
}

// Normal mapping relative to a flat surface: a flat pixel (n = +z) gets exactly the falloff, pixels
// turned towards the light brighten, those turned away darken. n and l are unit vectors in screen
// space (+x right, +y up, +z towards the viewer).
float lightShade(vec3 n, vec3 l) {
  return max(0.0, 1.0 + DH_LIGHT_RELIEF * (dot(n, l) - l.z));
}

// Blinn-Phong glint of glossy pixels (metal, ice, wet) for a viewer straight in front of the screen.
float lightSpecular(vec3 n, vec3 l, float gloss) {
  if (gloss <= 0.0) return 0.0;
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  return gloss * DH_LIGHT_SPECULAR * pow(max(dot(n, h), 0.0), DH_LIGHT_SHININESS);
}
