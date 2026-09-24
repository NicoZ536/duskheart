/**
 * SFX preset schema (MASTERPROMPT §27 "SFX-Synthese-Engine (sfxr-artig + FM + Rauschen + Filter +
 * Hüllkurven + Layering), Presets als Daten, Varianten gegen Wiederholung"; docs/SPIEL.md §5 ids
 * `sfx_<bereich>_<name>`).
 *
 * A preset is a recipe, not a recording: src/audio/dsp/render.ts synthesises it sample by sample into a
 * mono buffer (the same code in the browser and in Node, so every preset is unit-testable). Fields:
 *
 * - `bus`: mixer bus of src/audio/mixer.ts – `effekte` (actions, world), `umgebung` (loops and beds),
 *   `ui` (menus, bags), `musik` (stingers).
 * - `lautstaerke`: loudness of the rendered buffer, 0–1 (every take is normalised to it by short-term
 *   loudness, the peak never above 0,98). This is the loudness of the preset relative to all others; the
 *   bus and the settings scale it further.
 * - `schichten`: 1–6 layers mixed together (§27 "Layering"). A layer has a `quelle` (oscillator
 *   `welle`, `fm` pair, `rauschen`, pitched sample-and-hold noise `digital`, sparse impulses
 *   `knistern`), an ADSR envelope `huelle`, a level `pegel`, a start offset `start`, and optionally a
 *   pitch glide (`frequenzEnde` of the source, curve `gleiten`), `vibrato`, a pitch jump `sprung`
 *   (sfxr "change"), a resonant `filter` with cutoff sweep, a `wiederholung` (the layer again after
 *   `abstand` seconds, each time `abfall` quieter and `tonhoehe` higher/lower – chews, gulps,
 *   arpeggios) and a bit depth `koernung` (coarse 16-bit grit).
 * - `varianten`: how many takes are rendered (different noise seeds and a `streuung.klang` jitter of
 *   frequencies); playback picks another take than last time (§27 "Varianten gegen Wiederholung").
 *   `streuung.tonhoehe` [cent] and `streuung.lautstaerke` [dB] vary every single playback.
 * - `schleife`: the preset is a seamless loop of `dauer` seconds (fire crackle, sleep breathing,
 *   heartbeat) instead of a one-shot. The seam is crossfaded over the first 0,12 s (at most a quarter of
 *   the loop): sustained layers (`dauerton`) run through it, pulsed layers start after it.
 * - `reichweite`: audible radius [tiles] of a positioned sound (distance attenuation to 0 at the edge).
 * - `stimmen`: at most this many voices of the preset at once (the oldest is replaced);
 *   `sperrzeit`: a new start within this many seconds of the last one is skipped (no machine-gun
 *   stacking of the same event in one tick).
 * - `untertitel`: DE/EN subtitle of an important sound (§27 "Untertitel für wichtige Laute"); only
 *   presets that carry one are subtitled.
 */
import { z } from 'zod';
import { localizedTextSchema } from '../schema/common';
import { SFX_ID_PATTERN } from '../schema/item';

// ---------------------------------------------------------------------------------------------
// Enumerations and limits
// ---------------------------------------------------------------------------------------------

/** Mixer buses (§27 "Master → Busse Musik, Effekte, Umgebung, UI"). */
export const SFX_BUSES = ['effekte', 'umgebung', 'ui', 'musik'] as const;
export type SfxBus = (typeof SFX_BUSES)[number];

/** Oscillator waveforms (§27: Rechteck, Dreieck, Säge, Sinus). */
export const SFX_WAVEFORMS = ['rechteck', 'dreieck', 'saege', 'sinus'] as const;
export type SfxWaveform = (typeof SFX_WAVEFORMS)[number];

/** Noise colours: white, pink (−3 dB/octave), brown (−6 dB/octave). */
export const SFX_NOISE_COLORS = ['weiss', 'rosa', 'braun'] as const;
export type SfxNoiseColor = (typeof SFX_NOISE_COLORS)[number];

/** Filter types (resonant biquads). */
export const SFX_FILTER_TYPES = ['tiefpass', 'hochpass', 'bandpass'] as const;
export type SfxFilterType = (typeof SFX_FILTER_TYPES)[number];

