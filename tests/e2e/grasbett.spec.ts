/**
 * M4-34 "Grasbett aufstellen" in the browser (MASTERPROMPT §11.5, §11.6; ADR-0031, ADR-0040): herstellen → aufstellen →
 * schlafen (Zeit ×30 bis 06:00) → Tod → Wiedereinstieg am Grasbett – every step through the game's own UI:
 *
 * - The ingredients (12 fibres, 10 leaves, 4 twigs) come from the debug command `inventory.give`; the crafting menu
 *   (C) lists the grass bed, "Herstellen" queues it, the order finishes and the bed lies in the bags (inventory
 *   screen).
 * - The build mode (B) offers it under "Möbel"; a click on a free tile sets it up (1 × 2 on the build grid).
 * - After 19:00, aimed at with the mouse, the bed offers "Schlafen: Grasbett" and E puts the player to sleep: time runs
 *   faster (×30, §11.5) until the player wakes at 06:00; the bed became the respawn point.
 * - Away from the bed the player's light goes out (debug command `death.kill`); the death screen offers "Am Bett
 *   erwachen", and the player wakes beside the grass bed.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface SimState {
  tick: number;
  time: string;
  day: number;
  player: { x: number; y: number; layer: number; health: number } | null;
  events: Record<string, number>;
}

interface GhostInfo {
  cursor: [number, number] | null;
  piece: string | null;
  anchors: number;
  ok: number;
  reason: string | null;
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;
/** §11.5: while the player sleeps time runs ×30; measured ≥ 5 even on a busy machine (the loop catches up to 5 × 30 ticks a frame). */
const MIN_SLEEP_SPEEDUP = 5;
/** Game ticks per second (BALANCE.time.tickHz). */
const TICK_HZ = 60;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
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

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await frames(page, 2);
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

async function events(page: Page, type: string): Promise<number> {
  return (await sim(page)).events[type] ?? 0;
}

async function waitEvents(page: Page, type: string, before: number, more = 1, timeout = 30_000): Promise<void> {
  await page.waitForFunction(([t, b]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (b as number), [type, before + more] as const, { timeout });
}

async function ticks(page: Page, n = 2): Promise<void> {
  const t = (await sim(page)).tick;
  await page.waitForFunction((x) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick >= x, t + n);
}

async function teleport(page: Page, tx: number, ty: number): Promise<void> {
  await cmd(page, { type: 'player.teleport', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, layer: 0 });
  await page.waitForFunction(
    ([x, y]) => {
      const pl = (window as unknown as { __dh: Dh }).__dh.state().sim.player;
      return pl !== null && Math.floor(pl.x / 16) === x && Math.floor(pl.y / 16) === y;
    },
    [tx, ty] as const,
  );
  await frames(page, 4);
}

/**
 * A free, buildable `w` × `h` site at least `minRing` tiles (ring distance) from the spawn: its north-west tile (floor
 * blueprints over the footprint, counted, taken back).
 */
async function findSite(page: Page, w: number, h: number, minRing: number): Promise<{ x0: number; y0: number }> {
  const p = (await sim(page)).player;
  if (p === null) throw new Error('kein Spieler');
  const sx = Math.floor(p.x / TILE);
  const sy = Math.floor(p.y / TILE);
  const offsets: Array<[number, number]> = [];
  for (let r = minRing; r <= minRing + 18; r += 3) for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push([dx, dy]);
  for (const [dx, dy] of offsets) {
    const x0 = sx + dx - Math.floor(w / 2);
    const y0 = sy + dy - Math.floor(h / 2);
    await teleport(page, sx + dx, sy + dy);
    const before = await events(page, 'partPlaced');
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.blueprint', part: 'boden_holz', tx: x, ty: y });
    await ticks(page, 3);
    const placed = (await events(page, 'partPlaced')) - before;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.remove', tx: x, ty: y, ebene: 'boden' });
    await ticks(page, 3);
    if (placed === w * h) return { x0, y0 };
  }
  throw new Error(`kein freier Bauplatz ${w} × ${h} ab ${minRing} Feldern vom Startstrand`);
}

/** The CSS point of the middle of tile (tx, ty) under the current camera. */
async function tilePoint(page: Page, tx: number, ty: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) => {
      const dh = (window as unknown as { __dh: Dh }).__dh;
      const view = dh.call('worldInfo') as { camera: [number, number] };
      const vp = (dh.call('renderInfo') as { viewport: { internalWidth: number; internalHeight: number; outX: number; outY: number; outWidth: number; outHeight: number } }).viewport;
      const c = (document.getElementById('dh-canvas') as HTMLCanvasElement).getBoundingClientRect();
      const dpr = window.devicePixelRatio;
      const ix = (x as number) * 16 + 8 - view.camera[0] + vp.internalWidth / 2;
      const iy = (y as number) * 16 + 8 - view.camera[1] + vp.internalHeight / 2;
      return { x: c.left + (vp.outX + (ix * vp.outWidth) / vp.internalWidth) / dpr, y: c.top + (vp.outY + (iy * vp.outHeight) / vp.internalHeight) / dpr };
    },
    [tx, ty] as const,
  );
}

