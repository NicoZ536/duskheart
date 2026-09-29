/**
 * M4-22, M4-23, M4-26, M4-27, M4-38 in the browser: the build mode over the running game on the start beach
 * (debug mode with `?spieler=1`). A free site near the spawn is found the way the build scenarios find one – the
 * footprint laid as floor blueprints (they cost nothing and obey the ground rules), counted, taken back.
 *
 * - B opens the build mode (input context `build`: the world stays playable, the HUD's hotbar and tracker give way
 *   to the build panel); only categories with pieces have a tab; search; costs and stock of the chosen piece; the
 *   ghost under the mouse pointer green ("Frei") or red with its reason ("Keine Stütze in Reichweite", "Blockiert",
 *   "Zu weit"); R turns only pieces with a direction, F mirrors only mirrorable ones; a click places; the hints show
 *   the mouse and key cap glyph sprites; Esc leaves.
 * - Dragging walls places the rectangle's outline, dragging floors fills it; Ctrl+Z takes the drag back within
 *   10 s of game time and no longer after; the middle button picks the piece under the pointer.
 * - Blueprints (M4-24): without material the status names the toggle with its glyph ("Kein Material – [G] plant es
 *   als Blaupause."); G switches blueprint mode (panel switch and hint lit), a drag plans a wall line without
 *   material, the line of the blueprints' needs follows, Ctrl+Z takes the plans back within 10 s; with the material
 *   in the bags E with the hammer in the hand finishes each blueprint – the walls stand, undo leaves them.
 * - Selection by keys: Tab gives the panel the focus, the arrows walk the pieces, Enter takes one and returns.
 * - The overlays mark the world (fields and labels) with their legend.
 * - The roof of an interior fades out completely when the player enters and comes back outside; behind the house
 *   the roof opens in the circle around the player.
 * - Tools (§16.6, Review M4 #1; keys 1–4 and the tool bar): dismantling gives a wall built just now back whole
 *   ("100 % zurück (noch … s)") and one older than 30 s at 60 % rounded down (one of its three planks); upgrading turns
 *   a plank wall into stone in place; after a fire (debug `fire.ignite`, put out by rain) the repair tool takes the
 *   hammer into the hand and mends the dragged rectangle for planks; a station comes back whole; a piece taken from
 *   the panel returns to placing.
 * - Tool bar and hint line stay one row each at 1280 × 720 and 1920 × 1080 in German and English, for every tool (the
 *   primary gesture always shows), and the panel ends above the window's edge; while placing, the pipette hint shows
 *   in both languages at both sizes and the line never overlaps the panel (M5-37).
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface SimState {
  tick: number;
  player: { x: number; y: number; layer: number } | null;
  events: Record<string, number>;
}

interface GhostInfo {
  active: boolean;
  piece: string | null;
  cursor: [number, number] | null;
  anchors: number;
  ok: number;
  reason: string | null;
}

interface BuildingInfo {
  pieces: number;
  blueprints: number;
  roofs: number;
  roofsInCircle: number;
  cutWalls: number;
  roofFade: number;
  roofTiles: number;
  inside: boolean;
  ghost: GhostInfo;
  overlay: { kind: string | null; tiles: number; rooms: number; labels: number };
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
  setSpeed(factor: number): void;
  screenshotMode(on: boolean): void;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;
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
  // Frames the renderer drew (tests/e2e/frames.ts), not animation frames of the page.
  return renderedFrames(page, n);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await frames(page, 2);
}

/** Ctrl+Z as a hand presses it: Ctrl held over a few frames, Z tapped in between (the chord is read per frame). */
async function ctrlZ(page: Page): Promise<void> {
  await page.keyboard.down('Control');
  await frames(page, 2);
  await page.keyboard.press('KeyZ');
  await frames(page, 2);
  await page.keyboard.up('Control');
  await frames(page, 1);
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function building(page: Page): Promise<BuildingInfo> {
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building);
}

async function events(page: Page, type: string): Promise<number> {
  return (await sim(page)).events[type] ?? 0;
}

/** Waits until the simulation counted more than `before` events of `type` (or `at least` exactly `n` more). */
async function waitEvents(page: Page, type: string, before: number, more = 1): Promise<void> {
  await page.waitForFunction(([t, b]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (b as number), [type, before + more] as const);
}

/** Waits a few ticks (commands of the last frame applied). */
async function ticks(page: Page, n = 2): Promise<void> {
  const t = (await sim(page)).tick;
  await page.waitForFunction((x) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick >= x, t + n);
}

async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count] of items) await cmd(page, { type: 'inventory.give', item, count });
  // The notifications of the given items do not matter here; the pointer starts off the canvas.
  await page.mouse.move(1, 1);
}

