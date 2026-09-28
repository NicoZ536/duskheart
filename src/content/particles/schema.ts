/**
 * Schemas of the particle data (MASTERPROMPT §6.2 "GPU-Partikel … Emitter als Daten", M5-11/M5-12/M5-21): what a kind
 * of particle looks like and how it moves (`Partikelart`), where and how fast a source emits it (`Emitter`), and how a
 * kind of precipitation fills the sky around the camera (`Wetterpartikel`). The renderer (src/render/particles) turns
 * the records into its GPU tables; the data holds no code and no colours outside the master palette.
 *
 * Units: pixels of the internal resolution (world px), seconds, px/s, px/s². Heights (`z`) are pixels above the ground
 * the particle belongs to; on screen a particle at height z stands z px above its footprint (3/4 view).
 */
import { z } from 'zod';
import { paletteRefSchema } from '../biomes';
import { idSchema } from '../schema/common';

/**
 * Shapes a particle is drawn with, all on whole pixels:
 * - `punkt`: a square block of `groesse` px (sparks, ash, sand, embers).
 * - `strich`: a 1-px line along the particle's screen velocity (rain, fast sparks, blown sand), length from its speed.
 * - `scheibe`: a round puff of `groesse` px with a soft 1-px rim (smoke, dust, sand veils).
 * - `spritzer`: the crown of a raindrop hitting the ground – a dot, a small V, two flying droplets over its life.
 * - `flocke`: a snowflake – a dot, a 2×2 block, from 3 px a small plus.
 * - `schwade`: a wisp stretched along the screen velocity – `groesse` px thick, as long as a line (blown dust, spray).
 */
export const PARTICLE_SHAPES = ['punkt', 'strich', 'scheibe', 'spritzer', 'flocke', 'schwade'] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

/**
 * What a particle does when it reaches the ground (height 0):
 * - `vergehen`: it is gone (sparks falling back).
 * - `liegen`: it stops and lies until its life ends (snow, ash).
 * - `abprallen`: it bounces off with a third of its speed (hot sparks on stone).
 * - `spritzen`: it turns into the kind `spritzer` (a raindrop's splash).
 */
export const GROUND_CONTACTS = ['vergehen', 'liegen', 'abprallen', 'spritzen'] as const;
export type GroundContact = (typeof GROUND_CONTACTS)[number];

/** Largest particle [px]: a smoke puff at the end of its life. */
export const PARTICLE_SIZE_MAX_PX = 24;
/** Longest life of a particle [s]. */
export const PARTICLE_LIFE_MAX_S = 30;
/** Colours a particle passes through over its life (stepped, no blending: palette colours only). */
export const PARTICLE_COLORS_MAX = 4;

const unit = z.number().min(0).max(1);
/** A range `[min, max]` with `min ≤ max`. */
function range(lo: number, hi: number) {
  return z
    .object({ min: z.number().min(lo).max(hi), max: z.number().min(lo).max(hi) })
    .strict()
    .refine((r) => r.min <= r.max, { message: 'min must not exceed max' });
}

