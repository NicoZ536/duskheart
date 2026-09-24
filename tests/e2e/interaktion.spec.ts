/**
 * M3-10 Interaktion im Browser (acceptance spec of M3-10): the player stands before something to gather on
 * the start beach (debug mode with `?spieler=1`); the target in reach carries the 1-px accent outline and
 * the marker "[E] Pflücken: …"; E acts in the tick after the frame that read it, holding it picks the
 * target by hand with the progress ring, the items fly out, land ("[E] Aufheben: … ×n" on the ground) and
 * the magnet puts them into the bags. Screenshots `interaktion-outline`, `interaktion-ring`,
 * `interaktion-aufheben` go to `shots/latest/` for review.
 *
 * The spot comes from the same world generated in Node (seed of the boot session, size Mittel): the
 * nearest scatter object that yields something in spring, with free ground below it and nothing else to
 * interact with around.
 */
import { expect, test, type Page } from '@playwright/test';
import { CONTENT } from '../../src/content/index';
import { BOOT_SESSION_SEED } from '../../src/game/session';
import { worldFor } from '../../src/game/worldCache';
import { isRipe } from '../../src/game/gathering/formulas';
import { BLOCK_ALL, CollisionGrid, infoLevel } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { worldDimensions } from '../../src/world/model/worldSize';

interface SimState {
  tick: number;
  queuedCommands: number;
  player: { x: number; y: number } | null;
  events: Record<string, number>;
}

interface GatheringInfo {
  focus: string;
  subject: string;
  working: boolean;
  progress: number;
  hint: string;
  drops: number;
  dropList: { item: string; count: number; x: number; y: number; flying: boolean }[];
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
  freezeTime(on: boolean): void;
  screenshotMode(on: boolean): void;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE_PX = 16;
const SEARCH_TILES = 90;

/** The nearest spring-ripe scatter object with free level ground below it and no other interactable around. */
function findTarget(): { tx: number; ty: number; id: string; name: string } {
  const world = worldFor(BOOT_SESSION_SEED, 'medium');
  const tiles = worldDimensions('medium').tiles;
  const perEdge = tiles / CHUNK_SIZE;
  const cache = new Map<number, ChunkData>();
  const chunks = {
    get: (layer: Layer, cx: number, cy: number): ChunkData | undefined => {
      if (cx < 0 || cy < 0 || cx >= perEdge || cy >= perEdge) return undefined;
      const key = packChunkId(layer, cx, cy);
      let c = cache.get(key);
      if (c === undefined) {
        c = generateChunk(world, layer, cx, cy);
        cache.set(key, c);
      }
      return c;
    },
  };
  const grid = new CollisionGrid({ chunks, worldTiles: tiles });
  const ids = contentWorldIdTables();
  const objects = CONTENT.collection('worldObjects');
  const objectAt = (x: number, y: number): string => {
    const c = chunks.get(0, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
    const r = c === undefined ? 0 : (c.object[(y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] as number);
    return r === 0 ? '' : ids.objects.stringId(r);
  };
  const interactable = (id: string): boolean => {
    if (id === '') return false;
    const o = objects.get(id);
    return (o.drops ?? []).length > 0 || o.tool !== 'hand';
  };
  const { x: sx, y: sy } = world.spawn;
  for (let r = 1; r < SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        const id = objectAt(x, y);
        if (id === '' || !(id.startsWith('deko_') || id.startsWith('pflanze_'))) continue;
        const o = objects.get(id);
        if (!isRipe(o.drops ?? [], 'abbau', 'fruehling')) continue;
        // The player stands two tiles below it (1,5 tiles from the feet to its edge: in reach, not hiding it).
        const stand = grid.tileInfo(0, x, y + 2);
        const between = grid.tileInfo(0, x, y + 1);
        const here = grid.tileInfo(0, x, y);
        if ((stand & BLOCK_ALL) !== 0 || (between & BLOCK_ALL) !== 0 || infoLevel(stand) !== infoLevel(here) || objectAt(x, y + 1) !== '' || objectAt(x, y + 2) !== '') continue;
        let alone = true;
        // Nothing else within reach of the standing tile (two tiles around it) competes for the focus.
        for (let oy = -1; oy <= 3 && alone; oy++) for (let ox = -2; ox <= 2 && alone; ox++) if ((ox !== 0 || oy !== 0) && interactable(objectAt(x + ox, y + oy))) alone = false;
        if (alone && o.tool === 'hand' && !o.blocking) return { tx: x, ty: y, id, name: o.name.de };
      }
    }
  }
  throw new Error(`Kein einzelnes Sammelziel im Umkreis von ${SEARCH_TILES} Kacheln um den Startstrand`);
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openGame(page: Page): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function gathering(page: Page): Promise<GatheringInfo> {
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: GatheringInfo }).gathering);
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

