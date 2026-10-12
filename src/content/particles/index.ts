/**
 * Particle data (MASTERPROMPT §6.2 "GPU-Partikel … Emitter als Daten", M5-11, M5-12, M5-21): kinds of particles
 * (`arten.ts`), their sources (`emitter.ts`), the weather particles and the lightning (`wetter.ts`), the world objects that are
 * sources while in view (`OBJECT_EMITTERS`, M7-123: the Geysirfeld's steam, `orte.ts`), the night life at the lights
 * (`LIGHT_VISITORS`, M7-149: moths, `nachtleben.ts`), validated with the
 * schemas of `schema.ts` and cross-checked (every referenced kind exists, a splash kind never splashes itself), then
 * frozen. The renderer (src/render/particles) compiles them into its GPU tables; the content registry lists kinds and
 * sources as the collections `particleKinds` and `particleEmitters` (they count nothing towards §C).
 */
import type { z } from 'zod';
import { checkContent } from '../check';
import { deepFreeze } from '../freeze';
import { PARTICLE_KIND_DATA } from './arten';
import { PARTICLE_EMITTER_DATA } from './emitter';
// Strand F (M7-35): the beacons' Lumen storm, sparks and embers.
import { PARTICLE_EMITTERS_LEUCHTFEUER } from './leuchtfeuer';
// Strand C (M7-13): the draft of the vaults' cracked walls and the sparks of their fire bowls.
import { PARTICLE_EMITTERS_GEWOELBE, PARTICLE_KINDS_GEWOELBE } from './gewoelbe';
// M7-123: the Geysirfeld's steam, bound to the geyser and the steam vents (`OBJECT_EMITTERS`); M7-141: the geyser's eruptions.
import { OBJECT_EMITTERS_ORTE, PARTICLE_EMITTERS_ORTE, PARTICLE_KINDS_ORTE } from './orte';
// M7-149: the moths at the lights (`LIGHT_VISITORS`).
import { LIGHT_VISITORS_NACHTLEBEN, PARTICLE_EMITTERS_NACHTLEBEN, PARTICLE_KINDS_NACHTLEBEN } from './nachtleben';
import { LIGHTNING_DATA, WEATHER_PARTICLE_DATA } from './wetter';
import {
  lightningSchema,
  lightVisitorSchema,
  objectEmitterSchema,
  particleEmitterSchema,
  particleKindSchema,
  weatherParticlesSchema,
  WEATHER_PARTICLE_IDS,
  type Lightning,
  type LightVisitor,
  type ObjectEmitter,
  type ParticleEmitter,
  type ParticleKind,
  type WeatherParticleId,
  type WeatherParticles,
} from './schema';

/** Error in the particle data. */
export class ParticleDataError extends Error {
  override readonly name = 'ParticleDataError';
}

/**
 * World-wide numbers of the particles: the wind speed at full weather wind (a storm carries smoke and sand about ten
 * tiles a second), and what the quality level "Niedrig" (§6.3 "Wetter/Partikel: reduziert") keeps of the weather
 * particles and of the sources' rates.
 */
export const PARTICLE_WORLD = deepFreeze({
  /** Wind speed at weather wind 1 [px/s]. */
  windPxPerS: 150,
  /** Share of the weather particles and of the emitted particles kept on "reduziert". */
  reduced: { weather: 0.5, emitters: 0.6 },
});

function parseAll<T>(what: string, schema: z.ZodType<T>, records: readonly { id: string }[]): readonly T[] {
  const seen = new Set<string>();
  return records.map((raw, i) => {
    const r = checkContent(schema, raw);
    if (!r.success) throw new ParticleDataError(`${what} [${i}] "${raw.id}": ${r.error.issues.map((x) => `${x.path.map(String).join('.') || '(record)'}: ${x.message}`).join('; ')}`);
    if (seen.has(raw.id)) throw new ParticleDataError(`${what}: duplicate id "${raw.id}"`);
    seen.add(raw.id);
    return r.data;
  });
}

/** Validates kinds, sources and weather particles and checks their references; throws `ParticleDataError`. */
export function defineParticles(kindData: readonly unknown[], emitterData: readonly unknown[], weatherData: readonly unknown[], lightningData: unknown) {
  const kinds = parseAll<ParticleKind>('particle kind', particleKindSchema, kindData as readonly { id: string }[]);
  const emitters = parseAll<ParticleEmitter>('particle emitter', particleEmitterSchema, emitterData as readonly { id: string }[]);
  const weather = parseAll<WeatherParticles>('weather particles', weatherParticlesSchema, weatherData as readonly { id: string }[]);
  const lightning = checkContent(lightningSchema, lightningData);
  if (!lightning.success) throw new ParticleDataError(`lightning: ${lightning.error.issues.map((x) => `${x.path.map(String).join('.')}: ${x.message}`).join('; ')}`);
  const byId = new Map(kinds.map((k) => [k.id, k]));
  const kindOf = (id: string, where: string): ParticleKind => {
    const k = byId.get(id);
    if (k === undefined) throw new ParticleDataError(`${where}: unknown particle kind "${id}"`);
    return k;
  };
  for (const k of kinds) {
    if (k.spritzer === undefined) continue;
    const s = kindOf(k.spritzer, `particle kind "${k.id}".spritzer`);
    if (s.boden === 'spritzen') throw new ParticleDataError(`particle kind "${k.id}": its splash "${s.id}" must not splash itself`);
  }
  for (const e of emitters) kindOf(e.art, `particle emitter "${e.id}".art`);
  for (const w of weather) for (const a of w.arten) kindOf(a.art, `weather particles "${w.id}".arten`);
  for (const id of WEATHER_PARTICLE_IDS) if (!weather.some((w) => w.id === id)) throw new ParticleDataError(`weather particles "${id}" missing`);
  return deepFreeze({ kinds, emitters, weather, lightning: lightning.data });
}