async function teleport(page: Page, tx: number, ty: number): Promise<void> {
  const p = (await sim(page)).player;
  await cmd(page, { type: 'player.teleport', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, layer: p?.layer ?? 0 });
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
 * A free, buildable site of `w` × `h` tiles near the spawn: its north-west tile. The player stands in its middle
 * afterwards. Candidates ring by ring; the footprint is laid as floor blueprints and taken back.
 */
async function findSite(page: Page, w: number, h: number): Promise<{ x0: number; y0: number }> {
  const p = (await sim(page)).player;
  if (p === null) throw new Error('kein Spieler');
  const sx = Math.floor(p.x / TILE);
  const sy = Math.floor(p.y / TILE);
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let r = 3; r <= 24; r += 3) for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push([dx, dy]);
  for (const [dx, dy] of offsets) {
    const cx = sx + dx;
    const cy = sy + dy;
    const x0 = cx - Math.floor(w / 2);
    const y0 = cy - Math.floor(h / 2);
    await teleport(page, cx, cy);
    const before = await events(page, 'partPlaced');
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.blueprint', part: 'boden_holz', tx: x, ty: y });
    await ticks(page, 3);
    const placed = (await events(page, 'partPlaced')) - before;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.remove', tx: x, ty: y, ebene: 'boden' });
    await ticks(page, 3);
    if (placed === w * h) return { x0, y0 };
  }
  throw new Error(`kein freier Bauplatz ${w} × ${h} um den Startstrand`);
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

/** Moves the pointer over tile (tx, ty) and waits until the ghost's cursor is there. */
async function pointAt(page: Page, tx: number, ty: number): Promise<GhostInfo> {
  const pt = await tilePoint(page, tx, ty);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(
    ([x, y]) => {
      const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
      return g.cursor !== null && g.cursor[0] === x && g.cursor[1] === y;
    },
    [tx, ty] as const,
  );
  await frames(page, 2);
  return (await building(page)).ghost;
}

/** Chooses piece `id` in category `kategorie` of the panel. */
async function choose(page: Page, kategorie: string, id: string): Promise<void> {
  await page.getByTestId(`bau-kategorie-${kategorie}`).click();
  await page.getByTestId(`bau-teil-${id}`).click();
  await expect(page.getByTestId(`bau-teil-${id}`)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction((p) => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost.piece === p, id);
}

async function openBuildMode(page: Page): Promise<void> {
  await press(page, 'KeyB');
  await expect(page.getByTestId('baumodus')).toBeVisible();
}

/** Builds a closed hut of `n` × `n` tiles with its north-west corner (x0, y0): plank walls, a door south, a straw roof. */
async function hut(page: Page, x0: number, y0: number, n: number): Promise<void> {
  const before = await events(page, 'partPlaced');
  const door = x0 + Math.floor(n / 2);
  let count = 0;
  for (let y = y0; y < y0 + n; y++) {
    for (let x = x0; x < x0 + n; x++) {
      if (x !== x0 && x !== x0 + n - 1 && y !== y0 && y !== y0 + n - 1) continue;
      await cmd(page, { type: 'build.place', part: x === door && y === y0 + n - 1 ? 'tuer_holz' : 'wand_holz', tx: x, ty: y });
      count++;
    }
  }
  await waitEvents(page, 'partPlaced', before, count);
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) await cmd(page, { type: 'build.place', part: 'dach_stroh', tx: x, ty: y });
  await waitEvents(page, 'partPlaced', before, count + n * n);
}

test('B öffnet den Baumodus: Kategorien nur mit Teilen, Suche, Kosten und Vorrat, Geist grün und rot mit Grund, R dreht, F spiegelt, Klick setzt, Esc beendet', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['wand_holz', 12],
    ['dach_stroh', 4],
    ['tor_holz', 1],
    ['tisch_holz', 1],
  ]);
  const { x0, y0 } = await findSite(page, 9, 7);
  const py = y0 + 3;
  await teleport(page, x0 + 4, py);
  await openBuildMode(page);
  // The build panel takes the place of hotbar and tracker; the world keeps running.
  await expect(page.getByTestId('hud')).toHaveClass(/dh-hud--bau/);
  const tick = (await sim(page)).tick;
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 5, tick);

  // Every tab shows pieces; nothing waits for later content (the Lumen network arrives with M11).
  const tabs = await page.locator('[data-testid^="bau-kategorie-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['kategorie'] ?? ''));
  expect(tabs.length).toBeGreaterThanOrEqual(6);
  expect(tabs).not.toContain('lumen');
  expect(tabs.slice(0, 4)).toEqual(['fundament', 'waende', 'tueren', 'daecher']);
  for (const k of tabs) {
    await page.getByTestId(`bau-kategorie-${k}`).click();
    await expect(page.getByTestId(`bau-kategorie-${k}`)).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('[data-testid="bau-teile"] [data-teil]').count()).toBeGreaterThan(0);
  }
  await page.getByTestId('bau-kategorie-daecher').click();
  await expect(page.getByTestId('bau-titel')).toHaveText('Dächer');
  await expect(page.getByTestId('bau-teil-dach_stroh')).toBeVisible();

  // Search: accents do not matter; Enter takes the first match.
  await page.getByTestId('bau-suche').fill('tur');
  await expect(page.getByTestId('bau-titel')).toHaveText('Suchergebnis');
  await expect(page.getByTestId('bau-teil-tuer_holz')).toBeVisible();
  await expect(page.getByTestId('bau-treffer')).toContainText('Treffer');
  await page.getByTestId('bau-suche').fill('xyzzy');
  await expect(page.getByTestId('bau-teile')).toContainText('Nichts gefunden zu „xyzzy“');
  await page.getByTestId('bau-suche').press('Escape');
  await expect(page.getByTestId('bau-suche')).toHaveValue('');

  // Costs and stock of the plank wall.
  await choose(page, 'waende', 'wand_holz');
  await expect(page.getByTestId('bau-info')).toContainText('Holzwand');
  await expect(page.getByTestId('bau-vorrat')).toHaveText('12 dabei');
  await expect(page.getByTestId('bau-kosten')).toContainText('Brett');

  // Hints with the glyph sprites (M4-38): the mouse with the lit left button, key caps for keys.
  const hints = page.getByTestId('bau-hinweise');
  await expect(hints.locator('[data-aktion="attack"] [data-glyphe="hinweis_maus_links"]')).toHaveCount(1);
  await expect(hints.locator('[data-aktion="undo"] [data-glyphe="hinweis_taste"]')).toHaveText('Strg+Z');
  await expect(hints.locator('[data-aktion="pipette"]')).toContainText('Pipette');

  // Green: a free tile east of the player; a click places the wall there.
  let g = await pointAt(page, x0 + 7, py);
  expect(g).toMatchObject({ piece: 'wand_holz', anchors: 1, ok: 1, reason: null });
  await expect(page.getByTestId('bau-status')).toHaveText('Frei – hier kannst du bauen.');
  await expect(page.getByTestId('bau-status')).not.toHaveAttribute('data-warnung', '');
  const placed = await events(page, 'partPlaced');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', placed);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('11 dabei');
  // Red: the same tile again is taken.
  g = await pointAt(page, x0 + 7, py - 1);
  g = await pointAt(page, x0 + 7, py);
  expect(g.reason).toBe('blocked');
  await expect(page.getByTestId('bau-status')).toHaveText('Blockiert – der Platz ist belegt oder nicht bebaubar.');
  await expect(page.getByTestId('bau-status')).toHaveAttribute('data-warnung', '');
  // A click on a refused tile asks the simulation, which names the same reason.
  const rejected = await events(page, 'commandRejected');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'commandRejected', rejected);
  expect(await events(page, 'partPlaced')).toBe(placed + 1);

  // A straw roof far from the wall: no support in reach (§16.3).
  await choose(page, 'daecher', 'dach_stroh');
  g = await pointAt(page, x0, py - 3);
  expect(g.reason).toBe('noSupport');
  await expect(page.getByTestId('bau-status')).toHaveText('Keine Stütze in Reichweite – setz eine Wand oder Säule näher an das Dach.');
  // Beyond the build reach of 8 tiles.
  await choose(page, 'waende', 'wand_holz');
  g = await pointAt(page, x0 + 4 - 10, py);
  expect(g.reason).toBe('tooFar');
  await expect(page.getByTestId('bau-status')).toHaveText('Zu weit – geh näher heran (höchstens 8 Felder).');

  // R turns the gate, F does not mirror it; the table mirrors but has one direction.
  await choose(page, 'tueren', 'tor_holz');
  await expect(hints.locator('[data-aktion="block"]')).toContainText('Drehen');
  await press(page, 'KeyR');
  await expect(page.getByTestId('bau-info')).toContainText('Gedreht 90°');
  await press(page, 'KeyF');
  await expect(page.getByTestId('bau-status')).toHaveText('Dieses Bauteil lässt sich nicht spiegeln.');
  await choose(page, 'moebel', 'tisch_holz');
  await expect(page.getByTestId('bau-info')).not.toContainText('Gedreht');
  await press(page, 'KeyF');
  await expect(page.getByTestId('bau-info')).toContainText('Gespiegelt');
  await press(page, 'KeyR');
  await expect(page.getByTestId('bau-status')).toHaveText('Dieses Bauteil hat nur eine Richtung.');

  // Esc leaves the build mode; the hotbar returns.
  await press(page, 'Escape');
  await expect(page.getByTestId('baumodus')).toBeHidden();
  await expect(page.getByTestId('hud')).not.toHaveClass(/dh-hud--bau/);
  expect((await building(page)).ghost.active).toBe(false);
  expect(errors).toEqual([]);
});

