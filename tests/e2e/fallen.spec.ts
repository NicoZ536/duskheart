/**
 * Fallen im Browser (M6-30; MASTERPROMPT §2.2 „Alles ist erreichbar und erklärt“, §14 „Fallen (Schlinge, Kastenfalle)“;
 * Review-Mangel „traps-unplaceable“): eine Kastenfalle wird mit echter Eingabe aufgestellt – Taste 1 nimmt sie in die Hand,
 * der Mauszeiger zielt auf eine Kachel, die Vorschau steht dort grün, der HUD-Hinweis sagt „Aufstellen: Kastenfalle“, ein
 * Klick der linken Maustaste stellt sie auf. Ein Hase flieht vor der Figur über die Falle und wird gefangen; E nimmt die
 * Falle zurück, der Hase bleibt als Kadaver, und mit dem Steinmesser in der Hand zerlegt ihn E. Debug-Befehle nur, wo sie
 * Zeit sparen (Uhrzeit, Gegenstände geben, Hase erscheinen lassen, Teleport). Keine Konsolenfehler oder -warnungen.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface Summary {
  byId: Record<string, number>;
  carcasses: number;
  traps: number;
}
interface Placement {
  item: string | null;
  tx: number;
  ty: number;
  block: string | null;
}
interface Dh {
  ready: boolean;
  exec(line: string): string;
  command(cmd: unknown): unknown;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE_PX = 16;
/** The four directions a trap is tried in, two tiles from the figure. */
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function command(page: Page, cmd: unknown): Promise<unknown> {
  return page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

function events(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.events);
}

function summary(page: Page): Promise<Summary> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('creatures') as Summary);
}

function placement(page: Page): Promise<Placement> {
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { placement: Placement }).placement);
}

async function playerTile(page: Page): Promise<{ tx: number; ty: number }> {
  const p = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
  if (p === null) throw new Error('kein Spieler');
  return { tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) };
}

/** Waits until the event `type` was raised more than `n` times. */
async function eventAfter(page: Page, type: string, n: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(([t, c]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) > (c as number), [type, n] as const, { timeout });
}

/** Moves the mouse pointer onto the centre of tile `t` (world px → internal px → CSS px). */
async function pointAt(page: Page, t: { tx: number; ty: number }): Promise<void> {
  await renderedFrames(page, 2);
  const view = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { camera: [number, number] });
  const canvas = await page.evaluate(() => {
    const c = document.getElementById('dh-canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const vp = (await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { viewport: { internalWidth: number; internalHeight: number; outX: number; outY: number; outWidth: number; outHeight: number } })).viewport;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const ix = t.tx * TILE_PX + TILE_PX / 2 - view.camera[0] + vp.internalWidth / 2;
  const iy = t.ty * TILE_PX + TILE_PX / 2 - view.camera[1] + vp.internalHeight / 2;
  await page.mouse.move(canvas.left + (vp.outX + (ix * vp.outWidth) / vp.internalWidth) / dpr, canvas.top + (vp.outY + (iy * vp.outHeight) / vp.internalHeight) / dpr);
  await page.waitForFunction(
    (target) => {
      const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: { aim: { tx: number; ty: number } | null } }).gathering;
      return g.aim !== null && g.aim.tx === target.tx && g.aim.ty === target.ty;
    },
    t,
  );
  await renderedFrames(page, 2);
}

async function teleport(page: Page, t: { tx: number; ty: number }): Promise<void> {
  await command(page, { type: 'player.teleport', x: t.tx * TILE_PX + TILE_PX / 2, y: t.ty * TILE_PX + TILE_PX / 2, layer: 0 });
  await page.waitForFunction(
    (target) => {
      const p = (window as unknown as { __dh: Dh }).__dh.state().sim.player;
      return p !== null && Math.floor(p.x / 16) === target.tx && Math.floor(p.y / 16) === target.ty;
    },
    t,
  );
}

async function pressE(page: Page): Promise<void> {
  await page.keyboard.down('KeyE');
  await renderedFrames(page, 2);
  await page.keyboard.up('KeyE');
}

