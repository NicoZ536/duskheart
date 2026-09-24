/**
 * Plays SFX presets on the mixer (MASTERPROMPT §27): renders each preset's takes once into
 * `AudioBuffer`s (src/audio/dsp/render.ts, on first use or ahead of time with `warmUp`) and starts voices.
 *
 * - **Variation against repetition:** every start picks another take than the last one and varies pitch
 *   (±`streuung.tonhoehe` cent via the playback rate) and volume (up to −`streuung.lautstaerke` dB).
 * - **Voices:** at most `stimmen` voices per preset (the oldest is faded out) and `MAX_VOICES` overall; a
 *   start within `sperrzeit` of the last start of the same preset is skipped (events of one tick).
 * - **Space:** a cue with a position is placed relative to the listener (src/audio/spatial.ts: distance,
 *   pan, occlusion low-pass, other layer = silent); out of range it is not started. Positioned voices follow
 *   the listener every frame (`update`). A cue without a position is the listener's own sound (centred).
 * - **Loops:** `setLoop(slot, cue)` keeps one looping voice per named slot (the fear whispers, the sleep
 *   breathing, one campfire): the same preset only moves, another one crossfades, `null` fades it out.
 *
 * Presentation code: variation uses its own seeded `Rng`, never the simulation's streams.
 */
import type { LocalizedText } from '../content/schema/common';
import { SFX_SAMPLE_RATE, type SfxPreset } from '../content/sfx/schema';
import { Rng } from '../engine/rng';
import { renderTakes } from './dsp/render';
import type { AudioMixer } from './mixer';
import { OPEN_CUTOFF_HZ, place, type Listener, type Placement } from './spatial';
import type { AudioBufferLike, AudioBufferSourceNodeLike, AudioContextLike, BiquadFilterNodeLike, GainNodeLike, StereoPannerNodeLike } from './webAudio';

/** Most voices at once (the oldest one-shot gives way). */
export const MAX_VOICES = 32;
/** Fade of a voice that is stopped early, and of loops [s, time constant]. */
const STOP_FADE_SECONDS = 0.015;
const LOOP_FADE_SECONDS = 0.12;
/** A stopped voice ends after this many fade time constants. */
const STOP_AFTER_CONSTANTS = 5;
/** Time constant of a positioned voice following the listener [s]. */
const FOLLOW_SECONDS = 0.03;
/** Smallest change of level, pan and cutoff (relative) worth a new automation event. */
const GAIN_EPSILON = 0.002;
const PAN_EPSILON = 0.005;
const CUTOFF_EPSILON = 0.02;

/** A request to play a preset. */
export interface SfxCue {
  readonly id: string;
  /** World position [px]; without one the sound belongs to the listener (the player's own sounds). */
  readonly x?: number;
  readonly y?: number;
  /** World layer of the position (default: the listener's). */
  readonly layer?: number;
  /** Volume factor (default 1). */
  readonly volume?: number;
  /** Pitch factor (default 1). */
  readonly pitch?: number;
}

export interface SfxPlayerOptions {
  /** Seed of the variation. */
  readonly seed?: number;
  /** Occlusion 0 (open) … 1 (behind walls) of a position – the hook for walls and rooms. */
  readonly occlusion?: (x: number, y: number, layer: number) => number;
  /** Called when a preset with a subtitle starts (§27 "Untertitel für wichtige Laute"). */
  readonly onSubtitle?: (text: LocalizedText, cue: SfxCue) => void;
}

interface Voice {
  readonly preset: SfxPreset;
  readonly source: AudioBufferSourceNodeLike;
  readonly gain: GainNodeLike;
  readonly panner: StereoPannerNodeLike | null;
  readonly filter: BiquadFilterNodeLike | null;
  /** Volume without the placement (cue volume × variation). */
  readonly level: number;
  x: number;
  y: number;
  layer: number;
  readonly positioned: boolean;
  readonly startedAt: number;
  stopping: boolean;
  readonly loop: string | null;
  /** Placement last sent to the nodes (`update` only schedules a change when it moved). */
  sentGain: number;
  sentPan: number;
  sentCutoff: number;
}

