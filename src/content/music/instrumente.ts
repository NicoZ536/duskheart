/**
 * The instrument palette of the music (src/content/music/*.ts): every piece lists the instruments it uses in its own order
 * (the notation addresses them by index), taken from here so the pieces share one sound – a 16-bit band of plucked harp,
 * soft flute, choir and string pads, triangle bass, pulse lead and a noise/triangle drum kit, all through the SNES-like
 * echo of the piece.
 */
import type { MusicEchoInput, TrackerInstrumentInput } from './schema';

type Spec = Omit<TrackerInstrumentInput, 'id'>;

const PALETTE = {
  // --- melody ---
  /** Soft pulse lead with a late vibrato. */
  puls: { welle: 'rechteck', tastgrad: 0.25, huellkurve: [0.01, 0.35, 0.65, 0.18], pegel: 0.42, pan: 0.1, echoSend: 0.4, vibrato: { tiefe: 16, rate: 5.5, verzoegerung: 0.28 }, filter: { art: 'tiefpass', frequenz: 4200, resonanz: 0.7 } },
  /** Hollow square for counter lines. */
  hohl: { welle: 'rechteck', tastgrad: 0.5, huellkurve: [0.01, 0.4, 0.5, 0.15], pegel: 0.3, pan: -0.3, echoSend: 0.35, filter: { art: 'tiefpass', frequenz: 2600, resonanz: 0.7 } },
  /** Wooden flute: wavetable, breathy attack, vibrato after a beat. */
  floete: { welle: 'wavetable', tabelle: 'floete', huellkurve: [0.05, 0.25, 0.8, 0.22], pegel: 0.55, pan: 0.15, echoSend: 0.45, vibrato: { tiefe: 14, rate: 5, verzoegerung: 0.3 } },
  /** Plucked harp: FM, ringing decay. */
  harfe: { welle: 'fm', fm: { verhaeltnis: 2, index: 1.6 }, huellkurve: [0.002, 1.1, 0, 0.5], pegel: 0.4, pan: -0.25, echoSend: 0.45 },
  /** Bell / celesta: FM with an inharmonic ratio. */
  glocke: { welle: 'fm', fm: { verhaeltnis: 3.5, index: 2.2 }, huellkurve: [0.002, 1.8, 0, 1], pegel: 0.3, pan: 0.35, echoSend: 0.55 },
  /** Warm electric piano for the base. */
  epiano: { welle: 'fm', fm: { verhaeltnis: 1, index: 1.3 }, huellkurve: [0.003, 1.4, 0.2, 0.45], pegel: 0.36, pan: -0.15, echoSend: 0.3 },
  /** Lute: bright pluck. */
  laute: { welle: 'wavetable', tabelle: 'laute', huellkurve: [0.002, 0.8, 0, 0.35], pegel: 0.5, pan: -0.1, echoSend: 0.35, filter: { art: 'tiefpass', frequenz: 3800, resonanz: 0.9 } },
  /** Accordion reed for the base theme. */
  zunge: { welle: 'wavetable', tabelle: 'zunge', huellkurve: [0.03, 0.3, 0.75, 0.2], pegel: 0.32, pan: 0.2, echoSend: 0.25, chorus: { cents: 7 }, vibrato: { tiefe: 8, rate: 6, verzoegerung: 0.4 } },
  /** Horn for the boss: mellow brass. */
  horn: { welle: 'wavetable', tabelle: 'horn', huellkurve: [0.06, 0.4, 0.75, 0.3], pegel: 0.42, pan: -0.2, echoSend: 0.35, vibrato: { tiefe: 10, rate: 4.5, verzoegerung: 0.5 }, filter: { art: 'tiefpass', frequenz: 3000, resonanz: 0.8 } },
  /** Glassy lead for the night. */
  glas: { welle: 'wavetable', tabelle: 'glas', huellkurve: [0.004, 1.2, 0.15, 0.9], pegel: 0.34, pan: 0.3, echoSend: 0.6 },
  // --- harmony ---
  /** Choir pad: vowel table with a detuned second voice. */
  chor: { welle: 'wavetable', tabelle: 'chor', huellkurve: [0.6, 0.6, 0.75, 1.2], pegel: 0.22, pan: 0, echoSend: 0.4, chorus: { cents: 11 }, filter: { art: 'tiefpass', frequenz: 2400, resonanz: 0.7 } },
  /** String pad: detuned saw through a low-pass. */
  streicher: { welle: 'saege', huellkurve: [0.35, 0.5, 0.8, 0.8], pegel: 0.17, pan: -0.35, echoSend: 0.3, chorus: { cents: 9 }, filter: { art: 'tiefpass', frequenz: 2000, resonanz: 0.8 } },
  /** Drawbar organ. */
  orgel: { welle: 'wavetable', tabelle: 'orgel', huellkurve: [0.015, 0.2, 0.85, 0.25], pegel: 0.22, pan: 0.25, echoSend: 0.3 },
  // --- bass ---
  /** Triangle bass. */
  bass: { welle: 'dreieck', huellkurve: [0.004, 0.35, 0.65, 0.08], pegel: 0.6, pan: 0, echoSend: 0.05 },
  /** Saw bass through a resonant low-pass: the fight's drive. */
  saegebass: { welle: 'saege', huellkurve: [0.003, 0.22, 0.55, 0.07], pegel: 0.4, pan: 0, echoSend: 0.05, filter: { art: 'tiefpass', frequenz: 950, resonanz: 1.8 } },
  // --- drums ---
  /** Kick: triangle falling two and a half octaves. */
  kick: { welle: 'dreieck', huellkurve: [0.001, 0.2, 0, 0.05], pegel: 0.85, pan: 0, echoSend: 0, tonhoehenHuelle: { halbtoene: 30, sekunden: 0.08 } },
  /** Snare: high-passed noise. */
  snare: { welle: 'rauschen', huellkurve: [0.001, 0.16, 0, 0.06], pegel: 0.42, pan: 0.05, echoSend: 0.2, filter: { art: 'hochpass', frequenz: 900, resonanz: 0.8 } },
  /** Closed hi-hat. */
  hihat: { welle: 'rauschen', huellkurve: [0.001, 0.045, 0, 0.02], pegel: 0.22, pan: 0.25, echoSend: 0.05, filter: { art: 'hochpass', frequenz: 7000, resonanz: 0.7 } },
  /** Shaker: soft, a little attack. */
  shaker: { welle: 'rauschen', huellkurve: [0.012, 0.06, 0, 0.03], pegel: 0.13, pan: -0.25, echoSend: 0.1, filter: { art: 'bandpass', frequenz: 5000, resonanz: 1.2 } },
  /** Tom: triangle with a short drop. */
  tom: { welle: 'dreieck', huellkurve: [0.001, 0.32, 0, 0.1], pegel: 0.6, pan: -0.15, echoSend: 0.15, tonhoehenHuelle: { halbtoene: 12, sekunden: 0.14 } },
  /** Timpani: long triangle with a slight drop and a detuned skin. */
  pauke: { welle: 'dreieck', huellkurve: [0.002, 1, 0, 0.4], pegel: 0.7, pan: 0.1, echoSend: 0.25, tonhoehenHuelle: { halbtoene: 4, sekunden: 0.25 }, chorus: { cents: 18 } },
  /** Low string ostinato of the danger layer: dark saw. */
  dunkel: { welle: 'saege', huellkurve: [0.01, 0.2, 0.5, 0.1], pegel: 0.24, pan: 0.3, echoSend: 0.2, filter: { art: 'tiefpass', frequenz: 700, resonanz: 2.2 } },
} satisfies Record<string, Spec>;

