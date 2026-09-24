/**
 * M2-29 in the browser: the world console commands `tp`, `time`, `season`, `weather`, `seed` act on
 * the running session through game commands – the test types each one into the console (or runs it
 * through `__dh.exec`) and checks the result in `__dh.state()` – and the overlays chunks, collision
 * and temperature field draw in the render debug layer of the game view (`__dh.call('worldInfo')`,
 * pixel probes with the overlay on and off).
 */
import { expect, test, type Page } from '@playwright/test';

interface WorldState {
  ready: boolean;
  focus: { layer: number; tx: number; ty: number } | null;
  season: string;
  dayOfSeason: number;
  year: number;
  weather: { region: number; state: string } | null;
  temperatureC: number | null;
  activeChunks: number;
  residentChunks: number;
}

interface SimState {
  seed: number;
  tick: number;
  day: number;
  time: string;
  controlled: { x: number; y: number } | null;
  world: WorldState;
}

interface GameViewInfo {
  scene: string;
  layer: number;
  follows: boolean;
  figure: [number, number] | null;
  terrain: { missing: number };
  overlays: Record<string, boolean>;
  overlayStats: { chunks: number; collisionTiles: number; temperatureTiles: number };
}

interface Dh {
  ready: boolean;
  exec(line: string): string;
  state(): { sim: SimState };
  setSpeed(f: number): void;
  readPixel(x: number, y: number): Promise<readonly [number, number, number, number]>;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'en-US', viewport: { width: 1280, height: 720 } });

const TILE_PX = 16;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
}

function exec(page: Page, line: string): Promise<string> {
  return page.evaluate((l) => (window as unknown as { __dh: Dh }).__dh.exec(l), line);
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/**
 * Waits until the simulation state satisfies `pred` (polled in the page every frame). `pred` runs in
 * the page: it may only use its parameters (`arg` is passed as JSON).
 */
async function waitSim<A>(page: Page, pred: (s: SimState, arg: A) => boolean, arg?: A): Promise<SimState> {
  await page.waitForFunction(`(${pred.toString()})(window.__dh.state().sim, ${JSON.stringify(arg ?? null)})`);
  return sim(page);
}

function frames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

test('Konsolenbefehle tp, time, season, weather und seed wirken über Commands auf die laufende Sitzung', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await openGame(page);
  const points = await dh<{ spawn: { tx: number; ty: number }; caveEntrances: Array<{ tx: number; ty: number }> }>(page, 'worldPoints');
  const start = await sim(page);

  // seed: shows the world's seed and size.
  expect(await exec(page, 'seed')).toBe(`Seed ${start.seed} · world size Medium`);

  // tp without coordinates: the figure appears on the start beach, the camera follows, the zone forms.
  await page.keyboard.press('Backquote');
  await expect(page.locator('.dh-debug-console input.dh-debug-input')).toBeFocused();
  await page.keyboard.type('tp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dh-debug-line--output').last()).toHaveText(`Figure created at (${points.spawn.tx}, ${points.spawn.ty}) on layer 0.`);
  await page.keyboard.press('Backquote');
  let s = await waitSim(page, (st) => st.controlled !== null && st.world.activeChunks === 25);
  expect(s.world.focus).toEqual({ layer: 0, tx: points.spawn.tx, ty: points.spawn.ty });
  expect(s.controlled).toEqual({ entity: 0, x: points.spawn.tx * TILE_PX + TILE_PX / 2, y: points.spawn.ty * TILE_PX + TILE_PX / 2 });
  expect((await dh<GameViewInfo>(page, 'worldInfo')).follows).toBe(true);

  // tp to another tile, then into the Wurzelhöhlen at a cave entrance and back.
  const far = { tx: points.spawn.tx + 70, ty: points.spawn.ty - 45 };
  expect(await exec(page, `tp ${far.tx} ${far.ty}`)).toBe(`Teleported to (${far.tx}, ${far.ty}) on layer 0.`);
  s = await waitSim(page, (st, f) => st.world.focus !== null && st.world.focus.tx === f.tx && st.world.focus.ty === f.ty, far);
  // 5 × 5 around the new spot plus the old chunks still inside radius + hysteresis (docs/ARCHITEKTUR.md "Aktive Zone").
  expect(s.world.activeChunks).toBeGreaterThanOrEqual(25);
  const cave = points.caveEntrances[0] as { tx: number; ty: number };
  expect(await exec(page, `tp ${cave.tx} ${cave.ty} -1`)).toBe(`Teleported to (${cave.tx}, ${cave.ty}) on layer -1.`);
  s = await waitSim(page, (st) => st.world.focus !== null && st.world.focus.layer === -1);
  expect(s.world.focus).toEqual({ layer: -1, tx: cave.tx, ty: cave.ty });
  await page.waitForFunction(() => {
    const i = (window as unknown as { __dh: Dh }).__dh.call('worldInfo') as GameViewInfo;
    return i.layer === -1 && i.terrain.missing === 0;
  });
  // Caves have no weather; their temperature stays near the base value of the Wurzelhöhlen (12 °C, §9.3).
  s = await waitSim(page, (st) => st.world.temperatureC !== null);
  expect(s.world.weather).toBeNull();
  expect(Math.abs((s.world.temperatureC as number) - 12)).toBeLessThan(4);
  expect(await exec(page, `tp ${points.spawn.tx} ${points.spawn.ty} 0`)).toContain('layer 0');
  s = await waitSim(page, (st) => st.world.focus !== null && st.world.focus.layer === 0);
  expect(await exec(page, 'tp 99999 5')).toMatch(/lies outside the world/);

  // time: jumps forward to the next 18:30, then by 90 minutes.
  const day = s.day;
  expect(await exec(page, 'time 18:30')).toBe('Time jumps ahead to 18:30.');
  s = await waitSim(page, (st) => st.time >= '18:30' && st.time < '19:00');
  expect(s.day).toBe(day);
  expect(await exec(page, 'time +90')).toBe('Time jumps 90 game minutes ahead.');
  s = await waitSim(page, (st) => st.time >= '20:00' && st.time < '20:30');
  expect(await exec(page, 'time 25:00')).toMatch(/Expected HH:MM/);

  // season: the next start of summer (spring lasts 7 days), 06:00.
  expect(await exec(page, 'season sommer')).toBe('Time jumps to the start of: Summer.');
  s = await waitSim(page, (st) => st.world.season === 'sommer');
  expect([s.world.dayOfSeason, s.day]).toEqual([1, 8]);
  expect(s.time >= '06:00' && s.time < '06:30').toBe(true);
  expect(await exec(page, 'time')).toMatch(/^Day 8 · 06:\d\d · Summer, day 1\/7 · year 1 · moon phase \d\/8$/);
  expect(await exec(page, 'season')).toBe('Summer, day 1/7 · year 1');

  // weather: here (the region under the camera = the figure), then everywhere.
  s = await waitSim(page, (st) => st.world.weather !== null);
  const region = s.world.weather?.region as number;
  expect(await exec(page, 'weather regen')).toBe(`Weather in region ${region}: Rain`);
  s = await waitSim(page, (st) => st.world.weather !== null && st.world.weather.state === 'regen');
  expect(await exec(page, 'weather')).toBe(`Weather here: Rain (region ${region})`);
  expect(await exec(page, 'weather schnee alle')).toBe('Weather everywhere: Snow');
  s = await waitSim(page, (st) => st.world.weather !== null && st.world.weather.state === 'schnee');

  // seed n: a new world – the page reloads with ?seed=n and generates it.
  expect(await exec(page, 'seed 4242')).toBe('Loading a new world from seed 4242 …');
  await page.waitForURL(/seed=4242/);
  await openGame(page, '&seed=4242');
  expect((await sim(page)).seed).toBe(4242);
  expect(msgs).toEqual([]);
});