/** Close-up around the figure in the picture's centre [CSS px of the 1280 × 720 page]. */
const CLOSE_UP = { x: 520, y: 220, width: 240, height: 200 } as const;

/** Screenshots of the frozen view without HUD: `shots/latest/<name>.png` and the close-up `<name>-nah.png`; time stays frozen. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.screenshotMode(true));
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { terrain: { missing: number } }).terrain.missing === 0, undefined, { timeout: 30_000 });
  await frames(page, 3);
  await page.screenshot({ path: `shots/latest/${name}.png` });
  await page.screenshot({ path: `shots/latest/${name}-nah.png`, clip: CLOSE_UP });
  await page.evaluate(() => {
    const dh = (window as unknown as { __dh: Dh }).__dh;
    dh.screenshotMode(false);
    dh.freezeTime(true);
  });
}

/** Freezes the simulation as soon as `condition` (a function of the gathering info, as source) holds. */
async function freezeWhen(page: Page, condition: string): Promise<void> {
  await page.waitForFunction(`(() => { const g = window.__dh.call('worldInfo').gathering; if (!(${condition})(g)) return false; window.__dh.freezeTime(true); return true; })()`, undefined, { timeout: 30_000, polling: 'raf' });
}

test('Ziel in Reichweite: Umriss und Hinweis; E wirkt im nächsten Tick, sammelt mit Ring, Drops fliegen und der Magnet nimmt sie', async ({ page }) => {
  test.setTimeout(240_000);
  const msgs = collectConsole(page);
  const target = findTarget();
  await openGame(page);
  // The mouse stays off the canvas: only the target in reach is outlined.
  await page.mouse.move(0, 0);
  const x = target.tx * TILE_PX + TILE_PX / 2;
  const y = (target.ty + 2) * TILE_PX + TILE_PX / 2;
  await page.evaluate(([px, py]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x: px, y: py, layer: 0 }), [x, y] as const);
  await page.waitForFunction((id) => {
    const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: GatheringInfo }).gathering;
    return g.focus === 'object' && g.subject === id;
  }, target.id);
  const focused = await gathering(page);
  expect(focused.hint).toBe(`${target.id.startsWith('deko_') ? 'Aufsammeln' : 'Pflücken'}: ${target.name}`);
  await shot(page, 'interaktion-outline');

  // Frozen: the frame turns E into a queued command; nothing starts yet.
  const frozen = await sim(page);
  await page.keyboard.down('KeyE');
  await frames(page, 3);
  const queued = await sim(page);
  expect(queued.tick).toBe(frozen.tick);
  expect(queued.queuedCommands).toBeGreaterThanOrEqual(1);
  expect(queued.events['actionStarted'] ?? 0).toBe(frozen.events['actionStarted'] ?? 0);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  // The first tick applies it: the pick starts, the ring fills.
  await freezeWhen(page, '(g) => g.working && g.progress >= 0.4');
  const working = await sim(page);
  expect(working.events['actionStarted']).toBe((frozen.events['actionStarted'] ?? 0) + 1);
  await shot(page, 'interaktion-ring');
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  // The pick is done: leaves fly, the items pop out.
  await page.waitForFunction(
    (n) => {
      const dh = (window as unknown as { __dh: Dh }).__dh;
      if ((dh.state().sim.events['harvested'] ?? 0) <= n) return false;
      dh.freezeTime(true);
      return true;
    },
    frozen.events['harvested'] ?? 0,
    { polling: 'raf' },
  );
  await page.keyboard.up('KeyE');
  await frames(page, 2);
  expect((await page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: { particles: number } }).gathering.particles))).toBeGreaterThan(0);
  await shot(page, 'sammeln-partikel');
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  // The items fly out and land: "[E] Aufheben" over the drop until the magnet takes it. The player steps
  // right next to it while the simulation stands still, so it is in reach whatever way it flew.
  await freezeWhen(page, '(g) => g.dropList.length > 0 && g.dropList.every((d) => !d.flying)');
  const landed = (await gathering(page)).dropList[0] ?? { x: 0, y: 0 };
  if ((await gathering(page)).focus !== 'drop') {
    await page.evaluate(([px, py]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x: px, y: py, layer: 0 }), [landed.x + TILE_PX, landed.y] as const);
    await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
    await freezeWhen(page, "(g) => g.focus === 'drop'");
  }
  const lying = await gathering(page);
  expect(lying.hint).toMatch(/^Aufheben: /);
  expect(lying.drops).toBeGreaterThanOrEqual(1);
  await shot(page, 'interaktion-aufheben');
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['dropPickedUp'] ?? 0) > n, frozen.events['dropPickedUp'] ?? 0);
  const after = await sim(page);
  expect(after.events['itemsAdded'] ?? 0).toBeGreaterThan(frozen.events['itemsAdded'] ?? 0);
  expect(after.events['dropSpawned'] ?? 0).toBeGreaterThan(frozen.events['dropSpawned'] ?? 0);
  // The scatter is gone: nothing left to gather here.
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: GatheringInfo }).gathering.drops === 0);
  const gone = await gathering(page);
  expect(gone.subject === target.id && gone.focus === 'object').toBe(false);
  expect(msgs).toEqual([]);
});

