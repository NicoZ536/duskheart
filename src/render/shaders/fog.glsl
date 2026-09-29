// Fog of the atmosphere pass (MASTERPROMPT §6.1 pass 8 "Nebelschichten (Rauschen; Dichte nach Biom/Wetter/
// Zeit; Lichter streuen im Nebel)", M5-10). Needs atmosphere.glsl. Constants: src/render/passes/atmospherePass.ts.
//
// Three layers of the noise tile at growing scale drift with the wind, each faster than the one below
// (parallax: the high banks move over the low mist). The fog lies on its floor (the ground level at the
// camera): a pixel `h` px above level 0 (G1 height: trees, figures, walls, high ground) sees less of it the
// higher it rises above the floor, nothing above floor + thickness; lower ground lies deep in it.

// Offsets of the low, mid and high layer [1/DH_DRIFT_UNITS world px]: the wind's drift integrated over the presentation
// clock and kept modulo each layer's tile (world/skyScene.ts, world/drift.ts) – a change of wind moves the banks on
// smoothly.
uniform vec2 uFogDrift[3];

float fogPattern(sampler2D noise, vec2 ground) {
  float low = noiseAt(noise, ground + uFogDrift[0] / DH_DRIFT_UNITS, DH_FOG_TILE_LOW).b;
  float mid = noiseAt(noise, ground + uFogDrift[1] / DH_DRIFT_UNITS + vec2(53.0, 17.0), DH_FOG_TILE_MID).g;
  float high = noiseAt(noise, ground + uFogDrift[2] / DH_DRIFT_UNITS + vec2(-91.0, 37.0), DH_FOG_TILE_HIGH).r;
  return low * 0.25 + mid * 0.35 + high * 0.4;
}

// Fog amount 0…1 at `density` for pattern value `v` (≈ 0.2 … 0.8): thin fog lies in banks, thick fog
// closes up with only its brightness still varying.
float fogAmount(float density, float v) {
  float banks = clamp((v - 0.5) * DH_FOG_CONTRAST + 0.5, 0.0, 1.0);
  return clamp(density * mix(DH_FOG_FLOOR, 1.0, banks), 0.0, 1.0);
}

// Share of the fog a pixel `h` px above level 0 sees under fog `height` px thick on the floor `floor` px.
float fogHeightFade(float h, float height, float floor) {
  return height <= 0.0 ? 0.0 : clamp(1.0 - (h - floor) / height, 0.0, 1.0);
}

// Light scattered towards the viewer by fog of density `density` under light of brightness `light`.
float fogScatter(float density, float light) {
  return max(density, 0.0) * max(light, 0.0) * DH_SCATTER_STRENGTH;
}

// Weight of a softening tap of the scattered light whose air is `tapOpen` for a pixel whose air is `open` (1 open air, 0
// a roofed room, as fog_density.frag writes them): only the same air counts.
float fogSameAir(float tapOpen, float open) {
  return step(abs(tapOpen - open), 0.5);
}
