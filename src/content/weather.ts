/**
 * Weather and climate content (MASTERPROMPT §9.3, §10; docs/WORLD.md §6; M2-25, M2-26).
 *
 * - **Weather states** (`WEATHER_STATES`): the 12 states of §10 with the values the weather system
 *   blends between (cloud cover, wind, precipitation, haze, daylight factor), the temperature offset
 *   (§10: Regen −3, Gewitter −5, Schnee −4, Schneesturm −10, Hitzewelle +8, Sandsturm +3, Ascheregen
 *   +2; the other states have none) and the duration range (§10: 1–8 game hours).
 * - **Transition matrices** per surface biome × season (§10 "Übergangsmatrizen als Content"). They
 *   are generated deterministically from two readable tables instead of 32 hand-written 12×12
 *   matrices (docs/ARCHITEKTUR.md "Content": "teils per deterministischem Generator aus Tabellen"):
 *   `WEATHER_CLIMATES` says how common each state is in a biome and season, `WEATHER_AFFINITY` how
 *   plausible each succession is (rain after clouds, thunderstorm after a heatwave …). Row `from` of a
 *   matrix is `P(to) = weight(to) × affinity(from, to) / Σ`. `weatherTables()` validates both tables
 *   and builds the normalised matrices once.
 * - **Climate balance** (`CLIMATE_BALANCE`): the parameters of the temperature field that §9.3 leaves
 *   open (shape of the day curve, caves, lava heat) and the weather blend time, each with unit and
 *   reason.
 *
 * Biome base temperatures and day amplitudes live with the biomes (src/content/biomes.ts), season
 * offsets and the height gradient in `BALANCE` (src/content/balance.ts).
 */
import { z } from 'zod';
import { BALANCE, SEASON_IDS, type SeasonId } from './balance';
import { BIOMES } from './biomes';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';

// ---------------------------------------------------------------------------------------------
// Weather states
// ---------------------------------------------------------------------------------------------

/** The 12 weather states of §10 (index order of every matrix). */
export const WEATHER_STATE_IDS = [
  'klar',
  'bewoelkt',
  'nebel',
  'niesel',
  'regen',
  'gewitter',
  'schnee',
  'schneesturm',
  'hitzewelle',
  'sandsturm',
  'ascheregen',
  'sternschnuppennacht',
] as const;
/** One weather state id. */
export type WeatherStateId = (typeof WEATHER_STATE_IDS)[number];
/** Number of weather states (edge length of every transition matrix). */
export const WEATHER_STATE_COUNT = WEATHER_STATE_IDS.length;
/** zod schema of a weather state id. */
export const weatherStateIdSchema = z.enum(WEATHER_STATE_IDS);

/** What falls from the sky (rendering, wetness, fire; §10 "Wetterwirkung"). */
export const PRECIPITATION_KINDS = ['keiner', 'regen', 'schnee', 'asche'] as const;
/** One precipitation kind. */
export type PrecipitationKind = (typeof PRECIPITATION_KINDS)[number];

/** Shortest weather period [game hours] (§10 "Dauer 1–8 Spielstunden"). */
export const WEATHER_MIN_DURATION_HOURS = 1;
/** Longest weather period [game hours] (§10 "Dauer 1–8 Spielstunden"). */
export const WEATHER_MAX_DURATION_HOURS = 8;
/** Largest temperature offset of any weather state [°C] (§10: Schneesturm −10). */
export const WEATHER_TEMPERATURE_OFFSET_LIMIT_C = 20;
/** Darkest daylight factor of any weather [0–1] (§12.1 "Tag 1,0 bis 0,6 wetterabhängig"). */
export const WEATHER_MIN_LIGHT_FACTOR = 0.6;

const unit = z.number().min(0).max(1);
const durationHour = z.number().int().min(WEATHER_MIN_DURATION_HOURS).max(WEATHER_MAX_DURATION_HOURS);

