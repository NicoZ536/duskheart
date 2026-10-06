/**
 * Procedural reverb of the rooms the player stands in (M7-01; MASTERPROMPT §27 "Hall per Convolution mit prozedural
 * erzeugten Impulsantworten (Höhle, Innenraum, Halle)"):
 *
 * - **Impulses** (`generateImpulse`): no recorded files – each room's impulse response is made from seeded noise at the
 *   context's sample rate: a short pre-delay, a handful of discrete early reflections (the nearest walls), then a diffuse
 *   tail that falls by 60 dB over the room's `rt60` while a one-pole low-pass closes from `hellStartHz` to `hellEndHz`
 *   (high frequencies die first, as in every real room). Left and right draw from separate noise streams (a wide,
 *   decorrelated tail); both are scaled to unit energy, so a room's `sends` alone decide how much reverb is heard.
 * - **Rooms** (`reverbRoomFor`): a vault, or a built room of at least `HALLE_MIN_TILES` → `halle`; any cave layer →
 *   `hoehle`; inside a house → `innenraum`; under the open sky no reverb.
 * - **Graph** (`ReverbRack`): the buses' sends meet in one input; two convolver slots A/B take turns – a new room loads its
 *   impulse into the idle slot and the two wet gains crossfade over `REVERB_CROSSFADE_SECONDS` – into the compressor.
 *
 * Presentation code: the noise comes from its own `Rng`, never from the simulation's streams.
 */
import type { SfxBus } from '../content/sfx/schema';
import { Rng } from '../engine/rng';
import type { AudioBufferLike, AudioContextLike, AudioNodeLike, ConvolverNodeLike, GainNodeLike } from './webAudio';

/** The reverb rooms. */
export const REVERB_ROOMS = ['hoehle', 'innenraum', 'halle'] as const;
export type ReverbRoom = (typeof REVERB_ROOMS)[number];

/** One room's acoustics. */
export interface ReverbSpec {
  /** Time for the tail to fall by 60 dB [s]. */
  readonly rt60: number;
  /** Gap between the direct sound and the first reflection [s]. */
  readonly vorverzoegerung: number;
  /** Low-pass of the tail at its start and after `rt60` [Hz] (the room's materials eat the highs). */
  readonly hellStartHz: number;
  readonly hellEndHz: number;
  /** Early reflections: count, window after the pre-delay [s] and level relative to the tail's start. */
  readonly fruehe: { readonly anzahl: number; readonly bis: number; readonly pegel: number };
  /** Send level of each world bus into the room (0: dry). UI never reverberates. */
  readonly sends: Readonly<Record<Exclude<SfxBus, 'ui'>, number>>;
}

/**
 * The three rooms of §27:
 * - **Höhle**: long (2,6 s) and dark – wet rock rings, moss and earth swallow the highs; the nearest walls answer within
 *   90 ms. The ambience bus (drips, wind in the shafts) is sent strongest: the cave's own sound is its echo.
 * - **Innenraum**: a timber house – short (0,45 s), the walls a few metres off, fairly dark (wood, cloth).
 * - **Halle**: a vault or a great hall – 1,7 s, brighter stone, reflections within 50 ms.
 * Music stays dry everywhere: it plays in no room (the player's own song goes to the effects bus and rings with the room).
 */
export const REVERB_SPECS: Readonly<Record<ReverbRoom, ReverbSpec>> = {
  hoehle: { rt60: 2.6, vorverzoegerung: 0.02, hellStartHz: 7000, hellEndHz: 900, fruehe: { anzahl: 7, bis: 0.09, pegel: 0.5 }, sends: { effekte: 0.32, umgebung: 0.4, musik: 0 } },
  innenraum: { rt60: 0.45, vorverzoegerung: 0.004, hellStartHz: 6000, hellEndHz: 2200, fruehe: { anzahl: 5, bis: 0.025, pegel: 0.6 }, sends: { effekte: 0.2, umgebung: 0.12, musik: 0 } },
  halle: { rt60: 1.7, vorverzoegerung: 0.014, hellStartHz: 9000, hellEndHz: 2600, fruehe: { anzahl: 6, bis: 0.05, pegel: 0.4 }, sends: { effekte: 0.3, umgebung: 0.25, musik: 0 } },
};

