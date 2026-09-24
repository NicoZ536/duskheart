/**
 * Building blocks of the SFX group files (`schritte.ts`, `sammeln.ts`, …): `defineSfxGroup` validates
 * every preset with the schema, rejects duplicate ids and freezes the group (the same contract as the
 * item groups); the small constructors keep the recipes readable – a layer reads like
 * `{ quelle: ton('sinus', 180, 110), huelle: schlag(0.002, 0.12), filter: tiefpass(1200) }`.
 */
import type { z } from 'zod';
import { deepFreeze } from '../freeze';
import {
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
 * Validates one group of presets. Throws `SfxGroupError` naming the group, the preset and every
 * issue; duplicate ids inside the group are an error too.
 */
export function defineSfxGroup(group: string, records: readonly SfxPresetInput[]): readonly SfxPreset[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const result = sfxPresetSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(preset)'}: ${i.message}`).join('; ');
      throw new SfxGroupError(`SFX group "${group}" [${index}] "${raw.id}" invalid: ${issues}`);
    }
    if (seen.has(result.data.id)) throw new SfxGroupError(`SFX group "${group}": duplicate id "${result.data.id}"`);
    seen.add(result.data.id);
    return result.data;
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