/** A kind of particle (`Partikelart`). */
export const particleKindSchema = z
  .object({
    id: idSchema,
    form: z.enum(PARTICLE_SHAPES),
    /** Size at birth [px] (a square's side, a puff's diameter, a line's width is always 1 px). */
    groesse: range(1, PARTICLE_SIZE_MAX_PX),
    /** Size at the end of its life as a multiple of the birth size (smoke swells, sparks shrink). */
    wachstum: z.number().min(0.25).max(8),
    /** Lines and wisps: length = speed × `faktor` [s], between `min` and `max` px. */
    strich: z.object({ faktor: z.number().min(0).max(0.2), min: z.number().min(1).max(32), max: z.number().min(1).max(48) }).strict().optional(),
    /** Palette colours over its life, from birth to death (1–4, stepped). */
    farben: z.array(paletteRefSchema).min(1).max(PARTICLE_COLORS_MAX),
    /** Opacity at birth and at death (linear in between, drawn in eight steps). */
    deckung: z.object({ start: unit, ende: unit }).strict(),
    /** 0: lit by the scene like any surface; > 0: glows with this HDR factor (sparks, embers) and ignores the light. */
    emissiv: z.number().min(0).max(4),
    /** Twinkle of its brightness [0 steady … 1 flickers to dark]. */
    flackern: unit,
    /** Life [s] (drawn per particle between min and max). */
    leben: range(0.05, PARTICLE_LIFE_MAX_S),
    /** Pull towards the ground [px/s²]; negative: it rises (hot smoke, embers). */
    schwerkraft: z.number().min(-400).max(1600),
    /** Air drag [1/s]: how fast its velocity relaxes towards the wind (and its rise towards rest). */
    widerstand: z.number().min(0).max(20),
    /** How strongly the wind carries it [share of the wind speed]. */
    wind: z.number().min(0).max(2),
    /** Swirl of the air it drifts in [px/s] and its rate [Hz] (snow sways, smoke curls, sparks wobble). */
    wirbel: z.number().min(0).max(200),
    wirbelTakt: z.number().min(0).max(8),
    boden: z.enum(GROUND_CONTACTS),
    /** The kind a `spritzen` particle turns into at the ground. */
    spritzer: idSchema.optional(),
  })
  .strict()
  .refine((k) => (k.boden === 'spritzen') === (k.spritzer !== undefined), { message: 'a splash kind exactly when the ground contact is "spritzen"', path: ['spritzer'] })
  .refine((k) => (k.form === 'strich' || k.form === 'schwade') === (k.strich !== undefined), { message: 'line settings exactly for the shapes "strich" and "schwade"', path: ['strich'] })
  .refine((k) => k.strich === undefined || k.strich.min <= k.strich.max, { message: 'line min must not exceed max', path: ['strich'] });
export type ParticleKind = z.output<typeof particleKindSchema>;
export type ParticleKindInput = z.input<typeof particleKindSchema>;

/** Shape of the ground patch a source emits from. */
export const EMITTER_AREAS = ['kreis', 'rechteck'] as const;
/**
 * What `richtung` is measured from: `fest` – screen east (every particle the same way), `radial` – outward from the
 * source through the particle's birth point (a burst), `tangential` – a quarter turn from that, clockwise (a vortex).
 */
export const EMITTER_ALIGNMENTS = ['fest', 'radial', 'tangential'] as const;

/** A source of particles (`Emitter`): placed by the presentation (a burning tile, a camp fire, a torch). */
export const particleEmitterSchema = z
  .object({
    id: idSchema,
    /** Kind emitted. */
    art: idSchema,
    /** Particles per second at full strength (the presentation scales it by the source's strength). */
    rate: z.number().min(0).max(8000),
    /** Ground patch of the births: an ellipse or rectangle of `breite` × `tiefe` px around the source. */
    flaeche: z.object({ form: z.enum(EMITTER_AREAS), breite: z.number().min(0).max(640), tiefe: z.number().min(0).max(360) }).strict(),
    /** Height of the births above the source [px]. */
    hoehe: range(0, 360),
    /** Speed along the ground at birth [px/s], towards `richtung` [° clockwise, from `ausrichtung`] ± `streuung`/2. */
    tempo: range(0, 800),
    richtung: z.number().min(0).max(360),
    streuung: z.number().min(0).max(360),
    ausrichtung: z.enum(EMITTER_ALIGNMENTS).default('fest'),
    /** Upward speed at birth [px/s] (negative: thrown down). */
    steigen: range(-800, 800),
  })
  .strict();
export type ParticleEmitter = z.output<typeof particleEmitterSchema>;
export type ParticleEmitterInput = z.input<typeof particleEmitterSchema>;

/** Kinds of weather particles, one per kind of precipitation (and the blown sand of a sandstorm). */
export const WEATHER_PARTICLE_IDS = ['regen', 'schnee', 'asche', 'sand'] as const;
export type WeatherParticleId = (typeof WEATHER_PARTICLE_IDS)[number];
/** Parallax layers of a weather (far, ground, near). */
export const WEATHER_LAYERS_MAX = 3;

