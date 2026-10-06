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
 *   buffer arrived is rendered on the spot (a one-shot is a millisecond or two) – except the ambience's, which waits for
 *   the worker (`arrivedAmbienceSink`: its beds are seconds of sound). Without a worker the presets are rendered on the
 *   main thread in idle slices.
 * - **Events:** every event type with a mapper in `EVENT_SFX` is subscribed on the session; the cues play
 *   right after the tick (`GameSession.onEvent`). Footsteps on a built floor sound like the floor
 *   (src/audio/underfoot.ts reads the build grid at the listener); fuel sounds by the kind of the light it went into
 *   (src/audio/lightProbe.ts).
 * - **Per frame (`frame`):** the listener moves to the session's focus (the player, interpolated), the
 *   positioned voices follow it; the loops of what burns and works in the world (placed lights, stations at work, the
 *   hearth, blazes) follow the simulation's state (src/audio/loopSources.ts: every quarter second, and on the frame
 *   after an event that may start or stop one).
 * - **Clip events:** the figure renderer reports the frame events of the player's body clips
 *   (`clipEvent`); the body's own moments no simulation event marks sound (src/audio/clipEvents.ts).
 * - **Space (M7-01):** positioned sounds behind walls and roofs are muffled (src/audio/occlusion.ts); the room the
 *   listener stands in – cave, house, hall – sets the reverb (src/audio/roomProbe.ts → `AudioMixer.setRoom`), checked every
 *   `ROOM_PROBE_SECONDS` and changed once it held `ROOM_HOLD_SECONDS`.
 * - **Ambience (M7-06):** beds, calls, water and weather around the listener (src/audio/ambience); the thunder of a
 *   `lightningStruck` event comes after the distance's delay.
 * - **Music (M7-04):** the music runtime (src/audio/music/musicRuntime.ts) follows the simulation every frame, renders in
 *   the music worker (src/audio/music/music.worker.ts); the events of `STINGER_EVENTS` play their stingers.
 * - **Pause menu:** `setPaused` fades the world's buses out and back in (loops keep their place).
 * - **Settings:** master and bus volumes follow `settings.audio` live; subtitles of important sounds go
 *   to the `onSubtitle` listeners while `audio.subtitles` is on.
 * - **Hidden tab:** the context is suspended (the loop pauses too) and resumed when visible.
 */
import type { LocalizedText } from '../content/schema/common';
import { SFX_PRESETS } from '../content/sfx/index';
import type { SessionFocus } from '../game/session';
import { SIM_EVENT_TYPES, type SimEventMap, type Simulation } from '../game/sim';
import { AmbienceDirector, type AmbienceSink } from './ambience/director';
import { createAudioClock } from './clock';
import { AmbienceProbe, createAmbienceState } from './ambience/probe';
import type { MusicWorkerLike } from './music/bank';
import { MusicRuntime } from './music/musicRuntime';
import { STINGER_EVENTS, stingerEventTypes } from './music/stingers';
import { SoundOcclusion } from './occlusion';
import { reverbRoomFor, type ReverbRoom } from './reverb';
import { RoomProbe, createRoomSituation } from './roomProbe';
import { clipEventCue } from './clipEvents';
import { EVENT_SFX, createEventSfxContext, cuesFor, isLoopCue, type EventSfxContext } from './eventMap';
import { LOOP_SOURCE_EVENTS, LoopDirector } from './loopSources';
import { LightProbe } from './lightProbe';
import { ArmourProbe } from './armourProbe';
import { FloorProbe } from './underfoot';
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
/** How often the listener's room is checked for the reverb [s]. */
export const ROOM_PROBE_SECONDS = 0.25;
/** A new room must hold this long before the reverb changes (a doorway is no room) [s]. */
export const ROOM_HOLD_SECONDS = 0.5;
/** How often the ambience scans for rivers and the sea [s]. */
export const WATER_SCAN_SECONDS = 0.5;
/** Seed offsets of the presentation's own streams (ambience, music) against `seed`. */
const AMBIENCE_SEED = 0x0a3b1e;
const MUSIC_SEED = 0x3e5c;
/** The simulation event of a lightning strike (the world events, strand B) – heard once it is registered. */
const LIGHTNING_EVENT = 'lightningStruck';