/** Schema of one weather state. */
export const weatherStateSchema = z
  .object({
    id: weatherStateIdSchema,
    name: localizedTextSchema,
    /** Offset added to the air temperature on the surface [°C] (§10). */
    temperatureOffsetC: z.number().min(-WEATHER_TEMPERATURE_OFFSET_LIMIT_C).max(WEATHER_TEMPERATURE_OFFSET_LIMIT_C),
    /** Cloud cover [0 clear sky … 1 overcast]. */
    cloudCover: unit,
    /** Wind strength [0 calm … 1 storm] (arrows, windmills, sails, fire spread, §10). */
    wind: unit,
    /** Precipitation intensity [0 none … 1 downpour]. */
    precipitation: unit,
    precipitationKind: z.enum(PRECIPITATION_KINDS),
    /** Haze that limits visibility [0 none … 1 dense fog] (fog, dust, driving snow). */
    haze: unit,
    /** Factor on daylight [0,6 … 1] (§12.1 "Tag 1,0 bis 0,6 wetterabhängig"). */
    lightFactor: z.number().min(WEATHER_MIN_LIGHT_FACTOR).max(1),
    /** Duration range of one period of this state [game hours] (§10: 1–8). */
    durationHours: z.object({ min: durationHour, max: durationHour }).strict(),
    /** Only begins in full night and ends at dawn at the latest (Sternschnuppen-Nacht). */
    nightOnly: z.boolean(),
  })
  .strict()
  .refine((s) => s.durationHours.min <= s.durationHours.max, { message: 'durationHours.min must not exceed max', path: ['durationHours'] })
  .refine((s) => (s.precipitation > 0) === (s.precipitationKind !== 'keiner'), { message: 'precipitation > 0 exactly when a precipitation kind is set', path: ['precipitationKind'] });

/** One weather state. */
export type WeatherState = z.output<typeof weatherStateSchema>;

/** The 12 weather states (§10). */
export const WEATHER_STATES: ReadonlyArray<z.input<typeof weatherStateSchema>> = [
  { id: 'klar', name: { de: 'Klar', en: 'Clear' }, temperatureOffsetC: 0, cloudCover: 0.05, wind: 0.15, precipitation: 0, precipitationKind: 'keiner', haze: 0, lightFactor: 1, durationHours: { min: 3, max: 8 }, nightOnly: false },
  { id: 'bewoelkt', name: { de: 'Bewölkt', en: 'Overcast' }, temperatureOffsetC: 0, cloudCover: 0.75, wind: 0.3, precipitation: 0, precipitationKind: 'keiner', haze: 0, lightFactor: 0.85, durationHours: { min: 2, max: 8 }, nightOnly: false },
  { id: 'nebel', name: { de: 'Nebel', en: 'Fog' }, temperatureOffsetC: 0, cloudCover: 0.5, wind: 0.05, precipitation: 0, precipitationKind: 'keiner', haze: 1, lightFactor: 0.75, durationHours: { min: 1, max: 5 }, nightOnly: false },
  { id: 'niesel', name: { de: 'Niesel', en: 'Drizzle' }, temperatureOffsetC: 0, cloudCover: 0.85, wind: 0.2, precipitation: 0.25, precipitationKind: 'regen', haze: 0.2, lightFactor: 0.75, durationHours: { min: 1, max: 5 }, nightOnly: false },
  { id: 'regen', name: { de: 'Regen', en: 'Rain' }, temperatureOffsetC: -3, cloudCover: 0.95, wind: 0.45, precipitation: 0.65, precipitationKind: 'regen', haze: 0.15, lightFactor: 0.7, durationHours: { min: 2, max: 6 }, nightOnly: false },
  { id: 'gewitter', name: { de: 'Gewitter', en: 'Thunderstorm' }, temperatureOffsetC: -5, cloudCover: 1, wind: 0.85, precipitation: 1, precipitationKind: 'regen', haze: 0.1, lightFactor: 0.6, durationHours: { min: 1, max: 3 }, nightOnly: false },
  { id: 'schnee', name: { de: 'Schnee', en: 'Snow' }, temperatureOffsetC: -4, cloudCover: 0.9, wind: 0.3, precipitation: 0.5, precipitationKind: 'schnee', haze: 0.2, lightFactor: 0.8, durationHours: { min: 2, max: 8 }, nightOnly: false },
  { id: 'schneesturm', name: { de: 'Schneesturm', en: 'Blizzard' }, temperatureOffsetC: -10, cloudCover: 1, wind: 1, precipitation: 1, precipitationKind: 'schnee', haze: 0.7, lightFactor: 0.6, durationHours: { min: 1, max: 5 }, nightOnly: false },
  { id: 'hitzewelle', name: { de: 'Hitzewelle', en: 'Heatwave' }, temperatureOffsetC: 8, cloudCover: 0, wind: 0.1, precipitation: 0, precipitationKind: 'keiner', haze: 0.1, lightFactor: 1, durationHours: { min: 4, max: 8 }, nightOnly: false },
  { id: 'sandsturm', name: { de: 'Sandsturm', en: 'Sandstorm' }, temperatureOffsetC: 3, cloudCover: 0.3, wind: 1, precipitation: 0, precipitationKind: 'keiner', haze: 0.8, lightFactor: 0.65, durationHours: { min: 1, max: 4 }, nightOnly: false },
  { id: 'ascheregen', name: { de: 'Ascheregen', en: 'Ashfall' }, temperatureOffsetC: 2, cloudCover: 0.85, wind: 0.35, precipitation: 0.5, precipitationKind: 'asche', haze: 0.4, lightFactor: 0.65, durationHours: { min: 2, max: 6 }, nightOnly: false },
  { id: 'sternschnuppennacht', name: { de: 'Sternschnuppen-Nacht', en: 'Night of Falling Stars' }, temperatureOffsetC: 0, cloudCover: 0, wind: 0.1, precipitation: 0, precipitationKind: 'keiner', haze: 0, lightFactor: 1, durationHours: { min: 2, max: 8 }, nightOnly: true },
];

