/**
 * M7-78 (ADR-0212 „Grenze: ohne SimWorld laufen die Umgebungs-Betten nicht mit“; MASTERPROMPT §30 „Frame-Pfad ohne
 * Allokation“, §27 „Biom-Klangbetten …, Wetterschichten“): a frame of the audio (`attachAudio(…).frame()`) in a real biome
 * world allocates nothing while its beds, the weather layer and the waves loop – the game's own session (`GameSession`, the
 * small world of seed 3: the start beach of the Salt Coast with the sea beside it), the simulation ticking between the frames,
 * the ambience and the music reading the world (`SimWorld`: biome, calendar, the region's weather, the water scan, the room).
 *
 * The morning on the beach in the rain: the bed (the surf), the rain and the waves loop; the gulls keep quiet in the rain, so no
 * one-shot starts in the windows – a starting sound builds its audio nodes, which is no per-frame work. The browser parts the
 * test stands in for: the SFX worker renders every preset ahead (here: the idle warm-up runs to the end before the frames),
 * and a one-shot whose buffer has played ends (`onended`, as the browser fires it).
 *
 * Method of tests/integration/musik-render.test.ts (ADR-0203): sampled heap profile rooted at the runtime's `frame`, median of
 * three windows, each after a forced collection, a re-warm, a pause for the compiler and install frames.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../tools/bench/heap';
import { AMBIENCE_BEDS, CALLS_MAX_RAIN } from '../../src/audio/ambience/director';
import { AmbienceProbe, createAmbienceState } from '../../src/audio/ambience/probe';
import { attachAudio } from '../../src/audio/runtime';
import { createSettingsStore } from '../../src/engine/settings';
import { GameSession } from '../../src/game/session';
import { FakeContext, type FakeSource } from '../unit/audio/fakeAudio';
import { FakeMusicWorker, testLibrary } from '../unit/audio/musik-testlied';

/** The world: the fixture world (small, start beach with sand, the sea and meadows behind it). */
const WELT = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Mid-morning: the coast's day bed (the surf), its gulls quiet in the rain; the music's exploration piece without quiet nights. */
const STUNDE = 10;
/** Ticks for the player to appear and the zone to settle. */
const SETTLE_TICKS = 60;
/** Frames before the presets are all rendered (the unlock happened, the first beds asked for theirs). */
const UNLOCK_FRAMES = 60;
/** Frames before the measurement: the rain blends in, the beds and the waves start. */
const WARM_FRAMES = 3000;
/** Frames per sampled window, the re-warm before it (after the forced collection) and the pause for the compiler. */
const WINDOW_FRAMES = 2000;
const REWARM_FRAMES = 6000;
const INSTALL_FRAMES = 100;
const COMPILER_PAUSE_MS = 200;
const WINDOWS = 3;
/** Limit [B per frame]: one number boxed every frame (16 B) would exceed it eight times. */
const MAX_BYTES_PER_FRAME = 2;
/** Shortest ambience loop [s] (the presets' `schleife.dauer`: rain, crickets and rivers 4 s, the sea 5 s, beds 6 s). */
const AMBIENCE_LOOP_MIN_SECONDS = 4;

describe('M7-78: Audio-Frame in einer echten Biom-Welt mit laufenden Betten', () => {
  let inspector: Session;
  beforeAll(async () => {
    inspector = new Session();
    inspector.connect();
    await inspector.post('HeapProfiler.enable');
  });
  afterAll(() => inspector.disconnect());

  it('Brandung, Regen und Wellen am Morgen am Strand der Salzküste: 0 B je Frame (Median dreier Fenster)', async () => {
    const session = new GameSession({ config: WELT });
    session.command({ type: 'setTime', hour: STUNDE, minute: 0 });
    session.step();
    session.command({ type: 'player.spawn' });
    for (let i = 0; i < SETTLE_TICKS; i++) session.step();
    // Rain over the whole world: the weather layer joins the bed.
    session.command({ type: 'setWeather', state: 'regen' });
    session.step();

    const ctx = new FakeContext();
    const gestures = new EventTarget();
    const worker = new FakeMusicWorker(testLibrary());
    const idle: Array<() => void> = [];
    const audio = attachAudio({
      session,
      settings: createSettingsStore(null),
      gestureTarget: gestures,
      createContext: () => ctx,
      createWorker: null,
      createMusicWorker: () => worker,
      schedule: (fn) => {
        idle.push(fn);
      },
    });
    gestures.dispatchEvent(new Event('keydown'));

    // One-shots that are playing: ended once their buffer has played (the browser's `onended`).
    const playing: FakeSource[] = [];
    let seen = 0;
    const endFinished = (): void => {
      for (; seen < ctx.sources.length; seen++) {
        const s = ctx.sources[seen] as FakeSource;
        if (!s.loop) playing.push(s);
      }
      for (let i = playing.length - 1; i >= 0; i--) {
        const s = playing[i] as FakeSource;
        if (s.startedAt === null) continue;
        const played = s.startedAt + (s.buffer === null ? 0 : s.buffer.duration / s.playbackRate.value);
        if (ctx.currentTime < (s.stoppedAt === null ? played : Math.min(played, s.stoppedAt))) continue;
        playing.splice(i, 1);
        s.end();
      }
    };
    // One rendered frame: the simulation ticks (60 Hz), then the audio follows it.
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        session.step();
        ctx.currentTime += 1 / 60;
        audio.frame();
        worker.deliver();
        endFinished();
      }
    };
    frames(UNLOCK_FRAMES);
    // The SFX worker's part: every preset rendered before the frames that are measured.
    while (idle.length > 0) (idle.shift() as () => void)();
    frames(WARM_FRAMES);

    // The ambience hears a real world: the player stands in a biome with its own bed, by day, in the rain, the sea is near.
    const state = new AmbienceProbe().read(session.sim, createAmbienceState(), true);
    expect(state.active).toBe(true);
    expect(Object.keys(AMBIENCE_BEDS)).toContain(state.biome);
    expect([state.night, state.rain, state.sea]).toEqual([false, true, true]);
    expect(state.precipitation).toBeGreaterThan(CALLS_MAX_RAIN);
    // Its loops play: mono buffers (the SFX; the music's stems are stereo) of at least `AMBIENCE_LOOP_MIN_SECONDS` – the bed,
    // the rain and the waves.
    const ambienceLoops = (): number =>
      ctx.sources.filter((s) => s.loop && s.startedAt !== null && s.stoppedAt === null && s.buffer !== null && s.buffer.numberOfChannels === 1 && s.buffer.duration >= AMBIENCE_LOOP_MIN_SECONDS).length;
    expect(ambienceLoops()).toBeGreaterThanOrEqual(3);

    const perFrame: number[] = [];
    const tops: string[] = [];
    for (let k = 0; k < WINDOWS; k++) {
      // The rain holds through the window (a forced period lasts 1–8 game hours; the windows span about seven): rain again.
      session.command({ type: 'setWeather', state: 'regen' });
      await inspector.post('HeapProfiler.collectGarbage');
      frames(REWARM_FRAMES);
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      frames(INSTALL_FRAMES);
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      frames(WINDOW_FRAMES);
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frame' && /src\/audio\/runtime\.ts$/.test(f.url));
      perFrame.push(alloc.inPath / WINDOW_FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    // The beds still loop after the windows: nothing stopped them while measuring.
    expect(ambienceLoops()).toBeGreaterThanOrEqual(3);
    const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `Allokation je Audio-Frame (Fenster ${perFrame.map((b) => b.toFixed(2)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
