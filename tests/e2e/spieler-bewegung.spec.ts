/**
 * M3-08/M3-09 in the browser: the player appears on the start beach of the session's world (debug mode
 * with `?spieler=1`, as the game does without debug mode), WASD steers it through game commands – the
 * input of a frame acts in the very next simulation tick –, the game view's camera follows it, and the
 * world's collision holds: walking north into a cliff face stops the player at the face, walking into
 * deep water turns the walk into swimming at 2,5 tiles/s (M3-09: deep water is swum, not a wall).
 *
 * The spots come from the same world generated in Node (seed of the boot session, size Mittel): the
 * nearest cliff face with free ground below it and the nearest shore with deep water to its north.
 * Screenshots of the beach, the cliff and the swimmer go to `shots/latest/` for review.
 */
import { expect, test, type Page } from '@playwright/test';
import { BOOT_SESSION_SEED } from '../../src/game/session';
import { worldFor } from '../../src/game/worldCache';
import { BLOCK_ALL, BLOCK_DEEP_WATER, BLOCK_WALL, CollisionGrid, infoLevel, infoWallTop } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';

interface PlayerState {
  entity: number;
  x: number;
  y: number;
  layer: number;
  level: number;
  state: string;
  stateSince: number;
  swimming: boolean;
  vx: number;
  vy: number;
  health: number;
}

interface SimState {
  tick: number;
  queuedCommands: number;
  controlled: { entity: number; x: number; y: number } | null;
  player: PlayerState | null;
}

interface GameViewInfo {
  follows: boolean;
  figure: [number, number] | null;
  camera: [number, number];
  terrain: { missing: number };
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
/** Collision radius of the player [px] (`BALANCE.player.movement.colliderRadiusPx`). */
const RADIUS = 5;
const SEARCH_TILES = 120;

/** A cliff face tile with free level ground below it, and a dry shore tile with deep water to its north. */
function findSpots(): { cliff: { x: number; y: number; foot: number }; shore: { x: number; y: number } } {
  const world = worldFor(BOOT_SESSION_SEED, 'medium');
  const chunksPerEdge = worldDimensions('medium').tiles / CHUNK_SIZE;
  const cache = new Map<number, ChunkData>();
  const chunks = {
    get: (layer: Layer, cx: number, cy: number): ChunkData | undefined => {
      if (cx < 0 || cy < 0 || cx >= chunksPerEdge || cy >= chunksPerEdge) return undefined;
      const key = packChunkId(layer, cx, cy);
      let c = cache.get(key);
      if (c === undefined) {
        c = generateChunk(world, layer, cx, cy);
        cache.set(key, c);
      }
      return c;
    },
  };
  const grid = new CollisionGrid({ chunks, worldTiles: worldDimensions('medium').tiles });
  const free = (x: number, y: number): number => {
    const info = grid.tileInfo(0, x, y);
    return (info & BLOCK_ALL) === 0 ? infoLevel(info) : -1;
  };
  let cliff: { x: number; y: number; foot: number } | null = null;
  let shore: { x: number; y: number } | null = null;
  const { x: sx, y: sy } = world.spawn;
  for (let r = 1; r < SEARCH_TILES && (cliff === null || shore === null); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        const info = grid.tileInfo(0, x, y);
        if (cliff === null && (info & BLOCK_ALL) === BLOCK_WALL) {
          const foot = free(x, y + 1);
          if (foot >= 0 && free(x, y + 2) === foot && free(x, y + 3) === foot && infoWallTop(info) > foot) cliff = { x, y, foot };
        }
        if (shore === null && (info & BLOCK_ALL) === 0 && free(x, y + 1) === infoLevel(info)) {
          const deep = [1, 2, 3].every((k) => (grid.tileInfo(0, x, y - k) & BLOCK_ALL) === BLOCK_DEEP_WATER);
          if (deep && infoLevel(grid.tileInfo(0, x, y - 1)) === infoLevel(info)) shore = { x, y };
        }
      }
    }
  }
  if (cliff === null || shore === null) throw new Error(`Keine Klippe/kein Ufer im Umkreis von ${SEARCH_TILES} Kacheln um den Startstrand`);
  return { cliff, shore };
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
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function view(page: Page): Promise<GameViewInfo> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('worldInfo') as GameViewInfo);
}

/** Waits until `pred(player, arg)` holds (evaluated in the page every frame; `arg` travels as JSON). */
async function waitPlayer<A>(page: Page, pred: (p: PlayerState, s: SimState, arg: A) => boolean, arg?: A, timeout = 60_000): Promise<SimState> {
  await page.waitForFunction(`(() => { const s = window.__dh.state().sim; return s.player !== null && (${pred.toString()})(s.player, s, ${JSON.stringify(arg ?? null)}); })()`, undefined, { timeout });
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

/** Puts the player on the centre of tile (tx, ty) and waits until it stands there. */
async function teleport(page: Page, tx: number, ty: number): Promise<SimState> {
  const x = tx * TILE_PX + TILE_PX / 2;
  const y = ty * TILE_PX + TILE_PX / 2;
  await page.evaluate(([px, py]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x: px, y: py, layer: 0 }), [x, y] as const);
  return waitPlayer(page, (p, _s, at) => p.x === at[0] && p.y === at[1], [x, y]);
}

/** Close-up around the figure in the picture's centre [CSS px of the 1280 × 720 page]. */
const CLOSE_UP = { x: 560, y: 260, width: 160, height: 160 } as const;