// ---------------------------------------------------------------------------------------------
// Succession affinity (from → to)
// ---------------------------------------------------------------------------------------------

/** Row of the affinity table: plausibility of each successor state (0 < a ≤ 1). */
export type WeatherAffinityRow = Readonly<Record<WeatherStateId, number>>;

/**
 * How plausible it is that `to` follows `from` (0 < a ≤ 1), independent of biome and season. The
 * diagonal is the chance that a state renews itself for another period. Every entry is positive, so
 * a matrix row can never be empty while its biome and season allow at least one state.
 */
export const WEATHER_AFFINITY: Readonly<Record<WeatherStateId, WeatherAffinityRow>> = {
  // Clear skies cloud over or stay; storms rarely form out of a clear sky.
  klar: { klar: 1, bewoelkt: 1, nebel: 0.6, niesel: 0.2, regen: 0.1, gewitter: 0.15, schnee: 0.1, schneesturm: 0.02, hitzewelle: 0.6, sandsturm: 0.4, ascheregen: 0.3, sternschnuppennacht: 0.8 },
  // Clouds bring precipitation or clear up.
  bewoelkt: { klar: 1, bewoelkt: 0.6, nebel: 0.4, niesel: 0.8, regen: 0.8, gewitter: 0.4, schnee: 0.8, schneesturm: 0.2, hitzewelle: 0.1, sandsturm: 0.3, ascheregen: 0.6, sternschnuppennacht: 0.2 },
  // Fog lifts into a clear or cloudy day.
  nebel: { klar: 1, bewoelkt: 0.8, nebel: 0.4, niesel: 0.6, regen: 0.3, gewitter: 0.05, schnee: 0.3, schneesturm: 0.05, hitzewelle: 0.1, sandsturm: 0.05, ascheregen: 0.3, sternschnuppennacht: 0.3 },
  // Drizzle thickens into rain or peters out under clouds.
  niesel: { klar: 0.4, bewoelkt: 1, nebel: 0.6, niesel: 0.4, regen: 0.8, gewitter: 0.2, schnee: 0.4, schneesturm: 0.05, hitzewelle: 0.02, sandsturm: 0.02, ascheregen: 0.2, sternschnuppennacht: 0.05 },
  // Rain eases into clouds or drizzle, sometimes builds into a thunderstorm.
  regen: { klar: 0.4, bewoelkt: 1, nebel: 0.5, niesel: 0.8, regen: 0.4, gewitter: 0.5, schnee: 0.3, schneesturm: 0.1, hitzewelle: 0.02, sandsturm: 0.02, ascheregen: 0.1, sternschnuppennacht: 0.05 },
  // Thunderstorms rain out.
  gewitter: { klar: 0.5, bewoelkt: 1, nebel: 0.3, niesel: 0.5, regen: 1, gewitter: 0.2, schnee: 0.1, schneesturm: 0.1, hitzewelle: 0.05, sandsturm: 0.1, ascheregen: 0.3, sternschnuppennacht: 0.1 },
  // Snow either clears or whips up into a blizzard.
  schnee: { klar: 0.6, bewoelkt: 1, nebel: 0.5, niesel: 0.2, regen: 0.2, gewitter: 0.02, schnee: 0.5, schneesturm: 0.6, hitzewelle: 0.01, sandsturm: 0.01, ascheregen: 0.1, sternschnuppennacht: 0.2 },
  // Blizzards calm down into snowfall.
  schneesturm: { klar: 0.3, bewoelkt: 1, nebel: 0.3, niesel: 0.1, regen: 0.1, gewitter: 0.02, schnee: 1, schneesturm: 0.3, hitzewelle: 0.01, sandsturm: 0.01, ascheregen: 0.05, sternschnuppennacht: 0.05 },
  // Heat breaks in a thunderstorm or kicks up sand.
  hitzewelle: { klar: 1, bewoelkt: 0.6, nebel: 0.05, niesel: 0.1, regen: 0.2, gewitter: 0.8, schnee: 0.01, schneesturm: 0.01, hitzewelle: 0.6, sandsturm: 0.8, ascheregen: 0.3, sternschnuppennacht: 0.5 },
  // Sandstorms settle into clear heat.
  sandsturm: { klar: 1, bewoelkt: 0.6, nebel: 0.05, niesel: 0.05, regen: 0.1, gewitter: 0.2, schnee: 0.01, schneesturm: 0.01, hitzewelle: 0.6, sandsturm: 0.3, ascheregen: 0.2, sternschnuppennacht: 0.3 },
  // Ash clouds hang on or wash out.
  ascheregen: { klar: 0.6, bewoelkt: 1, nebel: 0.5, niesel: 0.3, regen: 0.3, gewitter: 0.4, schnee: 0.1, schneesturm: 0.05, hitzewelle: 0.3, sandsturm: 0.2, ascheregen: 0.4, sternschnuppennacht: 0.1 },
  // After a night of falling stars the sky stays clear.
  sternschnuppennacht: { klar: 1, bewoelkt: 0.5, nebel: 0.5, niesel: 0.1, regen: 0.1, gewitter: 0.05, schnee: 0.2, schneesturm: 0.02, hitzewelle: 0.3, sandsturm: 0.1, ascheregen: 0.1, sternschnuppennacht: 0.3 },
};

