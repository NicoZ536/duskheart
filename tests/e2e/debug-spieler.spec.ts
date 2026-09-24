/**
 * M3-35 in the browser: the debug console's player commands, each checked through `__dh` – `give` puts
 * items into the bags, `speed` changes the loop's tempo, `tp` moves the player, `kill` puts the light out
 * (the death screen shows), `god` keeps bleeding from hurting, `noclip` walks the player into deep water
 * without swimming, `unlock` raises every skill; and the entity inspector: Alt + click on the player opens
 * the panel with the player's components, `inspect an` makes a plain click pick, the panel follows live
 * values and closes with Esc. No console errors or warnings.
 *
 * The shore for `noclip` comes from the same world generated in Node (seed of the boot session, size
 * Mittel): the nearest dry tile with three tiles of deep water to its north.
 */
import { expect, test, type Page } from '@playwright/test';
import { BOOT_SESSION_SEED } from '../../src/game/session';
import { worldFor } from '../../src/game/worldCache';
import { BLOCK_ALL, BLOCK_DEEP_WATER, CollisionGrid, infoLevel } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';

interface PlayerState {
  x: number;
  y: number;
  health: number;
  state: string;
  swimming: boolean;
}
interface SimState {
  tick: number;
  player: PlayerState | null;
  events: Record<string, number>;
  cheats: { god: boolean; noclip: boolean };
}
interface Inspected {
  entity: number;
  components: { name: string; fields: [string, string][] }[];
}
interface Dh {
  ready: boolean;
  speed: number;
  exec(line: string): string;
  command(cmd: unknown): unknown;
  state(): { sim: SimState };
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE_PX = 16;
/** How far around the start beach the shore for `noclip` is searched [tiles]. */
const SEARCH_TILES = 120;

/** A dry shore tile with three tiles of deep water to its north (the world of the boot session). */
function findShore(): { x: number; y: number } {
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
  const { x: sx, y: sy } = world.spawn;
  for (let r = 1; r < SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        const info = grid.tileInfo(0, x, y);
        if ((info & BLOCK_ALL) !== 0) continue;
        const deep = [1, 2, 3].every((k) => (grid.tileInfo(0, x, y - k) & BLOCK_ALL) === BLOCK_DEEP_WATER);
        if (deep && infoLevel(grid.tileInfo(0, x, y - 1)) === infoLevel(info)) return { x, y };
      }
    }
  }
  throw new Error(`Kein Ufer im Umkreis von ${SEARCH_TILES} Kacheln um den Startstrand`);
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
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

async function openWithPlayer(page: Page): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
}

test('Konsole: give, speed, tp und kill wirken über Game-Commands', async ({ page }) => {
  test.setTimeout(120_000);
  const msgs = collectConsole(page);
  await openWithPlayer(page);
  expect(await exec(page, 'give feuerstein 3')).toBe('Feuerstein ×3 in die Taschen gelegt.');
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['itemsAdded'] ?? 0) >= 1);
  expect(await exec(page, 'give feuersten')).toBe('Unbekannter Gegenstand „feuersten“. Meintest du „feuerstein“?');

  expect(await exec(page, 'speed 2')).toBe('Tempo ×2');
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.speed)).toBe(2);
  expect(await exec(page, 'speed 1')).toBe('Tempo ×1');

  const before = await sim(page);
  const tx = Math.floor((before.player?.x ?? 0) / TILE_PX) + 3;
  const ty = Math.floor((before.player?.y ?? 0) / TILE_PX);
  expect(await exec(page, `tp ${tx} ${ty}`)).toBe(`Teleport nach (${tx}, ${ty}) auf Ebene 0.`);
  await page.waitForFunction(([x]) => Math.floor(((window as unknown as { __dh: Dh }).__dh.state().sim.player?.x ?? 0) / 16) === x, [tx] as const);

  expect(await exec(page, 'kill')).toBe('Das Licht des Spielers erlischt.');
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['playerDied'] ?? 0) >= 1);
  expect((await sim(page)).player?.health).toBe(0);
  // The death screen of the running game shows (M3-26).
  await expect(page.getByTestId('todesbildschirm')).toBeVisible();
  await expect(page.getByTestId('tod-titel')).toHaveText('Dein Licht ist erloschen.');
  expect(msgs).toEqual([]);
});

