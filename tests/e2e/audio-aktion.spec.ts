/**
 * M3-33 in the browser: a player action makes sound, without console errors or warnings. A spy on the
 * Web Audio graph (installed before the page's scripts) records every `AudioContext`, every buffer
 * source that starts and every connection into the context's destination:
 *
 * - before the first input no `AudioContext` exists (autoplay policy – no console warning about it);
 * - the first key press creates and runs it;
 * - walking (D) starts footstep voices whose buffers have exactly the length of a footstep preset, a
 *   roll (Space) starts the roll preset; the graph reaches the speakers (mixer → destination).
 */
import { expect, test, type Page } from '@playwright/test';
import { sfxSampleCount } from '../../src/audio/dsp/render';
import { SFX_PRESETS, SFX_SAMPLE_RATE } from '../../src/content/sfx/index';

interface SpyStart {
  readonly samples: number;
  readonly rate: number;
  readonly loop: boolean;
  readonly state: string;
}

interface AudioSpy {
  contexts: number;
  starts: SpyStart[];
  toDestination: number;
  state: () => string;
}

interface Dh {
  ready: boolean;
  state(): { sim: { player: { state: string; x: number } | null } };
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

/** Buffer lengths [samples at `SFX_SAMPLE_RATE`] of presets by id prefix. */
function lengths(prefix: string): number[] {
  return SFX_PRESETS.filter((p) => p.id.startsWith(prefix)).map((p) => sfxSampleCount(p, SFX_SAMPLE_RATE));
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

/** Wraps the Web Audio API before any page script runs. */
async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy = { contexts: 0, starts: [] as Array<{ samples: number; rate: number; loop: boolean; state: string }>, toDestination: 0, ctx: null as AudioContext | null, state: () => '' };
    spy.state = () => spy.ctx?.state ?? 'none';
    (window as unknown as { __audioSpy: typeof spy }).__audioSpy = spy;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        spy.contexts++;
        spy.ctx = this;
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      spy.starts.push({ samples: this.buffer?.length ?? 0, rate: this.buffer?.sampleRate ?? 0, loop: this.loop, state: this.context.state });
      return start.apply(this, args);
    };
    const connect = AudioNode.prototype.connect as (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) => AudioNode | undefined;
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) {
      if (destination === this.context.destination) spy.toDestination++;
      return connect.call(this, destination, ...rest);
    } as typeof AudioNode.prototype.connect;
  });
}

function spy(page: Page): Promise<Omit<AudioSpy, 'state'> & { state: string }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __audioSpy: AudioSpy }).__audioSpy;
    return { contexts: s.contexts, starts: s.starts.slice(), toDestination: s.toDestination, state: s.state() };
  });
}

test('eine Spieleraktion klingt: Schritte beim Gehen, die Rolle – ohne Konsolenfehler', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await installSpy(page);
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });

  // Autoplay policy: nothing before the first gesture.
  const before = await spy(page);
  expect(before.contexts).toBe(0);
  expect(before.starts).toEqual([]);

  // Walking right: the key press unlocks the audio, the steps sound.
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.starts.length >= 3, undefined, { timeout: 30_000 });
  const walking = await spy(page);
  expect(walking.contexts).toBe(1);
  expect(walking.state).toBe('running');
  expect(walking.toDestination).toBeGreaterThanOrEqual(1);
  const steps = new Set([...lengths('sfx_schritt_'), ...lengths('sfx_wasser_schwimmzug')]);
  const stepStarts = walking.starts.filter((s) => steps.has(s.samples));
  expect(stepStarts.length).toBeGreaterThanOrEqual(2);
  for (const s of walking.starts) {
    expect(s.rate).toBe(SFX_SAMPLE_RATE);
    expect(s.state).toBe('running');
  }

  // A roll: its own preset starts.
  const [rollSamples] = lengths('sfx_spieler_rolle');
  const startsBeforeRoll = walking.starts.length;
  await page.keyboard.down('Space');
  await page.waitForFunction(`window.__audioSpy.starts.slice(${startsBeforeRoll}).some((s) => s.samples === ${rollSamples})`, undefined, { timeout: 30_000 });
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player?.state === 'idle', undefined, { timeout: 30_000 });

  const after = await spy(page);
  expect(after.contexts).toBe(1);
  expect(msgs).toEqual([]);
});
