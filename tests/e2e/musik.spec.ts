/**
 * M7-03 acceptance (E2E; docs/SPIEL.md §24 "im Browser im Worker (`music.worker.ts`, Transferable)", §28 "Musik-Rendering:
 * Node und Worker bitgleich"; PROGRESS M7-03 "Titelmusik startet ohne Main-Thread-Blockade > 16 ms"): on today's title –
 * the boot without a player, the world behind the title card – the first key press unlocks the audio and the title music
 * starts.
 *
 * - The music is rendered in the music worker (a `Worker` of `music.worker`), not on the main thread, and arrives in slices
 *   the page pulls (src/audio/music/protocol.ts) – no message carries a whole piece.
 * - The title's stems start as looping sources of the title's length, looping from the piece's loop start; what their Web
 *   Audio buffers hold – what the player hears – has the same bits as Node's render of the same piece (`renderHash`,
 *   computed in the page after the measured window).
 * - From the key press until the music plays, no task of the page's main thread takes more than 16 ms of thread time: the
 *   browser's own trace judges (tests/e2e/trace.ts, ADR-0037 – wall time also counts the time the thread waits for a core
 *   beside SwiftShader, so it is reported, not judged). The stems reach Web Audio in slices of `UPLOAD_FRAMES_PER_FRAME`
 *   per frame (src/audio/music/bank.ts). A window of the same length before the key press is reported as the baseline.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { createMusicLibrary } from '../../src/audio/music/library';
import { UPLOAD_FRAMES_PER_FRAME } from '../../src/audio/music/bank';
import { renderHash, renderPiece } from '../../src/audio/music/render';
import { MOOD_MUSIC, type MusicPiece } from '../../src/content/music/index';
import { logicUrl } from './logik';
import { longestTasks, mainThreadTasks, threadMs, timeStampAt, type TraceEvent } from './trace';

/** Longest main-thread task the acceptance allows while the title music starts [ms of thread time]. */
const MAX_BLOCK_MS = 16;

interface MusicSpy {
  contexts: number;
  workers: string[];
  starts: Array<{ samples: number; loop: boolean; loopStart: number; channels: number; sampleRate: number }>;
  /** The music worker's messages: kind and the bytes of float samples each carried. */
  messages: Array<{ kind: string; bytes: number }>;
}

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: unknown } };
  call(name: string): unknown;
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

/**
 * Before the page's scripts: counts audio contexts, names the workers, notes the music worker's messages (kind and size –
 * nothing is kept), records every started buffer source and holds on to the looping ones' buffers (they play anyway) for
 * `hashLoops`.
 */
async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy = { contexts: 0, workers: [] as string[], starts: [] as unknown[], messages: [] as unknown[], loopBuffers: [] as AudioBuffer[] };
    (window as unknown as { __musikSpy: typeof spy }).__musikSpy = spy;
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        spy.contexts++;
      }
    };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const name = String(url);
        spy.workers.push(name);
        if (name.includes('music')) {
          this.addEventListener('message', (ev: MessageEvent<{ kind: string; stems?: Record<string, Float32Array> }>) => {
            let bytes = 0;
            for (const s of Object.values(ev.data.stems ?? {})) bytes += s.byteLength;
            spy.messages.push({ kind: ev.data.kind, bytes });
          });
        }
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      const b = this.buffer;
      spy.starts.push({ samples: b?.length ?? 0, loop: this.loop, loopStart: this.loopStart, channels: b?.numberOfChannels ?? 0, sampleRate: b?.sampleRate ?? 0 });
      if (this.loop && b !== null) spy.loopBuffers.push(b);
      return start.apply(this, args);
    };
  });
}

/**
 * FNV-1a (as `renderHash`) over the looping buffers of `samples` frames, in start order (the player starts the layers in the
 * order of `MUSIC_LAYERS`): each buffer's channels one after the other – the planar stem the worker rendered.
 */
async function hashLoops(page: Page, samples: number): Promise<string> {
  return page.evaluate((n) => {
    const spy = (window as unknown as { __musikSpy: { loopBuffers: AudioBuffer[] } }).__musikSpy;
    let h = 0x811c9dc5;
    for (const b of spy.loopBuffers) {
      if (b.length !== n) continue;
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const data = b.getChannelData(ch);
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        for (let i = 0; i < bytes.length; i++) {
          h ^= bytes[i] as number;
          h = Math.imul(h, 0x01000193);
        }
      }
      h ^= 0xff;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }, samples);
}

async function spy(page: Page): Promise<MusicSpy> {
  return page.evaluate(() => {
    const s = (window as unknown as { __musikSpy: MusicSpy }).__musikSpy;
    return { contexts: s.contexts, workers: [...s.workers], starts: [...s.starts], messages: [...s.messages] };
  });
}

