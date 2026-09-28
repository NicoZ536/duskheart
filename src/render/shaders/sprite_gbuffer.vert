#version 300 es
precision highp float;
precision highp int;
// Instanced sprite quads for the G-buffer (instance layout: src/render/batch/spriteLayout.ts).
// Wind (M5-17): sprites flagged for wind sway with the weather's wind vector – a steady lean downwind plus an
// oscillation, stronger where gust fronts roll over the meadow – growing quadratically above the anchor (the foot
// stays put). Interactive grass (M5-17): sprites with a bend strength lean away from the figures that press the
// interaction texture (src/render/surface/interactionPass.ts) and are pressed down under them.
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec2 aPos;      // anchor, world px (interpolated; snapped here)
layout(location = 2) in vec4 aParams;   // height base px, wind amplitude px, wind phase, rotation
layout(location = 3) in uvec4 aRect;    // atlas frame x, y, w, h
layout(location = 4) in ivec2 aAnchor;  // anchor in the frame (pixel edges)
layout(location = 5) in vec4 aTint;     // overlay rgb + strength
layout(location = 6) in uvec4 aMisc;    // palette row, flags, emissive boost, dither fade
layout(location = 7) in uvec4 aSurface; // second palette row, row blend, surface flags, grass bend

uniform vec2 uOrigin;      // world px of target pixel (0, 0), top-left, whole pixels
uniform vec2 uTargetSize;  // target size in px
uniform vec4 uWind;        // wind x, y (sway scale; the direction it blows towards), time [s], gust strength 0…1
uniform sampler2D uInteraction;  // R = pressure of the figures on the grass (world-anchored, 1 texel = 1 px)
uniform vec4 uInteractionRect;   // world px of texel (0, 0), size in texels (z = 0: no interaction texture)

const uint FLAG_MIRROR = 1u;
const uint FLAG_WIND = 8u;
const float TAU = 6.2831853;

out vec2 vLocal;                 // frame px (unmirrored)
flat out uvec4 vRect;
flat out uvec4 vMisc;
flat out uvec4 vSurface;
flat out vec4 vTint;
flat out vec2 vAnchor;
flat out vec2 vAnchorWorld;      // snapped anchor, world px (world-anchored patterns of the sprite)
flat out float vHeightBase;
flat out vec2 vRotation;         // cos, sin

float pressureAt(vec2 world) {
  vec2 t = floor(world - uInteractionRect.xy);
  if (any(lessThan(t, vec2(0.0))) || any(greaterThanEqual(t, uInteractionRect.zw))) return 0.0;
  return texelFetch(uInteraction, ivec2(t), 0).r;
}

void main() {
  uint flags = aMisc.y;
  vec2 local = aCorner * vec2(aRect.zw);
  vec2 anchor = vec2(aAnchor);
  vec2 rel = local - anchor;
  vec2 anchorWorld = floor(aPos + 0.5);
  // Mirroring reflects about the vertical line through the anchor point.
  if ((flags & FLAG_MIRROR) != 0u) rel.x = -rel.x;
  // Share of the sprite's height above the anchor (0 at the foot, 1 at the top).
  float up = clamp(-rel.y / max(1.0, anchor.y), 0.0, 1.0);
  if ((flags & FLAG_WIND) != 0u) {
    float strength = length(uWind.xy);
    float gust = 1.0;
    if (strength > 1e-4 && uWind.w > 0.0) {
      // Gust fronts travel downwind: a wave along the wind direction, anchored to the world.
      float along = dot(anchorWorld, uWind.xy / strength);
      gust = 1.0 + uWind.w * DH_GUST_STRENGTH * sin((along - uWind.z * DH_GUST_SPEED) * TAU / DH_GUST_WAVELENGTH);
    }
    float sway = aParams.y * (DH_WIND_LEAN + (1.0 - DH_WIND_LEAN) * sin(uWind.z * DH_WIND_FREQUENCY + aParams.z)) * gust * up * up;
    rel += vec2(uWind.x, uWind.y * DH_WIND_DEPTH_SHARE) * sway;
  }
  if (aSurface.w > 0u && uInteractionRect.z > 0.0) {
    // Lean away from the push (against the pressure gradient), pressed down where a figure stands on it.
    float k = float(aSurface.w) / 255.0;
    vec2 probe = vec2(float(DH_PROBE_PX), 0.0);
    float gx = pressureAt(anchorWorld + probe) - pressureAt(anchorWorld - probe);
    float gy = pressureAt(anchorWorld + probe.yx) - pressureAt(anchorWorld - probe.yx);
    float p = pressureAt(anchorWorld - vec2(0.0, 1.0));
    vec2 lean = clamp(-vec2(gx, gy) * 1.5, vec2(-1.0), vec2(1.0));
    rel.x += lean.x * DH_BEND_PX * k * up;
    rel.y += lean.y * DH_BEND_PX * 0.5 * k * up;
    rel.y *= 1.0 - p * DH_FLATTEN_SHARE * k;
  }
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  rel = vec2(c * rel.x - s * rel.y, s * rel.x + c * rel.y);
  // Pixel snapping after interpolation (MASTERPROMPT §3.3): same rule as camera.ts snapToPixel.
  vec2 target = anchorWorld + rel - uOrigin;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vMisc = aMisc;
  vSurface = aSurface;
  vTint = aTint;
  vAnchor = anchor;
  vAnchorWorld = anchorWorld;
  vHeightBase = aParams.x;
  vRotation = vec2(c, s);
}
