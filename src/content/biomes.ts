/**
 * Biomes (MASTERPROMPT §9.3; docs/WORLD.md §7; colour identity docs/ART.md §5).
 *
 * Eight surface biomes and the three underground layers. Each record carries its progression tier
 * range, the base temperature of a spring day (§9.3 table), the amplitude of the daily temperature
 * curve (±6 °C, Glutsand ±18 °C; caves 0 because "Höhlen bleiben nahe ihrem Basiswert") and the
 * colour identity from docs/ART.md §5 (palette row `biom_<id>` plus ground, accent and night colours
 * as `ramp.step` palette references, mirrored from `BIOME_TINTS` in assets-src/paletteRows.ts;
 * tests/unit/content/world-content.test.ts keeps both in sync). Transition bands (e.g. taiga between
 * Grünhain and Frostkamm) are mixing zones, not biomes.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, tierSchema } from './schema/common';

/** World layers: 0 = surface, −1 Wurzelhöhlen, −2 Tiefgrund, −3 Glutadern (WORLD.md §1). */
export const WORLD_LAYERS = [0, -1, -2, -3] as const;
/** One world layer. */
export type WorldLayer = (typeof WORLD_LAYERS)[number];
/** zod schema of a world layer. */
export const worldLayerSchema = z.union([z.literal(0), z.literal(-1), z.literal(-2), z.literal(-3)]);

/** Ramps of the master palette (assets-src/palette.ts `RAMPS`). */
export const PALETTE_RAMP_NAMES = ['nacht', 'stein', 'erde', 'holz', 'gras', 'laub', 'wasser', 'sand', 'feuer', 'haut', 'eis', 'verderb'] as const;
/** A palette reference `ramp.step` (e.g. `gras.3`). */
export const paletteRefSchema = z.string().regex(new RegExp(`^(${PALETTE_RAMP_NAMES.join('|')})\\.[0-9]$`), { message: 'palette reference must be "ramp.step"' });

/** Largest daily temperature swing of any biome [°C] (§9.3: Glutsand ±18 °C). */
export const MAX_DAY_AMPLITUDE_C = 18;

/** Colour identity of a biome (docs/ART.md §5). */
export const biomeColorIdentitySchema = z
  .object({
    /** Palette row that tints shared sprites into the biome (`biom_<id>`). */
    paletteRow: idSchema,
    /** Surface colours that carry the biome. */
    ground: z.array(paletteRefSchema).min(1),
    /** Rare, readable accent colours. */
    accent: z.array(paletteRefSchema).min(1),
    /** Colour of the darkness (night shadows, cave black). */
    night: paletteRefSchema,
  })
  .strict();

/** Schema of one biome. */
export const biomeSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** Layer the biome belongs to. */
    layer: worldLayerSchema,
    /** Lowest progression tier of the biome (§9.3 "Stufe"). */
    tierMin: tierSchema,
    /** Highest progression tier of the biome. */
    tierMax: tierSchema,
    /** Temperature of a spring day at height level 0 [°C] (§9.3). */
    baseTemperatureC: z.number().min(-50).max(60),
    /** Amplitude of the daily temperature curve [°C] (§9.3). */
    dayAmplitudeC: z.number().min(0).max(MAX_DAY_AMPLITUDE_C),
    colorIdentity: biomeColorIdentitySchema,
  })
  .strict()
  .refine((b) => b.tierMin <= b.tierMax, { message: 'tierMin must not exceed tierMax', path: ['tierMax'] })
  .refine((b) => b.colorIdentity.paletteRow === `biom_${b.id}`, { message: 'palette row must be "biom_<id>"', path: ['colorIdentity', 'paletteRow'] });

/** One biome record. */
export type Biome = z.output<typeof biomeSchema>;

/** Day amplitude of every surface biome except Glutsand [°C] (§9.3 "Tageskurve ±6 °C"). */
const SURFACE_DAY_AMPLITUDE_C = 6;
/** Caves keep their base temperature (§9.3 "Höhlen bleiben nahe ihrem Basiswert"). */
const CAVE_DAY_AMPLITUDE_C = 0;

