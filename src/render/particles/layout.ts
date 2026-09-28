/**
 * Memory layout of the GPU particles (M5-11): one record of three vec4 per particle, simulated by transform feedback
 * (`particle_update.vert` reads a record and writes the next state into the other buffer) and drawn as instanced quads
 * (`particle_draw.vert`). The same layout is the spawn record the CPU writes into the ring (`spawn.ts`).
 *
 * | vec4 | x | y | z | w |
 * |---|---|---|---|---|
 * | `pos`  | x [world px] | y [world px] | height above the ground [px] | age [s] (≥ life: dead) |
 * | `vel`  | vx [px/s] | vy [px/s] | vz [px/s, up] | life [s] |
 * | `meta` | kind (row of the kind table) | seed 0…1 | phase (weather: cycles; splash: 1) | layer (0: world, > 0: weather parallax) |
 *
 * The buffer holds the weather pool first (`WEATHER_CAPACITY` particles that fall and start over around the camera,
 * `weather.ts`) and the ring of emitted particles after it (`RING_CAPACITY`, overwritten oldest first).
 */

/** Floats per particle record. */
export const PARTICLE_FLOATS = 12;
export const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
/** Bytes per particle record. */
export const PARTICLE_STRIDE = PARTICLE_FLOATS * FLOAT_BYTES;
/** Float offsets inside a record. */
export const P = {
  x: 0,
  y: 1,
  z: 2,
  age: 3,
  vx: 4,
  vy: 5,
  vz: 6,
  life: 7,
  kind: 8,
  seed: 9,
  phase: 10,
  layer: 11,
} as const;
/** Byte offsets of the three vec4 attributes. */
export const ATTRIB_OFFSET = { pos: 0, vel: 4 * FLOAT_BYTES, meta: 8 * FLOAT_BYTES } as const;
/** Attribute locations of the update program (`particle_update.vert`). */
export const UPDATE_LOCATION = { pos: 0, vel: 1, meta: 2 } as const;
/** Attribute locations of the draw program (`particle_draw.vert`). */
export const DRAW_LOCATION = { corner: 0, pos: 1, vel: 2, meta: 3 } as const;
/** Transform-feedback outputs of the update program, interleaved in record order. */
export const UPDATE_VARYINGS: readonly string[] = ['vPos', 'vVel', 'vMeta'];

/**
 * Particles of the weather pool (M5-12: the densest weather, a sandstorm, needs ≈ 3 300 at 480 × 270 and ≈ 5 300 at the
 * widest internal view 640 × 360, §4.2). Only the part the weather asks for is stepped and drawn.
 */
export const WEATHER_CAPACITY = 8192;
/** Particles of the emitter ring (M5-11: ≥ 20 000 simultaneously together with the weather). */
export const RING_CAPACITY = 28672;
/** All particles: the §30 budget "20 000 Partikel" with headroom. */
export const PARTICLE_CAPACITY = WEATHER_CAPACITY + RING_CAPACITY;
/** Most particles one source may spawn in one frame (a burst larger than this is spread over the next frames). */
export const MAX_SPAWNS_PER_STEP = 4096;

/** A dead record: age ≥ life. */
export const DEAD_AGE = 1;
export const DEAD_LIFE = 0;