/** What the kernel needs from the game session (read-only, like every presentation module). */
export interface AudioSession {
  onEvent<K extends keyof SimEventMap>(type: K, handler: (payload: SimEventMap[K]) => void): () => void;
  sampleFocus(out: SessionFocus): boolean;
  /** The simulation whose burning and working things loop (read only; without it no world loops). */
  readonly sim?: Simulation;
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
  /** Occlusion of positioned sounds (default: walls and roofs of the session's simulation, src/audio/occlusion.ts). */
  readonly occlusion?: SfxPlayerOptions['occlusion'];
  /** Starts the music worker (default: src/audio/music/music.worker.ts); `null` renders the music on the main thread. */
  readonly createMusicWorker?: (() => MusicWorkerLike) | null;
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

function browserMusicWorker(): MusicWorkerLike {
  return new Worker(new URL('./music/music.worker.ts', import.meta.url), { type: 'module' });
}

function defaultSchedule(fn: () => void, ms: number): void {
  setTimeout(fn, ms);
}

/** Subscribes one event type (keeps the payload type of `K` intact). */
function subscribe<K extends keyof SimEventMap>(session: AudioSession, type: K, handle: (type: K, payload: SimEventMap[K]) => void): () => void {
  return session.onEvent(type, (payload) => handle(type, payload));
}

/**
 * The ambience's sink (M7-06): the SFX player, playing only what has arrived while the SFX worker renders. The ambience's
 * beds and the water are seconds of sound – rendered on the main thread on the spot, the first beds after the unlock held
 * that frame for 50–200 ms (on SwiftShader the figure was drawn 15 px behind the simulation). So while `workerRenders()`, a
 * loop whose takes have not arrived waits – the director sets its loops again every `UPDATE_SECONDS`
 * (src/audio/ambience/director.ts), so it starts on the first update after the worker delivered it – and a call or a
 * thunder before its takes is left out. Without a worker (idle slices on this thread) everything plays as before; `null`
 * (stop) and an unknown id always reach the player (which reports an unknown one). No allocation per call.
 */
export function arrivedAmbienceSink(player: () => SfxPlayer | null, workerRenders: () => boolean): AmbienceSink {
  const waiting = (p: SfxPlayer, id: string): boolean => workerRenders() && p.has(id) && !p.isPrepared(id);
  return {
    setLoop: (slot, cue) => {
      const p = player();
      if (p === null || (cue !== null && waiting(p, cue.id))) return;
      p.setLoop(slot, cue);
    },
    play: (cue) => {
      const p = player();
      return p !== null && !waiting(p, cue.id) && p.play(cue);
    },
  };
}

/** Connects the audio kernel to a game session (see module comment). */
export function attachAudio(options: AudioRuntimeOptions): AudioRuntime {
  const { session, settings, gestureTarget } = options;
  const createContext = options.createContext ?? browserContext;
  const createWorker = options.createWorker === undefined ? browserWorker : options.createWorker;
  const createMusicWorker = options.createMusicWorker === undefined ? browserMusicWorker : options.createMusicWorker;
  const schedule = options.schedule ?? defaultSchedule;
  const subtitleListeners = new Set<(text: LocalizedText, cue: SfxCue) => void>();
  const focus: SessionFocus = { x: 0, y: 0, layer: 0 };
  // Footsteps on built floors: the build grid under the listener (the player, as of the last frame). Fuel on a fire or
  // into a lamp: the kind of the placed light.
  const floors = new FloorProbe();
  const lights = new LightProbe();
  // A blow on the player: the armour on its chest (M6-33).
  const armour = new ArmourProbe();
  const lookups: EventSfxContext = createEventSfxContext({
    underfoot: () => (session.sim === undefined ? null : floors.stepAt(session.sim, focus.layer, focus.x, focus.y)),
    placedLightKind: (light) => (session.sim === undefined ? null : lights.kindOf(session.sim, light)),
    playerArmour: () => (session.sim === undefined ? null : armour.chestOf(session.sim)),
  });
  let ctx: AudioContextLike | null = null;
  let mixer: AudioMixer | null = null;
  let player: SfxPlayer | null = null;
  let music: MusicRuntime | null = null;
  const loops = new LoopDirector(SFX_PRESETS);
  // Space: occlusion of positioned sounds, the room of the reverb (held a moment before it changes).
  const occlusion = new SoundOcclusion();
  const roomProbe = new RoomProbe();
  const situation = createRoomSituation();
  let heardRoom: ReverbRoom | null = null;
  let candidateRoom: ReverbRoom | null = null;
  // The audio clock's due times [s] in a held record: a number stored in a closure's variable is boxed anew on every write
  // (16 B a frame), a number field of an object is updated in place.
  const due = { roomProbe: 0, candidateSince: 0, waterScan: 0 };
  const clock = createAudioClock();
  // Ambience: beds, calls, water, weather, thunder.
  const ambienceProbe = new AmbienceProbe();
  const ambienceState = createAmbienceState();
  const ambience = new AmbienceDirector(((options.seed ?? 1) ^ AMBIENCE_SEED) >>> 0);
  /** Whether the SFX worker renders the presets (false: idle slices on this thread, or nothing unlocked yet). */
  let workerRenders = false;
  const ambienceSink = arrivedAmbienceSink(
    () => player,
    () => workerRenders,
  );
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
    workerRenders = true;
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
        occlusion: options.occlusion ?? ((x, y, layer) => occlusion.at(x, y, layer)),
        onSubtitle: (text, cue) => {
          if (!settings.get().audio.subtitles) return;
          for (const l of subtitleListeners) l(text, cue);
        },
      });
      startRendering(player);
      music = new MusicRuntime(ctx, mixer.bus, { createWorker: createMusicWorker, seed: ((options.seed ?? 1) ^ MUSIC_SEED) >>> 0 });
      // The listener starts where the session's focus is, not at the world's origin: an event of the ticks before the
      // next `frame` (the first action after the unlocking key) is heard from the player.
      if (session.sampleFocus(focus)) {
        player.setListener(focus.x, focus.y, focus.layer);
        occlusion.begin(session.sim, focus);
      }
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
  for (const type of LOOP_SOURCE_EVENTS) unsubscribers.push(session.onEvent(type, () => loops.invalidate()));
  // Stingers of the events the simulation knows (another strand's event joins once it is registered).
  for (const type of stingerEventTypes(SIM_EVENT_TYPES)) {
    const stinger = STINGER_EVENTS[type] as string;
    unsubscribers.push(session.onEvent(type as keyof SimEventMap, () => music?.stinger(stinger)));
  }
  if ((SIM_EVENT_TYPES as readonly string[]).includes(LIGHTNING_EVENT)) {
    unsubscribers.push(
      session.onEvent(LIGHTNING_EVENT as keyof SimEventMap, (payload) => {
        if (ctx === null) return;
        const at = payload as { readonly x?: number; readonly y?: number; readonly layer?: number };
        if (at.x !== undefined && at.y !== undefined) ambience.lightning(at.x, at.y, at.layer ?? 0, focus, ctx.currentTime);
      }),
    );
  }

  /** The reverb follows the listener's room once the new room held `ROOM_HOLD_SECONDS`. */
  const followRoom = (): void => {
    const now = clock.now;
    if (mixer === null || now < due.roomProbe) return;
    due.roomProbe = now + ROOM_PROBE_SECONDS;
    roomProbe.read(session.sim, situation);
    const room = reverbRoomFor(situation);
    if (room !== candidateRoom) {
      candidateRoom = room;
      due.candidateSince = now;
    }
    if (candidateRoom !== heardRoom && now - due.candidateSince >= ROOM_HOLD_SECONDS) {
      heardRoom = candidateRoom;
      mixer.setRoom(heardRoom);
    }
  };

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
      if (player === null || ctx === null) return;
      // The audio clock read once; the frame's parts read the held record (no number boxed at their calls).
      clock.now = ctx.currentTime;
      if (session.sampleFocus(focus)) player.setListener(focus.x, focus.y, focus.layer);
      occlusion.begin(session.sim, focus);
      followRoom();
      if (session.sim !== undefined) loops.updateAt(session.sim, player, clock);
      const scanWater = clock.now >= due.waterScan;
      if (scanWater) due.waterScan = clock.now + WATER_SCAN_SECONDS;
      ambience.update(ambienceProbe.read(session.sim, ambienceState, scanWater), focus, clock, ambienceSink);
      music?.frame(session.sim, clock);
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
      music?.dispose();
      loops.reset();
      ctx?.suspend().catch(() => undefined);
    },
  };
}