/** A built room of at least this many tiles sounds like a hall [tiles]. */
export const HALLE_MIN_TILES = 60;
/** The impulse runs this much longer than `rt60` (the last 10 % of the tail fade to zero, no cut). */
const TAIL_FACTOR = 1.15;
/** Fade-in of the diffuse tail after the pre-delay [s] (a soft onset instead of a click). */
const ONSET_SECONDS = 0.002;
/** −60 dB as a natural-log factor: e^−6,9078 = 10^−3. */
const LN_1000 = Math.log(1000);
/** Crossfade between two rooms [s] (time constant: a third of it). */
export const REVERB_CROSSFADE_SECONDS = 0.6;
/** Default seed of the impulses (any fixed number: the rooms sound the same in every session). */
export const REVERB_SEED = 0x5ca1ab1e;

/** A stereo impulse response. */
export interface ReverbImpulse {
  readonly room: ReverbRoom;
  readonly sampleRate: number;
  readonly left: Float32Array<ArrayBuffer>;
  readonly right: Float32Array<ArrayBuffer>;
}

/** Length of a room's impulse at `sampleRate` [samples]. */
export function impulseLength(room: ReverbRoom, sampleRate: number): number {
  const s = REVERB_SPECS[room];
  return Math.ceil((s.vorverzoegerung + s.rt60 * TAIL_FACTOR) * sampleRate);
}

function fillChannel(out: Float32Array, spec: ReverbSpec, sampleRate: number, rng: Rng): void {
  const n = out.length;
  const pre = Math.round(spec.vorverzoegerung * sampleRate);
  const onset = Math.max(1, Math.round(ONSET_SECONDS * sampleRate));
  const tailEnd = n - pre;
  const fadeFrom = Math.floor(tailEnd / TAIL_FACTOR);
  const decay = LN_1000 / (spec.rt60 * sampleRate);
  // The low-pass closes exponentially from the start cutoff to the end cutoff over rt60.
  const cutoffRatio = spec.hellEndHz / spec.hellStartHz;
  let lp = 0;
  for (let i = 0; i < tailEnd; i++) {
    const t = i / (spec.rt60 * sampleRate);
    const cutoff = spec.hellStartHz * cutoffRatio ** Math.min(1, t);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    lp += a * (rng.float(-1, 1) - lp);
    let env = Math.exp(-decay * i);
    if (i < onset) env *= i / onset;
    if (i > fadeFrom) env *= (tailEnd - i) / (tailEnd - fadeFrom);
    out[pre + i] = lp * env;
  }
  // Early reflections: single, slightly smeared taps of falling level and alternating sign, spread over the window.
  const er = spec.fruehe;
  for (let k = 0; k < er.anzahl; k++) {
    const at = pre + Math.round(rng.float(0.05, 1) * er.bis * sampleRate);
    const level = er.pegel * (1 - k / (er.anzahl + 1)) * (k % 2 === 0 ? 1 : -1);
    if (at + 1 < n) {
      out[at] = (out[at] as number) + level;
      out[at + 1] = (out[at + 1] as number) + level * 0.5;
      if (at > 0) out[at - 1] = (out[at - 1] as number) + level * 0.25;
    }
  }
  let energy = 0;
  for (let i = 0; i < n; i++) energy += (out[i] as number) ** 2;
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) * scale;
}

/** The impulse response of `room` at `sampleRate`, the same for the same `seed` (see module comment). */
export function generateImpulse(room: ReverbRoom, sampleRate: number, seed: number = REVERB_SEED): ReverbImpulse {
  const n = impulseLength(room, sampleRate);
  const spec = REVERB_SPECS[room];
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rngL = new Rng((seed ^ 0x1f) >>> 0);
  const rngR = new Rng((seed ^ 0x2e7) >>> 0);
  fillChannel(left, spec, sampleRate, rngL);
  fillChannel(right, spec, sampleRate, rngR);
  return { room, sampleRate, left, right };
}

