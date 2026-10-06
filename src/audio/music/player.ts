/**
 * Plays the music the director decides (M7-04; docs/SPIEL.md §24): one deck per arrangement – a buffer source per layer
 * (stem), started on the same audio-clock time so the stems stay sample-locked, each through its layer gain into the deck
 * gain –, crossfades between decks, glides the layer gains (the danger percussion rising with a hunter, the melody leaving
 * in a vault), ducks the music under a stinger and plays the songs of the player's instruments.
 *
 * ```text
 * deck: stem basis ─► gain ─┐
 *       stem melodie ► gain ─┼─► deck gain ─► duck ─► bus musik
 *       stem gefahr ─► gain ─┘
 * stinger ──────────────────────────────────────────► bus musik
 * song (the player's flute or lute) ────────────────► bus effekte
 * ```
 */
import { MUSIC_LAYERS, type MusicLayer } from '../../content/music/schema';
import type { AudioBufferSourceNodeLike, AudioContextLike, AudioNodeLike, GainNodeLike } from '../webAudio';
import type { LoadedPiece } from './bank';
import type { MusicDecision } from './director';

/** Lead before a deck starts [s] (all stems on one scheduled time). */
const START_LEAD_SECONDS = 0.05;
/** Time constant of a layer gain glide [s]. */
const LAYER_GLIDE_SECONDS = 0.6;
/** Smallest layer gain change worth a new automation event. */
const LAYER_EPSILON = 0.01;
/** The duck under a stinger: attack and release [s]. */
const DUCK_ATTACK_SECONDS = 0.12;
const DUCK_RELEASE_SECONDS = 0.8;
/** Fade of a song when the player stops playing [s]. */
const SONG_FADE_SECONDS = 0.4;
/** Level of the player's song (it sits at the listener, under the world's sounds). */
const SONG_LEVEL = 0.7;

interface Deck {
  readonly key: string;
  readonly loaded: LoadedPiece;
  readonly gain: GainNodeLike;
  readonly layers: Partial<Record<MusicLayer, GainNodeLike>>;
  readonly sources: AudioBufferSourceNodeLike[];
  readonly sent: Record<MusicLayer, number>;
  stopping: boolean;
}

