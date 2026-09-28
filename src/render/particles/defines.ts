/**
 * `#define`s of the particle shaders (`particle_*.{glsl,vert,frag}`): one set of constants for TypeScript and GLSL.
 */
import { WEATHER_LAYERS_MAX } from '../../content/particles';
import { GROUND_CODE, KIND_ROWS, MAX_KINDS, SHAPE_CODE } from './kinds';
import { WEATHER_FALL_LIFE, WEATHER_IDLE_S, WEATHER_START_SPREAD, WEATHER_STATE, WEATHER_STATE_SLOTS } from './weather';

/** Opacity steps of a particle (flat translucency, §4.5 no smooth ramps). */
export const PARTICLE_ALPHA_STEPS = 8;
/** How much a line fades from head to tail (rain streaks and fast sparks thin out behind). */
export const LINE_TAIL_FADE = 0.6;
/** Bounce off the ground: share of the height kept, of the upward speed returned, of the sideways speed kept. */
export const BOUNCE = { height: 0.3, up: 0.35, sideways: 0.6 } as const;
/** Share of a wisp (its ellipse measure) drawn at full opacity; the rest is its half-covered rim. */
export const WISP_CORE = 0.45;
/** Heat shimmer: wave number along the column [rad/px] and its climb [rad/s]. */
export const SHIMMER_WAVE = { wave: 0.85, speed: 9 } as const;

function f(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

export function particleDefines(): Readonly<Record<string, string>> {
  return {
    DH_PARTICLE_KIND_ROWS: String(KIND_ROWS),
    DH_PARTICLE_KIND_VEC4S: String(KIND_ROWS * MAX_KINDS),
    DH_PARTICLE_WEATHER_LAYERS: String(WEATHER_LAYERS_MAX),
    DH_SHAPE_PUNKT: String(SHAPE_CODE.punkt),
    DH_SHAPE_STRICH: String(SHAPE_CODE.strich),
    DH_SHAPE_SCHEIBE: String(SHAPE_CODE.scheibe),
    DH_SHAPE_SPRITZER: String(SHAPE_CODE.spritzer),
    DH_SHAPE_FLOCKE: String(SHAPE_CODE.flocke),
    DH_SHAPE_SCHWADE: String(SHAPE_CODE.schwade),
    DH_GROUND_VERGEHEN: String(GROUND_CODE.vergehen),
    DH_GROUND_LIEGEN: String(GROUND_CODE.liegen),
    DH_GROUND_ABPRALLEN: String(GROUND_CODE.abprallen),
    DH_GROUND_SPRITZEN: String(GROUND_CODE.spritzen),
    DH_WEATHER_FALLING: String(WEATHER_STATE.falling),
    DH_WEATHER_LANDED: String(WEATHER_STATE.landed),
    DH_WEATHER_IDLE: String(WEATHER_STATE.idle),
    DH_WEATHER_STATE_SLOTS: f(WEATHER_STATE_SLOTS),
    DH_WEATHER_IDLE_MIN: f(WEATHER_IDLE_S.min),
    DH_WEATHER_IDLE_MAX: f(WEATHER_IDLE_S.max),
    DH_WEATHER_FALL_LIFE: f(WEATHER_FALL_LIFE),
    DH_WEATHER_START_SPREAD: f(WEATHER_START_SPREAD),
    DH_BOUNCE_HEIGHT: f(BOUNCE.height),
    DH_BOUNCE_UP: f(BOUNCE.up),
    DH_BOUNCE_SIDEWAYS: f(BOUNCE.sideways),
    DH_PARTICLE_ALPHA_STEPS: f(PARTICLE_ALPHA_STEPS),
    DH_LINE_TAIL_FADE: f(LINE_TAIL_FADE),
    DH_WISP_CORE: f(WISP_CORE),
    DH_SHIMMER_WAVE: f(SHIMMER_WAVE.wave),
    DH_SHIMMER_SPEED: f(SHIMMER_WAVE.speed),
  };
}
