/**
 * M7-87 (MASTERPROMPT §30 „keine Allokationen in Hot-Loops“; ADR-0222 Einmal-je-Frame-Brücken): the game view asks its
 * views every frame to follow the session (`follow`). A method that holds the listeners' closures itself creates a context
 * object on entry – also when it returns at once because it follows that session already. Called once per frame, such a
 * method stays in V8's lower tiers (the interpreter, the baseline code), where nothing removes that context: in the bench
 * a `follow` stood among the five largest items of `spiel`. Optimised and inlined into a hot loop the context goes away, so
 * the test measures the lower tiers: the first calls of the method, a few hundred, as the frames of a window make them.
 * The world events (`WorldEventView`) and the bosses (`BossView`) keep their closures in `subscribe`, like the creatures,
 * effects and building views: following the same session again allocates nothing, and a new session is still subscribed.
 *
 * Sampled heap profile rooted at the calling loop, median of three windows of 300 calls (one window of the frame-path
 * bench); the one-time work of the engine in them (the baseline code of the method, compiled in a window) stays far below a
 * context per call.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import type { SimEventMap } from '../../../src/game/sim';
import { BossView } from '../../../src/render/game/bosses';
import { WorldEventView } from '../../../src/render/world/worldEventsScene';

/** A session that counts its listeners. */
class CountingSession {
  listeners = 0;
  onEvent<K extends keyof SimEventMap>(_type: K, _h: (e: SimEventMap[K]) => void): () => void {
    this.listeners++;
    return () => {
      this.listeners--;
    };
  }
}

interface Follower {
  follow(session: CountingSession): void;
}

/** Calls per window: one window of the frame-path bench (300 frames). */
const WINDOW_CALLS = 300;
const WINDOWS = 3;
/** Limit [B per call]: a context object per call is 24–40 B; the engine's one-time work spread over a window stays below it. */
const MAX_BYTES_PER_CALL = 8;

describe('Einmal-je-Frame: follow legt in den unteren Stufen nichts an (M7-87)', () => {
  let inspector: Session;
  beforeAll(async () => {
    inspector = new Session();
    inspector.connect();
    await inspector.post('HeapProfiler.enable');
  });
  afterAll(() => inspector.disconnect());

  for (const [name, make, listeners] of [
    ['WorldEventView', (): Follower => new WorldEventView() as unknown as Follower, 3],
    ['BossView', (): Follower => new BossView() as unknown as Follower, 1],
  ] as const) {
    it(`${name}: dieselbe Sitzung erneut folgen – 0 B je Aufruf; eine neue Sitzung wird abonniert`, async () => {
      const view = make();
      const session = new CountingSession();
      view.follow(session);
      expect(session.listeners).toBe(listeners);
      /** The measured loop: the frames' call of `follow` with the session the view follows already. */
      function followCalls(n: number): void {
        for (let i = 0; i < n; i++) view.follow(session);
      }
      followCalls(1);
      const perCall: number[] = [];
      const tops: string[] = [];
      for (let k = 0; k < WINDOWS; k++) {
        await inspector.post('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        followCalls(WINDOW_CALLS);
        const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
        const alloc = pathAllocation(profile, (f) => f.functionName === 'followCalls');
        perCall.push(alloc.inPath / WINDOW_CALLS);
        tops.push(JSON.stringify(alloc.top));
      }
      const median = [...perCall].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
      expect(median, `Allokation je follow (Fenster ${perCall.map((b) => b.toFixed(2)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_CALL);
      // Following the same session never subscribed again; another session takes the listeners over.
      expect(session.listeners).toBe(listeners);
      const next = new CountingSession();
      view.follow(next);
      expect([session.listeners, next.listeners]).toEqual([0, listeners]);
    });
  }
});
