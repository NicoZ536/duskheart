/**
 * Building blocks of the SFX group files (`schritte.ts`, `sammeln.ts`, …): `defineSfxGroup` completes every preset with
 * the schema's defaults (`completeSfxPreset`), checks it with the schema where the content is checked (mode `voll`,
 * src/content/check.ts), rejects duplicate ids and freezes the group (the same contract as the item groups); the small
 * constructors keep the recipes readable – a layer reads like
 * `{ quelle: ton('sinus', 180, 110), huelle: schlag(0.002, 0.12), filter: tiefpass(1200) }`.
 *
 * Why the defaults are written here as well as in the schema (M7-129): zod's parse of the 530 presets with their layers
 * made 8,2 MB of short-lived objects on the loading screen – boot garbage V8's memory reducer sweeps up in one long
 * collection in the middle of play. The production build (`vertraut`) uses the completed record as it is; `npm run check`
 * (`voll`) parses every preset with the schema and requires zod's result to equal the completed record (`contentDifference`,
 * key order aside), so the two cannot drift apart unnoticed.
 */
import type { z } from 'zod';
import { CONTENT_CHECK_MODE, contentDifference, type ContentCheckMode } from '../check';
import { deepFreeze } from '../freeze';
import {
  SFX_DEFAULT_LOCKOUT_SECONDS,
  SFX_DEFAULT_RANGE_TILES,
  SFX_DEFAULT_VOICES,
  SFX_LOOP_MAX_SECONDS,
  sfxPresetSchema,
  type SfxFilterType,
  type SfxNoiseColor,
  type SfxPreset,
  type SfxPresetInput,
  type SfxWaveform,
  type sfxEnvelopeSchema,
  type sfxFilterSchema,
  type sfxSourceSchema,
} from './schema';

/** Error in an SFX group. */
export class SfxGroupError extends Error {
  override readonly name = 'SfxGroupError';
}

/**
 * The defaults the schema fills in (`.default(…)` in schema.ts), written out: a layer's level, start and glide curve, an
 * envelope's curve, a filter's resonance, a repeat's level and pitch factors, a preset's takes, spread, range, voices and
 * lock-out. `completeSfxPreset` applies them; the full check proves them equal to the schema's.
 */
export const SFX_DEFAULTS = {
  layer: { pegel: 1, start: 0, gleiten: 'exponentiell' },
  envelope: { kurve: 2 },
  filter: { resonanz: 0.707 },
  repeat: { abfall: 1, tonhoehe: 1 },
  preset: { varianten: 1, reichweite: SFX_DEFAULT_RANGE_TILES, stimmen: SFX_DEFAULT_VOICES, sperrzeit: SFX_DEFAULT_LOCKOUT_SECONDS },
  spread: { tonhoehe: 0, lautstaerke: 0, klang: 0 },
} as const;

/** A value, or `fallback` where it is absent or `undefined` (as zod's `.default()` sees it). */
function or<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

type LayerInput = SfxPresetInput['schichten'][number];
type LayerOutput = SfxPreset['schichten'][number];

function completeLayer(l: LayerInput): LayerOutput {
  const huelle = { ...l.huelle, kurve: or(l.huelle.kurve, SFX_DEFAULTS.envelope.kurve) };
  // Keys stay as authored, an optional written as `undefined` included: zod keeps such a key in its result.
  const out: Record<string, unknown> = {
    quelle: { ...l.quelle },
    huelle,
    pegel: or(l.pegel, SFX_DEFAULTS.layer.pegel),
    start: or(l.start, SFX_DEFAULTS.layer.start),
    gleiten: or(l.gleiten, SFX_DEFAULTS.layer.gleiten),
  };
  if (l.vibrato !== undefined) out['vibrato'] = l.vibrato;
  if (l.sprung !== undefined) out['sprung'] = l.sprung;
  if (l.filter !== undefined) out['filter'] = { ...l.filter, resonanz: or(l.filter.resonanz, SFX_DEFAULTS.filter.resonanz) };
  if (l.wiederholung !== undefined) out['wiederholung'] = { ...l.wiederholung, abfall: or(l.wiederholung.abfall, SFX_DEFAULTS.repeat.abfall), tonhoehe: or(l.wiederholung.tonhoehe, SFX_DEFAULTS.repeat.tonhoehe) };
  if (l.koernung !== undefined) out['koernung'] = l.koernung;
  return out as unknown as LayerOutput;
}

/** `raw` with every default of the schema written out (what `sfxPresetSchema.parse(raw)` gives, up to key order). */
export function completeSfxPreset(raw: SfxPresetInput): SfxPreset {
  const spread = raw.streuung ?? {};
  const out: Record<string, unknown> = {
    id: raw.id,
    bus: raw.bus,
    lautstaerke: raw.lautstaerke,
    schichten: raw.schichten.map(completeLayer),
    varianten: or(raw.varianten, SFX_DEFAULTS.preset.varianten),
    streuung: { tonhoehe: or(spread.tonhoehe, SFX_DEFAULTS.spread.tonhoehe), lautstaerke: or(spread.lautstaerke, SFX_DEFAULTS.spread.lautstaerke), klang: or(spread.klang, SFX_DEFAULTS.spread.klang) },
  };
  if (raw.schleife !== undefined) out['schleife'] = raw.schleife;
  out['reichweite'] = or(raw.reichweite, SFX_DEFAULTS.preset.reichweite);
  out['stimmen'] = or(raw.stimmen, SFX_DEFAULTS.preset.stimmen);
  out['sperrzeit'] = or(raw.sperrzeit, SFX_DEFAULTS.preset.sperrzeit);
  if (raw.untertitel !== undefined) out['untertitel'] = raw.untertitel;
  return out as unknown as SfxPreset;
}