/** The 11 biomes of §9.3 in tier order, surface first. */
export const BIOMES: ReadonlyArray<z.input<typeof biomeSchema>> = [
  {
    id: 'gruenhain',
    name: { de: 'Grünhain', en: 'Greengrove' },
    layer: 0,
    tierMin: 0,
    tierMax: 1,
    baseTemperatureC: 16,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_gruenhain', ground: ['gras.3', 'gras.2', 'erde.2', 'holz.2'], accent: ['laub.4', 'sand.4', 'laub.2'], night: 'wasser.1' },
  },
  {
    id: 'salzkueste',
    name: { de: 'Salzküste', en: 'Saltcoast' },
    layer: 0,
    tierMin: 0,
    tierMax: 2,
    baseTemperatureC: 17,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_salzkueste', ground: ['sand.3', 'sand.2', 'wasser.3', 'stein.4'], accent: ['eis.3', 'laub.3', 'wasser.5'], night: 'wasser.0' },
  },
  {
    id: 'nebelmoor',
    name: { de: 'Nebelmoor', en: 'Mistmoor' },
    layer: 0,
    tierMin: 2,
    tierMax: 2,
    baseTemperatureC: 14,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_nebelmoor', ground: ['stein.3', 'gras.1', 'erde.1', 'stein.2'], accent: ['gras.5', 'eis.2', 'laub.2'], night: 'gras.0' },
  },
  {
    id: 'frostkamm',
    name: { de: 'Frostkamm', en: 'Frostcrest' },
    layer: 0,
    tierMin: 3,
    tierMax: 3,
    baseTemperatureC: -8,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_frostkamm', ground: ['eis.2', 'eis.3', 'stein.2', 'eis.0'], accent: ['laub.2', 'wasser.4', 'eis.4'], night: 'eis.0' },
  },
  {
    id: 'glutsand',
    name: { de: 'Glutsand', en: 'Embersand' },
    layer: 0,
    tierMin: 4,
    tierMax: 4,
    baseTemperatureC: 34,
    dayAmplitudeC: MAX_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_glutsand', ground: ['sand.2', 'sand.3', 'erde.3', 'laub.3'], accent: ['wasser.4', 'gras.4', 'feuer.4'], night: 'verderb.1' },
  },
  {
    id: 'aschenschlund',
    name: { de: 'Aschenschlund', en: 'Ashmaw' },
    layer: 0,
    tierMin: 5,
    tierMax: 5,
    baseTemperatureC: 38,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_aschenschlund', ground: ['nacht.2', 'stein.1', 'stein.2', 'nacht.3'], accent: ['feuer.3', 'feuer.4', 'laub.2', 'sand.3'], night: 'feuer.0' },
  },
  {
    id: 'scherbenhain',
    name: { de: 'Scherbenhain', en: 'Shardgrove' },
    layer: 0,
    tierMin: 6,
    tierMax: 6,
    baseTemperatureC: 12,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_scherbenhain', ground: ['wasser.3', 'eis.1', 'eis.2', 'nacht.3'], accent: ['verderb.4', 'eis.4', 'wasser.5'], night: 'verderb.1' },
  },
  {
    id: 'nachtherz',
    name: { de: 'Nachtherz', en: 'Nightheart' },
    layer: 0,
    tierMin: 7,
    tierMax: 7,
    baseTemperatureC: 5,
    dayAmplitudeC: SURFACE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_nachtherz', ground: ['nacht.2', 'verderb.1', 'nacht.3', 'verderb.2'], accent: ['verderb.4', 'eis.4', 'verderb.3'], night: 'nacht.0' },
  },
  {
    id: 'wurzelhoehlen',
    name: { de: 'Wurzelhöhlen', en: 'Rootcaves' },
    layer: -1,
    tierMin: 1,
    tierMax: 2,
    baseTemperatureC: 12,
    dayAmplitudeC: CAVE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_wurzelhoehlen', ground: ['holz.1', 'erde.0', 'erde.1', 'gras.2'], accent: ['wasser.4', 'wasser.5', 'sand.3'], night: 'erde.0' },
  },
  {
    id: 'tiefgrund',
    name: { de: 'Tiefgrund', en: 'Deepground' },
    layer: -2,
    tierMin: 2,
    tierMax: 4,
    baseTemperatureC: 14,
    dayAmplitudeC: CAVE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_tiefgrund', ground: ['stein.1', 'stein.2', 'wasser.2', 'stein.0'], accent: ['eis.2', 'wasser.5', 'sand.3'], night: 'wasser.0' },
  },
  {
    id: 'glutadern',
    name: { de: 'Glutadern', en: 'Embervein' },
    layer: -3,
    tierMin: 4,
    tierMax: 6,
    baseTemperatureC: 30,
    dayAmplitudeC: CAVE_DAY_AMPLITUDE_C,
    colorIdentity: { paletteRow: 'biom_glutadern', ground: ['nacht.1', 'erde.0', 'laub.0', 'feuer.1'], accent: ['feuer.3', 'feuer.4', 'wasser.4'], night: 'feuer.0' },
  },
];