export class SfxPlayer {
  readonly listener: Listener = { x: 0, y: 0, layer: 0 };
  private readonly presets: ReadonlyMap<string, SfxPreset>;
  private readonly buffers = new Map<string, readonly AudioBufferLike[]>();
  private readonly lastStart = new Map<string, number>();
  private readonly lastTake = new Map<string, number>();
  private readonly loops = new Map<string, Voice>();
  private voices: Voice[] = [];
  private readonly rng: Rng;
  private readonly placement: Placement = { gain: 0, pan: 0, cutoffHz: OPEN_CUTOFF_HZ };
  private readonly reportedUnknown = new Set<string>();
  private warmUpQueue: string[];

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly mixer: AudioMixer,
    presets: readonly SfxPreset[],
    private readonly options: SfxPlayerOptions = {},
  ) {
    this.presets = new Map(presets.map((p) => [p.id, p]));
    this.rng = new Rng(options.seed ?? 1);
    this.warmUpQueue = presets.map((p) => p.id);
  }

  /** Voices currently sounding (loops included, fading voices not). */
  get activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (!v.stopping) n++;
    return n;
  }

  /** Whether a preset `id` exists. */
  has(id: string): boolean {
    return this.presets.has(id);
  }

  /** Whether the takes of `id` are rendered. */
  isPrepared(id: string): boolean {
    return this.buffers.has(id);
  }

  /** The takes of `id`, rendered now on this thread if they were not yet (throws for an unknown id). */
  prepare(id: string): readonly AudioBufferLike[] {
    const cached = this.buffers.get(id);
    if (cached !== undefined) return cached;
    const preset = this.presets.get(id);
    if (preset === undefined) throw new Error(`SFX: unbekanntes Preset „${id}“`);
    return this.provide(id, renderTakes(preset));
  }

  /** Takes of `id` rendered elsewhere (the SFX worker); ignored when they are already there. */
  provide(id: string, samples: readonly Float32Array<ArrayBuffer>[]): readonly AudioBufferLike[] {
    const cached = this.buffers.get(id);
    if (cached !== undefined) return cached;
    const takes = samples.map((s) => {
      const buffer = this.ctx.createBuffer(1, s.length, SFX_SAMPLE_RATE);
      buffer.copyToChannel(s, 0);
      return buffer;
    });
    this.buffers.set(id, takes);
    return takes;
  }

  /** Renders the next `count` presets not yet rendered (idle time after the unlock). Returns how many remain. */
  warmUp(count: number): number {
    let done = 0;
    while (done < count && this.warmUpQueue.length > 0) {
      const id = this.warmUpQueue.shift();
      if (id !== undefined && !this.buffers.has(id)) {
        this.prepare(id);
        done++;
      }
    }
    return this.warmUpQueue.length;
  }

  /** Moves the listener (once per frame, before `update`). */
  setListener(x: number, y: number, layer: number): void {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.layer = layer;
  }

  /** Plays a one-shot. Returns whether a voice started (false: unknown, locked out, out of range). */
  play(cue: SfxCue): boolean {
    const preset = this.lookup(cue.id);
    if (preset === null) return false;
    const now = this.ctx.currentTime;
    const last = this.lastStart.get(preset.id);
    if (last !== undefined && now - last < preset.sperrzeit) return false;
    const voice = this.start(preset, cue, null);
    if (voice === null) return false;
    this.lastStart.set(preset.id, now);
    this.limitVoices(preset);
    return true;
  }

  /**
   * Sets the loop of `slot`: starts `cue` (a preset with `schleife`), moves it if the slot already plays
   * that preset, crossfades from another preset, or fades the slot out with `null`.
   */
  setLoop(slot: string, cue: SfxCue | null): void {
    const current = this.loops.get(slot);
    if (cue !== null && current !== undefined && !current.stopping && current.preset.id === cue.id) {
      if (cue.x !== undefined && cue.y !== undefined) {
        current.x = cue.x;
        current.y = cue.y;
        current.layer = cue.layer ?? this.listener.layer;
      }
      return;
    }
    if (current !== undefined) {
      this.stop(current, LOOP_FADE_SECONDS);
      this.loops.delete(slot);
    }
    if (cue === null) return;
    const preset = this.lookup(cue.id);
    if (preset === null) return;
    const voice = this.start(preset, cue, slot);
    if (voice !== null) this.loops.set(slot, voice);
  }

  /** Once per frame: positioned voices follow the listener; finished voices are released. */
  update(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.stopping || !v.positioned) continue;
      const p = this.place(v.x, v.y, v.layer, v.preset.reichweite);
      // Only real changes are scheduled: a standing listener adds no automation events per frame.
      const gain = v.level * p.gain;
      if (Math.abs(gain - v.sentGain) > GAIN_EPSILON) {
        v.gain.gain.setTargetAtTime(gain, now, FOLLOW_SECONDS);
        v.sentGain = gain;
      }
      if (v.panner !== null && Math.abs(p.pan - v.sentPan) > PAN_EPSILON) {
        v.panner.pan.setTargetAtTime(p.pan, now, FOLLOW_SECONDS);
        v.sentPan = p.pan;
      }
      if (v.filter !== null && Math.abs(p.cutoffHz - v.sentCutoff) > v.sentCutoff * CUTOFF_EPSILON) {
        v.filter.frequency.setTargetAtTime(p.cutoffHz, now, FOLLOW_SECONDS);
        v.sentCutoff = p.cutoffHz;
      }
    }
  }

  /** Fades out every voice and loop (pause menu, death screen). */
  stopAll(): void {
    for (const v of this.voices) this.stop(v, STOP_FADE_SECONDS);
    this.loops.clear();
  }

  // -------------------------------------------------------------------------------------------

  private lookup(id: string): SfxPreset | null {
    const preset = this.presets.get(id);
    if (preset !== undefined) return preset;
    if (!this.reportedUnknown.has(id)) {
      this.reportedUnknown.add(id);
      console.error(`SFX: unbekanntes Preset „${id}“`);
    }
    return null;
  }

  private place(x: number, y: number, layer: number, rangeTiles: number): Placement {
    const occlusion = this.options.occlusion?.(x, y, layer) ?? 0;
    return place(x, y, layer, rangeTiles, this.listener, occlusion, this.placement);
  }

  private start(preset: SfxPreset, cue: SfxCue, loop: string | null): Voice | null {
    const positioned = cue.x !== undefined && cue.y !== undefined;
    const x = cue.x ?? this.listener.x;
    const y = cue.y ?? this.listener.y;
    const layer = cue.layer ?? this.listener.layer;
    let placementGain = 1;
    let pan = 0;
    let cutoff = OPEN_CUTOFF_HZ;
    if (positioned) {
      const p = this.place(x, y, layer, preset.reichweite);
      // Out of range: a one-shot is not started; a loop runs silently so it fades in when approached.
      if (p.gain <= 0 && loop === null) return null;
      placementGain = p.gain;
      pan = p.pan;
      cutoff = p.cutoffHz;
    }
    const takes = this.prepare(preset.id);
    const take = this.pickTake(preset.id, takes.length);
    const spread = preset.streuung;
    const rate = (cue.pitch ?? 1) * 2 ** ((this.rng.float(-1, 1) * spread.tonhoehe) / 1200);
    const level = (cue.volume ?? 1) * 10 ** ((-this.rng.next() * spread.lautstaerke) / 20);
    const now = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = takes[take] ?? null;
    source.playbackRate.value = rate;
    source.loop = loop !== null;
    const gain = this.ctx.createGain();
    let tail: GainNodeLike | BiquadFilterNodeLike = gain;
    source.connect(gain);
    let filter: BiquadFilterNodeLike | null = null;
    let panner: StereoPannerNodeLike | null = null;
    if (positioned) {
      if (this.options.occlusion !== undefined) {
        filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        gain.connect(filter);
        tail = filter;
      }
      panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      tail.connect(panner);
      panner.connect(this.mixer.bus[preset.bus]);
    } else tail.connect(this.mixer.bus[preset.bus]);

    const voice: Voice = { preset, source, gain, panner, filter, level, x, y, layer, positioned, startedAt: now, stopping: false, loop, sentGain: level * placementGain, sentPan: pan, sentCutoff: cutoff };
    if (loop === null) {
      gain.gain.value = level * placementGain;
      source.start(now);
    } else {
      // Loops fade in and start at a random point, so two fires never pulse in step.
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(level * placementGain, now, LOOP_FADE_SECONDS);
      const duration = source.buffer?.duration ?? 0;
      source.start(now, this.rng.next() * duration);
    }
    source.onended = () => this.release(voice);
    this.voices.push(voice);
    const subtitle = preset.untertitel;
    if (subtitle !== undefined) this.options.onSubtitle?.(subtitle, cue);
    return voice;
  }

  /** Another take than last time (when there is more than one). */
  private pickTake(id: string, count: number): number {
    if (count <= 1) return 0;
    const last = this.lastTake.get(id);
    let take = this.rng.int(0, last === undefined ? count : count - 1);
    if (last !== undefined && take >= last) take++;
    this.lastTake.set(id, take);
    return take;
  }

  /** Enforces `stimmen` of `preset` and `MAX_VOICES`, fading the oldest one-shots (the list is in start order). */
  private limitVoices(preset: SfxPreset): void {
    let same = 0;
    let total = 0;
    for (const v of this.voices) {
      if (v.stopping) continue;
      total++;
      if (v.preset.id === preset.id && v.loop === null) same++;
    }
    for (const v of this.voices) {
      if (same <= preset.stimmen) break;
      if (v.stopping || v.loop !== null || v.preset.id !== preset.id) continue;
      this.stop(v, STOP_FADE_SECONDS);
      same--;
      total--;
    }
    for (const v of this.voices) {
      if (total <= MAX_VOICES) break;
      if (v.stopping || v.loop !== null) continue;
      this.stop(v, STOP_FADE_SECONDS);
      total--;
    }
  }

  private stop(v: Voice, fadeSeconds: number): void {
    if (v.stopping) return;
    v.stopping = true;
    const now = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, now, fadeSeconds);
    v.source.stop(now + fadeSeconds * STOP_AFTER_CONSTANTS);
  }

  private release(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (v.loop !== null && this.loops.get(v.loop) === v) this.loops.delete(v.loop);
    v.source.disconnect();
    v.gain.disconnect();
    v.filter?.disconnect();
    v.panner?.disconnect();
  }
}
