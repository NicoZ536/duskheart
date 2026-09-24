/**
 * The audio kernel of the running game (M3-33): turns simulation events into sounds and keeps the mixer
 * on the settings. `attachAudio` is called once by the composition root (src/main.tsx):
 *
 * - **Autoplay policy:** browsers only let a page make sound after a user gesture, and complain on the
 *   console about an `AudioContext` created earlier. So the context is created on the first pointer,
 *   key or touch input (every later gesture resumes it if the browser suspended it); events before that
 *   are dropped – nothing could be heard anyway.
 * - **Rendering:** on the unlock the SFX worker (src/audio/sfx.worker.ts) renders every preset in the
 *   order of `SFX_PRESETS` (footsteps first) and hands the buffers over; a sound needed before its
 *   buffer arrived is rendered on the spot (a one-shot is a millisecond or two). Without a worker the
 *   presets are rendered on the main thread in idle slices.
 * - **Events:** every event type with a mapper in `EVENT_SFX` is subscribed on the session; the cues play
 *   right after the tick (`GameSession.onEvent`).
 * - **Per frame (`frame`):** the listener moves to the session's focus (the player, interpolated), the
 *   positioned voices follow it.
 * - **Clip events:** the figure renderer reports the frame events of the player's body clips
 *   (`clipEvent`); the body's own moments no simulation event marks sound (src/audio/clipEvents.ts).
 * - **Pause menu:** `setPaused` fades the world's buses out and back in (loops keep their place).
 * - **Settings:** master and bus volumes follow `settings.audio` live; subtitles of important sounds go
 *   to the `onSubtitle` listeners while `audio.subtitles` is on.
 * - **Hidden tab:** the context is suspended (the loop pauses too) and resumed when visible.
 */
import type { LocalizedText } from '../content/schema/common';
import { SFX_PRESETS } from '../content/sfx/index';
import type { SessionFocus } from '../game/session';
import { SIM_EVENT_TYPES, type SimEventMap } from '../game/sim';
import { clipEventCue } from './clipEvents';
import { EVENT_SFX, createEventSfxContext, cuesFor, isLoopCue, type EventSfxContext } from './eventMap';
import { AudioMixer, busGains, type AudioSettings, type MixLevels } from './mixer';
import { SfxPlayer, type SfxCue, type SfxPlayerOptions } from './sfxPlayer';
import type { SfxRenderRequest, SfxRenderResult } from './sfxWorkerProtocol';
import { asAudioContextLike, type AudioContextLike } from './webAudio';

/** Inputs that count as a user gesture for the autoplay policy. */
export const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;
/** Presets rendered per idle slice when there is no worker. */
const IDLE_PRESETS_PER_SLICE = 2;
/** Pause between two idle slices [ms]. */
const IDLE_SLICE_MS = 50;
/** Buses silent while the game is paused: the world's sounds (the pause menu's clicks and the music stay). */
const PAUSED_BUSES = { effekte: 0, umgebung: 0 } as const;

/** What the kernel needs from the game session (read-only, like every presentation module). */
export interface AudioSession {
  onEvent<K extends keyof SimEventMap>(type: K, handler: (payload: SimEventMap[K]) => void): () => void;
  sampleFocus(out: SessionFocus): boolean;
}

/** The part of the settings store the kernel reads. */
export interface AudioSettingsSource {
  get(): { readonly audio: AudioSettings };
  subscribe(listener: (next: { readonly audio: AudioSettings }, prev: { readonly audio: AudioSettings }) => void): () => void;
}

/** A page whose visibility suspends the audio. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** The part of a `Worker` the kernel uses. */
export interface SfxWorkerLike {
  onmessage: ((ev: MessageEvent<SfxRenderResult>) => unknown) | null;
  postMessage(message: SfxRenderRequest): void;
}

export interface AudioRuntimeOptions {
  readonly session: AudioSession;
  readonly settings: AudioSettingsSource;
  /** Receives the unlocking gestures (the window). */
  readonly gestureTarget: EventTarget;
  readonly visibility?: VisibilitySource;
  /** Creates the context at the unlock (default: the browser's `AudioContext`). */
  readonly createContext?: () => AudioContextLike;
  /** Starts the SFX worker (default: src/audio/sfx.worker.ts); `null` renders on the main thread. */
  readonly createWorker?: (() => SfxWorkerLike) | null;
  /** Schedules an idle slice (default: `setTimeout`). */
  readonly schedule?: (fn: () => void, ms: number) => void;
  readonly occlusion?: SfxPlayerOptions['occlusion'];
  /** Seed of the playback variation. */
  readonly seed?: number;
}

export interface AudioRuntime {
  /** True once a gesture created the context. */
  readonly unlocked: boolean;
  /** The context (null before the unlock). */
  readonly context: AudioContextLike | null;
  /** Once per rendered frame: the listener follows the focus, positioned voices follow the listener. */
  frame(): void;
  /** Plays a one-shot from presentation code (UI). False before the unlock. */
  play(cue: SfxCue): boolean;
  /** Sets a loop slot (campfires, torches). No effect before the unlock. */
  setLoop(slot: string, cue: SfxCue | null): void;
  /** A frame event of the player's body clip in loop `cycle` of the clip (`src/audio/clipEvents.ts`). */
  clipEvent(event: string, cycle: number): void;
  /**
   * While the game is paused (the pause menu) the world falls silent: the effects and ambience buses fade
   * out – burning fires and whispers keep their loops and come back on resume –, music and UI stay.
   */
  setPaused(paused: boolean): void;
  /** Subtitles of important sounds while `audio.subtitles` is on; returns the unsubscribe function. */
  onSubtitle(listener: (text: LocalizedText, cue: SfxCue) => void): () => void;
  /** Unsubscribes everything and suspends the context. */
  dispose(): void;
}

