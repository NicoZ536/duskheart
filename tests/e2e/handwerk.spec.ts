/**
 * M4-32 and M4-08 in the browser: the crafting menu (C) over the running game and the recipe tracker of the HUD.
 * Items come from the game's content, put into the bags with the debug command `inventory.give`.
 *
 * - C opens and closes the menu, Esc closes it (without the pause menu); while it is open WASD moves the focus, not
 *   the player. The list shows the hand recipes whose ingredients the player owned once.
 * - Crafting fibre rope with the mouse: choose it, raise the quantity, "2 herstellen" – the queue shows the order,
 *   the rope arrives in the bags (inventory screen), the fibres are gone.
 * - Search and filter; a missing ingredient names how to get it ("Fehlt: 1× Faserseil – herstellbar ohne Station").
 * - Keyboard only: arrows walk the list, Enter chooses, Enter again jumps to "Herstellen", Enter crafts.
 * - Pinning (the game command `craft.pin`) shows the tracker right below the minimap with the missing ingredients live –
 *   it follows the bags (more on pins, their save and the item lookup: rezept-tracker.spec.ts).
 * No console errors or warnings.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null } };
  command(cmd: unknown): unknown;
  setSpeed(f: number): void;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

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

async function give(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  for (const [item, count] of items) await page.evaluate(([i, n]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'inventory.give', item: i, count: n }), [item, count] as const);
}

/** Boots the game with a player on the start beach and gives it `items`. */
async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await give(page, items);
}

function playerPos(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
}

async function open(page: Page): Promise<Locator> {
  await press(page, 'KeyC');
  const screen = page.getByTestId('ui-handwerk');
  await expect(screen).toBeVisible();
  return screen;
}

const row = (page: Page, id: string): Locator => page.getByTestId(`rezept-${id}`);

/** Pieces of `item` in the inventory screen's slots (opens and closes it with Tab). */
async function countInBags(page: Page, item: string): Promise<number> {
  await press(page, 'Tab');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  const n = await page.evaluate((id) => {
    let total = 0;
    for (const el of document.querySelectorAll(`[data-testid^="slot-"][data-item="${id}"]`)) {
      const count = el.querySelector('.dh-slot__anzahl')?.textContent ?? '1';
      total += Number(count);
    }
    return total;
  }, item);
  await press(page, 'Tab');
  await expect(page.getByTestId('ui-inventar')).toBeHidden();
  return n;
}

test('C öffnet und schließt das Handwerksmenü, Esc schließt es ohne Pausemenü; WASD bewegt dann nur den Fokus', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [['fasern', 9]]);
  const screen = await open(page);
  await expect(row(page, 'rezept_faserseil')).toBeVisible();
  // Rope needs three fibres: nine make three.
  await expect(row(page, 'rezept_faserseil')).toContainText('×3');
  // Recipes whose ingredients were never owned stay hidden (§15.1).
  await expect(row(page, 'rezept_steinaxt')).toHaveCount(0);
  const before = await playerPos(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  expect((await playerPos(page))?.x).toBeCloseTo(before?.x ?? 0, 3);
  await expect(page.locator('[data-fokus-sichtbar]')).toHaveCount(1);
  await press(page, 'KeyC');
  await expect(screen).toBeHidden();
  await open(page);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  await expect(page.getByTestId('ui-pause')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Faserseil herstellen: wählen, Menge, Herstellen – die Warteschlange arbeitet, das Seil landet in den Taschen', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [['fasern', 9]]);
  await open(page);
  await page.mouse.move(2, 2);
  await row(page, 'rezept_faserseil').click();
  await expect(page.getByTestId('handwerk-detail')).toHaveAttribute('data-rezept', 'rezept_faserseil');
  await page.getByTestId('handwerk-mehr').click();
  await expect(page.getByTestId('handwerk-menge')).toHaveAttribute('data-menge', '2');
  await expect(page.getByTestId('handwerk-herstellen')).toHaveText('2 herstellen');
  await page.getByTestId('handwerk-herstellen').click();
  // The order stands in the queue until its two pieces are done (1.5 s each).
  await expect(page.getByTestId('auftrag-0')).toHaveAttribute('data-rezept', 'rezept_faserseil');
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0, { timeout: 15_000 });
  await expect(row(page, 'rezept_faserseil')).toContainText('×1');
  await press(page, 'Escape');
  expect(await countInBags(page, 'faserseil')).toBe(2);
  expect(await countInBags(page, 'fasern')).toBe(3);
  expect(errors).toEqual([]);
});

