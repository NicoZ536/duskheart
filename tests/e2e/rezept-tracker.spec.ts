/**
 * M4-08 in the browser (MASTERPROMPT §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten live. Für jedes Item
 * ‚Verwendet in' und ‚Herkunft' nachschlagbar"): the acceptance of the recipe tracker and the item lookup.
 *
 * - Pinning a recipe in the crafting menu (C) is the game command `craft.pin`: the pin shows in the list and in the
 *   HUD's tracker below the minimap, which names the missing ingredients and follows the bags live – items given
 *   (debug `inventory.give`) complete a plate, crafting takes items away again; the cross unpins.
 * - The pins are part of the save: "Speichern" in the pause menu writes them into the world's slot in IndexedDB, and
 *   that slot, loaded into a new game session (the browser gets its world selection with M7-50, so the load runs in
 *   Node with the same code), has them again – the crafting sample the tracker reads lists them.
 * - "Verwendet in" and "Herkunft": the tooltip of an ingredient and of the product in the recipe book (mouse and focus
 *   frame) and of a stack in the inventory names where an item comes from and what it goes into.
 * - "Nur am Wasser": the recipe book checks live whether water is within reach (filling a bucket) – at the start beach
 *   not, next to the nearest fresh water (found in the same world generated in Node) yes.
 * No console errors or warnings.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BALANCE } from '../../src/content/balance';
import { freshWaterWithin } from '../../src/game/crafting/formulas';
import { createCraftingSample } from '../../src/game/samples/werkstatt';
import { BOOT_SESSION_SEED, GameSession } from '../../src/game/session';
import type { SimConfig } from '../../src/game/sim';
import { worldFor } from '../../src/game/worldCache';
import { stableHash64 } from '../../src/save/canonical';
import { simulationRegistry } from '../../src/save/world';
import { BLOCK_ALL, CollisionGrid } from '../../src/world/collision/tiles';
import { generateChunk } from '../../src/world/gen/chunk';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, packChunkId, TILE_PX, type Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null } };
  command(cmd: unknown): unknown;
  setSpeed(f: number): void;
}

/** The world record and the main slot of the save in IndexedDB (what `loadWorld` reads). */
interface Saved {
  readonly world: { readonly id: string; readonly config: SimConfig };
  readonly slot: { readonly hash: string; readonly snapshot: { readonly participants: Record<string, { readonly version: number; readonly data: unknown }> } };
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

/** How far around the start beach fresh water is searched [tiles]. */
const SEARCH_TILES = 120;

/** The centre of the nearest free tile with fresh water within the reach of crafting (the world of the boot session). */
function findFreshWater(): { x: number; y: number } {
  const world = worldFor(BOOT_SESSION_SEED, 'medium');
  const edge = worldDimensions('medium').tiles / CHUNK_SIZE;
  const cache = new Map<number, ChunkData>();
  const get = (layer: Layer, cx: number, cy: number): ChunkData | undefined => {
    if (cx < 0 || cy < 0 || cx >= edge || cy >= edge) return undefined;
    const key = packChunkId(layer, cx, cy);
    let c = cache.get(key);
    if (c === undefined) {
      c = generateChunk(world, layer, cx, cy);
      cache.set(key, c);
    }
    return c;
  };
  const grid = new CollisionGrid({ chunks: { get }, worldTiles: worldDimensions('medium').tiles });
  const water = (tx: number, ty: number): number => {
    const c = get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return c === undefined ? 0 : (c.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  };
  const reach = BALANCE.crafting.waterReachTiles * TILE_PX;
  const { x: sx, y: sy } = world.spawn;
  for (let r = 0; r < SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = sx + dx;
        const ty = sy + dy;
        if ((grid.tileInfo(0, tx, ty) & BLOCK_ALL) !== 0) continue;
        const x = (tx + 0.5) * TILE_PX;
        const y = (ty + 0.5) * TILE_PX;
        if (freshWaterWithin(x, y, reach, water)) return { x, y };
      }
    }
  }
  throw new Error(`Kein Süßwasser im Umkreis von ${SEARCH_TILES} Kacheln um den Startstrand`);
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

/** Presses `key` and waits two rendered frames (the input is read once per frame). */
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function command(page: Page, cmd: unknown): Promise<unknown> {
  return page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

async function give(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  for (const [item, count] of items) await command(page, { type: 'inventory.give', item, count });
}

/** Boots the game with a player on the start beach and gives it `items`. */
async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await give(page, items);
}

async function open(page: Page): Promise<Locator> {
  await press(page, 'KeyC');
  const screen = page.getByTestId('ui-handwerk');
  await expect(screen).toBeVisible();
  await page.mouse.move(2, 2);
  return screen;
}

const row = (page: Page, id: string): Locator => page.getByTestId(`rezept-${id}`);

/** The world record and the main slot of the only world in the page's save database. */
function readSave(page: Page): Promise<Saved> {
  return page.evaluate(
    () =>
      new Promise<Saved>((resolve, reject) => {
        const req = indexedDB.open('duskhearth');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['worlds', 'slots'], 'readonly');
          const worlds = tx.objectStore('worlds').getAll();
          const slots = tx.objectStore('slots').getAll();
          tx.oncomplete = () => {
            const world = (worlds.result as Saved['world'][])[0];
            const slot = (slots.result as Array<Saved['slot'] & { worldId: string; slot: string }>).find((s) => s.worldId === world?.id && s.slot === 'main');
            db.close();
            if (world === undefined || slot === undefined) reject(new Error('no saved world'));
            else resolve({ world, slot });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('Anheften im Handwerksmenü: der Tracker zeigt fehlende Zutaten live – und der Spielstand behält die Nadel', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectConsole(page);
  await start(page, [
    ['fasern', 3],
    ['zweig', 3],
    ['stein', 1],
    ['faserseil', 1],
    ['harz', 1],
  ]);
  await expect(page.getByTestId('hud-tracker')).toHaveCount(0);
  await open(page);
  await row(page, 'rezept_steinaxt').click();
  await page.getByTestId('handwerk-anheften').click();
  // The pin comes back from the simulation (craft.pin), with the next sample.
  await expect(page.getByTestId('handwerk-anheften')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'rezept_steinaxt').locator('.dh-hw__zeile-nadel')).toHaveCount(1);
  await row(page, 'rezept_fackel').click();
  await page.getByTestId('handwerk-anheften').click();
  await expect(row(page, 'rezept_fackel').locator('.dh-hw__zeile-nadel')).toHaveCount(1);
  await press(page, 'Escape');

  const axt = page.getByTestId('tracker-rezept_steinaxt');
  const fackel = page.getByTestId('tracker-rezept_fackel');
  await expect(page.getByTestId('hud-tracker')).toBeVisible();
  // One stone of two: missing, with where to find it; the torch has all it needs.
  await expect(axt.locator('[data-zutat="stein"]')).toContainText('1/2');
  await expect(axt.locator('[data-zutat="stein"]')).toContainText('Sammeln in der Welt');
  await expect(axt).not.toHaveAttribute('data-bereit', '');
  await expect(fackel).toHaveAttribute('data-bereit', '');
  // Live: the missing stone arrives – the axe is ready.
  await give(page, [['stein', 1]]);
  await expect(axt.locator('[data-zutat="stein"]')).toHaveCount(0);
  await expect(axt).toHaveAttribute('data-bereit', '');
  // Live the other way: a torch made takes the resin – now the torch plate misses it.
  await open(page);
  await row(page, 'rezept_fackel').click();
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0, { timeout: 15_000 });
  await press(page, 'Escape');
  await expect(fackel.locator('[data-zutat="harz"]')).toContainText('0/1');
  await expect(fackel).not.toHaveAttribute('data-bereit', '');

  // Saving writes the pins into the world's slot.
  await press(page, 'Escape');
  await page.getByTestId('pause-speichern').click();
  await expect(page.getByTestId('pause-status')).toHaveText(/^Gespeichert: Tag 1, \d\d:\d\d$/, { timeout: 30_000 });
  const saved = await readSave(page);
  expect(stableHash64(saved.slot.snapshot)).toBe(saved.slot.hash);
  expect(saved.slot.snapshot.participants['crafting']?.data).toMatchObject({ angeheftet: ['rezept_steinaxt', 'rezept_fackel'] });
  // Loaded into a new game session, the crafting sample the tracker reads lists the pins again.
  const loaded = new GameSession({ config: saved.world.config });
  simulationRegistry(loaded.sim).deserializeAll(saved.slot.snapshot);
  const sample = createCraftingSample();
  expect(loaded.sampleCrafting(sample)).toBe(true);
  expect(sample.angeheftet).toEqual(['rezept_steinaxt', 'rezept_fackel']);
  expect(sample.sichtbar.has('rezept_steinaxt')).toBe(true);
  await press(page, 'Escape');

  // The cross unpins.
  await page.getByTestId('tracker-loesen-rezept_steinaxt').click();
  await expect(axt).toHaveCount(0);
  await page.getByTestId('tracker-loesen-rezept_fackel').click();
  await expect(page.getByTestId('hud-tracker')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('„Verwendet in“ und „Herkunft“: Tooltip der Zutaten und des Erzeugnisses im Rezeptbuch und im Inventar', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['stein', 2],
    ['zweig', 2],
    ['faserseil', 1],
    ['holz', 3],
  ]);
  await open(page);
  await row(page, 'rezept_steinaxt').click();
  const tip = page.getByTestId('ui-tooltip');
  await page.getByTestId('handwerk-zutaten').locator('[data-zutat="stein"]').hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator('.dh-tooltip__titel')).toHaveText('Stein');
  await expect(tip).toContainText('Herkunft');
  await expect(tip).toContainText('Sammeln in der Welt:');
  await expect(tip).toContainText('Verwendet in');
  await expect(tip).toContainText('Zutat: Steinaxt');
  await expect(tip).toContainText('Reparatur');
  // The product: made without a station, used as a tool.
  await page.getByTestId('handwerk-produkt').hover();
  await expect(tip.locator('.dh-tooltip__titel')).toHaveText('Steinaxt');
  await expect(tip).toContainText('Herstellen: Ohne Station');
  await expect(tip).toContainText('Werkzeug');
  await page.mouse.move(2, 2);
  await expect(tip).toHaveCount(0);
  // The focus frame on an ingredient shows its tooltip as well (keyboard, controller).
  await press(page, 'Enter');
  for (let i = 0; i < 6 && (await page.locator('[data-fokus-sichtbar][data-tipp-item]').count()) === 0; i++) await press(page, 'ArrowRight');
  const fokus = page.locator('[data-fokus-sichtbar][data-tipp-item]');
  await expect(fokus).toHaveCount(1);
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Herkunft');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-handwerk')).toBeHidden();