test('Kastenfalle: mit Taste 1 und Linksklick aufstellen, ein Hase läuft hinein, E nimmt sie zurück, das Messer zerlegt den Fang', async ({ page }) => {
  test.setTimeout(240_000);
  const msgs = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.exec('time 10:00'))).toContain('10:00');
  // The trap into hotbar slot 1 (a crafted trap lands in the inventory; the inventory screen would drag it there).
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.exec('give kastenfalle 1'))).toContain('Kastenfalle');
  await command(page, { type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'schnellleiste', index: 0 } });
  await expect(page.getByTestId('hud-schnellleiste-0')).toHaveAttribute('data-item', 'kastenfalle');
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('hud-schnellleiste')).toHaveAttribute('data-auswahl', '0');

  // Aim two tiles away until the preview stands green there.
  const home = await playerTile(page);
  let trap: { tx: number; ty: number } | null = null;
  let dir: readonly [number, number] = DIRECTIONS[0];
  for (const d of DIRECTIONS) {
    const t = { tx: home.tx + 2 * d[0], ty: home.ty + 2 * d[1] };
    await pointAt(page, t);
    const p = await placement(page);
    expect(p).toMatchObject({ item: 'kastenfalle', tx: t.tx, ty: t.ty });
    if (p.block === null) {
      trap = t;
      dir = d;
      break;
    }
  }
  if (trap === null) throw new Error('kein freier Boden zwei Kacheln um die Figur');
  await expect(page.getByTestId('hud-hinweis')).toContainText('Aufstellen: Kastenfalle');

  // LMB sets it up – no blow.
  const before = await events(page);
  await page.mouse.down();
  await renderedFrames(page, 2);
  await page.mouse.up();
  await eventAfter(page, 'trapPlaced', before['trapPlaced'] ?? 0);
  const after = await events(page);
  expect(after['attackWindup'] ?? 0).toBe(before['attackWindup'] ?? 0);
  expect((await summary(page)).traps).toBe(1);
  await expect(page.getByTestId('hud-schnellleiste-0')).not.toHaveAttribute('data-item', 'kastenfalle');
  // The same tile again: the preview is gone with the empty hand.
  expect((await placement(page)).item).toBeNull();

  // A hare beyond the trap; the figure steps around it, the hare flees back across the trap.
  let caught = false;
  for (let attempt = 0; attempt < 4 && !caught; attempt++) {
    await teleport(page, home);
    const sprung = (await events(page))['trapSprung'] ?? 0;
    await command(page, { type: 'creature.spawn', creature: 'hase', count: 1, x: (trap.tx + dir[0]) * TILE_PX + TILE_PX / 2, y: (trap.ty + dir[1]) * TILE_PX + TILE_PX / 2, layer: 0 });
    await renderedFrames(page, 2);
    await teleport(page, { tx: trap.tx + 4 * dir[0], ty: trap.ty + 4 * dir[1] });
    caught = await eventAfter(page, 'trapSprung', sprung, 20_000).then(
      () => true,
      () => false,
    );
  }
  expect(caught).toBe(true);

  // Beside the trap, pointing at it: E takes it back; the hare stays as a carcass.
  await teleport(page, { tx: trap.tx - dir[0], ty: trap.ty - dir[1] });
  await pointAt(page, trap);
  await expect(page.getByTestId('hud-hinweis')).toContainText('Nehmen: Kastenfalle');
  const carcasses = (await summary(page)).carcasses;
  const taken = (await events(page))['trapTaken'] ?? 0;
  await pressE(page);
  await eventAfter(page, 'trapTaken', taken);
  expect(await summary(page)).toMatchObject({ traps: 0, carcasses: carcasses + 1 });

  // The stone knife in the hand: E carves the hare.
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.exec('give steinmesser 1'))).toContain('Steinmesser');
  // A tool lands in the hotbar (its first free slot); the HUD shows it a frame later. The slot's number 1–10 (truthy).
  const slot = (await (
    await page.waitForFunction(() => {
      for (let i = 0; i < 10; i++) if (document.querySelector(`[data-testid="hud-schnellleiste-${i}"]`)?.getAttribute('data-item') === 'steinmesser') return i + 1;
      return false;
    })
  ).jsonValue()) as number;
  await page.keyboard.press(`Digit${slot % 10}`);
  await expect(page.getByTestId('hud-hinweis')).toContainText('Zerlegen: Hase');
  const carved = (await events(page))['carcassCarved'] ?? 0;
  await pressE(page);
  await eventAfter(page, 'carcassCarved', carved);
  expect(msgs).toEqual([]);
});