/** What decides the room: the player's layer, whether a roof or a room's walls are around, the room's size, a vault. */
export interface RoomSituation {
  layer: number;
  indoors: boolean;
  roomTiles: number;
  inVault: boolean;
}

/** The reverb room of a situation, or `null` under the open sky (see module comment). */
export function reverbRoomFor(s: Readonly<RoomSituation>): ReverbRoom | null {
  if (s.inVault) return 'halle';
  if (s.layer < 0) return 'hoehle';
  if (!s.indoors) return null;
  return s.roomTiles >= HALLE_MIN_TILES ? 'halle' : 'innenraum';
}

interface Slot {
  /** The input's branch into the slot (the old convolver is cut off here when the slot gets a new room). */
  readonly feed: GainNodeLike;
  convolver: ConvolverNodeLike | null;
  readonly wet: GainNodeLike;
  room: ReverbRoom | null;
}

/** The reverb of the mixer: one input, two convolver slots crossfading into `output` (see module comment). */
export class ReverbRack {
  readonly input: GainNodeLike;
  private readonly slots: readonly [Slot, Slot];
  private active = 0;
  private roomValue: ReverbRoom | null = null;
  private readonly buffers = new Map<ReverbRoom, AudioBufferLike>();

  constructor(
    private readonly ctx: AudioContextLike,
    output: AudioNodeLike,
    private readonly seed: number = REVERB_SEED,
  ) {
    this.input = ctx.createGain();
    const slot = (): Slot => {
      const feed = ctx.createGain();
      this.input.connect(feed);
      const wet = ctx.createGain();
      wet.gain.value = 0;
      wet.connect(output);
      return { feed, convolver: null, wet, room: null };
    };
    this.slots = [slot(), slot()];
  }

  /** The room reverberating now (`null`: dry). */
  get room(): ReverbRoom | null {
    return this.roomValue;
  }

  /** The impulse buffer of `room` for this context (generated once). */
  impulse(room: ReverbRoom): AudioBufferLike {
    let b = this.buffers.get(room);
    if (b === undefined) {
      const ir = generateImpulse(room, this.ctx.sampleRate, this.seed);
      b = this.ctx.createBuffer(2, ir.left.length, ir.sampleRate);
      b.copyToChannel(ir.left, 0);
      b.copyToChannel(ir.right, 1);
      this.buffers.set(room, b);
    }
    return b;
  }

  /** Crossfades to `room` (`null`: the reverb fades out). */
  setRoom(room: ReverbRoom | null): void {
    if (room === this.roomValue) return;
    const now = this.ctx.currentTime;
    const tc = REVERB_CROSSFADE_SECONDS / 3;
    const current = this.slots[this.active] as Slot;
    this.roomValue = room;
    if (room === null) {
      current.wet.gain.setTargetAtTime(0, now, tc);
      return;
    }
    // The current slot fades out; the other one gets the new room (a fresh convolver: the idle one faded long ago).
    current.wet.gain.setTargetAtTime(0, now, tc);
    const nextIndex = current.room === null ? this.active : 1 - this.active;
    const next = this.slots[nextIndex] as Slot;
    if (next.room !== room || next.convolver === null) {
      next.feed.disconnect();
      next.convolver?.disconnect();
      const conv = this.ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = this.impulse(room);
      next.feed.connect(conv);
      conv.connect(next.wet);
      next.convolver = conv;
      next.room = room;
    }
    next.wet.gain.setTargetAtTime(1, now, tc);
    this.active = nextIndex;
  }

  /** The wet gain of slot `i` (tests). */
  wet(i: 0 | 1): GainNodeLike {
    return (this.slots[i] as Slot).wet;
  }
}