/** Screenshots of the view without HUD for review: `shots/latest/<name>.png` and the close-up `<name>-nah.png`. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.screenshotMode(true));
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as GameViewInfo).terrain.missing === 0, undefined, { timeout: 30_000 });
  await frames(page, 3);
  await page.screenshot({ path: `shots/latest/${name}.png` });
  await page.screenshot({ path: `shots/latest/${name}-nah.png`, clip: CLOSE_UP });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.screenshotMode(false));
}

/** Freezes the simulation as soon as the player is in `state`, takes the screenshots and lets it run on. */
async function shotInState(page: Page, state: string, name: string): Promise<void> {
  await page.waitForFunction(`(() => { const s = window.__dh.state().sim; if (s.player === null || s.player.state !== ${JSON.stringify(state)}) return false; window.__dh.freezeTime(true); return true; })()`, undefined, { timeout: 60_000, polling: 'raf' });
  await shot(page, name);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
}

test('der Spieler erscheint am Startstrand; WASD wirkt im nächsten Tick, die Kamera folgt', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await openGame(page);
  const start = await waitPlayer(page, () => true);
  const player = start.player as PlayerState;
  const points = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('worldPoints') as { spawn: { tx: number; ty: number } });
  // On a free tile of the start beach, the camera on the player, the input steers the player.
  expect(Math.hypot(Math.floor(player.x / TILE_PX) - points.spawn.tx, Math.floor(player.y / TILE_PX) - points.spawn.ty)).toBeLessThanOrEqual(24);
  expect(start.controlled?.entity).toBe(player.entity);
  const v0 = await view(page);
  expect(v0.follows).toBe(true);
  await shot(page, 'spieler-strand');

  // Frozen simulation: the frame turns D into a queued command, nothing moves yet.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  const frozen = await sim(page);
  const x0 = (frozen.player as PlayerState).x;
  await page.keyboard.down('KeyD');
  await frames(page, 3);
  const queued = await sim(page);
  expect(queued.tick).toBe(frozen.tick);
  expect(queued.player?.x).toBe(x0);
  expect(queued.queuedCommands).toBeGreaterThanOrEqual(1);
  // The first tick after the freeze applies it: the player walks from exactly that tick on.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  const walking = await waitPlayer(page, (p, _s, x) => p.x > x + 2 * 16, x0);
  expect(walking.player?.state).toBe('walk');
  expect(walking.player?.stateSince).toBe(frozen.tick);
  expect(walking.player?.y).toBe(player.y);
  const v1 = await view(page);
  expect(v1.follows).toBe(true);
  expect(Math.abs((v1.figure?.[0] ?? 0) - (walking.player?.x ?? 0))).toBeLessThan(16);
  await shotInState(page, 'walk', 'spieler-gehen');
  // Space rolls towards the held direction; Shift sprints.
  await page.keyboard.down('Space');
  await shotInState(page, 'roll', 'spieler-rolle');
  await page.keyboard.up('Space');
  await page.keyboard.down('ShiftLeft');
  await shotInState(page, 'sprint', 'spieler-rennen');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyD');
  await waitPlayer(page, (p) => p.state === 'idle');
  expect(msgs).toEqual([]);
});

test('eine Klippenwand hält den Spieler auf, tiefes Wasser lässt ihn schwimmen', async ({ page }) => {
  test.setTimeout(240_000);
  const msgs = collectConsole(page);
  const { cliff, shore } = findSpots();
  await openGame(page);
  await waitPlayer(page, () => true);

  // Three tiles below a cliff face, walking north: the face stops the circle at its lower edge.
  const below = await teleport(page, cliff.x, cliff.y + 3);
  await page.keyboard.down('KeyW');
  const stopY = (cliff.y + 1) * TILE_PX + RADIUS;
  await waitPlayer(page, (p, s, a) => s.tick > a.tick + 60 && Math.abs(p.y - a.stopY) < 0.1, { tick: below.tick, stopY });
  const blocked = await waitPlayer(page, (_p, s, t) => s.tick > t + 60, (await sim(page)).tick);
  expect(blocked.player?.y).toBeCloseTo(stopY, 1);
  expect(blocked.player?.x).toBe(cliff.x * TILE_PX + TILE_PX / 2);
  expect(blocked.player?.level).toBe(cliff.foot);
  expect(blocked.player?.state).toBe('walk');
  await shot(page, 'spieler-klippe');
  await page.keyboard.up('KeyW');

  // From a shore tile north into deep water: the walk becomes a swim at 2,5 tiles/s.
  await teleport(page, shore.x, shore.y);
  await page.keyboard.down('KeyW');
  const swimming = await waitPlayer(page, (p) => p.state === 'swim');
  const later = await waitPlayer(page, (_p, s, t) => s.tick > t + 20, swimming.tick);
  const p = later.player as PlayerState;
  expect(p.swimming).toBe(true);
  expect(Math.hypot(p.vx, p.vy) / TILE_PX).toBeCloseTo(2.5, 1);
  expect(p.y).toBeLessThan(shore.y * TILE_PX);
  await page.keyboard.up('KeyW');
  await waitPlayer(page, (q) => q.state === 'swim' && q.vx === 0 && q.vy === 0);
  await shot(page, 'spieler-schwimmen');
  expect(msgs).toEqual([]);
});