export class MusicPlayer {
  private deck: Deck | null = null;
  private readonly fading: Deck[] = [];
  private readonly duck: GainNodeLike;
  private duckUntil = 0;
  private song: { key: string; sources: AudioBufferSourceNodeLike[]; gain: GainNodeLike } | null = null;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly musicBus: AudioNodeLike,
    private readonly effectsBus: AudioNodeLike,
  ) {
    this.duck = ctx.createGain();
    this.duck.connect(musicBus);
  }

  /** The key of the deck playing (or fading in), '' for none. */
  get playing(): string {
    return this.deck?.key ?? '';
  }

  /** Bank keys that must stay loaded (playing, fading, the song). */
  keep(out: Set<string>): Set<string> {
    out.clear();
    if (this.deck !== null) out.add(this.deck.key);
    for (const d of this.fading) out.add(d.key);
    if (this.song !== null) out.add(this.song.key);
    return out;
  }

  /**
   * Follows `decision`: `loaded` is the bank's arrangement for it (null while it renders – the old deck keeps playing until
   * the new one is ready; with no piece wanted the deck fades out).
   */
  apply(decision: Readonly<MusicDecision>, loaded: LoadedPiece | null): void {
    const now = this.ctx.currentTime;
    if (decision.piece === '') {
      if (this.deck !== null) this.fadeOut(this.deck, decision.fadeSeconds, now);
      this.deck = null;
    } else if (loaded !== null && this.deck?.key !== loaded.key) {
      if (this.deck !== null) this.fadeOut(this.deck, decision.fadeSeconds, now);
      this.deck = this.start(loaded, loaded.key, decision, now);
    }
    if (this.deck !== null) this.glideLayers(this.deck, decision, now);
  }

  /** Plays a stinger over the music and ducks the music by `duckDb` while it sounds. */
  stinger(loaded: LoadedPiece, duckDb: number): void {
    const now = this.ctx.currentTime;
    const when = now + START_LEAD_SECONDS;
    for (const layer of MUSIC_LAYERS) {
      const buffer = loaded.buffers[layer];
      if (buffer === undefined) continue;
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(this.musicBus);
      s.onended = () => s.disconnect();
      s.start(when);
    }
    const g = this.duck.gain;
    const until = when + loaded.duration;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(10 ** (duckDb / 20), now, DUCK_ATTACK_SECONDS / 3);
    g.setTargetAtTime(1, Math.max(now + DUCK_ATTACK_SECONDS, until - DUCK_RELEASE_SECONDS), DUCK_RELEASE_SECONDS / 3);
    this.duckUntil = until;
  }

  /** Whether a stinger is sounding at the audio time `now`. */
  stingerPlaying(now: number): boolean {
    return now < this.duckUntil;
  }

  /** The player's song (`loaded` loops) or none: starts, keeps or fades the song voice. */
  setSong(loaded: LoadedPiece | null, key: string): void {
    const now = this.ctx.currentTime;
    if (this.song !== null && (loaded === null || this.song.key !== key)) {
      const old = this.song;
      old.gain.gain.setTargetAtTime(0, now, SONG_FADE_SECONDS / 3);
      for (const src of old.sources) src.stop(now + SONG_FADE_SECONDS * 2);
      const last = old.sources[old.sources.length - 1];
      if (last !== undefined) {
        last.onended = () => {
          for (const src of old.sources) src.disconnect();
          old.gain.disconnect();
        };
      }
      this.song = null;
    }
    if (loaded === null || this.song !== null) return;
    const gain = this.ctx.createGain();
    gain.gain.value = SONG_LEVEL;
    gain.connect(this.effectsBus);
    // A song is a solo: the melody and the lute's bass strings go to the one voice, sample-locked.
    const sources: AudioBufferSourceNodeLike[] = [];
    const when = now + START_LEAD_SECONDS;
    for (const layer of MUSIC_LAYERS) {
      const buffer = loaded.buffers[layer];
      if (buffer === undefined) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = loaded.loops;
      src.loopStart = loaded.loopStart;
      src.loopEnd = loaded.loopEnd;
      src.connect(gain);
      src.start(when);
      sources.push(src);
    }
    this.song = { key, sources, gain };
  }

  /** Stops everything at once (disposal). */
  stopAll(): void {
    const now = this.ctx.currentTime;
    if (this.deck !== null) this.fadeOut(this.deck, 0.05, now);
    this.deck = null;
    this.setSong(null, '');
  }

  // -------------------------------------------------------------------------------------------

  private start(loaded: LoadedPiece, key: string, decision: Readonly<MusicDecision>, now: number): Deck {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, now, Math.max(0.01, decision.fadeSeconds / 3));
    gain.connect(this.duck);
    const layers: Partial<Record<MusicLayer, GainNodeLike>> = {};
    const sources: AudioBufferSourceNodeLike[] = [];
    const sent: Record<MusicLayer, number> = { basis: 0, melodie: 0, gefahr: 0 };
    const when = now + START_LEAD_SECONDS;
    for (const layer of MUSIC_LAYERS) {
      const buffer = loaded.buffers[layer];
      if (buffer === undefined) continue;
      const lg = this.ctx.createGain();
      lg.gain.value = decision.layers[layer];
      sent[layer] = decision.layers[layer];
      lg.connect(gain);
      layers[layer] = lg;
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = loaded.loops;
      s.loopStart = loaded.loopStart;
      s.loopEnd = loaded.loopEnd;
      s.connect(lg);
      s.start(when);
      sources.push(s);
    }
    return { key, loaded, gain, layers, sources, sent, stopping: false };
  }

  private glideLayers(deck: Deck, decision: Readonly<MusicDecision>, now: number): void {
    for (const layer of MUSIC_LAYERS) {
      const g = deck.layers[layer];
      if (g === undefined) continue;
      const target = decision.layers[layer];
      if (Math.abs(target - deck.sent[layer]) < LAYER_EPSILON) continue;
      g.gain.setTargetAtTime(target, now, LAYER_GLIDE_SECONDS / 3);
      deck.sent[layer] = target;
    }
  }

  private fadeOut(deck: Deck, seconds: number, now: number): void {
    if (deck.stopping) return;
    deck.stopping = true;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setTargetAtTime(0, now, Math.max(0.01, seconds / 3));
    for (const s of deck.sources) s.stop(now + seconds * 1.5);
    this.fading.push(deck);
    // When the last source has ended, the deck's nodes go.
    const last = deck.sources[deck.sources.length - 1];
    if (last !== undefined) {
      last.onended = () => {
        for (const s of deck.sources) s.disconnect();
        for (const l of Object.values(deck.layers)) l.disconnect();
        deck.gain.disconnect();
        const i = this.fading.indexOf(deck);
        if (i >= 0) this.fading.splice(i, 1);
      };
    }
  }
}
