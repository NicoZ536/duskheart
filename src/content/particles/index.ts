/**
 * Particle data (MASTERPROMPT §6.2 "GPU-Partikel … Emitter als Daten", M5-11, M5-12, M5-21): kinds of particles
 * (`arten.ts`), their sources (`emitter.ts`), the weather particles and the lightning (`wetter.ts`), validated with the
 * schemas of `schema.ts` and cross-checked (every referenced kind exists, a splash kind never splashes itself), then
 * frozen. The renderer (src/render/particles) compiles them into its GPU tables; the content registry lists kinds and
 * sources as the collections `particleKinds` and `particleEmitters` (they count nothing towards §C).
 */
import { deepFreeze } from '../freeze';
import { PARTICLE_KIND_DATA } from './arten';
import { PARTICLE_EMITTER_DATA } from './emitter';
import { LIGHTNING_DATA, WEATHER_PARTICLE_DATA } from './wetter';
import {
  lightningSchema,
  particleEmitterSchema,
  particleKindSchema,
  weatherParticlesSchema,
  WEATHER_PARTICLE_IDS,
  type Lightning,
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

function parseAll<T>(what: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } } }, records: readonly { id: string }[]): readonly T[] {
  const seen = new Set<string>();
  return records.map((raw, i) => {
    const r = schema.safeParse(raw);
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
  const lightning = lightningSchema.safeParse(lightningData);
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

const PARTICLES = defineParticles(PARTICLE_KIND_DATA, PARTICLE_EMITTER_DATA, WEATHER_PARTICLE_DATA, LIGHTNING_DATA);

/** Every kind of particle, in definition order (the index is the kind's row in the renderer's table). */
export const PARTICLE_KINDS: readonly ParticleKind[] = PARTICLES.kinds as readonly ParticleKind[];
/** Every particle source, in definition order. */
export const PARTICLE_EMITTERS: readonly ParticleEmitter[] = PARTICLES.emitters as readonly ParticleEmitter[];
/** Weather particles by id. */
export const WEATHER_PARTICLES: readonly WeatherParticles[] = PARTICLES.weather as readonly WeatherParticles[];
/** Lightning of a thunderstorm. */
export const LIGHTNING: Lightning = PARTICLES.lightning as Lightning;

/** The weather particles `id`. */
export function weatherParticles(id: WeatherParticleId): WeatherParticles {
  const w = WEATHER_PARTICLES.find((x) => x.id === id);
  if (w === undefined) throw new ParticleDataError(`weather particles "${id}" missing`);
  return w;
}

export * from './schema';