/** Frequency curves of glides and sweeps. */
export const SFX_GLIDES = ['exponentiell', 'linear'] as const;
export type SfxGlide = (typeof SFX_GLIDES)[number];

/**
 * Sample rate of the synthesis [Hz]: the SNES DSP ran at 32 kHz – enough for every SFX (content above
 * 16 kHz is inaudible in this style), a third less memory than 48 kHz; the browser resamples on playback.
 */
export const SFX_SAMPLE_RATE = 32000;
/** Lowest source/filter frequency [Hz]. */
export const SFX_FREQ_MIN = 20;
/** Highest source/filter frequency [Hz] (below the Nyquist frequency of `SFX_SAMPLE_RATE`). */
export const SFX_FREQ_MAX = 14000;
/** Longest one-shot [s]: longer sounds are loops or music. */
export const SFX_MAX_SECONDS = 4;
/** Loop length range [s]. */
export const SFX_LOOP_MIN_SECONDS = 0.25;
export const SFX_LOOP_MAX_SECONDS = 6;
/** Longest hold of an envelope [s] (a loop layer holds past the loop's end into the seam crossfade). */
export const SFX_MAX_HOLD_SECONDS = 8;
/** Layers per preset. */
export const SFX_MAX_LAYERS = 6;
/** Rendered takes per preset. */
export const SFX_MAX_VARIANTS = 8;
/** Pitch variation per playback [cent] (one octave). */
export const SFX_MAX_PITCH_SPREAD_CENTS = 1200;
/** Volume variation per playback [dB]. */
export const SFX_MAX_VOLUME_SPREAD_DB = 12;
/** Frequency jitter between takes [fraction]. */
export const SFX_MAX_TIMBRE_SPREAD = 0.25;
/** Audible radius range [tiles]. */
export const SFX_RANGE_MIN_TILES = 1;
export const SFX_RANGE_MAX_TILES = 64;
/** Default audible radius [tiles]: a bit more than half the 480-px view (15 tiles) – sounds fade out just off screen. */
export const SFX_DEFAULT_RANGE_TILES = 20;
/** Voices per preset. */
export const SFX_MAX_VOICES = 16;
/** Default voices per preset. */
export const SFX_DEFAULT_VOICES = 4;
/** Longest lock-out [s]. */
export const SFX_MAX_LOCKOUT_SECONDS = 5;
/** Default lock-out between two starts of one preset [s] (two events of one tick play once). */
export const SFX_DEFAULT_LOCKOUT_SECONDS = 0.03;

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

const hz = z.number().min(SFX_FREQ_MIN).max(SFX_FREQ_MAX);
const seconds = (max: number): z.ZodNumber => z.number().min(0).max(max);
const level = z.number().min(0).max(1);

/** Oscillator (sfxr square/triangle/saw/sine); `tastgrad` = pulse width of the square. */
export const sfxWaveSourceSchema = z
  .object({
    art: z.literal('welle'),
    form: z.enum(SFX_WAVEFORMS),
    frequenz: hz,
    frequenzEnde: hz.optional(),
    tastgrad: z.number().min(0.05).max(0.95).optional(),
  })
  .strict()
  .refine((s) => s.tastgrad === undefined || s.form === 'rechteck', { message: 'tastgrad only applies to rechteck', path: ['tastgrad'] });

/**
 * Upper edge of an FM pair's spectrum by Carson's rule, `f + (index + 1) × f × verhaeltnis` at the highest
 * frequency and index: above the Nyquist frequency the sidebands would fold back as inharmonic hash.
 */
export function fmUpperEdgeHz(s: { frequenz: number; frequenzEnde?: number | undefined; verhaeltnis: number; index: number; indexEnde?: number | undefined }): number {
  const f = Math.max(s.frequenz, s.frequenzEnde ?? 0);
  return f + (Math.max(s.index, s.indexEnde ?? 0) + 1) * f * s.verhaeltnis;
}

