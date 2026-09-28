/**
 * The kind table of the GPU particles (M5-11): every particle kind of the content (src/content/particles) as rows of
 * vec4, uploaded as one uniform array (`uKinds`) that the update and draw shaders index with the record's kind. Also
 * compiles the particle sources into flat numbers for the CPU spawner (`spawn.ts`).
 *
 * | row | x | y | z | w |
 * |---|---|---|---|---|
 * | 0 | shape | size min [px] | size max [px] | growth (size factor at death) |
 * | 1 | line: length per speed [s] | line min [px] | line max [px] | emissive factor (0 = lit) |
 * | 2 | colour 1 | colour 2 | colour 3 | colour 4 (palette indices 1…64) |
 * | 3 | colours used | opacity at birth | opacity at death | flicker |
 * | 4 | gravity [px/s²] | drag [1/s] | wind share | swirl [px/s] |
 * | 5 | swirl rate [Hz] | ground contact | splash kind (−1 none) | – |
 * | 6 | life min [s] | life max [s] | – | – |
 */
import { PALETTE_RAMPS } from '../../generated/palette';
import { GROUND_CONTACTS, PARTICLE_COLORS_MAX, PARTICLE_EMITTERS, PARTICLE_KINDS, PARTICLE_SHAPES, type ParticleEmitter, type ParticleKind } from '../../content/particles';
import { paletteRefIndex } from '../palette/rows';

/** vec4 rows per kind. */
export const KIND_ROWS = 7;
/** Kinds the uniform table holds (24 × 7 vec4 fit the 256 vertex uniform vectors WebGL2 guarantees). */
export const MAX_KINDS = 24;
/** Floats of the whole table. */
export const KIND_TABLE_FLOATS = MAX_KINDS * KIND_ROWS * 4;

/** Shape codes of the shaders (`particle_common.glsl`). */
export const SHAPE_CODE: Readonly<Record<ParticleKind['form'], number>> = Object.fromEntries(PARTICLE_SHAPES.map((s, i) => [s, i])) as Record<ParticleKind['form'], number>;
/** Ground contact codes of the update shader. */
export const GROUND_CODE: Readonly<Record<ParticleKind['boden'], number>> = Object.fromEntries(GROUND_CONTACTS.map((s, i) => [s, i])) as Record<ParticleKind['boden'], number>;

/** Kind table plus lookups (built once from the content). */
export interface KindTable {
  /** `KIND_TABLE_FLOATS` floats, row-major vec4. */
  readonly data: Float32Array;
  readonly count: number;
  /** Row of a kind id; throws for unknown ids. */
  index(id: string): number;
  /** Life range of a kind [s]. */
  lifeMin(kind: number): number;
  lifeMax(kind: number): number;
}

/** Builds the table of `kinds` (default: the content's). */
export function buildKindTable(kinds: readonly ParticleKind[] = PARTICLE_KINDS): KindTable {
  if (kinds.length > MAX_KINDS) throw new RangeError(`Partikel: ${kinds.length} Arten, die Tabelle fasst ${MAX_KINDS}`);
  const data = new Float32Array(KIND_TABLE_FLOATS);
  const ids = kinds.map((k) => k.id);
  const indexOf = (id: string): number => {
    const i = ids.indexOf(id);
    if (i < 0) throw new Error(`Partikel: unbekannte Art „${id}“`);
    return i;
  };
  kinds.forEach((k, i) => {
    const o = i * KIND_ROWS * 4;
    const colors = k.farben.map((ref) => paletteRefIndex(ref, PALETTE_RAMPS));
    const row = [
      [SHAPE_CODE[k.form], k.groesse.min, k.groesse.max, k.wachstum],
      [k.strich?.faktor ?? 0, k.strich?.min ?? 1, k.strich?.max ?? 1, k.emissiv],
      Array.from({ length: PARTICLE_COLORS_MAX }, (_, c) => colors[Math.min(c, colors.length - 1)] as number),
      [colors.length, k.deckung.start, k.deckung.ende, k.flackern],
      [k.schwerkraft, k.widerstand, k.wind, k.wirbel],
      [k.wirbelTakt, GROUND_CODE[k.boden], k.spritzer === undefined ? -1 : indexOf(k.spritzer), 0],
      [k.leben.min, k.leben.max, 0, 0],
    ];
    row.forEach((v, r) => data.set(v, o + r * 4));
  });
  return {
    data,
    count: kinds.length,
    index: indexOf,
    lifeMin: (kind) => data[kind * KIND_ROWS * 4 + 6 * 4] as number,
    lifeMax: (kind) => data[kind * KIND_ROWS * 4 + 6 * 4 + 1] as number,
  };
}

/** Floats per compiled source (`EmitterTable.data`). */
export const EMITTER_FLOATS = 16;
/** Float offsets of a compiled source. */
export const E = {
  kind: 0,
  rate: 1,
  round: 2,
  width: 3,
  depth: 4,
  zMin: 5,
  zMax: 6,
  speedMin: 7,
  speedMax: 8,
  direction: 9,
  spread: 10,
  riseMin: 11,
  riseMax: 12,
  lifeMin: 13,
  lifeMax: 14,
  alignment: 15,
} as const;
/** Codes of the emitters' direction reference (`ausrichtung`). */
export const ALIGNMENT_CODE: Readonly<Record<ParticleEmitter['ausrichtung'], number>> = { fest: 0, radial: 1, tangential: 2 };

/** The particle sources compiled for the spawner. */
export interface EmitterTable {
  readonly data: Float32Array;
  readonly count: number;
  /** Index of a source id; throws for unknown ids. */
  index(id: string): number;
}

const DEG = Math.PI / 180;

/** Compiles `emitters` (default: the content's) against `kinds`. */
export function buildEmitterTable(kinds: KindTable, emitters: readonly ParticleEmitter[] = PARTICLE_EMITTERS): EmitterTable {
  const data = new Float32Array(Math.max(1, emitters.length) * EMITTER_FLOATS);
  const ids = emitters.map((e) => e.id);
  emitters.forEach((e, i) => {
    const o = i * EMITTER_FLOATS;
    const kind = kinds.index(e.art);
    data[o + E.kind] = kind;
    data[o + E.rate] = e.rate;
    data[o + E.round] = e.flaeche.form === 'kreis' ? 1 : 0;
    data[o + E.width] = e.flaeche.breite;
    data[o + E.depth] = e.flaeche.tiefe;
    data[o + E.zMin] = e.hoehe.min;
    data[o + E.zMax] = e.hoehe.max;
    data[o + E.speedMin] = e.tempo.min;
    data[o + E.speedMax] = e.tempo.max;
    data[o + E.direction] = e.richtung * DEG;
    data[o + E.spread] = e.streuung * DEG;
    data[o + E.riseMin] = e.steigen.min;
    data[o + E.riseMax] = e.steigen.max;
    data[o + E.lifeMin] = kinds.lifeMin(kind);
    data[o + E.lifeMax] = kinds.lifeMax(kind);
    data[o + E.alignment] = ALIGNMENT_CODE[e.ausrichtung];
  });
  return {
    data,
    count: emitters.length,
    index: (id) => {
      const i = ids.indexOf(id);
      if (i < 0) throw new Error(`Partikel: unbekannter Emitter „${id}“`);
      return i;
    },
  };
}