/**
 * Validates one group of presets: every preset completed (`completeSfxPreset`); in mode `voll` also parsed by the schema,
 * whose result must equal the completed record. Throws `SfxGroupError` naming the group, the preset and every issue;
 * duplicate ids inside the group are an error too. `mode` defaults to the build's (`CONTENT_CHECK_MODE`); tests pass it.
 */
export function defineSfxGroup(group: string, records: readonly SfxPresetInput[], mode: ContentCheckMode = CONTENT_CHECK_MODE): readonly SfxPreset[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const complete = completeSfxPreset(raw);
    if (mode === 'voll') {
      const result = sfxPresetSchema.safeParse(raw);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(preset)'}: ${i.message}`).join('; ');
        throw new SfxGroupError(`SFX group "${group}" [${index}] "${raw.id}" invalid: ${issues}`);
      }
      const d = contentDifference(result.data, complete);
      if (d !== null) throw new SfxGroupError(`SFX group "${group}" [${index}] "${raw.id}": completeSfxPreset differs from the schema's defaults at ${d.map(String).join('.') || '(preset)'} (M7-129)`);
    }
    if (seen.has(complete.id)) throw new SfxGroupError(`SFX group "${group}": duplicate id "${complete.id}"`);
    seen.add(complete.id);
    return complete;
  });
  deepFreeze(parsed);
  return parsed;
}

type SourceInput = z.input<typeof sfxSourceSchema>;
type EnvelopeInput = z.input<typeof sfxEnvelopeSchema>;
type FilterInput = z.input<typeof sfxFilterSchema>;

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

/** Oscillator of `form` gliding from `frequenz` to `frequenzEnde` [Hz]. */
export function ton(form: SfxWaveform, frequenz: number, frequenzEnde?: number): SourceInput {
  return { art: 'welle', form, frequenz, frequenzEnde };
}

/** Square wave with pulse width `tastgrad` (0,5 = hollow, 0,125 = thin and nasal). */
export function puls(frequenz: number, tastgrad: number, frequenzEnde?: number): SourceInput {
  return { art: 'welle', form: 'rechteck', frequenz, frequenzEnde, tastgrad };
}

/** FM pair: sine carrier, modulator at `verhaeltnis` × carrier, index `index` → `indexEnde`. */
export function fm(frequenz: number, verhaeltnis: number, index: number, indexEnde?: number, frequenzEnde?: number): SourceInput {
  return { art: 'fm', frequenz, verhaeltnis, index, indexEnde, frequenzEnde };
}

/** Continuous noise. */
export function rauschen(farbe: SfxNoiseColor): SourceInput {
  return { art: 'rauschen', farbe };
}

/** Pitched sample-and-hold noise (the retro noise channel). */
export function digital(frequenz: number, frequenzEnde?: number): SourceInput {
  return { art: 'digital', frequenz, frequenzEnde };
}

/** One cycle of content wavetable `tabelle` (collection `wavetables`) at `frequenz` → `frequenzEnde` [Hz]. */
export function tabelle(tabelleId: string, frequenz: number, frequenzEnde?: number): SourceInput {
  return { art: 'wavetable', tabelle: tabelleId, frequenz, frequenzEnde };
}

/** `dichte` impulses per second (→ `dichteEnde`), each decaying over `laenge` seconds. */
export function knistern(dichte: number, laenge: number, dichteEnde?: number): SourceInput {
  return { art: 'knistern', dichte, laenge, dichteEnde };
}

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

/** Percussive envelope: rise in `anschlag`, fall to silence in `abfall` [s]. */
export function schlag(anschlag: number, abfall: number, kurve = 2): EnvelopeInput {
  return { anschlag, abfall, halten: 0, haltezeit: 0, ausklang: 0, kurve };
}

/** Sustained envelope: rise, fall to `halten`, hold `haltezeit`, release in `ausklang` [s]. */
export function bogen(anschlag: number, abfall: number, halten: number, haltezeit: number, ausklang: number, kurve = 2): EnvelopeInput {
  return { anschlag, abfall, halten, haltezeit, ausklang, kurve };
}

/**
 * Envelope of a loop layer: a short rise, then full level for longer than any loop (the renderer cuts
 * it at the loop's end plus the seam crossfade, which also hides the rise).
 */
export function dauerton(): EnvelopeInput {
  return { anschlag: 0.01, abfall: 0, halten: 1, haltezeit: SFX_LOOP_MAX_SECONDS, ausklang: 0.01, kurve: 1 };
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

function filter(art: SfxFilterType, frequenz: number, resonanz?: number, frequenzEnde?: number): FilterInput {
  return { art, frequenz, resonanz, frequenzEnde };
}

/** Low-pass at `frequenz` [Hz] (Q `resonanz`), sweeping to `frequenzEnde`. */
export function tiefpass(frequenz: number, resonanz?: number, frequenzEnde?: number): FilterInput {
  return filter('tiefpass', frequenz, resonanz, frequenzEnde);
}

/** High-pass at `frequenz` [Hz]. */
export function hochpass(frequenz: number, resonanz?: number, frequenzEnde?: number): FilterInput {
  return filter('hochpass', frequenz, resonanz, frequenzEnde);
}

/** Band-pass around `frequenz` [Hz]; higher `resonanz` = narrower band. */
export function bandpass(frequenz: number, resonanz?: number, frequenzEnde?: number): FilterInput {
  return filter('bandpass', frequenz, resonanz, frequenzEnde);
}