/** Moves the pointer over tile (tx, ty) and waits until the build ghost's cursor is there. */
async function pointAt(page: Page, tx: number, ty: number): Promise<GhostInfo> {
  const pt = await tilePoint(page, tx, ty);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(
    ([x, y]) => {
      const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: { ghost: GhostInfo } }).building.ghost;
      return g.cursor !== null && g.cursor[0] === x && g.cursor[1] === y;
    },
    [tx, ty] as const,
  );
  await frames(page, 2);
  return ((await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('worldInfo'))) as { building: { ghost: GhostInfo } }).building.ghost;
}

/** Pieces of `item` in the inventory screen's slots (opens and closes it with Tab). */
async function countInBags(page: Page, item: string): Promise<number> {
  await press(page, 'Tab');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  const n = await page.evaluate((id) => {
    let total = 0;
    for (const el of document.querySelectorAll(`[data-testid^="slot-"][data-item="${id}"]`)) total += Number(el.querySelector('.dh-slot__anzahl')?.textContent ?? '1');
    return total;
  }, item);
  await press(page, 'Tab');
  await expect(page.getByTestId('ui-inventar')).toBeHidden();
  return n;
}

test('Grasbett: herstellen (C) → aufstellen (B) → ab 19 Uhr mit E schlafen, Zeit ×30 bis 06:00 → Tod → Wiedereinstieg am Grasbett', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  const spawn = (await sim(page)).player;
  if (spawn === null) throw new Error('kein Spieler');
  const beach = { tx: Math.floor(spawn.x / TILE), ty: Math.floor(spawn.y / TILE) };
  for (const [item, count] of [
    ['fasern', 12],
    ['laub', 10],
    ['zweig', 4],
  ] as const)
    await cmd(page, { type: 'inventory.give', item, count });
  await page.mouse.move(2, 2);

  // Herstellen: the crafting menu lists the grass bed (every ingredient owned once); the order runs and finishes.
  await press(page, 'KeyC');
  await expect(page.getByTestId('ui-handwerk')).toBeVisible();
  await page.getByTestId('rezept-rezept_grasbett').click();
  await expect(page.getByTestId('handwerk-detail')).toHaveAttribute('data-rezept', 'rezept_grasbett');
  await expect(page.getByTestId('handwerk-herstellen')).toBeEnabled();
  const crafted = await events(page, 'craftCompleted');
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('auftrag-0')).toHaveAttribute('data-rezept', 'rezept_grasbett');
  await waitEvents(page, 'craftCompleted', crafted);
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0);
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-handwerk')).toBeHidden();
  expect(await countInBags(page, 'grasbett')).toBe(1);
  expect(await countInBags(page, 'fasern')).toBe(0);

  // Aufstellen: a free site away from the start beach; the build mode sets the bed (1 × 2, anchor north) there.
  const site = await findSite(page, 3, 4, 9);
  const bed = { tx: site.x0 + 1, ty: site.y0 + 1 };
  await teleport(page, bed.tx + 1, bed.ty + 2);
  await press(page, 'KeyB');
  await expect(page.getByTestId('baumodus')).toBeVisible();
  await page.getByTestId('bau-kategorie-moebel').click();
  await page.getByTestId('bau-teil-grasbett').click();
  await expect(page.getByTestId('bau-teil-grasbett')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bau-vorrat')).toHaveText('1 dabei');
  const ghost = await pointAt(page, bed.tx, bed.ty);
  expect(ghost).toMatchObject({ piece: 'grasbett', anchors: 1, ok: 1, reason: null });
  const placed = await events(page, 'partPlaced');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', placed);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');
  await press(page, 'Escape');
  await expect(page.getByTestId('baumodus')).toBeHidden();
  await page.mouse.move(2, 2);

  // Schlafen: after 19:00, beside the bed with the mouse over its foot, the hint offers sleep and E lies down. (Before
  // 19:00 the bed refuses – "noch nicht müde" – and yields the hint to any other target in reach; the rule itself:
  // tests/unit/game/grasbett.test.ts.)
  await cmd(page, { type: 'setTime', hour: 19, minute: 5 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.time.startsWith('19:'));
  await teleport(page, bed.tx + 1, bed.ty + 1);
  const foot = await tilePoint(page, bed.tx, bed.ty + 1);
  await page.mouse.move(foot.x, foot.y);
  await ticks(page, 2);
  await expect(page.getByTestId('hud-hinweis')).toContainText('Schlafen: Grasbett');
  const slept = await events(page, 'sleepStarted');
  const respawnSet = await events(page, 'respawnPointSet');
  await press(page, 'KeyE');
  await waitEvents(page, 'sleepStarted', slept);
  await waitEvents(page, 'respawnPointSet', respawnSet);
  const night = await sim(page);

  // Time ×30 while asleep: ticks against the wall clock over a stretch of the night.
  const speedup = await page.evaluate(
    (hz) =>
      new Promise<number>((resolve) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        const t0 = dh.state().sim.tick;
        const w0 = performance.now();
        setTimeout(() => resolve((dh.state().sim.tick - t0) / ((performance.now() - w0) / 1000) / hz), 3000);
      }),
    TICK_HZ,
  );
  console.log(`Grasbett: Schlaf ab ${night.time} (Tag ${night.day}), Zeit läuft ×${speedup.toFixed(1)} (Soll ×30, Takt ${TICK_HZ} Hz)`);
  expect(speedup).toBeGreaterThanOrEqual(MIN_SLEEP_SPEEDUP);
  const woke = await events(page, 'sleepEnded');
  await waitEvents(page, 'sleepEnded', woke, 1, 300_000);
  const morning = await sim(page);
  expect(morning.day).toBe(night.day + 1);
  expect(morning.time.startsWith('06:')).toBe(true);
  console.log(`Grasbett: erwacht Tag ${morning.day} um ${morning.time}`);

  // Tod: away from the bed, on the start beach; the death screen offers the bed, and the player wakes beside it.
  await teleport(page, beach.tx, beach.ty);
  const died = await events(page, 'playerDied');
  await cmd(page, { type: 'death.kill' });
  await waitEvents(page, 'playerDied', died);
  await expect(page.getByTestId('todesbildschirm')).toBeVisible();
  await expect(page.getByTestId('tod-erwachen-bett')).toHaveText('Am Bett erwachen');
  const respawned = await events(page, 'playerRespawned');
  await page.getByTestId('tod-erwachen-bett').click();
  await waitEvents(page, 'playerRespawned', respawned);
  await expect(page.getByTestId('todesbildschirm')).toBeHidden();
  const back = (await sim(page)).player;
  if (back === null) throw new Error('kein Spieler nach dem Wiedereinstieg');
  const bedX = (bed.tx + 0.5) * TILE;
  const bedY = (bed.ty + 1) * TILE;
  expect(Math.hypot(back.x - bedX, back.y - bedY)).toBeLessThan(3 * TILE);
  expect(Math.hypot(back.x - spawn.x, back.y - spawn.y)).toBeGreaterThan(6 * TILE);
  expect(back.health).toBeGreaterThan(0);
  await frames(page, 10);
  await page.screenshot({ path: 'shots/latest/e2e-grasbett-erwacht.png' });
  expect(errors).toEqual([]);
});