test('Konsole: god, noclip und unlock wirken über Game-Commands', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  const shore = findShore();
  await openWithPlayer(page);

  // god: three bleeding wounds do nothing; without god they hurt.
  expect(await exec(page, 'god an')).toBe('Gott-Modus an: kein Schaden.');
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.cheats.god);
  await page.evaluate(() => {
    const api = (window as unknown as { __dh: Dh }).__dh;
    for (let i = 0; i < 3; i++) api.command({ type: 'conditions.apply', id: 'blutung' });
  });
  expect(await exec(page, 'speed 8')).toBe('Tempo ×8');
  const bleeding = await sim(page);
  // 10 s of game time at ×8: three wounds would take 15 HP (0,5 HP/s each).
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 600, bleeding.tick);
  expect((await sim(page)).player?.health).toBe(100);
  expect((await sim(page)).events['playerAfflicted'] ?? 0).toBe(0);
  expect(await exec(page, 'god')).toBe('Gott-Modus aus.');
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.player?.health ?? 100) < 100);
  expect(await exec(page, 'speed 1')).toBe('Tempo ×1');
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'conditions.cure', id: 'blutung' }));

  // noclip: from the shore north into deep water – walking, not swimming; without noclip the water carries.
  expect(await exec(page, 'noclip an')).toBe('Noclip an: Nichts hält dich auf.');
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.cheats.noclip);
  await page.evaluate(([x, y]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x, y, layer: 0 }), [shore.x * TILE_PX + TILE_PX / 2, shore.y * TILE_PX + TILE_PX / 2] as const);
  await page.waitForFunction((y) => Math.floor(((window as unknown as { __dh: Dh }).__dh.state().sim.player?.y ?? 0) / 16) === y, shore.y);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((y) => ((window as unknown as { __dh: Dh }).__dh.state().sim.player?.y ?? Infinity) < (y - 2) * 16, shore.y);
  const inWater = await sim(page);
  expect(inWater.player?.state).toBe('walk');
  expect(inWater.player?.swimming).toBe(false);
  await page.keyboard.up('KeyW');
  expect(await exec(page, 'noclip aus')).toBe('Noclip aus.');
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player?.swimming === true);

  // unlock: every skill at level 100, its perk choices open.
  const opened = (await sim(page)).events['perkChoiceOpened'] ?? 0;
  expect(await exec(page, 'unlock')).toBe('Alle Fertigkeiten auf Stufe 100 – die Talentwahlen sind offen.');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['perkChoiceOpened'] ?? 0) >= n + 36, opened);
  expect(await exec(page, 'unlock zauberei')).toContain('Unbekannte Fertigkeit „zauberei“.');
  expect(msgs).toEqual([]);
});

test('Entitäts-Inspektor: Alt + Klick auf den Spieler zeigt seine Komponenten, live; Esc schließt', async ({ page }) => {
  test.setTimeout(120_000);
  const msgs = collectConsole(page);
  await openWithPlayer(page);
  const canvas = page.locator('#dh-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Leinwand fehlt');
  // The camera follows the player: the figure stands in the middle of the view (feet at the centre).
  const scale = box.height / 270;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 - 10 * scale };
  // A plain click does not inspect while the inspector is off.
  await page.mouse.click(at.x, at.y);
  expect(await dh<Inspected | null>(page, 'inspected')).toBeNull();
  await page.keyboard.down('Alt');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Alt');
  const panel = page.getByTestId('entitaets-inspektor');
  await expect(panel).toBeVisible();
  const inspected = await dh<Inspected>(page, 'inspected');
  expect(inspected.components.map((c) => c.name)).toEqual(expect.arrayContaining(['position', 'player', 'vitals']));
  await expect(panel.locator('[data-komponente="vitals"]')).toContainText('health');
  // Live: the satiety falls with time, the panel follows.
  const satiety = (i: Inspected): string => i.components.find((c) => c.name === 'vitals')?.fields.find(([k]) => k === 'satiety')?.[1] ?? '';
  const first = satiety(inspected);
  await exec(page, 'speed 8');
  await page.waitForFunction((s) => {
    const i = (window as unknown as { __dh: Dh }).__dh.call('inspected') as Inspected | null;
    return i !== null && i.components.find((c) => c.name === 'vitals')?.fields.find(([k]) => k === 'satiety')?.[1] !== s;
  }, first);
  await exec(page, 'speed 1');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // `inspect an`: a plain click picks.
  expect(await exec(page, 'inspect an')).toBe('Inspektor an: Klick auf eine Entität.');
  await page.mouse.click(at.x, at.y);
  await expect(panel).toBeVisible();
  expect((await dh<Inspected>(page, 'inspected')).entity).toBe(inspected.entity);
  // Clicking empty ground (left of the player, clear of the HUD) finds nothing and closes the panel.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
  expect(await dh<Inspected | null>(page, 'inspected')).toBeNull();
  expect(await exec(page, 'inspect aus')).toBe('Inspektor aus.');
  expect(msgs).toEqual([]);
});