  // The inventory: wood burns in the fires and goes into planks through "Bauholz".
  await press(page, 'Tab');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  await page.locator('[data-testid^="slot-"][data-item="holz"]').first().hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Brennt 45 s in Lagerfeuer');
  await expect(tip).toContainText('Sammeln in der Welt:');
  await expect(tip).toContainText('Brennstoff');
  await expect(tip).toContainText(/Zutat: .*und \d+ weitere/);
  await press(page, 'Tab');
  expect(errors).toEqual([]);
});

test('Eimer füllen: das Rezeptbuch prüft live, ob Wasser in Reichweite ist', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectConsole(page);
  const wasser = findFreshWater();
  await start(page, [['holzeimer', 1]]);
  await open(page);
  await row(page, 'rezept_holzeimer_wasser').click();
  const zeile = page.getByTestId('handwerk-wasser');
  await expect(zeile).toHaveText('Nur am Wasser: Fluss, See, Quelle');
  await expect(zeile).not.toHaveAttribute('data-am-wasser', '');
  await expect(page.getByTestId('handwerk-herstellen')).toHaveClass(/dh-hw__herstellen--matt/);
  // Next to fresh water (while the menu stays open): the line turns.
  await command(page, { type: 'player.teleport', x: wasser.x, y: wasser.y, layer: 0 });
  await expect(zeile).toHaveAttribute('data-am-wasser', '', { timeout: 30_000 });
  await expect(zeile).toHaveText('Wasser in Reichweite');
  await expect(page.getByTestId('handwerk-herstellen')).not.toHaveClass(/dh-hw__herstellen--matt/);
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('handwerk-hinweis')).not.toHaveAttribute('role', 'alert');
  expect(errors).toEqual([]);
});