test('Titelmusik: im Worker gerendert, bitgleich zu Node, startet ohne Main-Thread-Blockade über 16 ms', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const msgs = collectConsole(page);
  // Node: the title piece, its length and the bits of its render.
  const library = createMusicLibrary();
  const title = library.piece(MOOD_MUSIC.titel) as MusicPiece;
  const arrangement = title.arrangements[0]?.art ?? 'standard';
  const rendered = renderPiece(title, arrangement, library.tables);
  const expectedHash = renderHash(rendered);

  await installSpy(page);
  await page.goto(logicUrl());
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  // Today's title: the world behind the title card is there, no player walks it.
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.call('renderInfo') !== null && ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.call('frames') as number > 30, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player)).toBeNull();
  // Autoplay policy: no audio context before the first input.
  expect((await spy(page)).contexts).toBe(0);

  await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline'] });
  // Baseline: the title's frames without audio, as long as the music's window will be (reported).
  await page.evaluate(() => console.timeStamp('dh-ruhe-start'));
  const baselineStart = Date.now();
  await page.waitForTimeout(3000);
  await page.evaluate(() => console.timeStamp('dh-ruhe-end'));
  const baselineMs = Date.now() - baselineStart;

  // The first key press unlocks the audio; Shift alone does nothing on the title.
  await page.evaluate(() => console.timeStamp('dh-musik-start'));
  const t0 = Date.now();
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction(
    ([n]) => (window as unknown as { __musikSpy: MusicSpy }).__musikSpy.starts.some((s) => s.loop && s.samples === n),
    [rendered.lengthSamples] as const,
    { timeout: 120_000 },
  );
  // A few frames more: the deck's fade-in has begun, the stingers' uploads may still run.
  await page.waitForTimeout(500);
  await page.evaluate(() => console.timeStamp('dh-musik-end'));
  const musicMs = Date.now() - t0;
  const trace = JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: TraceEvent[] };
  const events = trace.traceEvents;

  // Rendered in the music worker, pulled in slices: no message carries more than one slice of every layer.
  const s = await spy(page);
  expect(s.contexts).toBe(1);
  expect(s.workers.some((w) => w.includes('music'))).toBe(true);
  const slices = s.messages.filter((m) => m.kind === 'slice');
  const layerCount = Object.values(title.schichten).filter((chs) => chs.length > 0).length;
  expect(slices.length).toBeGreaterThanOrEqual(Math.ceil(rendered.lengthSamples / (UPLOAD_FRAMES_PER_FRAME / layerCount)));
  expect(Math.max(...s.messages.map((m) => m.bytes))).toBeLessThanOrEqual(UPLOAD_FRAMES_PER_FRAME * 2 * 4);
  // The title's stems play as looping sources: stereo at 32 kHz, the piece's length, from its loop start.
  const titleStarts = s.starts.filter((x) => x.loop && x.samples === rendered.lengthSamples);
  expect(titleStarts.length).toBe(layerCount);
  for (const x of titleStarts) {
    expect(x).toMatchObject({ channels: 2, sampleRate: 32000 });
    expect(x.loopStart).toBeCloseTo(rendered.loopStartSample / rendered.sampleRate, 6);
  }
  // What plays is Node's render, bit for bit.
  expect(await hashLoops(page, rendered.lengthSamples)).toBe(expectedHash);

  // The trace judges: every main-thread task between the key press and the music's start.
  const windowTasks = (start: string, end: string): TraceEvent[] => {
    const a = timeStampAt(events, start);
    const b = timeStampAt(events, end);
    if (a === null || b === null) throw new Error(`Markierung ${start}/${end} fehlt im Trace`);
    return mainThreadTasks(events).filter((t) => t.ts >= a && t.ts + (t.dur ?? 0) <= b);
  };
  const during = windowTasks('dh-musik-start', 'dh-musik-end');
  const before = windowTasks('dh-ruhe-start', 'dh-ruhe-end');
  const maxMs = (tasks: readonly TraceEvent[]): number => tasks.reduce((m, t) => Math.max(m, threadMs(t)), 0);
  const report = {
    musicMs,
    baselineMs,
    tasks: during.length,
    maxTaskMs: Math.round(maxMs(during) * 10) / 10,
    baselineMaxTaskMs: Math.round(maxMs(before) * 10) / 10,
    longest: longestTasks(events, 3, (t) => during.includes(t)),
  };
  console.info('musik', JSON.stringify(report));
  expect(during.length).toBeGreaterThan(10);
  expect(maxMs(during), JSON.stringify(report.longest)).toBeLessThanOrEqual(MAX_BLOCK_MS);
  expect(msgs).toEqual([]);
});
