// Tonemapping (MASTERPROMPT §6.1 pass 9, M1-19): identity up to 1 – palette colours under full light
// stay exact – and a hue-preserving shoulder above: the brightest channel holds at 1 while the others
// rise towards white with the overexposure (a blazing fire burns white instead of clipping into a
// hue shift). Mirrors src/render/passes/postPass.ts `tonemap`.
float tonemapWhite(float peak) {
  return peak <= 1.0 ? 0.0 : (1.0 - 1.0 / peak) * DH_TONEMAP_WHITE;
}

vec3 tonemap(vec3 c) {
  c = max(c, vec3(0.0));
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= 1.0) return c;
  return mix(c / peak, vec3(1.0), tonemapWhite(peak));
}

// Eyelids of a blink (§11.1 "Lidschlag-Effekt", M3-20): they cover `lid` of the picture's half from the
// top and the bottom; the last DH_LID_SOFT_PX rows are dithered, and shut lids (1) cover everything.
// Mirrors postPass.ts `lidCovers`.
const vec3 LID_COLOR = vec3(13.0, 10.0, 20.0) / 255.0; // nacht.0
bool lidCovers(float dist, float height, float lid, float bayer) {
  float lidPx = clamp(lid, 0.0, 1.0) * (height * 0.5 + DH_LID_SOFT_PX);
  float t = clamp((lidPx - dist) / DH_LID_SOFT_PX, 0.0, 1.0);
  return t > bayer;
}

// Frost at the edges of a freezing player's picture (§11.2 "Unterkühlt … Frostrand", M3-20): ice creeps in
// DH_FROST_REACH_PX × frost from the nearest edge, stronger towards it (`frostShare`), in uneven fingers
// along the edge, laid over the picture where the share beats the Bayer threshold.
const vec3 FROST_COLOR = vec3(210.0, 231.0, 242.0) / 255.0; // eis.3
float frostShare(float dist, float frost) {
  float reach = DH_FROST_REACH_PX * clamp(frost, 0.0, 1.0);
  if (reach <= 0.0) return 0.0;
  float m = clamp(1.0 - dist / reach, 0.0, 1.0);
  return m * m;
}
float frostFinger(float along) {
  return 0.55 + 0.45 * fract(sin(floor(along / 3.0) * 12.9898) * 43758.5453);
}
vec3 frostOver(vec3 c, vec2 p, vec2 size, float frost, float bayer) {
  float dx = min(p.x, size.x - 1.0 - p.x);
  float dy = min(p.y, size.y - 1.0 - p.y);
  float share = dx < dy ? frostShare(dx / frostFinger(p.y), frost) : frostShare(dy / frostFinger(p.x), frost);
  return share > bayer ? mix(c, FROST_COLOR, DH_FROST_MIX) : c;
}

// ---------------------------------------------------------------------------------------------------
// State effects, vignette, grain, transitions (§6.1 pass 9, M5-15; src/render/post/state.ts). All work on
// whole internal pixels of the visible picture (`p`, GL orientation, `size` = its extent); smooth masks
// are quantised with the Bayer threshold (`orderedSteps`, atmosphere.glsl) – bands with dithered seams.

const vec3 NIGHT_COLOR = vec3(13.0, 10.0, 20.0) / 255.0;   // nacht.0: fear's shadows
const vec3 BLOOD_COLOR = vec3(90.0, 20.0, 32.0) / 255.0;   // feuer.0: the low-health rim
const vec3 SICK_COLOR = vec3(120.0, 173.0, 69.0) / 255.0;  // gras.4: poison
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float picLuma(vec3 c) {
  return dot(c, LUMA);
}

vec3 drain(vec3 c, float amount) {
  return mix(c, vec3(picLuma(c)), clamp(amount, 0.0, 1.0));
}

// Distance of a pixel to the nearest edge of the picture [px].
float edgeDistance(vec2 p, vec2 size) {
  return min(min(p.x, size.x - 1.0 - p.x), min(p.y, size.y - 1.0 - p.y));
}

// 0 in the centre … 1 in the corners.
float radial(vec2 p, vec2 size) {
  vec2 q = (p + 0.5) / size * 2.0 - 1.0;
  return length(q) * 0.70710678;
}

// Vignette: the edges darken by up to DH_VIGNETTE_DEPTH at `amount` 1, in dithered steps.
vec3 vignette(vec3 c, vec2 p, vec2 size, float amount, float bayer) {
  if (amount <= 0.0) return c;
  float f = smoothstep(DH_VIGNETTE_INNER, 1.0, radial(p, size));
  return c * (1.0 - orderedSteps(f * clamp(amount, 0.0, 1.0) * DH_VIGNETTE_DEPTH, DH_VIGNETTE_STEPS, bayer));
}