/** Name of a palette instrument. */
export type PaletteName = keyof typeof PALETTE;

/** The instruments `names` in this order (the notation's instrument indices), each with its palette sound. */
export function instruments(names: readonly PaletteName[], overrides: Partial<Record<PaletteName, Partial<Spec>>> = {}): TrackerInstrumentInput[] {
  return names.map((name) => ({ id: name, ...(PALETTE[name] as Spec), ...(overrides[name] ?? {}) }));
}

/** The index of `name` in `names` (throws if missing – a piece only plays what it lists). */
export function idx(names: readonly PaletteName[], name: PaletteName): number {
  const i = names.indexOf(name);
  if (i < 0) throw new Error(`music: instrument "${name}" not in [${names.join(', ')}]`);
  return i;
}

/** The echo of a calm piece: 160 ms, soft feedback, a gentle low-pass FIR. */
export const ECHO_WEICH = { verzoegerungMs: 160, rueckkopplung: 0.42, fir: [0.4, 0.25, 0.15, 0.08, 0.05, 0.03, 0.02, 0.02], pegel: 0.32 } satisfies MusicEchoInput;
/** The echo of a large space (night, boss): 240 ms, longer feedback, darker. */
export const ECHO_WEIT = { verzoegerungMs: 240, rueckkopplung: 0.5, fir: [0.3, 0.25, 0.18, 0.12, 0.07, 0.04, 0.02, 0.02], pegel: 0.36 } satisfies MusicEchoInput;
/** The echo of a tight, driving piece: 96 ms, little feedback. */
export const ECHO_KURZ = { verzoegerungMs: 96, rueckkopplung: 0.25, fir: [0.5, 0.25, 0.12, 0.06, 0.03, 0.02, 0.01, 0.01], pegel: 0.22 } satisfies MusicEchoInput;
