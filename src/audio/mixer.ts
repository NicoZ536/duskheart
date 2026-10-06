/**
 * The Web Audio graph (MASTERPROMPT §27 "Master → Busse Musik, Effekte, Umgebung, UI; Kompressor/
 * Limiter"):
 *
 * ```text
 * voices ─► bus musik    ─┐
 *        ─► bus effekte  ─┤
 *        ─► bus umgebung ─┼─► compressor ─► limiter ─► master ─► destination
 *        ─► bus ui       ─┘        ▲
 * bus effekte/umgebung/musik ─► send ─► reverb (convolver A/B) ─┘
 * ```
 *
 * The compressor glues busy moments together (a tree crash over footsteps over the fire), the limiter
 * catches the rest so nothing clips; the master fader comes last, so turning the game down never changes
 * how hard the dynamics work. Bus levels follow the audio settings (`busGains`, a square law: the
 * sliders feel even to the ear) and glide to a new value instead of jumping (no zipper clicks).
 *
 * The world's buses also send into the room's reverb (M7-01, src/audio/reverb.ts): `setRoom` glides each send to the
 * room's level and crossfades the convolvers; the UI bus never reverberates. The sends sit behind the bus faders, so a
 * quieter bus also reverberates less.
 */
import { SFX_BUSES, type SfxBus } from '../content/sfx/schema';
import type { Settings } from '../engine/settings';
import { REVERB_CROSSFADE_SECONDS, REVERB_SPECS, ReverbRack, type ReverbRoom } from './reverb';
import type { AudioContextLike, DynamicsCompressorNodeLike, GainNodeLike } from './webAudio';

/** The audio section of the settings (§29 "Audio (alle Busse)"). */
export type AudioSettings = Settings['audio'];

/** Glue compressor: gentle ratio above −18 dBFS. */
export const COMPRESSOR = { threshold: -18, knee: 12, ratio: 3, attack: 0.005, release: 0.2 } as const;
/** Brick-wall limiter just below full scale. */
export const LIMITER = { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.08 } as const;
/** Time constant of bus volume changes [s]. */
export const GAIN_GLIDE_SECONDS = 0.04;
/** The buses that reverberate (the UI stays dry). */
export const REVERB_BUSES = ['effekte', 'umgebung', 'musik'] as const satisfies readonly SfxBus[];
export type ReverbBus = (typeof REVERB_BUSES)[number];

/** Settings slider (0–1) → gain. */
export function sliderGain(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v * v;
}

/** Gains of the master fader and each bus from the audio settings. */
export interface MixLevels {
  readonly master: number;
  readonly bus: Readonly<Record<SfxBus, number>>;
}

/** The mixer levels of `audio` (music → musik, sfx → effekte, ambience → umgebung, ui → ui). */
export function busGains(audio: Pick<AudioSettings, 'master' | 'music' | 'sfx' | 'ambience' | 'ui'>): MixLevels {
  return {
    master: sliderGain(audio.master),
    bus: { musik: sliderGain(audio.music), effekte: sliderGain(audio.sfx), umgebung: sliderGain(audio.ambience), ui: sliderGain(audio.ui) },
  };
}

function configure(node: DynamicsCompressorNodeLike, p: typeof COMPRESSOR | typeof LIMITER): void {
  node.threshold.value = p.threshold;
  node.knee.value = p.knee;
  node.ratio.value = p.ratio;
  node.attack.value = p.attack;
  node.release.value = p.release;
}

/** The mixer graph of one audio context. */
export class AudioMixer {
  readonly bus: Readonly<Record<SfxBus, GainNodeLike>>;
  readonly compressor: DynamicsCompressorNodeLike;
  readonly limiter: DynamicsCompressorNodeLike;
  readonly master: GainNodeLike;
  /** The reverb behind the sends. */
  readonly reverb: ReverbRack;
  /** Send of each world bus into the reverb. */
  readonly send: Readonly<Record<ReverbBus, GainNodeLike>>;

  constructor(
    private readonly ctx: AudioContextLike,
    levels: MixLevels,
  ) {
    this.compressor = ctx.createDynamicsCompressor();
    configure(this.compressor, COMPRESSOR);
    this.limiter = ctx.createDynamicsCompressor();
    configure(this.limiter, LIMITER);
    this.master = ctx.createGain();
    this.master.gain.value = levels.master;
    const bus = {} as Record<SfxBus, GainNodeLike>;
    for (const name of SFX_BUSES) {
      const g = ctx.createGain();
      g.gain.value = levels.bus[name];
      g.connect(this.compressor);
      bus[name] = g;
    }
    this.bus = bus;
    // Created after the buses (the gains' order: master, the buses, then the reverb's nodes).
    this.reverb = new ReverbRack(ctx, this.compressor);
    const send = {} as Record<ReverbBus, GainNodeLike>;
    for (const name of REVERB_BUSES) {
      const g = ctx.createGain();
      g.gain.value = 0;
      bus[name].connect(g);
      g.connect(this.reverb.input);
      send[name] = g;
    }
    this.send = send;
    this.compressor.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);
  }

  /** Glides the master fader and the buses to `levels`. */
  apply(levels: MixLevels): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(levels.master, t, GAIN_GLIDE_SECONDS);
    for (const name of SFX_BUSES) this.bus[name].gain.setTargetAtTime(levels.bus[name], t, GAIN_GLIDE_SECONDS);
  }

  /** The room the listener is in (`null`: open sky, dry): sends glide to its levels, the reverb crossfades. */
  setRoom(room: ReverbRoom | null): void {
    if (room === this.reverb.room) return;
    const t = this.ctx.currentTime;
    for (const name of REVERB_BUSES) {
      // Leaving a room the send stays open while the old tail fades (the wet gain closes it).
      if (room !== null) this.send[name].gain.setTargetAtTime(REVERB_SPECS[room].sends[name], t, REVERB_CROSSFADE_SECONDS / 3);
    }
    this.reverb.setRoom(room);
  }
}