test('E ohne Ziel in Reichweite wird abgelehnt; der Mauszeiger über einem Ziel zielt darauf', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  const target = findTarget();
  await openGame(page);
  // A few tiles further below, nothing is in reach: a tap on E is refused (a tap within one frame still counts).
  let empty = false;
  for (let k = 4; k < 12 && !empty; k++) {
    await page.evaluate(([px, py]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x: px, y: py, layer: 0 }), [target.tx * TILE_PX + TILE_PX / 2, (target.ty + k) * TILE_PX + TILE_PX / 2] as const);
    await frames(page, 4);
    empty = (await gathering(page)).focus === 'none';
  }
  expect(empty).toBe(true);
  const before = await sim(page);
  await page.keyboard.press('KeyE');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['commandRejected'] ?? 0) > n, before.events['commandRejected'] ?? 0);
  // Put the player below the target and point at it: the aim reaches the simulation.
  const x = target.tx * TILE_PX + TILE_PX / 2;
  const y = (target.ty + 2) * TILE_PX + TILE_PX / 2;
  await page.evaluate(([px, py]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x: px, y: py, layer: 0 }), [x, y] as const);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { follows: boolean; figure: [number, number] | null }).figure !== null);
  await frames(page, 5);
  const view = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { camera: [number, number] });
  const canvas = await page.evaluate(() => {
    const c = document.getElementById('dh-canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const render = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { viewport: { internalWidth: number; internalHeight: number; outX: number; outY: number; outWidth: number; outHeight: number } });
  const vp = render.viewport;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  // World px of the target's centre → internal px → device px → CSS px.
  const ix = target.tx * TILE_PX + TILE_PX / 2 - view.camera[0] + vp.internalWidth / 2;
  const iy = target.ty * TILE_PX + TILE_PX / 2 - view.camera[1] + vp.internalHeight / 2;
  const cssX = canvas.left + (vp.outX + (ix * vp.outWidth) / vp.internalWidth) / dpr;
  const cssY = canvas.top + (vp.outY + (iy * vp.outHeight) / vp.internalHeight) / dpr;
  await page.mouse.move(cssX, cssY);
  await page.waitForFunction(
    (t) => {
      const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { gathering: { aim: { tx: number; ty: number } | null } }).gathering;
      return g.aim !== null && g.aim.tx === t.tx && g.aim.ty === t.ty;
    },
    { tx: target.tx, ty: target.ty },
  );
  expect(msgs).toEqual([]);
});