/**
 * Weather particles (`Wetterpartikel`, M5-12): the sky around the camera filled with one kind of precipitation. Each
 * particle falls from up to `hoehe` px above a point of the ground, is carried by the wind and starts over above a new
 * point when it lands; the layers draw it with parallax (a far layer scrolls slower, a near one faster and larger), only
 * the ground layer (`parallaxe` 1) lands on the ground (splashes, snow lying).
 */
export const weatherParticlesSchema = z
  .object({
    id: z.enum(WEATHER_PARTICLE_IDS),
    /** Kinds falling, with their share (drawn per particle; e.g. ash with a few glowing embers). */
    arten: z
      .array(z.object({ art: idSchema, anteil: z.number().positive().max(1) }).strict())
      .min(1)
      .max(3),
    /** Particles per 10 000 px² of sky at full precipitation (and full quality). */
    dichte: z.number().min(0).max(400),
    /** Falling speed [px/s]. */
    fall: range(0, 600),
    /** Highest start above the ground [px]. */
    hoehe: z.number().min(0).max(540),
    /** Share of the wind's speed it drifts with (sand flies with the storm, snow sways, rain slants). */
    wind: z.number().min(0).max(3),
    /** Parallax layers: scroll factor, share of the particles, size and opacity factors. */
    schichten: z
      .array(z.object({ parallaxe: z.number().min(0.5).max(2), anteil: z.number().positive().max(1), groesse: z.number().min(0.25).max(3), deckung: z.number().min(0).max(1.5) }).strict())
      .min(1)
      .max(WEATHER_LAYERS_MAX),
  })
  .strict()
  .refine((w) => Math.abs(w.arten.reduce((s, a) => s + a.anteil, 0) - 1) < 1e-6, { message: 'kind shares must add up to 1', path: ['arten'] })
  .refine((w) => Math.abs(w.schichten.reduce((s, l) => s + l.anteil, 0) - 1) < 1e-6, { message: 'layer shares must add up to 1', path: ['schichten'] })
  .refine((w) => w.schichten.filter((l) => l.parallaxe === 1).length === 1, { message: 'exactly one ground layer (parallaxe 1)', path: ['schichten'] });
export type WeatherParticles = z.output<typeof weatherParticlesSchema>;
export type WeatherParticlesInput = z.input<typeof weatherParticlesSchema>;

/**
 * Lightning of a thunderstorm (§6.1 pass 8 "Blitz (Vollbildblitz …)", M5-12): strikes come at uneven intervals, each a
 * short bright flash followed by a weaker after-flash; the flash lights every surface with the cold colour of the
 * lightning. With "Blitz- und Flackerreduktion" (§29) one soft pulse at most `reduziert` of the strength remains.
 */
export const lightningSchema = z
  .object({
    /** Seconds between two strikes (drawn per strike). */
    abstand: range(1, 60),
    /** Length of the first flash, the dark gap and the after-flash [s]. */
    blitz: z.number().min(0.02).max(0.5),
    pause: z.number().min(0).max(0.5),
    nachblitz: z.number().min(0.02).max(1),
    /** Strength of the after-flash relative to the first. */
    nachblitzStaerke: unit,
    /** Light the flash adds to every surface at full strength [light level]. */
    staerke: z.number().min(0).max(4),
    /**
     * Share of that light laid over the whole picture as a flat veil (the lit air and rain between camera and ground):
     * colours wash out towards the flash's cold white, the sky outside the world lights up too.
     */
    schleier: unit,
    /** Colour of the flash. */
    farbe: paletteRefSchema,
    /** Strength left with flash reduction, and the length of its one soft pulse [s]. */
    reduziert: unit,
    reduziertDauer: z.number().min(0.05).max(2),
  })
  .strict();
export type Lightning = z.output<typeof lightningSchema>;
