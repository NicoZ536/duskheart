/**
 * M4-29 in the browser: the base sounds. A spy on the Web Audio graph (installed before the page's scripts) records
 * every buffer source that starts or stops, with its buffer length – every preset renders to its own length
 * (`sfxSampleCount`), so the length names the sound.
 *
 * - A clay kiln set up next to the player sounds like clay; loaded with clay and fuel it runs, and its loop
 *   (`sfx_station_ofen`) starts – read from the simulation's state (src/audio/loopSources.ts); taken down, the loop
 *   stops and the kiln is taken apart with a clay sound.
 * - A wooden crate set on the build grid sounds like wood; opening and closing it creak and thud.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { sfxSampleCount } from '../../src/audio/dsp/render';
import { SFX_PRESETS, SFX_SAMPLE_RATE } from '../../src/content/sfx/index';
import { logicUrl } from './logik';

interface SpySource {
  readonly samples: number;
  readonly loop: boolean;
}

interface AudioSpy {
  contexts: number;
  starts: SpySource[];
  stops: SpySource[];
}

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  command(cmd: unknown): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;

/** Buffer length of preset `id` [samples at `SFX_SAMPLE_RATE`]. */
function samplesOf(id: string): number {
  const p = SFX_PRESETS.find((s) => s.id === id);
  if (p === undefined) throw new Error(id);
  return sfxSampleCount(p, SFX_SAMPLE_RATE);
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy = { contexts: 0, starts: [] as Array<{ samples: number; loop: boolean }>, stops: [] as Array<{ samples: number; loop: boolean }> };
    (window as unknown as { __audioSpy: typeof spy }).__audioSpy = spy;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        spy.contexts++;
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      spy.starts.push({ samples: this.buffer?.length ?? 0, loop: this.loop });
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['stop']>) {
      spy.stops.push({ samples: this.buffer?.length ?? 0, loop: this.loop });
      return stop.apply(this, args);
    };
  });
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

async function events(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, type);
}

/** Waits until a source of `samples` starts (loop or not) after the first `from` starts. */
async function started(page: Page, samples: number, loop: boolean, from: number): Promise<void> {
  await page.waitForFunction(
    ([n, l, f]) => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.starts.slice(f as number).some((s) => s.samples === n && s.loop === l),
    [samples, loop, from] as const,
    { timeout: 30_000 },
  );
}

async function startCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.starts.length);
}

/**
 * Sends `make(tx, ty)` for the tiles around the player until `event` counts up; returns the new count. Each command is
 * answered by the simulation – `event` when it is placed, `commandRejected` when the tile does not take it – and the
 * helper waits for that answer, however many ticks it takes to arrive (a busy machine runs several ticks per frame).
 */
async function placeNextToPlayer(page: Page, make: (tx: number, ty: number) => unknown, event: string): Promise<number> {
  const offsets = [
    [1, -2],
    [-2, -2],
    [1, 1],
    [-2, 1],
    [2, -1],
    [-3, -1],
    [0, 2],
    [0, -3],
  ] as const;
  for (const [dx, dy] of offsets) {
    const sim = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
    if (sim.player === null) throw new Error('no player');
    const c = make(Math.floor(sim.player.x / TILE) + dx, Math.floor(sim.player.y / TILE) + dy);
    // Read both counters and queue the command in one go: ticks may run between two evaluations.
    const sent = await page.evaluate(
      ([x, e]) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        const counts = dh.state().sim.events;
        const before = { placed: counts[e as string] ?? 0, rejected: counts['commandRejected'] ?? 0 };
        dh.command(x);
        return before;
      },
      [c, event] as const,
    );
    await page.waitForFunction(
      ([e, placed, rejected]) => {
        const s = (window as unknown as { __dh: Dh }).__dh.state().sim;
        return (s.events[e as string] ?? 0) > (placed as number) || (s.events['commandRejected'] ?? 0) > (rejected as number);
      },
      [event, sent.placed, sent.rejected] as const,
    );
    const after = await events(page, event);
    if (after > sent.placed) return after;
  }
  throw new Error(`no free tile for ${event}`);
}

test('Basis klingt: Lehmofen aufstellen, seine Arbeitsschleife läuft und endet; Kiste setzen, öffnen, schließen', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await installSpy(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  // The first key press unlocks the audio (autoplay policy); Shift alone does nothing in the game.
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction(() => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.contexts === 1);

  // The kiln: set up (clay), loaded, running (its loop), taken down (the loop stops, clay again).
  let from = await startCount(page);
  await cmd(page, { type: 'inventory.give', item: 'lehmofen', count: 1 });
  const kiln = await placeNextToPlayer(page, (tx, ty) => ({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty }), 'stationPlaced');
  await started(page, samplesOf('sfx_bau_setzen_lehm'), false, from);
  from = await startCount(page);
  await cmd(page, { type: 'inventory.give', item: 'lehm', count: 6 });
  await cmd(page, { type: 'station.put', station: kiln, from: { bereich: 'inventar', index: 0 }, bereich: 'eingang' });
  await cmd(page, { type: 'inventory.give', item: 'holz', count: 4 });
  await cmd(page, { type: 'station.put', station: kiln, from: { bereich: 'inventar', index: 0 }, bereich: 'brennstoff' });
  await started(page, samplesOf('sfx_station_ofen'), true, from);
  from = await startCount(page);
  const stopsBefore = await page.evaluate(() => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.stops.length);
  await cmd(page, { type: 'station.remove', station: kiln });
  await started(page, samplesOf('sfx_bau_abbauen_lehm'), false, from);
  await page.waitForFunction(
    ([n, f]) => (window as unknown as { __audioSpy: AudioSpy }).__audioSpy.stops.slice(f as number).some((s) => s.loop && s.samples === n),
    [samplesOf('sfx_station_ofen'), stopsBefore] as const,
    { timeout: 30_000 },
  );

  // A wooden crate on the build grid: set with wood, the lid creaks open and thuds shut.
  from = await startCount(page);
  await cmd(page, { type: 'inventory.give', item: 'kiste_holz', count: 1 });
  const chest = await placeNextToPlayer(page, (tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }), 'chestPlaced');
  await started(page, samplesOf('sfx_bau_setzen_holz'), false, from);
  from = await startCount(page);
  await cmd(page, { type: 'storage.open', chest });
  await started(page, samplesOf('sfx_kiste_oeffnen'), false, from);
  await expect(page.getByTestId('ui-kiste')).toBeVisible();
  from = await startCount(page);
  await cmd(page, { type: 'storage.close', chest });
  await started(page, samplesOf('sfx_kiste_schliessen'), false, from);

  expect(msgs).toEqual([]);
});