test('Ziehen: Wände als Umriss, Böden gefüllt; Strg+Z nimmt den Zug binnen 10 s zurück, danach nicht mehr; Mittelklick ist die Pipette', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['wand_holz', 20],
    ['boden_holz', 12],
    ['werkbank', 1],
  ]);
  const { x0, y0 } = await findSite(page, 9, 7);
  await teleport(page, x0 + 4, y0 + 6);
  await openBuildMode(page);
  await choose(page, 'waende', 'wand_holz');

  // Walls: a 5 × 4 drag places its outline (14 walls) as one step.
  const placedBefore = await events(page, 'partPlaced');
  const a = await tilePoint(page, x0 + 2, y0 + 1);
  await page.mouse.move(a.x, a.y);
  await pointAt(page, x0 + 2, y0 + 1);
  await page.mouse.down();
  await frames(page, 2);
  await pointAt(page, x0 + 6, y0 + 4);
  await page.waitForFunction(() => {
    const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
    return g.anchors === 14 && g.ok === 14;
  });
  await expect(page.getByTestId('bau-status')).toHaveText('Alle 14 setzbar.');
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', placedBefore, 14);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('6 dabei');

  // Ctrl+Z within 10 s: the whole drag comes back into the bags.
  const removedBefore = await events(page, 'partRemoved');
  await ctrlZ(page);
  await waitEvents(page, 'partRemoved', removedBefore, 14);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('20 dabei');
  await expect(page.getByTestId('bau-status')).toHaveText('Rückgängig: 14 Teile zurück in den Taschen.');

  // Floors: a 3 × 2 drag fills the rectangle.
  await choose(page, 'fundament', 'boden_holz');
  const floorsBefore = await events(page, 'partPlaced');
  await pointAt(page, x0 + 3, y0 + 2);
  await page.mouse.down();
  await frames(page, 2);
  await pointAt(page, x0 + 5, y0 + 3);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost.anchors === 6);
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', floorsBefore, 6);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('6 dabei');

  // The middle button takes the piece under the pointer.
  await choose(page, 'waende', 'wand_holz');
  const floor = await tilePoint(page, x0 + 4, y0 + 3);
  await page.mouse.move(floor.x, floor.y);
  await frames(page, 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await expect(page.getByTestId('bau-teil-boden_holz')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bau-status')).toHaveText('Pipette: Holzboden');

  // Stations are set up from the bags the same way (station.place) and taken back by Ctrl+Z (station.remove).
  await choose(page, 'stationen', 'werkbank');
  await expect(page.getByTestId('bau-vorrat')).toHaveText('1 dabei');
  const g = await pointAt(page, x0 + 6, y0 + 5);
  expect(g).toMatchObject({ piece: 'werkbank', anchors: 1, ok: 1 });
  const stationsBefore = await events(page, 'stationPlaced');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'stationPlaced', stationsBefore);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');
  const stationsGone = await events(page, 'stationRemoved');
  await ctrlZ(page);
  await waitEvents(page, 'stationRemoved', stationsGone);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('1 dabei');

  // More than 10 s of game time later nothing is undone any more.
  const t0 = (await sim(page)).tick;
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(8));
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t, t0 + 11 * TICK_HZ, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(1));
  const removed = await events(page, 'partRemoved');
  await ctrlZ(page);
  await expect(page.getByTestId('bau-status')).toHaveText('Nichts mehr rückgängig zu machen – das geht nur 10 s lang.');
  await ticks(page, 3);
  expect(await events(page, 'partRemoved')).toBe(removed);
  expect(errors).toEqual([]);
});