// ---------------------------------------------------------------------------------------------
// Climate per surface biome and season
// ---------------------------------------------------------------------------------------------

/** How common a state is in one biome and season (relative weight > 0). */
export const weatherWeightSchema = z.object({ state: weatherStateIdSchema, weight: z.number().positive() }).strict();
/** Weights of one season; states not listed never occur there. */
export const weatherSeasonSchema = z
  .array(weatherWeightSchema)
  .min(1)
  .refine((ws) => new Set(ws.map((w) => w.state)).size === ws.length, { message: 'a state is listed twice' });

/** Schema of the weather climate of one surface biome. */
export const weatherClimateSchema = z
  .object({
    /** Same as the biome id. */
    id: idSchema,
    biome: refSchema,
    fruehling: weatherSeasonSchema,
    sommer: weatherSeasonSchema,
    herbst: weatherSeasonSchema,
    winter: weatherSeasonSchema,
  })
  .strict()
  .refine((c) => c.id === c.biome, { message: 'id must equal the biome id', path: ['id'] });

/** The weather climate of one surface biome. */
export type WeatherClimate = z.output<typeof weatherClimateSchema>;

type Weights = Partial<Record<WeatherStateId, number>>;

function season(weights: Weights): Array<{ state: WeatherStateId; weight: number }> {
  return WEATHER_STATE_IDS.filter((id) => weights[id] !== undefined).map((id) => ({ state: id, weight: weights[id] as number }));
}

function climate(biome: string, s: Record<SeasonId, Weights>): z.input<typeof weatherClimateSchema> {
  return { id: biome, biome, fruehling: season(s.fruehling), sommer: season(s.sommer), herbst: season(s.herbst), winter: season(s.winter) };
}