/** Two-operator FM: sine carrier at `frequenz`, modulator at `frequenz × verhaeltnis`, index sweep `index` → `indexEnde`. */
export const sfxFmSourceSchema = z
  .object({
    art: z.literal('fm'),
    frequenz: hz,
    frequenzEnde: hz.optional(),
    verhaeltnis: z.number().min(0.125).max(16),
    index: z.number().min(0).max(24),
    indexEnde: z.number().min(0).max(24).optional(),
  })
  .strict()
  .refine((s) => fmUpperEdgeHz(s) <= SFX_SAMPLE_RATE / 2, {
    message: `FM sidebands reach past ${SFX_SAMPLE_RATE / 2} Hz and would alias (lower frequenz, verhaeltnis or index)`,
    path: ['index'],
  });

/** Continuous noise of a colour. */
export const sfxNoiseSourceSchema = z.object({ art: z.literal('rauschen'), farbe: z.enum(SFX_NOISE_COLORS) }).strict();

/** Pitched sample-and-hold noise (the 8/16-bit noise channel): a new random value `frequenz` times per second. */
export const sfxDigitalSourceSchema = z.object({ art: z.literal('digital'), frequenz: hz, frequenzEnde: hz.optional() }).strict();

/** Sparse impulses (crackle, gravel, splinters, droplets): `dichte` bursts per second of `laenge` seconds decay. */
export const sfxCrackleSourceSchema = z
  .object({
    art: z.literal('knistern'),
    dichte: z.number().min(0.5).max(4000),
    dichteEnde: z.number().min(0.5).max(4000).optional(),
    laenge: z.number().min(0.0005).max(0.1),
  })
  .strict();

export const sfxSourceSchema = z.discriminatedUnion('art', [sfxWaveSourceSchema, sfxFmSourceSchema, sfxNoiseSourceSchema, sfxDigitalSourceSchema, sfxCrackleSourceSchema]);
export type SfxSource = z.output<typeof sfxSourceSchema>;

/** Resonant filter with an optional cutoff sweep over the layer. */
export const sfxFilterSchema = z
  .object({
    art: z.enum(SFX_FILTER_TYPES),
    frequenz: hz,
    frequenzEnde: hz.optional(),
    /** Q (0,707 = no resonance peak). */
    resonanz: z.number().min(0.3).max(24).default(0.707),
  })
  .strict();
export type SfxFilter = z.output<typeof sfxFilterSchema>;

/** ADSR envelope [s]; `kurve` bends decay and release (1 linear, higher = snappier, punchier). */
export const sfxEnvelopeSchema = z
  .object({
    anschlag: seconds(2),
    abfall: seconds(SFX_MAX_SECONDS),
    halten: level,
    haltezeit: seconds(SFX_MAX_HOLD_SECONDS),
    ausklang: seconds(SFX_MAX_SECONDS),
    kurve: z.number().min(1).max(6).default(2),
  })
  .strict()
  .refine((e) => e.anschlag + e.abfall + e.haltezeit + e.ausklang > 0, { message: 'envelope has no length' });
export type SfxEnvelope = z.output<typeof sfxEnvelopeSchema>;

/** The layer again after `abstand` seconds, `anzahl` times in all. */
export const sfxRepeatSchema = z
  .object({
    anzahl: z.number().int().min(2).max(16),
    abstand: z.number().min(0.005).max(2),
    /** Level factor from one repeat to the next. */
    abfall: z.number().min(0).max(1).default(1),
    /** Pitch factor from one repeat to the next (source and filter; arpeggios). */
    tonhoehe: z.number().min(0.25).max(4).default(1),
  })
  .strict();

export const sfxLayerSchema = z
  .object({
    quelle: sfxSourceSchema,
    huelle: sfxEnvelopeSchema,
    pegel: level.default(1),
    /** Start offset of the layer [s]. */
    start: seconds(SFX_MAX_SECONDS).default(0),
    /** Curve of the glides (`frequenzEnde`, `indexEnde`, `dichteEnde`, filter sweep). */
    gleiten: z.enum(SFX_GLIDES).default('exponentiell'),
    vibrato: z
      .object({ tiefe: z.number().min(0).max(SFX_MAX_PITCH_SPREAD_CENTS), rate: z.number().min(0.1).max(40) })
      .strict()
      .optional(),
    /** Pitch jump by `faktor` after `nach` seconds (sfxr "change"). */
    sprung: z
      .object({ faktor: z.number().min(0.25).max(4), nach: seconds(SFX_MAX_SECONDS) })
      .strict()
      .optional(),
    filter: sfxFilterSchema.optional(),
    wiederholung: sfxRepeatSchema.optional(),
    /** Bit depth of the layer (3–16): coarse quantisation for grit. */
    koernung: z.number().int().min(3).max(16).optional(),
  })
  .strict();