const PARTICLES = defineParticles(
  [...PARTICLE_KIND_DATA, ...PARTICLE_KINDS_GEWOELBE, ...PARTICLE_KINDS_ORTE, ...PARTICLE_KINDS_NACHTLEBEN],
  [...PARTICLE_EMITTER_DATA, ...PARTICLE_EMITTERS_LEUCHTFEUER, ...PARTICLE_EMITTERS_GEWOELBE, ...PARTICLE_EMITTERS_ORTE, ...PARTICLE_EMITTERS_NACHTLEBEN],
  WEATHER_PARTICLE_DATA,
  LIGHTNING_DATA,
);

/**
 * Validates the objects' sources (M7-123): each names a source of `emitters` (and so does each source of its eruption,
 * M7-141), each object once; throws `ParticleDataError`.
 * Whether the object exists is the content validator's (`tests/unit/content/objekt-emitter.test.ts` against the world objects).
 */
export function defineObjectEmitters(data: readonly unknown[], emitters: readonly ParticleEmitter[]): readonly ObjectEmitter[] {
  const seen = new Set<string>();
  return deepFreeze(
    data.map((raw, i) => {
      const r = checkContent(objectEmitterSchema, raw);
      if (!r.success) throw new ParticleDataError(`object emitter [${i}]: ${r.error.issues.map((x) => `${x.path.map(String).join('.') || '(record)'}: ${x.message}`).join('; ')}`);
      if (!emitters.some((e) => e.id === r.data.emitter)) throw new ParticleDataError(`object emitter "${r.data.objekt}": unknown particle emitter "${r.data.emitter}"`);
      for (const burst of r.data.rhythmus?.ausbruchEmitter ?? []) {
        if (!emitters.some((e) => e.id === burst)) throw new ParticleDataError(`object emitter "${r.data.objekt}": unknown eruption emitter "${burst}"`);
      }
      if (seen.has(r.data.objekt)) throw new ParticleDataError(`object emitter: "${r.data.objekt}" bound twice`);
      seen.add(r.data.objekt);
      return r.data;
    }),
  ) as readonly ObjectEmitter[];
}

/**
 * Validates the night life at the lights (M7-149): each names a source of `emitters`, no light kind twice over all of them;
 * throws `ParticleDataError`. Whether the light kinds exist is the content validator's (`tests/unit/render/motten.test.ts`
 * against src/content/lights.ts – the particle data does not import the lights).
 */
export function defineLightVisitors(data: readonly unknown[], emitters: readonly ParticleEmitter[]): readonly LightVisitor[] {
  const lights = new Set<string>();
  return deepFreeze(
    data.map((raw, i) => {
      const r = checkContent(lightVisitorSchema, raw);
      if (!r.success) throw new ParticleDataError(`light visitor [${i}]: ${r.error.issues.map((x) => `${x.path.map(String).join('.') || '(record)'}: ${x.message}`).join('; ')}`);
      if (!emitters.some((e) => e.id === r.data.emitter)) throw new ParticleDataError(`light visitor [${i}]: unknown particle emitter "${r.data.emitter}"`);
      for (const l of r.data.lichter) {
        if (lights.has(l)) throw new ParticleDataError(`light visitor [${i}]: light kind "${l}" visited twice`);
        lights.add(l);
      }
      return r.data;
    }),
  ) as readonly LightVisitor[];
}

/** Every kind of particle, in definition order (the index is the kind's row in the renderer's table). */
export const PARTICLE_KINDS: readonly ParticleKind[] = PARTICLES.kinds as readonly ParticleKind[];
/** Every particle source, in definition order. */
export const PARTICLE_EMITTERS: readonly ParticleEmitter[] = PARTICLES.emitters as readonly ParticleEmitter[];
/** Weather particles by id. */
export const WEATHER_PARTICLES: readonly WeatherParticles[] = PARTICLES.weather as readonly WeatherParticles[];
/** Lightning of a thunderstorm. */
export const LIGHTNING: Lightning = PARTICLES.lightning as Lightning;
/** The world objects that are particle sources while in view, with their source and its point (M7-123). */
export const OBJECT_EMITTERS: readonly ObjectEmitter[] = defineObjectEmitters(OBJECT_EMITTERS_ORTE, PARTICLE_EMITTERS);
/** The night life at the lights (M7-149: moths). */
export const LIGHT_VISITORS: readonly LightVisitor[] = defineLightVisitors(LIGHT_VISITORS_NACHTLEBEN, PARTICLE_EMITTERS);

/** The weather particles `id`. */
export function weatherParticles(id: WeatherParticleId): WeatherParticles {
  const w = WEATHER_PARTICLES.find((x) => x.id === id);
  if (w === undefined) throw new ParticleDataError(`weather particles "${id}" missing`);
  return w;
}

export * from './schema';
