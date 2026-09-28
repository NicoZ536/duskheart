#version 300 es
precision highp float;
precision highp int;
// GPU particle step (M5-11, M5-12) by transform feedback: reads one particle record and writes its state after
// `uSubsteps` sub-steps of `uDt` seconds into the other buffer (src/render/particles/system.ts). Nothing is rasterised.
// An ordinary frame steps once; the prewarm after a start-over runs long steps of many sub-steps (few draw calls,
// the same small sub-step as every frame).
//
// Emitted particles (layer 0): drag pulls their velocity towards the wind (sideways) and towards rest (up/down),
// gravity pulls them down (negative: they rise), the swirl of the air moves them; a newborn (age ≤ 0 at the start of
// a sub-step) moves only for its share of it. At the ground they vanish, lie, bounce or turn into their splash kind.
//
// Weather particles (layer 1…3, src/render/particles/weather.ts): fall at their speed and drift with the weather's
// wind; the ground layer lands (splash, lying snow), the others start over when they reach the ground. A particle
// whose index is beyond the number the weather needs waits (idle) and checks again. Positions stay inside the box of
// sky around the camera (layer space: camera × parallax).
#include "particle_common.glsl"

layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aVel;
layout(location = 2) in vec4 aMeta;

out vec4 vPos;
out vec4 vVel;
out vec4 vMeta;

uniform float uDt;                 // sub-step [s]
uniform int uSubsteps;             // sub-steps of this step (≥ 1)
uniform float uTime;               // end of the step [s] (wrapped, drives the swirl)
uniform vec2 uWind;                // wind [px/s]
uniform vec2 uCamera;              // view centre [world px]
uniform vec4 uWeatherBox;          // half width, top, bottom [px, layer space], particles falling
uniform vec4 uWeatherFall;         // fall min, fall max [px/s], start height [px], wind share
uniform ivec4 uWeatherKinds;       // kinds of the shares (−1 unused), number of kinds (0: no weather)
uniform vec4 uWeatherKindShares;   // cumulative shares of the kinds
uniform vec4 uWeatherLayers[DH_PARTICLE_WEATHER_LAYERS];  // parallax, cumulative share, size, opacity
uniform int uWeatherLayerCount;
uniform uint uWeatherSalt;         // varies the starts after a reset

// The record while it is stepped (read at the start of a sub-step, written by it).
vec4 sPos;
vec4 sVel;
vec4 sMeta;

float cycleOf(float phase) {
  return floor(phase / DH_WEATHER_STATE_SLOTS);
}

int stateOf(float phase) {
  return int(phase - cycleOf(phase) * DH_WEATHER_STATE_SLOTS + 0.5);
}

// A new fall for weather particle `i` in cycle `cycle` – or a wait when the weather needs fewer particles.
void respawn(int i, float cycle) {
  uint h = particleHash(uint(i) * 2654435761u ^ particleHash(uint(cycle) + uWeatherSalt));
  float u1 = hashUnit(h); h = particleHash(h);
  float u2 = hashUnit(h); h = particleHash(h);
  float u3 = hashUnit(h); h = particleHash(h);
  float u4 = hashUnit(h); h = particleHash(h);
  float u5 = hashUnit(h); h = particleHash(h);
  float u6 = hashUnit(h); h = particleHash(h);
  float u7 = hashUnit(h); h = particleHash(h);
  float u8 = hashUnit(h);
  if (uWeatherKinds.w <= 0 || float(i) >= uWeatherBox.w) {
    sPos.w = 0.0;
    sVel = vec4(0.0, 0.0, sVel.z, mix(DH_WEATHER_IDLE_MIN, DH_WEATHER_IDLE_MAX, u1));
    sMeta.z = cycle * DH_WEATHER_STATE_SLOTS + float(DH_WEATHER_IDLE);
    return;
  }
  int layer = uWeatherLayerCount - 1;
  for (int l = 0; l < DH_PARTICLE_WEATHER_LAYERS; l++) {
    if (l < uWeatherLayerCount - 1 && u2 < uWeatherLayers[l].y) { layer = l; break; }
  }
  int kind = uWeatherKinds.x;
  if (uWeatherKinds.w > 1 && u3 >= uWeatherKindShares.x) kind = uWeatherKinds.w > 2 && u3 >= uWeatherKindShares.y ? uWeatherKinds.z : uWeatherKinds.y;
  float parallax = uWeatherLayers[layer].x;
  vec2 q = vec2((u4 * 2.0 - 1.0) * uWeatherBox.x, uWeatherBox.y + u5 * (uWeatherBox.z - uWeatherBox.y));
  sPos = vec4(q + uCamera * parallax, uWeatherFall.z * (1.0 - DH_WEATHER_START_SPREAD * u6), 0.0);
  sVel = vec4(0.0, 0.0, -mix(uWeatherFall.x, uWeatherFall.y, u7), DH_WEATHER_FALL_LIFE);
  sMeta = vec4(float(kind), u8, cycle * DH_WEATHER_STATE_SLOTS + float(DH_WEATHER_FALLING), float(layer + 1));
}