/**
 * Weather climate of the eight surface biomes (§9.3 features, §10 "Wetterwahrscheinlichkeiten"
 * per season). Caves have no weather.
 */
export const WEATHER_CLIMATES: ReadonlyArray<z.input<typeof weatherClimateSchema>> = [
  // Temperate forest: showers in spring, thunder and heat in summer, fog in autumn, snow in winter.
  climate('gruenhain', {
    fruehling: { klar: 4, bewoelkt: 3, nebel: 1.5, niesel: 2, regen: 2, gewitter: 0.5, sternschnuppennacht: 0.3 },
    sommer: { klar: 5, bewoelkt: 2, nebel: 0.5, niesel: 0.5, regen: 1, gewitter: 1.5, hitzewelle: 1, sternschnuppennacht: 0.5 },
    herbst: { klar: 2.5, bewoelkt: 3, nebel: 2.5, niesel: 2, regen: 2.5, gewitter: 0.3, sternschnuppennacht: 0.3 },
    winter: { klar: 2.5, bewoelkt: 3, nebel: 1.5, niesel: 0.5, regen: 0.5, schnee: 3, schneesturm: 0.5, sternschnuppennacht: 0.3 },
  }),
  // Coast: sea fog and autumn gales.
  climate('salzkueste', {
    fruehling: { klar: 3.5, bewoelkt: 3, nebel: 2, niesel: 2, regen: 2, gewitter: 0.5, sternschnuppennacht: 0.3 },
    sommer: { klar: 5, bewoelkt: 2, nebel: 1, niesel: 0.5, regen: 1, gewitter: 1, hitzewelle: 0.8, sternschnuppennacht: 0.5 },
    herbst: { klar: 2, bewoelkt: 3, nebel: 2.5, niesel: 2, regen: 3, gewitter: 1, sternschnuppennacht: 0.3 },
    winter: { klar: 2, bewoelkt: 3, nebel: 2, niesel: 1, regen: 2, gewitter: 0.3, schnee: 1.5, schneesturm: 0.3, sternschnuppennacht: 0.3 },
  }),
  // Swamp: "dichter Nebel" all year.
  climate('nebelmoor', {
    fruehling: { klar: 1.5, bewoelkt: 3, nebel: 5, niesel: 3, regen: 2, gewitter: 0.3, sternschnuppennacht: 0.2 },
    sommer: { klar: 2.5, bewoelkt: 2.5, nebel: 3, niesel: 2, regen: 1.5, gewitter: 1.5, hitzewelle: 0.5, sternschnuppennacht: 0.3 },
    herbst: { klar: 1, bewoelkt: 3, nebel: 6, niesel: 3, regen: 2.5, gewitter: 0.3, sternschnuppennacht: 0.2 },
    winter: { klar: 1, bewoelkt: 3, nebel: 5, niesel: 1.5, regen: 1, schnee: 2, schneesturm: 0.3, sternschnuppennacht: 0.2 },
  }),
  // Mountains: snow in three seasons, blizzards in winter, summer thunder.
  climate('frostkamm', {
    fruehling: { klar: 3, bewoelkt: 3, nebel: 1, niesel: 0.5, schnee: 3, schneesturm: 1, sternschnuppennacht: 0.3 },
    sommer: { klar: 4, bewoelkt: 3, nebel: 1, niesel: 1, regen: 1.5, gewitter: 1, schnee: 1, sternschnuppennacht: 0.5 },
    herbst: { klar: 2.5, bewoelkt: 3, nebel: 1.5, niesel: 0.5, schnee: 3, schneesturm: 1, sternschnuppennacht: 0.3 },
    winter: { klar: 2, bewoelkt: 2.5, nebel: 1, schnee: 4, schneesturm: 3, sternschnuppennacht: 0.3 },
  }),
  // Desert: dry, sandstorms and heatwaves, clear starry nights; rare winter rain.
  climate('glutsand', {
    fruehling: { klar: 6, bewoelkt: 1, gewitter: 0.2, hitzewelle: 1, sandsturm: 2, sternschnuppennacht: 0.8 },
    sommer: { klar: 5, bewoelkt: 0.5, gewitter: 0.3, hitzewelle: 3, sandsturm: 2.5, sternschnuppennacht: 0.8 },
    herbst: { klar: 6, bewoelkt: 1, regen: 0.2, gewitter: 0.2, hitzewelle: 0.8, sandsturm: 2, sternschnuppennacht: 0.8 },
    winter: { klar: 6, bewoelkt: 1.5, niesel: 0.3, regen: 0.5, gewitter: 0.2, sandsturm: 1.5, sternschnuppennacht: 0.8 },
  }),
  // Volcanic: ash rain from the vents, dry thunderstorms.
  climate('aschenschlund', {
    fruehling: { klar: 2, bewoelkt: 3, nebel: 1, regen: 0.5, gewitter: 1, hitzewelle: 0.5, ascheregen: 4, sternschnuppennacht: 0.2 },
    sommer: { klar: 2, bewoelkt: 2.5, gewitter: 1.5, hitzewelle: 1.5, ascheregen: 4, sternschnuppennacht: 0.2 },
    herbst: { klar: 2, bewoelkt: 3, nebel: 1, regen: 0.8, gewitter: 1, ascheregen: 4, sternschnuppennacht: 0.2 },
    winter: { klar: 2, bewoelkt: 3, nebel: 1, regen: 0.8, gewitter: 0.8, schnee: 0.5, ascheregen: 4, sternschnuppennacht: 0.2 },
  }),
  // Crystal forest: light anomalies – falling stars are common (Lumenregen, §10).
  climate('scherbenhain', {
    fruehling: { klar: 4, bewoelkt: 2, nebel: 1.5, niesel: 1.5, regen: 1, sternschnuppennacht: 2.5 },
    sommer: { klar: 5, bewoelkt: 1.5, nebel: 1, niesel: 1, regen: 1, gewitter: 1, hitzewelle: 0.5, sternschnuppennacht: 2.5 },
    herbst: { klar: 3, bewoelkt: 2.5, nebel: 2, niesel: 1.5, regen: 1.5, gewitter: 0.5, sternschnuppennacht: 2.5 },
    winter: { klar: 3, bewoelkt: 2.5, nebel: 1.5, schnee: 2, schneesturm: 0.3, sternschnuppennacht: 2.5 },
  }),
  // Corrupted crater: a lid of cloud and fog, dark storms, ash; the stars stay hidden.
  climate('nachtherz', {
    fruehling: { klar: 1, bewoelkt: 4, nebel: 3, niesel: 1.5, gewitter: 1.5, ascheregen: 1 },
    sommer: { klar: 1.5, bewoelkt: 4, nebel: 2.5, niesel: 1, gewitter: 2, ascheregen: 1 },
    herbst: { klar: 1, bewoelkt: 4, nebel: 3.5, niesel: 2, gewitter: 1.5, ascheregen: 1 },
    winter: { klar: 1, bewoelkt: 4, nebel: 3, gewitter: 1, schnee: 1.5, schneesturm: 1, ascheregen: 1 },
  }),
];