test('Abbrechen erstattet, Suche und Filter, fehlende Zutat mit Lösungshinweis', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['fasern', 3],
    ['zweig', 2],
    ['stein', 2],
    ['faserseil', 1],
    ['harz', 1],
  ]);
  await open(page);
  await page.mouse.move(2, 2);
  // Search: umlauts and case folded; product names first.
  await page.getByTestId('handwerk-suche').fill('SEIL');
  await expect(page.locator('[data-testid^="rezept-"]').first()).toHaveAttribute('data-rezept', 'rezept_faserseil');
  await expect(row(page, 'rezept_steinaxt')).toBeVisible();
  await page.getByTestId('handwerk-suche').fill('axt');
  await expect(page.locator('[data-testid^="rezept-"]')).toHaveCount(1);
  await page.getByTestId('handwerk-suche').fill('');
  // Filter "Herstellbar" and back to "Alle".
  await page.getByTestId('handwerk-filter').locator('button').last().click();
  await expect(page.getByTestId('handwerk-filter')).toHaveAttribute('data-filter', 'herstellbar');
  await page.getByTestId('handwerk-filter').locator('button').first().click();
  await expect(page.getByTestId('handwerk-filter')).toHaveAttribute('data-filter', 'alle');
  // Two stone axes need two ropes: one is missing – and says how to get it.
  await row(page, 'rezept_steinaxt').click();
  await page.getByTestId('handwerk-mehr').click();
  await expect(page.getByTestId('handwerk-fehlt')).toContainText('Fehlt: 1× Faserseil – herstellbar ohne Station');
  await expect(page.getByTestId('handwerk-fehlt')).toContainText('Fehlt: 2× Zweig');
  await expect(page.getByTestId('handwerk-zutaten').locator('[data-zutat="faserseil"]')).toHaveAttribute('data-braucht', '2');
  // Refused: the hint line says why.
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('handwerk-hinweis')).toContainText('Dafür reichen die Zutaten nicht');
  // One axe is fine; cancelling it at once gives everything back.
  await page.getByTestId('handwerk-weniger').click();
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(0.05));
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('auftrag-0')).toBeVisible();
  await page.getByTestId('auftrag-abbrechen-0').click();
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(1));
  await press(page, 'Escape');
  expect(await countInBags(page, 'faserseil')).toBe(1);
  expect(await countInBags(page, 'stein')).toBe(2);
  expect(errors).toEqual([]);
});

test('Nur Tastatur: Pfeile wählen, Enter wählt, Enter springt zu Herstellen, Enter stellt her', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['fasern', 6],
    ['zweig', 1],
    ['harz', 1],
  ]);
  await open(page);
  // The focus frame starts on the first recipe of the list.
  const focused = page.locator('[data-fokus-sichtbar]');
  await expect(focused).toHaveAttribute('data-rezept', 'rezept_faserseil');
  await press(page, 'ArrowDown');
  await expect(focused).toHaveAttribute('data-rezept', 'rezept_fackel');
  await press(page, 'Enter');
  await expect(page.getByTestId('handwerk-detail')).toHaveAttribute('data-rezept', 'rezept_fackel');
  await press(page, 'Enter');
  await expect(focused).toHaveAttribute('data-testid', 'handwerk-herstellen');
  // Slowed down, the torch stays in the queue long enough to be seen there.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(0.2));
  await press(page, 'Enter');
  await expect(page.getByTestId('auftrag-0')).toHaveAttribute('data-rezept', 'rezept_fackel');
  // E/Q step the filter.
  await press(page, 'KeyE');
  await expect(page.getByTestId('handwerk-filter')).toHaveAttribute('data-filter', 'herstellbar');
  await press(page, 'KeyQ');
  await expect(page.getByTestId('handwerk-filter')).toHaveAttribute('data-filter', 'alle');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-handwerk')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Anheften zeigt den Tracker unter der Minimap mit den fehlenden Zutaten – live', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['fasern', 3],
    ['zweig', 2],
    ['stein', 1],
    ['faserseil', 1],
  ]);
  await expect(page.getByTestId('hud-tracker')).toHaveCount(0);
  await open(page);
  await page.mouse.move(2, 2);
  await row(page, 'rezept_steinaxt').click();
  await page.getByTestId('handwerk-anheften').click();
  await expect(page.getByTestId('handwerk-anheften')).toHaveAttribute('aria-pressed', 'true');
  await press(page, 'Escape');
  const tracker = page.getByTestId('hud-tracker');
  await expect(tracker).toBeVisible();
  const block = page.getByTestId('tracker-rezept_steinaxt');
  await expect(block).toContainText('Steinaxt');
  // One stone of two: missing, with where to find it.
  await expect(block.locator('[data-zutat="stein"]')).toContainText('1/2');
  await expect(block.locator('[data-zutat="stein"]')).toContainText('Sammeln in der Welt');
  await expect(block.locator('[data-zutat="zweig"]')).toHaveCount(0);
  // Below the minimap, at the right edge.
  const box = await tracker.boundingBox();
  const map = await page.locator('.dh-hud-minimap').boundingBox();
  expect(box !== null && map !== null && box.y >= map.y + map.height - 1 && box.x + box.width > 1200).toBe(true);
  // Live: another stone arrives – all at hand.
  await give(page, [['stein', 1]]);
  await expect(block.locator('[data-zutat="stein"]')).toHaveCount(0);
  await expect(block).toHaveAttribute('data-bereit', '');
  // The cross unpins.
  await page.getByTestId('tracker-loesen-rezept_steinaxt').click();
  await expect(tracker).toHaveCount(0);
  expect(errors).toEqual([]);
});