function browserContext(): AudioContextLike {
  return asAudioContextLike(new AudioContext({ latencyHint: 'interactive' }));
}

function browserWorker(): SfxWorkerLike {
  return new Worker(new URL('./sfx.worker.ts', import.meta.url), { type: 'module' });
}

function defaultSchedule(fn: () => void, ms: number): void {
  setTimeout(fn, ms);
}

/** Subscribes one event type (keeps the payload type of `K` intact). */
function subscribe<K extends keyof SimEventMap>(session: AudioSession, type: K, handle: (type: K, payload: SimEventMap[K]) => void): () => void {
  return session.onEvent(type, (payload) => handle(type, payload));
}

/** Connects the audio kernel to a game session (see module comment). */
export function attachAudio(options: AudioRuntimeOptions): AudioRuntime {
  const { session, settings, gestureTarget } = options;
  const createContext = options.createContext ?? browserContext;
  const createWorker = options.createWorker === undefined ? browserWorker : options.createWorker;
  const schedule = options.schedule ?? defaultSchedule;
  const lookups: EventSfxContext = createEventSfxContext();
  const subtitleListeners = new Set<(text: LocalizedText, cue: SfxCue) => void>();
  const focus: SessionFocus = { x: 0, y: 0, layer: 0 };
  let ctx: AudioContextLike | null = null;
  let mixer: AudioMixer | null = null;
  let player: SfxPlayer | null = null;
  let disposed = false;
  let paused = false;
  /** Mixer levels of the settings; the world's buses silent while paused. */
  const levels = (): MixLevels => {
    const l = busGains(settings.get().audio);
    return paused ? { master: l.master, bus: { ...l.bus, ...PAUSED_BUSES } } : l;
  };

  const resume = (): void => {
    if (ctx === null || ctx.state === 'running' || options.visibility?.hidden === true) return;
    ctx.resume().catch(() => undefined);
  };

  const idleWarmUp = (): void => {
    if (disposed || player === null) return;
    if (player.warmUp(IDLE_PRESETS_PER_SLICE) > 0) schedule(idleWarmUp, IDLE_SLICE_MS);
  };

  const startRendering = (p: SfxPlayer): void => {
    let worker: SfxWorkerLike | null = null;
    if (createWorker !== null) {
      try {
        worker = createWorker();
      } catch {
        worker = null;
      }
    }
    if (worker === null) {
      schedule(idleWarmUp, IDLE_SLICE_MS);
      return;
    }
    worker.onmessage = (ev) => p.provide(ev.data.id, ev.data.takes);
    worker.postMessage({ ids: SFX_PRESETS.map((s) => s.id) });
  };

  const unlock = (): void => {
    if (disposed) return;
    if (ctx === null) {
      ctx = createContext();
      mixer = new AudioMixer(ctx, levels());
      player = new SfxPlayer(ctx, mixer, SFX_PRESETS, {
        seed: options.seed,
        occlusion: options.occlusion,
        onSubtitle: (text, cue) => {
          if (!settings.get().audio.subtitles) return;
          for (const l of subtitleListeners) l(text, cue);
        },
      });
      startRendering(player);
    }
    resume();
    if (ctx.state === 'running') for (const type of UNLOCK_EVENTS) gestureTarget.removeEventListener(type, unlock, true);
  };
  for (const type of UNLOCK_EVENTS) gestureTarget.addEventListener(type, unlock, true);

  const handle = <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]): void => {
    if (player === null) return;
    for (const cue of cuesFor(type, payload, lookups)) {
      if (isLoopCue(cue)) player.setLoop(cue.loop, cue.cue);
      else player.play(cue);
    }
  };
  const unsubscribers: Array<() => void> = [];
  for (const type of SIM_EVENT_TYPES) if (EVENT_SFX[type] !== undefined) unsubscribers.push(subscribe(session, type, handle));

  unsubscribers.push(
    settings.subscribe((next, prev) => {
      if (next.audio !== prev.audio) mixer?.apply(levels());
    }),
  );

  options.visibility?.addEventListener('visibilitychange', () => {
    if (ctx === null || disposed) return;
    if (options.visibility?.hidden === true) ctx.suspend().catch(() => undefined);
    else resume();
  });

  return {
    get unlocked() {
      return ctx !== null;
    },
    get context() {
      return ctx;
    },
    frame() {
      if (player === null) return;
      if (session.sampleFocus(focus)) player.setListener(focus.x, focus.y, focus.layer);
      player.update();
    },
    play(cue) {
      return player?.play(cue) ?? false;
    },
    setLoop(slot, cue) {
      player?.setLoop(slot, cue);
    },
    clipEvent(event, cycle) {
      if (player === null) return;
      const cue = clipEventCue(event, cycle);
      if (cue !== null) player.play(cue);
    },
    setPaused(on) {
      if (paused === on) return;
      paused = on;
      mixer?.apply(levels());
    },
    onSubtitle(listener) {
      subtitleListeners.add(listener);
      return () => subtitleListeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const off of unsubscribers) off();
      for (const type of UNLOCK_EVENTS) gestureTarget.removeEventListener(type, unlock, true);
      player?.stopAll();
      ctx?.suspend().catch(() => undefined);
    },
  };
}
