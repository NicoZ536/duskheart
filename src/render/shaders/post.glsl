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
  return DH_FROST_FINGER_LEAST + DH_FROST_FINGER_EXTRA * fract(sin(floor(along / DH_FROST_FINGER_PX) * 12.9898) * 43758.5453);
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
// are quantised with the Bayer threshold (`orderedSteps`, atmosphere.glsl) – bands with dithered seams. Their
// parameters: src/render/passes/postPass.ts (`POST_LOOK`, `STATE_CASTS`, `STATE_SWAY`, `FEAR_TENDRILS`).

const vec3 NIGHT_COLOR = vec3(13.0, 10.0, 20.0) / 255.0;   // nacht.0: fear's shadows
const vec3 BLOOD_COLOR = vec3(90.0, 20.0, 32.0) / 255.0;   // feuer.0: the low-health rim
const vec3 SICK_COLOR = vec3(120.0, 173.0, 69.0) / 255.0;  // gras.4: poison

float picLuma(vec3 c) {
  return dot(c, DH_LUMA);
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
  float bend = texture(noise, vec2(u * DH_FEAR_BEND_ALONG, across / (DH_FEAR_TILE * DH_FEAR_BEND_ACROSS))).b - 0.5;
  float n = texture(noise, vec2(u + bend * DH_FEAR_BEND, across / (DH_FEAR_TILE * DH_FEAR_STRETCH) - time * DH_FEAR_FLOW)).g;
  n = clamp((n - 0.5) * DH_FEAR_CONTRAST + 0.5, 0.0, 1.0);
  float band = reach * DH_FEAR_REACH * min(size.x, size.y) * (DH_FEAR_REACH_BASE + DH_FEAR_REACH_GAIN * n * n);
  float s = clamp(1.0 - across / max(band, 1.0), 0.0, 1.0);
  return mix(c, NIGHT_COLOR, orderedSteps(s * (2.0 - s), DH_FEAR_STEPS, bayer) * DH_FEAR_COVER);
}

// Low health: a dark red rim, `rim` 0…1 including the heartbeat; the picture shows through it faintly as
// a red-stained shade, so the rim reads as blood over the scene, not as a painted frame.
vec3 bloodRim(vec3 c, vec2 p, vec2 size, float rim, float bayer) {
  if (rim <= 0.0) return c;
  float f = smoothstep(DH_RIM_INNER, DH_RIM_OUTER, radial(p, size));
  vec3 blood = mix(BLOOD_COLOR, c * DH_BLOOD_STAIN, DH_BLOOD_SHOW);
  return mix(c, blood, orderedSteps(clamp(f * rim * DH_RIM_GAIN, 0.0, 1.0), DH_RIM_STEPS, bayer) * DH_RIM_MIX);
}

// Poison: a sickly green rim in blotches, `rim` 0…1 including its slow swell. Where the low-health rim is a smooth band,
// this one creeps in as a ragged chain of blots, fading inwards – the two differ in shape, not only in hue (a colour-blind
// viewer tells them apart, review M5 Minor 7): `edge` 0 inside … 1 at the rim, `n` the picture-anchored noise. Mirrors
// postPass.ts `sickCover`.
float sickCover(float edge, float rim, float n) {
  float s = edge * rim;
  float k = clamp((n - 0.5) * DH_SICK_BLOT_CONTRAST + 0.5, 0.0, 1.0);
  return clamp((k - (1.0 - s)) * DH_SICK_BLOT_SHARP + s, 0.0, 1.0) * s;
}
vec3 sickRim(vec3 c, vec2 p, vec2 size, float rim, float bayer, sampler2D noise) {
  if (rim <= 0.0) return c;
  float f = smoothstep(DH_SICK_INNER, 1.0, radial(p, size));
  float cover = sickCover(f, rim, texture(noise, (p + 0.5) / DH_SICK_BLOT_PX).r);
  vec3 sick = c * DH_SICK_TINT + SICK_COLOR * DH_SICK_GLOW;
  return mix(c, sick, orderedSteps(cover, DH_RIM_STEPS, bayer) * DH_SICK_MIX);
}

// Heat and cold casts.
vec3 heatCast(vec3 c, float heat) {
  return mix(c, min(c * DH_HEAT_TINT, vec3(1.0)), clamp(heat, 0.0, 1.0) * DH_HEAT_CAST);
}
vec3 coldCast(vec3 c, float cold) {
  return mix(c, min(picLuma(c) * DH_COLD_TINT, vec3(1.0)), clamp(cold, 0.0, 1.0) * DH_COLD_CAST);
}

// Sampling offset of the state effects [picture px]: intoxication swims in slow waves, poison sways
// queasily, heat shimmers at the edges (Hitzschlag: everywhere). `motion` scales it (reduced motion).
vec2 stateOffset(vec2 p, vec2 size, float time, float drunk, float poison, float heat, float motion, sampler2D noise) {
  vec2 o = vec2(0.0);
  if (drunk > 0.0) {
    o.x += drunk * DH_DRUNK_PX * sin(p.y * DH_DRUNK_WAVE_X + time * DH_DRUNK_SPEED_X);
    o.y += drunk * DH_DRUNK_PX * DH_DRUNK_VERTICAL * sin(p.x * DH_DRUNK_WAVE_Y + time * DH_DRUNK_SPEED_Y);
  }
  if (poison > 0.0) o.x += poison * DH_POISON_PX * sin(time * DH_POISON_SPEED + p.y * DH_POISON_WAVE);
  if (heat > 0.0) {
    float edge = 1.0 - clamp(edgeDistance(p, size) / (size.y * DH_HEAT_EDGE_REACH), 0.0, 1.0);
    float reach = max(edge, smoothstep(DH_HEAT_EVERYWHERE, 1.0, heat));
    float n = texture(noise, p / DH_HEAT_NOISE_PX + vec2(0.0, time * DH_HEAT_NOISE_CLIMB)).b;
    o.x += sin(p.y * DH_HEAT_WAVE + time * DH_HEAT_SPEED + n * 6.2831853) * heat * DH_HEAT_EDGE_PX * reach;
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

// Colour-blind correction (accessibility §29, M5-14; review M5 Minor 7): the finished display colour through the mode's
// matrix (`colorblindMatrix`, src/render/post/grading.ts), clamped – the last step of the picture, so the red and green
// state rims reach the viewer corrected like the scene. Mirrors grading.ts `daltonize`.
vec3 colorblindCorrect(vec3 c, mat3 m) {
  return clamp(m * c, 0.0, 1.0);
}