// ---------------------------------------------------------------------------------------------
// Climate balance
// ---------------------------------------------------------------------------------------------

/** Parameters of the temperature field and the weather automaton (`BALANCE.climate`, unit and reason per value). */
export const CLIMATE_BALANCE = BALANCE.climate;

// ---------------------------------------------------------------------------------------------
// Validated tables and matrices
// ---------------------------------------------------------------------------------------------

/** Validated weather content with the generated transition matrices. */
export interface WeatherTables {
  /** States in `WEATHER_STATE_IDS` order. */
  readonly states: readonly WeatherState[];
  /** Surface biome ids that have a weather climate (sorted). */
  readonly biomes: readonly string[];
  /**
   * Transition matrix per biome and season: row-major `WEATHER_STATE_COUNT²` probabilities,
   * `m[from × COUNT + to]`; every row sums to 1.
   */
  matrix(biome: string, season: SeasonId): Float64Array;
  /** Relative weights of the states in a biome and season (0 = never), in state order. */
  weights(biome: string, season: SeasonId): Float64Array;
}

/** Index of a weather state in `WEATHER_STATE_IDS`. */
export function weatherStateIndex(id: WeatherStateId): number {
  return WEATHER_STATE_IDS.indexOf(id);
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TypeError(`Weather content ${what} invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** Builds and validates the weather tables (throws `TypeError` naming the first problem). */
export function buildWeatherTables(
  states: ReadonlyArray<z.input<typeof weatherStateSchema>> = WEATHER_STATES,
  climates: ReadonlyArray<z.input<typeof weatherClimateSchema>> = WEATHER_CLIMATES,
  affinity: Readonly<Record<WeatherStateId, WeatherAffinityRow>> = WEATHER_AFFINITY,
): WeatherTables {
  const parsedStates = states.map((s, i) => parseOrThrow(weatherStateSchema, s, `state ${i}`));
  const byId = new Map(parsedStates.map((s) => [s.id, s]));
  if (byId.size !== parsedStates.length) throw new TypeError('Weather content: a weather state is defined twice');
  const ordered = WEATHER_STATE_IDS.map((id) => {
    const s = byId.get(id);
    if (s === undefined) throw new TypeError(`Weather content: state "${id}" is missing`);
    return s;
  });
  for (const from of WEATHER_STATE_IDS) {
    for (const to of WEATHER_STATE_IDS) {
      const a = affinity[from][to];
      if (!(a > 0 && a <= 1)) throw new TypeError(`Weather content: affinity ${from} → ${to} must be in (0, 1], got ${String(a)}`);
    }
  }
  const surfaceBiomes = new Set(BIOMES.filter((b) => b.layer === 0).map((b) => b.id));
  const matrices = new Map<string, Float64Array>();
  const weightTables = new Map<string, Float64Array>();
  const biomes: string[] = [];
  for (const [ci, raw] of climates.entries()) {
    const c = parseOrThrow(weatherClimateSchema, raw, `climate ${ci}`);
    if (!surfaceBiomes.has(c.biome)) throw new TypeError(`Weather content: climate "${c.id}" references "${c.biome}", which is not a surface biome`);
    if (biomes.includes(c.biome)) throw new TypeError(`Weather content: biome "${c.biome}" has two climates`);
    biomes.push(c.biome);
    for (const seasonId of SEASON_IDS) {
      const w = new Float64Array(WEATHER_STATE_COUNT);
      for (const { state, weight } of c[seasonId]) w[weatherStateIndex(state)] = weight;
      if (!ordered.some((s, i) => (w[i] as number) > 0 && !s.nightOnly)) {
        throw new TypeError(`Weather content: ${c.biome}/${seasonId} needs a state that may occur by day`);
      }
      const m = new Float64Array(WEATHER_STATE_COUNT * WEATHER_STATE_COUNT);
      WEATHER_STATE_IDS.forEach((from, fi) => {
        let sum = 0;
        WEATHER_STATE_IDS.forEach((to, ti) => {
          const p = (w[ti] as number) * affinity[from][to];
          m[fi * WEATHER_STATE_COUNT + ti] = p;
          sum += p;
        });
        for (let ti = 0; ti < WEATHER_STATE_COUNT; ti++) m[fi * WEATHER_STATE_COUNT + ti] = (m[fi * WEATHER_STATE_COUNT + ti] as number) / sum;
      });
      matrices.set(`${c.biome}/${seasonId}`, m);
      weightTables.set(`${c.biome}/${seasonId}`, w);
    }
  }
  for (const b of surfaceBiomes) if (!biomes.includes(b)) throw new TypeError(`Weather content: surface biome "${b}" has no weather climate`);
  biomes.sort();
  const lookup = <T>(table: Map<string, T>, biome: string, seasonId: SeasonId): T => {
    const v = table.get(`${biome}/${seasonId}`);
    if (v === undefined) throw new RangeError(`Weather: no climate for biome "${biome}"`);
    return v;
  };
  return Object.freeze({
    states: Object.freeze(ordered),
    biomes: Object.freeze(biomes),
    matrix: (biome: string, seasonId: SeasonId) => lookup(matrices, biome, seasonId),
    weights: (biome: string, seasonId: SeasonId) => lookup(weightTables, biome, seasonId),
  });
}

let tables: WeatherTables | undefined;

/** The game's weather tables (validated and built once). */
export function weatherTables(): WeatherTables {
  tables ??= buildWeatherTables();
  return tables;
}