export type SfxLayer = z.output<typeof sfxLayerSchema>;

// ---------------------------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------------------------

/** Length of one pass of a layer's envelope [s]. */
export function sfxEnvelopeSeconds(e: Pick<SfxEnvelope, 'anschlag' | 'abfall' | 'haltezeit' | 'ausklang'>): number {
  return e.anschlag + e.abfall + e.haltezeit + e.ausklang;
}

/** When a layer has finished, repeats included [s from the preset start]. */
export function sfxLayerEndSeconds(layer: Pick<SfxLayer, 'huelle' | 'start' | 'wiederholung'>): number {
  const repeats = layer.wiederholung === undefined ? 0 : (layer.wiederholung.anzahl - 1) * layer.wiederholung.abstand;
  return layer.start + repeats + sfxEnvelopeSeconds(layer.huelle);
}

/** Length of a preset [s]: the loop length, or the end of its last layer. */
export function sfxPresetSeconds(preset: { readonly schichten: ReadonlyArray<Pick<SfxLayer, 'huelle' | 'start' | 'wiederholung'>>; readonly schleife?: { readonly dauer: number } | undefined }): number {
  if (preset.schleife !== undefined) return preset.schleife.dauer;
  let end = 0;
  for (const l of preset.schichten) end = Math.max(end, sfxLayerEndSeconds(l));
  return end;
}

export const sfxPresetSchema = z
  .object({
    id: z.string().regex(SFX_ID_PATTERN, { message: 'SFX id must look like sfx_<bereich>_<name>' }),
    bus: z.enum(SFX_BUSES),
    lautstaerke: z.number().min(0.02).max(1),
    schichten: z.array(sfxLayerSchema).min(1).max(SFX_MAX_LAYERS),
    varianten: z.number().int().min(1).max(SFX_MAX_VARIANTS).default(1),
    streuung: z
      .object({
        tonhoehe: z.number().min(0).max(SFX_MAX_PITCH_SPREAD_CENTS).default(0),
        lautstaerke: z.number().min(0).max(SFX_MAX_VOLUME_SPREAD_DB).default(0),
        klang: z.number().min(0).max(SFX_MAX_TIMBRE_SPREAD).default(0),
      })
      .strict()
      .default({ tonhoehe: 0, lautstaerke: 0, klang: 0 }),
    schleife: z.object({ dauer: z.number().min(SFX_LOOP_MIN_SECONDS).max(SFX_LOOP_MAX_SECONDS) }).strict().optional(),
    reichweite: z.number().min(SFX_RANGE_MIN_TILES).max(SFX_RANGE_MAX_TILES).default(SFX_DEFAULT_RANGE_TILES),
    stimmen: z.number().int().min(1).max(SFX_MAX_VOICES).default(SFX_DEFAULT_VOICES),
    sperrzeit: z.number().min(0).max(SFX_MAX_LOCKOUT_SECONDS).default(SFX_DEFAULT_LOCKOUT_SECONDS),
    untertitel: localizedTextSchema.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.schleife === undefined && sfxPresetSeconds(p) > SFX_MAX_SECONDS) {
      ctx.addIssue({ code: 'custom', path: ['schichten'], message: `one-shot longer than ${SFX_MAX_SECONDS} s (${sfxPresetSeconds(p).toFixed(2)} s)` });
    }
  });

/** A validated SFX preset (defaults filled in). */
export type SfxPreset = z.output<typeof sfxPresetSchema>;
/** Preset data as written in the group files (defaults may be omitted). */
export type SfxPresetInput = z.input<typeof sfxPresetSchema>;