test('Blaupause: ohne Material nennt der Grund G; G plant eine Wandlinie ohne Material, Strg+Z nimmt sie zurück; mit Material stellt E mit dem Hammer fertig – die Wand steht', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await start(page, [['steinhammer', 1]]);
  const { x0, y0 } = await findSite(page, 9, 7);
  const py = y0 + 3;
  const xs = [x0 + 2, x0 + 3, x0 + 4, x0 + 5];
  await teleport(page, x0 + 4, py + 2);
  // The hammer in the hand (the hotbar slot holding it, as the digit keys choose it).
  let hammer = -1;
  for (let i = 0; i < 10 && hammer < 0; i++) {
    const label = await page.getByTestId(`hud-schnellleiste-${i}`).getAttribute('aria-label');
    if (label?.includes('Steinhammer') === true) hammer = i;
  }
  expect(hammer).toBeGreaterThanOrEqual(0);
  await cmd(page, { type: 'player.selectHotbar', index: hammer });
  await openBuildMode(page);
  await choose(page, 'waende', 'wand_holz');
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');
  const status = page.getByTestId('bau-status');
  const hints = page.getByTestId('bau-hinweise');
  const plan = page.getByTestId('bau-blaupause');
  const needs = page.getByTestId('bau-blaupausen');

  // No material, blueprint mode off: red, and the reason names the toggle with its key cap glyph (hint line too).
  let g = await pointAt(page, xs[0] as number, py);
  expect(g.reason).toBe('noMaterial');
  await expect(plan).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveText('Kein Material – G plant es als Blaupause.');
  await expect(status.locator('[data-glyphe="hinweis_taste"]')).toHaveText('G');
  await expect(status).toHaveAttribute('data-warnung', '');
  await expect(hints.locator('[data-aktion="blueprint"] [data-glyphe="hinweis_taste"]')).toHaveText('G');
  await expect(hints.locator('[data-aktion="blueprint"]')).toContainText('Blaupause');
  await page.screenshot({ path: 'shots/latest/e2e-baumodus-blaupause-hinweis.png' });

  // G: blueprint mode – the switch and the hint lit, the ghost plans without material.
  await press(page, 'KeyG');
  await expect(plan).toHaveAttribute('aria-pressed', 'true');
  await expect(hints.locator('[data-aktion="blueprint"]')).toHaveAttribute('data-an', '');
  await page.waitForFunction(() => {
    const gh = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
    return gh.ok === 1 && gh.reason === null;
  });
  await expect(status).toHaveText('Frei – hier kannst du eine Blaupause planen.');
  await expect(status).toHaveAttribute('data-plan', '');

  /** Drags a wall line over `xs` on row `py` in blueprint mode: four blueprints, the bags untouched. */
  const planLine = async (): Promise<void> => {
    const before = await events(page, 'partPlaced');
    await pointAt(page, xs[0] as number, py);
    await page.mouse.down();
    await frames(page, 2);
    await pointAt(page, xs[3] as number, py);
    await page.waitForFunction(() => {
      const gh = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
      return gh.anchors === 4 && gh.ok === 4;
    });
    await expect(status).toHaveText('Alle 4 als Blaupause planbar.');
    await page.screenshot({ path: 'shots/latest/e2e-baumodus-blaupause-ziehen.png' });
    await page.mouse.up();
    await waitEvents(page, 'partPlaced', before, 4);
    await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.blueprints === 4);
    await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');
    await expect(needs).toHaveText('Blaupausen brauchen noch: 4× Holzwand');
    await expect(needs).toHaveAttribute('data-fehlt', '');
  };
  await planLine();

  // Ctrl+Z within 10 s takes the plans back (nothing comes into the bags).
  const removedBefore = await events(page, 'partRemoved');
  await ctrlZ(page);
  await waitEvents(page, 'partRemoved', removedBefore, 4);
  await expect(status).toHaveText('Rückgängig: 4 Blaupausen entfernt.');
  await expect(needs).toHaveCount(0);
  expect((await building(page)).blueprints).toBe(0);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');

  // Planned again; then the material arrives: the line says the hammer can finish them.
  await planLine();
  await cmd(page, { type: 'inventory.give', item: 'wand_holz', count: 4 });
  await expect(needs).toHaveText('4 Blaupausen: Material da – mit dem Hammer in der Hand fertigstellen.');
  await expect(needs).not.toHaveAttribute('data-fehlt', '');

  // E with the hammer in the hand, the pointer on each blueprint from the tile south of it: finished one by one.
  const completed = await events(page, 'blueprintCompleted');
  for (let i = 0; i < xs.length; i++) {
    const tx = xs[i] as number;
    await teleport(page, tx, py + 1);
    await pointAt(page, tx, py);
    await press(page, 'KeyE');
    await waitEvents(page, 'blueprintCompleted', completed, i + 1);
  }
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');
  await expect(needs).toHaveCount(0);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.blueprints === 0);
  expect((await building(page)).pieces).toBeGreaterThanOrEqual(4);
  // The walls stand: the ghost finds the tile taken, and undo no longer takes the finished walls.
  g = await pointAt(page, xs[1] as number, py);
  expect(g.reason).toBe('blocked');
  const removed = await events(page, 'partRemoved');
  await ctrlZ(page);
  await expect(status).toHaveText('Nichts mehr rückgängig zu machen – das geht nur 10 s lang.');
  await ticks(page, 3);
  expect(await events(page, 'partRemoved')).toBe(removed);
  expect(errors).toEqual([]);
});

