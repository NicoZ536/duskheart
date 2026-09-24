/**
 * M3-30 in the browser: the inventory, equipment and stats screen (Tab/I) over the running game.
 * Items come from the game's content, put into the bags with the debug command `inventory.give`.
 *
 * - Tab and I open and close the screen, Esc closes it (without opening the pause menu); while it is
 *   open, WASD moves the focus, not the player.
 * - Pointer comfort (§26): drag & drop moves, Shift+click moves to the hotbar, right click splits,
 *   double click gathers the halves again, a number key over a slot puts its stack on the hotbar,
 *   "Sortieren" orders by category, the bin destroys a common stack at once, the tooltip names the
 *   item with its origin and use.
 * - Keyboard only: the focus frame starts on the first slot, Enter picks a stack up and puts it down
 *   elsewhere, E moves it to the hotbar.
 * - The stats panel shows the player's values. No console errors or warnings.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null } };
  command(cmd: unknown): unknown;
  call(name: string, ...args: unknown[]): unknown;
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

/**
 * Presses `key` and waits two rendered frames: the input is read once per frame, so two presses of
 * the same key inside one frame count once (as for a player, who never presses twice in 16 ms).
 */
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

function playerPos(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
}

/** Boots the game with a player on the start beach and gives it `items`. */
async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count] of items) await page.evaluate(([i, n]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'inventory.give', item: i, count: n }), [item, count] as const);
}

const slot = (page: Page, bereich: string, index: number): Locator => page.getByTestId(`slot-${bereich}-${index}`);

async function open(page: Page, key = 'Tab'): Promise<Locator> {
  await press(page, key);
  const screen = page.getByTestId('ui-inventar');
  await expect(screen).toBeVisible();
  return screen;
}

/** Drags the stack of `from` onto `to` with the mouse in several steps. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error('slot not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('Tab/I öffnen und schließen das Inventar, Esc schließt es ohne Pausemenü; WASD bewegt dann nur den Fokus', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [['holz', 10]]);
  const screen = await open(page);
  await expect(slot(page, 'inventar', 0)).toHaveAttribute('data-item', 'holz');
  const before = await playerPos(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  const after = await playerPos(page);
  expect(after?.x).toBeCloseTo(before?.x ?? 0, 3);
  await expect(page.locator('[data-fokus-sichtbar]')).toHaveCount(1);
  await press(page, 'Tab');
  await expect(screen).toBeHidden();
  await open(page, 'KeyI');
  await press(page, 'KeyI');
  await expect(screen).toBeHidden();
  await open(page);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  await expect(page.getByTestId('ui-pause')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Maus: Ziehen, Umschalt+Klick, Rechtsklick, Doppelklick, Zifferntaste, Sortieren, Mülleimer, Tooltip', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['himbeeren', 6],
    ['holz', 10],
    ['stein', 4],
    ['fasern', 3],
  ]);
  await open(page);
  await page.mouse.move(2, 2);
  await expect(slot(page, 'inventar', 1)).toHaveAttribute('data-item', 'holz');

  // Drag & drop onto an empty slot.
  await drag(page, slot(page, 'inventar', 1), slot(page, 'inventar', 7));
  await expect(slot(page, 'inventar', 7)).toHaveAttribute('data-item', 'holz');
  await expect(slot(page, 'inventar', 1)).not.toHaveAttribute('data-item');

  // Right click splits off the smaller half into the first free slot; double click gathers it again.
  await slot(page, 'inventar', 7).click({ button: 'right' });
  await expect(slot(page, 'inventar', 1)).toHaveAttribute('data-item', 'holz');
  await expect(slot(page, 'inventar', 1)).toHaveAttribute('aria-label', /×5$/);
  await expect(slot(page, 'inventar', 7)).toHaveAttribute('aria-label', /×5$/);
  await slot(page, 'inventar', 7).dblclick();
  await expect(slot(page, 'inventar', 7)).toHaveAttribute('aria-label', /×10$/);
  await expect(slot(page, 'inventar', 1)).not.toHaveAttribute('data-item');

  // Shift+click moves inventory → hotbar.
  await slot(page, 'inventar', 7).click({ modifiers: ['Shift'] });
  await expect(slot(page, 'schnellleiste', 0)).toHaveAttribute('data-item', 'holz');
  await expect(slot(page, 'inventar', 7)).not.toHaveAttribute('data-item');

  // A number key over a slot puts its stack on that hotbar slot (key 4 = slot 3).
  await slot(page, 'inventar', 2).hover();
  await press(page, 'Digit4');
  await expect(slot(page, 'schnellleiste', 3)).toHaveAttribute('data-item', 'stein');

  // Tooltip of the hovered slot: rarity-coloured name, origin and use.
  await slot(page, 'inventar', 0).hover();
  const tip = page.getByTestId('ui-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Himbeeren');
  await expect(tip).toContainText('Herkunft');
  await expect(tip).toContainText('Verwendet in');
  await expect(tip.locator('[data-raritaet="gewoehnlich"]')).toHaveCount(1);
  await page.mouse.move(2, 2);
  await expect(tip).toHaveCount(0);

  // Sort: raw materials before food (category order), stacks joined.
  await page.getByTestId('inventar-sortieren').click();
  await expect(slot(page, 'inventar', 0)).toHaveAttribute('data-item', 'fasern');
  await expect(slot(page, 'inventar', 1)).toHaveAttribute('data-item', 'himbeeren');

  // The bin destroys a common stack without asking.
  await drag(page, slot(page, 'inventar', 0), page.getByTestId('inventar-muell'));
  await expect(page.getByTestId('inventar-muell-dialog')).toHaveCount(0);
  await expect(slot(page, 'inventar', 0)).not.toHaveAttribute('data-item', 'fasern');
  await expect(page.locator('[data-item="fasern"]')).toHaveCount(0);

  // Stats panel with the player's values.
  await expect(page.getByTestId('wert-leben')).toContainText('100/100');
  await expect(page.getByTestId('wert-kern')).toContainText('°C');
  expect(errors).toEqual([]);
});

test('Tastatur: Fokusrahmen, Enter nimmt auf und legt ab, E lagert um', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['holz', 10],
    ['stein', 4],
  ]);
  await open(page);
  const framed = page.locator('[data-fokus-sichtbar]');
  await expect(framed).toHaveAttribute('data-slot', 'inventar:0');
  await press(page, 'Enter');
  await expect(page.getByTestId('ui-inventar').locator('[data-traegt="inventar:0"]')).toHaveCount(1);
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'ArrowDown');
  await expect(framed).toHaveAttribute('data-slot', 'inventar:12');
  await press(page, 'Enter');
  await expect(slot(page, 'inventar', 12)).toHaveAttribute('data-item', 'holz');
  await expect(slot(page, 'inventar', 0)).not.toHaveAttribute('data-item');
  // Tooltip follows the focus while nothing is carried.
  await expect(page.getByTestId('ui-tooltip')).toContainText('Holz');
  await press(page, 'KeyE');
  await expect(page.locator('[data-slot^="schnellleiste:"][data-item="holz"]')).toHaveCount(1);
  // Esc puts a carried stack back first, then closes.
  await press(page, 'ArrowUp');
  await press(page, 'ArrowLeft');
  await expect(framed).toHaveAttribute('data-slot', 'inventar:1');
  await press(page, 'Enter');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  await expect(slot(page, 'inventar', 1)).toHaveAttribute('data-item', 'stein');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-inventar')).toBeHidden();
  expect(errors).toEqual([]);
});