void stepWeather(float time) {
  float cycle = cycleOf(sMeta.z);
  int state = stateOf(sMeta.z);
  int layer = clamp(int(sMeta.w + 0.5) - 1, 0, DH_PARTICLE_WEATHER_LAYERS - 1);
  bool again = false;
  if (state != DH_WEATHER_FALLING) {
    sPos.w += uDt;
    again = sPos.w >= sVel.w;
  } else {
    int kind = int(sMeta.x + 0.5);
    vec4 r4 = kindRow(kind, 4);
    vec4 r5 = kindRow(kind, 5);
    vec2 drift = uWind * uWeatherFall.w * r4.z + particleSwirl(sPos.xy, sMeta.y, r4.w, r5.x, time);
    vec3 p = sPos.xyz + vec3(drift, sVel.z) * uDt;
    sPos = vec4(p, sPos.w + uDt);
    sVel.xy = drift;
    if (p.z <= 0.0) {
      int ground = int(r5.y + 0.5);
      bool onGround = abs(uWeatherLayers[layer].x - 1.0) < 0.001;
      if (onGround && ground == DH_GROUND_SPRITZEN) {
        int splash = int(r5.z + 0.5);
        vec4 r6 = kindRow(splash, 6);
        sPos = vec4(p.xy, 0.0, 0.0);
        sVel = vec4(0.0, 0.0, 0.0, mix(r6.x, r6.y, sMeta.y));
        sMeta.x = float(splash);
        sMeta.z = cycle * DH_WEATHER_STATE_SLOTS + float(DH_WEATHER_LANDED);
      } else if (onGround && ground == DH_GROUND_LIEGEN) {
        vec4 r6 = kindRow(kind, 6);
        sPos = vec4(p.xy, 0.0, 0.0);
        sVel = vec4(0.0, 0.0, 0.0, mix(r6.x, r6.y, sMeta.y));
        sMeta.z = cycle * DH_WEATHER_STATE_SLOTS + float(DH_WEATHER_LANDED);
      } else {
        again = true;
      }
    }
  }
  if (again) respawn(gl_VertexID, cycle + 1.0);
  float parallax = uWeatherLayers[clamp(int(sMeta.w + 0.5) - 1, 0, DH_PARTICLE_WEATHER_LAYERS - 1)].x;
  sPos.xy = wrapWeather(sPos.xy - uCamera * parallax, uWeatherBox.xyz) + uCamera * parallax;
}

void stepWorld(float time) {
  float life = sVel.w;
  if (sPos.w >= life) return;
  float age = sPos.w + uDt;
  sPos.w = age;
  float dt = clamp(age, 0.0, uDt);
  // Lying on the ground or splashed: it stays where it is until its life ends.
  if (dt <= 0.0 || sMeta.z > 0.5) return;
  int kind = int(sMeta.x + 0.5);
  vec4 r4 = kindRow(kind, 4);
  vec4 r5 = kindRow(kind, 5);
  vec3 v = sVel.xyz;
  float relax = 1.0 - exp(-r4.y * dt);
  v.xy += (uWind * r4.z - v.xy) * relax;
  v.z = v.z * (1.0 - relax) - r4.x * dt;
  vec3 p = sPos.xyz + vec3(v.xy + particleSwirl(sPos.xy, sMeta.y, r4.w, r5.x, time), v.z) * dt;
  if (p.z <= 0.0) {
    int ground = int(r5.y + 0.5);
    if (ground == DH_GROUND_VERGEHEN) {
      sPos.w = life;
    } else if (ground == DH_GROUND_LIEGEN) {
      p.z = 0.0;
      v = vec3(0.0);
      sMeta.z = 1.0;
    } else if (ground == DH_GROUND_ABPRALLEN) {
      p.z = -p.z * DH_BOUNCE_HEIGHT;
      v = vec3(v.xy * DH_BOUNCE_SIDEWAYS, -v.z * DH_BOUNCE_UP);
    } else {
      int splash = int(r5.z + 0.5);
      vec4 r6 = kindRow(splash, 6);
      p.z = 0.0;
      v = vec3(0.0);
      sMeta.x = float(splash);
      sMeta.z = 1.0;
      sPos.w = 0.0;
      sVel.w = mix(r6.x, r6.y, sMeta.y);
    }
  }
  sPos.xyz = p;
  sVel.xyz = v;
}

void main() {
  sPos = aPos;
  sVel = aVel;
  sMeta = aMeta;
  bool weather = aMeta.w > 0.5;
  for (int s = 0; s < uSubsteps; s++) {
    float time = uTime - float(uSubsteps - 1 - s) * uDt;
    if (weather) stepWeather(time);
    else stepWorld(time);
  }
  vPos = sPos;
  vVel = sVel;
  vMeta = sMeta;
}