test('Auswahl mit Tasten: Tab gibt der Bautafel den Fokus, Pfeile wählen, Enter nimmt und kehrt zum Setzen zurück; Overlays mit Legende', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['wand_holz', 20],
    ['tuer_holz', 1],
    ['dach_stroh', 25],
  ]);
  const { x0, y0 } = await findSite(page, 7, 7);
  await teleport(page, x0 + 3, y0 + 6);
  await hut(page, x0 + 1, y0, 5);
  await openBuildMode(page);
  await choose(page, 'waende', 'wand_holz');
  await page.mouse.move(1, 1);

  // Tab: the panel has the focus (context ui); the right arrow moves to the next piece, Enter takes it.
  await press(page, 'Tab');
  await expect(page.getByTestId('baumodus')).toHaveAttribute('data-katalog', '');
  const focused = page.locator('[data-fokus-sichtbar]');
  await expect(focused).toHaveAttribute('data-teil', 'wand_holz');
  await press(page, 'ArrowRight');
  const next = await focused.getAttribute('data-teil');
  expect(next).not.toBeNull();
  expect(next).not.toBe('wand_holz');
  await press(page, 'Enter');
  await expect(page.getByTestId('baumodus')).not.toHaveAttribute('data-katalog', '');
  await expect(page.getByTestId(`bau-teil-${next ?? ''}`)).toHaveAttribute('aria-pressed', 'true');
  // Q/E in the selection change the category.
  await press(page, 'Tab');
  await press(page, 'KeyE');
  await expect(page.getByTestId('bau-kategorie-tueren')).toHaveAttribute('aria-selected', 'true');
  await press(page, 'Escape');
  await expect(page.getByTestId('baumodus')).toBeVisible();
  await expect(page.getByTestId('baumodus')).not.toHaveAttribute('data-katalog', '');

  // Overlays: each marks the world and shows its legend; the same switch again turns it off.
  const expected: Record<string, (o: BuildingInfo['overlay']) => boolean> = {
    raeume: (o) => o.rooms >= 1 && o.tiles >= 9 && o.labels >= 2,
    temperatur: (o) => o.rooms >= 1 && o.tiles > 100,
    licht: (o) => o.tiles > 100,
    behaglichkeit: (o) => o.rooms >= 1 && o.labels >= 1,
    stuetzen: (o) => o.tiles >= 25,
  };
  for (const [kind, ok] of Object.entries(expected)) {
    await page.getByTestId(`bau-overlay-${kind}`).click();
    await expect(page.getByTestId(`bau-overlay-${kind}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bau-legende')).toHaveAttribute('data-overlay', kind);
    await page.waitForFunction((k) => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.overlay.kind === k, kind);
    await frames(page, 3);
    const o = (await building(page)).overlay;
    expect(ok(o), `${kind}: ${JSON.stringify(o)}`).toBe(true);
    if (kind === 'stuetzen') await page.screenshot({ path: 'shots/latest/e2e-baumodus-stuetzen.png' });
  }
  await page.getByTestId('bau-overlay-stuetzen').click();
  await expect(page.getByTestId('bau-legende')).toHaveCount(0);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.overlay.kind === null);
  expect(errors).toEqual([]);
});

test('Das Dach eines Innenraums blendet beim Betreten ganz aus und kehrt draußen zurück; hinter dem Haus öffnet es sich im Kreis um den Spieler', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['wand_holz', 20],
    ['tuer_holz', 1],
    ['dach_stroh', 25],
  ]);
  const { x0, y0 } = await findSite(page, 7, 9);
  // The hut stands in the middle of the site, the player south of it by the door.
  await teleport(page, x0 + 3, y0 + 7);
  await hut(page, x0 + 1, y0 + 1, 5);
  await frames(page, 30);
  let b = await building(page);
  expect(b.inside).toBe(false);
  expect(b.roofFade).toBe(0);
  expect(b.roofs).toBe(25);

  // Inside: the whole roof lifts (M4-27), the walls in front are cut.
  await teleport(page, x0 + 3, y0 + 3);
  await page.waitForFunction(() => {
    const bi = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building;
    return bi.inside && bi.roofFade === 1;
  });
  b = await building(page);
  expect(b.roofTiles).toBe(25);
  expect(b.cutWalls).toBeGreaterThan(0);
  await page.screenshot({ path: 'shots/latest/e2e-haus-innen.png' });

  // Outside again: the roof comes back.
  await teleport(page, x0 + 3, y0 + 7);
  await page.waitForFunction(() => {
    const bi = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building;
    return !bi.inside && bi.roofFade === 0;
  });
  expect((await building(page)).roofsInCircle).toBe(0);

  // Behind the house (north of it): the roof in front of the player opens in the circle around them.
  await teleport(page, x0 + 3, y0);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.roofsInCircle > 0);
  b = await building(page);
  expect(b.inside).toBe(false);
  expect(b.roofFade).toBe(0);
  await page.screenshot({ path: 'shots/latest/e2e-haus-dahinter.png' });
  expect(errors).toEqual([]);
});

/** Rows the visible children `sel` of the element `testId` take (a hidden hint has no box). */
function zeilen(page: Page, testId: string, sel: string): Promise<number> {
  return page.getByTestId(testId).evaluate((el, s) => new Set([...el.querySelectorAll(s)].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size, sel);
}

test('Werkzeuge: Abbauen binnen 30 s ganz, danach 60 %; Aufwerten Holz » Stein; Flächenreparatur mit dem Hammer nach einem Brand; eine Station aufheben', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  // No planks at the start: the late refund's plank is the only one the notifications name.
  await start(page, [
    ['wand_holz', 8],
    ['wand_stein', 1],
    ['werkbank', 1],
    ['steinhammer', 1],
  ]);
  const { x0, y0 } = await findSite(page, 9, 7);
  const spieler = [x0 + 4, y0 + 6] as const;
  const frisch = [x0 + 7, y0 + 1] as const;
  const alt = [x0 + 1, y0 + 1] as const;
  const stein = [x0 + 4, y0 + 1] as const;
  const brand = [
    [x0 + 1, y0 + 3],
    [x0 + 7, y0 + 3],
  ] as const;
  const station = [x0 + 4, y0 + 4] as const;
  await teleport(page, spieler[0], spieler[1]);
  // Three walls that will be older than the refund window (two of them burn first), one to upgrade.
  const placed = await events(page, 'partPlaced');
  for (const [tx, ty] of [alt, stein, ...brand]) await cmd(page, { type: 'build.place', part: 'wand_holz', tx, ty });
  await waitEvents(page, 'partPlaced', placed, 4);
  const gebaut = (await sim(page)).tick;

  await openBuildMode(page);
  await choose(page, 'waende', 'wand_holz');
  const root = page.getByTestId('baumodus');
  const status = page.getByTestId('bau-status');
  const hints = page.getByTestId('bau-hinweise');
  const vorrat = page.getByTestId('bau-vorrat');
  await expect(vorrat).toHaveText('4 dabei');
  await expect(root).toHaveAttribute('data-werkzeug', 'setzen');
  await expect(page.getByTestId('bau-werkzeug-setzen')).toHaveAttribute('aria-pressed', 'true');

  // The two lone walls burn (debug `fire.ignite`) as rain sets in; it puts them out before they burn down.
  const aus = await events(page, 'fireOut');
  const weg = await events(page, 'partRemoved');
  const beschaedigt = await events(page, 'partDamaged');
  for (const [tx, ty] of brand) await cmd(page, { type: 'fire.ignite', tx, ty });
  await cmd(page, { type: 'setWeather', state: 'regen' });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(8));
  await page.waitForFunction((b) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['fireOut'] ?? 0) >= b, aus + 2, { timeout: 60_000 });
  await cmd(page, { type: 'setWeather', state: 'klar' });
  // Past the full refund window of the walls built at the start (30 s of game time).
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t, gebaut + 31 * TICK_HZ, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(1));
  expect(await events(page, 'partRemoved')).toBe(weg);
  expect((await events(page, 'partDamaged')) - beschaedigt).toBeGreaterThanOrEqual(2);

  // Dismantle (2): a wall built just now comes back whole – the refund window counts down over the cursor.
  const neu = await events(page, 'partPlaced');
  await cmd(page, { type: 'build.place', part: 'wand_holz', tx: frisch[0], ty: frisch[1] });
  await waitEvents(page, 'partPlaced', neu);
  await expect(vorrat).toHaveText('3 dabei');
  await press(page, 'Digit2');
  await expect(root).toHaveAttribute('data-werkzeug', 'abbauen');
  await expect(page.getByTestId('bau-werkzeug-abbauen')).toHaveAttribute('aria-pressed', 'true');
  await expect(hints.locator('[data-aktion="attack"]')).toContainText('Abbauen');
  expect(await zeilen(page, 'bau-hinweise', ':scope > [data-aktion]')).toBe(1);
  let g = await pointAt(page, frisch[0], frisch[1]);
  expect(g).toMatchObject({ anchors: 1, ok: 1, reason: null });
  await expect(status).toHaveText(/^Holzwand abbauen – 100 % zurück \(noch \d+ s\)\.$/);
  let removed = await events(page, 'partRemoved');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partRemoved', removed);
  await expect(vorrat).toHaveText('4 dabei');
  // A wall older than 30 s: 60 % of its three planks, rounded down – one plank; the wall itself stays gone.
  g = await pointAt(page, alt[0], alt[1]);
  expect(g).toMatchObject({ anchors: 1, ok: 1, reason: null });
  await expect(status).toHaveText('Holzwand abbauen – 60 % zurück: 1× Brett.');
  removed = await events(page, 'partRemoved');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partRemoved', removed);
  await expect(page.getByTestId('hud-meldungen')).toContainText('Brett ×1');
  await expect(vorrat).toHaveText('4 dabei');

  // Upgrade (3) with the stone wall chosen: the plank wall turns to stone in place, the stone wall leaves the bags.
  await choose(page, 'waende', 'wand_stein');
  await page.getByTestId('bau-werkzeug-aufwerten').click();
  await expect(root).toHaveAttribute('data-werkzeug', 'aufwerten');
  await expect(vorrat).toHaveText('1 dabei');
  g = await pointAt(page, stein[0], stein[1]);
  expect(g).toMatchObject({ anchors: 1, ok: 1, reason: null });
  await expect(status).toHaveText('Holzwand » Steinwand – kostet 1× Steinwand; Holzwand: 60 % zurück: 1× Brett.');
  const upgraded = await events(page, 'partUpgraded');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partUpgraded', upgraded);
  await expect(vorrat).toHaveText('Keins dabei');
  await press(page, 'Digit2');
  await expect(status).toHaveText(/^Steinwand abbauen – /);

  // Repair (4): takes the stone hammer from the hotbar into the hand; the rectangle over both burned walls costs
  // planks; released, both are mended – nothing is left to repair.
  await cmd(page, { type: 'inventory.give', item: 'brett', count: 6 });
  let hammer = -1;
  for (let i = 0; i < 10 && hammer < 0; i++) {
    const label = await page.getByTestId(`hud-schnellleiste-${i}`).getAttribute('aria-label');
    if (label?.includes('Steinhammer') === true) hammer = i;
  }
  expect(hammer).toBeGreaterThanOrEqual(0);
  // Something else in the hand.
  await cmd(page, { type: 'player.selectHotbar', index: (hammer + 1) % 10 });
  await expect(page.getByTestId('hud-schnellleiste')).toHaveAttribute('data-auswahl', String((hammer + 1) % 10));
  await press(page, 'Digit4');
  await expect(root).toHaveAttribute('data-werkzeug', 'reparieren');
  await expect(status).toHaveText('Steinhammer in die Hand genommen – zieh eine Fläche, um sie zu reparieren.');
  await expect(page.getByTestId('hud-schnellleiste')).toHaveAttribute('data-auswahl', String(hammer));
  await expect(hints.locator('[data-aktion="attack"]')).toContainText('Fläche reparieren');
  await pointAt(page, brand[0][0], brand[0][1]);
  await page.mouse.down();
  await frames(page, 2);
  await pointAt(page, brand[1][0], brand[1][1]);
  await expect(status).toHaveText(/^2 beschädigte Teile reparieren – kostet \d+× Brett\.$/);
  const repaired = await events(page, 'partRepaired');
  await page.mouse.up();
  await waitEvents(page, 'partRepaired', repaired, 2);
  await expect(status).toHaveText('Nichts zu reparieren – hier ist alles heil.');
  // The text over the cursor follows with the next drawn frame.
  await frames(page, 3);
  await page.screenshot({ path: 'shots/latest/e2e-baumodus-reparieren.png' });

  // A station (1: placing) set up from the bags comes back whole with the dismantle tool.
  await press(page, 'Digit1');
  await choose(page, 'stationen', 'werkbank');
  await expect(root).toHaveAttribute('data-werkzeug', 'setzen');
  g = await pointAt(page, station[0], station[1]);
  expect(g).toMatchObject({ piece: 'werkbank', anchors: 1, ok: 1 });
  const stations = await events(page, 'stationPlaced');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'stationPlaced', stations);
  await expect(vorrat).toHaveText('Keins dabei');
  await press(page, 'Digit2');
  g = await pointAt(page, station[0], station[1]);
  expect(g).toMatchObject({ anchors: 1, ok: 1, reason: null });
  await expect(status).toHaveText(/^Werkbank abbauen – 100 % zurück \(noch \d+ s\)\.$/);
  const gone = await events(page, 'stationRemoved');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'stationRemoved', gone);
  await expect(vorrat).toHaveText('1 dabei');
  // A piece taken from the panel while dismantling returns to placing.
  await choose(page, 'waende', 'wand_holz');
  await expect(root).toHaveAttribute('data-werkzeug', 'setzen');
  expect(errors).toEqual([]);
});

test('Werkzeugleiste und Hinweiszeile bleiben je eine Zeile – 1280 × 720 und 1920 × 1080, Deutsch und Englisch', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  for (const locale of ['de-DE', 'en-US']) {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ]) {
      const ctx = await browser.newContext({ ...(baseURL === undefined ? {} : { baseURL }), locale, viewport });
      const page = await ctx.newPage();
      const errors = collectConsole(page);
      await start(page, []);
      await openBuildMode(page);
      const wo = `${locale} ${viewport.width}`;
      // Placing with each kind of piece (a line, a direction, mirrorable), then the other tools and the selection.
      for (const [kategorie, teil] of [
        ['waende', 'wand_holz'],
        ['tueren', 'tor_holz'],
        ['moebel', 'tisch_holz'],
      ] as const) {
        await choose(page, kategorie, teil);
        expect(await zeilen(page, 'bau-hinweise', ':scope > [data-aktion]'), `${wo} ${teil}`).toBe(1);
        // M5-37: while placing, the pipette (middle button) keeps its place – the line runs on under the panel
        // where the panel ends above it, and never overlaps the panel.
        await expect(page.getByTestId('bau-hinweise').locator('[data-aktion="pipette"]'), `${wo} ${teil}`).toBeVisible();
        const zeile = await page.getByTestId('bau-hinweise').boundingBox();
        const tafel = await page.getByTestId('bau-leiste').boundingBox();
        expect(zeile, `${wo} ${teil}`).not.toBeNull();
        expect(tafel, `${wo} ${teil}`).not.toBeNull();
        if (zeile !== null && tafel !== null && zeile.x + zeile.width > tafel.x) expect(zeile.y, `${wo} ${teil}: Hinweiszeile unter der Tafel`).toBeGreaterThanOrEqual(tafel.y + tafel.height);
      }
      for (const taste of ['Digit2', 'Digit3', 'Digit4', 'Digit1']) {
        await press(page, taste);
        expect(await zeilen(page, 'bau-hinweise', ':scope > [data-aktion]'), `${wo} ${taste}`).toBe(1);
        expect(await zeilen(page, 'bau-werkzeuge', 'button'), `${wo} ${taste}`).toBe(1);
        // The primary gesture never gives way.
        await expect(page.getByTestId('bau-hinweise').locator('[data-aktion="attack"]')).toBeVisible();
      }
      await press(page, 'Tab');
      expect(await zeilen(page, 'bau-hinweise', ':scope > [data-aktion]'), `${wo} Auswahl`).toBe(1);
      // The panel ends above the window's bottom edge.
      const panel = await page.getByTestId('bau-leiste').boundingBox();
      expect((panel?.y ?? 0) + (panel?.height ?? 0), wo).toBeLessThanOrEqual(viewport.height);
      expect(errors, wo).toEqual([]);
      await ctx.close();
    }
  }
});
