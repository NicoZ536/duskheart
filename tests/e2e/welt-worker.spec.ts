/**
 * M3-41 in the browser: the world worker dies during the session – after the world is there, without a
 * word (`__dh.call('worldWorker', 'beenden')` terminates it the way a crashed worker process ends). The
 * camera then moves to chunks nobody loaded yet: the failover notices the missing answer, loads the chunks
 * in the main thread and the picture is complete again – no dark view, the host stays `bereit`, one warning
 * on the console and no error.
 */
import { expect, test, type Page } from '@playwright/test';

interface Dh {
  ready: boolean;
  readPixel(x: number, y: number): Promise<readonly [number, number, number, number]>;
  call(name: string, ...args: unknown[]): unknown;
}

interface WorkerStatus {
  state: string;
  mode: 'worker' | 'inThread';
  failure: string | null;
  terminated: boolean;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE_PX = 16;
/** Colour of the background where no chunk is drawn (palette `nacht.0`). */
const BACKGROUND = [13, 10, 20] as const;

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

function sceneReady(page: Page): Promise<boolean> {
  return dh<{ sceneReady: boolean }>(page, 'renderInfo').then((i) => i.sceneReady);
}

/** Pixel probes across the picture that show the background colour (a hole where a chunk is missing). */
async function backgroundPixels(page: Page): Promise<number> {
  let holes = 0;
  for (const [x, y] of [
    [160, 120],
    [640, 120],
    [1120, 120],
    [160, 360],
    [640, 360],
    [1120, 360],
    [160, 600],
    [640, 600],
    [1120, 600],
  ] as const) {
    const px = await page.evaluate(([a, b]) => (window as unknown as { __dh: Dh }).__dh.readPixel(a as number, b as number), [x, y] as const);
    if (px[0] === BACKGROUND[0] && px[1] === BACKGROUND[1] && px[2] === BACKGROUND[2]) holes++;
  }
  return holes;
}

test('der Welt-Worker fällt während der Sitzung aus: die Chunks laden im Hauptthread weiter, das Bild bleibt vollständig', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  const before = await dh<WorkerStatus>(page, 'worldWorker');
  expect(before).toEqual({ state: 'bereit', mode: 'worker', failure: null, terminated: false });
  expect(await backgroundPixels(page)).toBe(0);

  // The worker dies without a word.
  const killed = await dh<WorkerStatus>(page, 'worldWorker', 'beenden');
  expect(killed.terminated).toBe(true);

  // The camera moves to chunks nobody loaded yet (the spawn plus 6 chunks east, then north – inland from the south coast).
  const points = await dh<{ spawn: { tx: number; ty: number } }>(page, 'worldPoints');
  const far = { x: (points.spawn.tx + 6 * 32) * TILE_PX, y: points.spawn.ty * TILE_PX };
  await dh(page, 'worldCamera', far.x, far.y);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldWorker') as WorkerStatus).mode === 'inThread', undefined, { timeout: 30_000 });
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 30_000 });
  const after = await dh<WorkerStatus>(page, 'worldWorker');
  expect(after.state).toBe('bereit');
  expect(after.failure).toMatch(/keine Antwort/);
  expect((await dh<{ terrain: { missing: number } }>(page, 'worldInfo')).terrain.missing).toBe(0);
  expect(await backgroundPixels(page)).toBe(0);

  // Later loads stream too.
  await dh(page, 'worldCamera', far.x, far.y - 5 * 32 * TILE_PX);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 30_000 });
  expect(await sceneReady(page)).toBe(true);
  expect((await dh<{ terrain: { missing: number } }>(page, 'worldInfo')).terrain.missing).toBe(0);
  expect(await backgroundPixels(page)).toBe(0);

  expect(errors).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/Welt-Worker ausgefallen, Chunks laden ab jetzt im Hauptthread/);
});
