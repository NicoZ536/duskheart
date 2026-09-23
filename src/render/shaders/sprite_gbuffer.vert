#version 300 es
precision highp float;
precision highp int;
// Instanced sprite quads for the G-buffer (instance layout: src/render/batch/spriteLayout.ts).
layout(location = 0) in vec2 aCorner;   // quad corner, 0 or 1 per axis
layout(location = 1) in vec2 aPos;      // anchor, world px (interpolated; snapped here)
layout(location = 2) in vec4 aParams;   // height base px, wind amplitude px, wind phase, rotation
layout(location = 3) in uvec4 aRect;    // atlas frame x, y, w, h
layout(location = 4) in ivec2 aAnchor;  // anchor in the frame (pixel edges)
layout(location = 5) in vec4 aTint;     // overlay rgb + strength
layout(location = 6) in uvec4 aMisc;    // palette row, flags, emissive boost, dither fade

uniform vec2 uOrigin;      // world px of target pixel (0, 0), top-left, whole pixels
uniform vec2 uTargetSize;  // target size in px
uniform vec2 uWind;        // signed wind strength, time in seconds

const uint FLAG_MIRROR = 1u;
const uint FLAG_WIND = 8u;

out vec2 vLocal;                 // frame px (unmirrored)
flat out uvec4 vRect;
flat out uvec4 vMisc;
flat out vec4 vTint;
flat out vec2 vAnchor;
flat out float vHeightBase;
flat out vec2 vRotation;         // cos, sin

void main() {
  uint flags = aMisc.y;
  vec2 local = aCorner * vec2(aRect.zw);
  vec2 anchor = vec2(aAnchor);
  vec2 rel = local - anchor;
  // Mirroring reflects about the vertical line through the anchor point.
  if ((flags & FLAG_MIRROR) != 0u) rel.x = -rel.x;
  if ((flags & FLAG_WIND) != 0u) {
    // Sway grows quadratically with the height above the anchor (the foot stays put).
    float up = clamp(-rel.y / max(1.0, anchor.y), 0.0, 1.0);
    rel.x += aParams.y * uWind.x * sin(uWind.y * DH_WIND_FREQUENCY + aParams.z) * up * up;
  }
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  rel = vec2(c * rel.x - s * rel.y, s * rel.x + c * rel.y);
  // Pixel snapping after interpolation (MASTERPROMPT §3.3): same rule as camera.ts snapToPixel.
  vec2 target = floor(aPos + 0.5) + rel - uOrigin;
  vec2 clip = target / uTargetSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vRect = aRect;
  vMisc = aMisc;
  vTint = aTint;
  vAnchor = anchor;
  vHeightBase = aParams.x;
  vRotation = vec2(c, s);
}