test('Overlays Chunks, Kollision und Temperaturfeld zeichnen in der Render-Debug-Ebene der Spielansicht', async ({ page }) => {
  const msgs = collectConsole(page);
  await openGame(page);
  await exec(page, 'tp');
  await waitSim(page, (st) => st.world.activeChunks === 25);
  await frames(page, 3);
  const centre = { x: 640, y: 300 };
  const probe = (): Promise<readonly number[]> => page.evaluate(([x, y]) => (window as unknown as { __dh: Dh }).__dh.readPixel(x as number, y as number), [centre.x, centre.y] as const);
  const bare = await probe();
  const drawCalls = async (): Promise<number> => (await dh<{ drawCalls: number }>(page, 'renderInfo')).drawCalls;
  const baseCalls = await drawCalls();

  expect(await exec(page, 'overlay chunks an')).toBe('Overlay chunks: On');
  await frames(page, 2);
  let info = await dh<GameViewInfo>(page, 'worldInfo');
  expect(info.overlays).toEqual({ chunks: true, kollision: false, temperatur: false });
  expect(info.overlayStats.chunks).toBeGreaterThanOrEqual(2);
  // One instanced draw call for the whole overlay.
  expect(await drawCalls()).toBe(baseCalls + 1);

  expect(await exec(page, 'overlay chunks aus')).toBe('Overlay chunks: Off');
  expect(await exec(page, 'overlay kollision')).toBe('Overlay kollision: On');
  await frames(page, 2);
  info = await dh<GameViewInfo>(page, 'worldInfo');
  expect(info.overlayStats.collisionTiles).toBeGreaterThan(0);

  await dh(page, 'worldOverlay', 'kollision', false);
  await dh(page, 'worldOverlay', 'temperatur', true);
  await frames(page, 2);
  info = await dh<GameViewInfo>(page, 'worldInfo');
  // The temperature field tints every visible tile (30 × 17 at 480 × 270).
  expect(info.overlayStats.temperatureTiles).toBeGreaterThanOrEqual(30 * 17);
  const tinted = await probe();
  expect(tinted).not.toEqual(bare);
  expect(await exec(page, 'overlay')).toBe(['Overlay chunks: Off', 'Overlay kollision: Off', 'Overlay temperatur: On'].join('\n'));
  await exec(page, 'overlay temperatur aus');
  await frames(page, 2);
  expect(await drawCalls()).toBe(baseCalls);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});