// Fear (§12.3 "Schatten am Bildrand"): dark tendrils reach in from the edges; `reach` 0…1. The noise is
// read around the picture (by the angle from its centre, a multiple of four tiles per turn: no seam) and
// stretched inwards by DH_FEAR_STRETCH, so it varies quickly along the edge and slowly towards the middle –
// streaks that reach in, creeping inwards with the flow; a coarser noise bends them sideways.
vec3 fearShadows(vec3 c, vec2 p, vec2 size, float reach, float time, sampler2D noise, float bayer) {
  if (reach <= 0.0) return c;
  float across = edgeDistance(p, size);
  vec2 q = p + 0.5 - size * 0.5;
  float turns = 4.0 * max(1.0, floor(0.5 * (size.x + size.y) / DH_FEAR_TILE + 0.5));
  float u = atan(q.y, q.x) * 0.15915494 * turns;
  float bend = texture(noise, vec2(u * 0.25, across / (DH_FEAR_TILE * 1.5))).b - 0.5;
  float n = texture(noise, vec2(u + bend * 0.9, across / (DH_FEAR_TILE * DH_FEAR_STRETCH) - time * DH_FEAR_FLOW)).g;
  n = clamp((n - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  float band = reach * DH_FEAR_REACH * min(size.x, size.y) * (0.2 + 1.3 * n * n);
  float s = clamp(1.0 - across / max(band, 1.0), 0.0, 1.0);
  return mix(c, NIGHT_COLOR, orderedSteps(s * (2.0 - s), 4.0, bayer) * 0.92);
}

// Low health: a dark red rim, `rim` 0…1 including the heartbeat; the picture shows through it faintly as
// a red-stained shade, so the rim reads as blood over the scene, not as a painted frame.
vec3 bloodRim(vec3 c, vec2 p, vec2 size, float rim, float bayer) {
  if (rim <= 0.0) return c;
  float f = smoothstep(DH_RIM_INNER, DH_RIM_OUTER, radial(p, size));
  vec3 blood = mix(BLOOD_COLOR, c * vec3(0.9, 0.2, 0.2), 0.35);
  return mix(c, blood, orderedSteps(clamp(f * rim * DH_RIM_GAIN, 0.0, 1.0), 8.0, bayer) * DH_RIM_MIX);
}

// Poison: a sickly green rim, `rim` 0…1 including its slow swell.
vec3 sickRim(vec3 c, vec2 p, vec2 size, float rim, float bayer) {
  if (rim <= 0.0) return c;
  float f = smoothstep(DH_SICK_INNER, 1.0, radial(p, size));
  vec3 sick = c * vec3(0.72, 1.0, 0.5) + SICK_COLOR * 0.14;
  return mix(c, sick, orderedSteps(f * rim, 8.0, bayer) * 0.7);
}

// Heat and cold casts.
vec3 heatCast(vec3 c, float heat) {
  return mix(c, min(c * vec3(1.1, 0.97, 0.78), vec3(1.0)), clamp(heat, 0.0, 1.0) * 0.55);
}
vec3 coldCast(vec3 c, float cold) {
  return mix(c, min(picLuma(c) * vec3(0.8, 0.93, 1.12), vec3(1.0)), clamp(cold, 0.0, 1.0) * 0.45);
}

// Sampling offset of the state effects [picture px]: intoxication swims in slow waves, poison sways
// queasily, heat shimmers at the edges (Hitzschlag: everywhere). `motion` scales it (reduced motion).
vec2 stateOffset(vec2 p, vec2 size, float time, float drunk, float poison, float heat, float motion, sampler2D noise) {
  vec2 o = vec2(0.0);
  if (drunk > 0.0) {
    o.x += drunk * DH_DRUNK_PX * sin(p.y * 0.035 + time * 1.1);
    o.y += drunk * DH_DRUNK_PX * 0.6 * sin(p.x * 0.028 + time * 0.8);
  }
  if (poison > 0.0) o.x += poison * DH_POISON_PX * sin(time * 0.7 + p.y * 0.012);
  if (heat > 0.0) {
    float edge = 1.0 - clamp(edgeDistance(p, size) / (size.y * DH_HEAT_EDGE_REACH), 0.0, 1.0);
    float reach = max(edge, smoothstep(0.85, 1.0, heat));
    float n = texture(noise, p / 96.0 + vec2(0.0, time * 0.15)).b;
    o.x += sin(p.y * 0.9 + time * 6.0 + n * 6.2831853) * heat * DH_HEAT_EDGE_PX * reach;
  }
  return o * motion;
}

// Fine pixel grain: ± amount / 2, strongest in the dark, a new pattern each grain step (`seed`).
vec3 grain(vec3 c, vec2 p, float amount, float seed) {
  if (amount <= 0.0) return c;
  float h = fract(sin(dot(p + seed * vec2(17.13, 31.71), vec2(12.9898, 78.233))) * 43758.5453);
  float dark = 1.0 - clamp(picLuma(c), 0.0, 1.0);
  return c + (h - 0.5) * amount * DH_GRAIN_AMOUNT * dark * dark;
}

// Bayer transition: at cover `t` (0…1) the pixels whose key is below it show the cover colour – an iris
// closing from the corners towards the middle, its rim a dithered seam DH_TRANSITION_SEAM wide in 2 × 2
// cells of the Bayer pattern. Keys lie in [0, 1): cover 0 shows everything, cover 1 hides everything.
// Mirrors postPass.ts `transitionKey`.
float transitionKey(float radialDistance, float bayerCell) {
  return (1.0 - min(1.0, radialDistance)) * (1.0 - DH_TRANSITION_SEAM) + bayerCell * DH_TRANSITION_SEAM;
}
bool transitionCovers(vec2 p, vec2 size, float t, float bayerCell) {
  return transitionKey(radial(p, size), bayerCell) < t;
}
