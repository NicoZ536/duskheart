/**
 * M4-21 in the browser: the chest screen over the running game. A wooden chest is built next to the player on the
 * start beach with `build.place` (the first tile around the player that takes it) and opened with `storage.open` –
 * the screen opens on the simulation's `chestOpened`; closing it shuts the lid (`chestClosed`).
 *
 * - Click a bag stack: the whole stack into the chest; right click: half; click a chest stack: back into the bags.
 * - Rename (Enter) and the icon label (◀ ▶ through the items it holds), "Sortieren", "Alles nehmen".
 * - "Alles einlagern" stores inventory and backpack compartment but leaves the hotbar; "Schnellablage" puts stacks
 *   into the chests around that already hold their item.
 * - Keyboard only; Esc closes; the crafting menu takes from the chest in reach ("Aus Kisten").
 * - In the real game E opens it: standing at the chest, aimed at it, the hint reads "Öffnen: Holzkiste", E opens the
 *   screen and the press that opened it does not close it again in the same frame.
 * - §16.7 "Suche über alle Kisten der Basis" from the chest screen, without a hearthfire: the tab "Suche" searches every
 *   chest within 12 tiles (not one farther away), groups the finds per chest with where it stands, highlights them
 *   in the open chest's slots, takes a find of the open chest with a click; by mouse and by keyboard alone.
 * - Item tooltips (§26, "Herkunft"/"Verwendet in") on the chest's slots, the bags and the finds – on hover and on the
 *   keyboard's focus frame.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  command(cmd: unknown): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

async function events(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, type);
}

async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count] of items) await cmd(page, { type: 'inventory.give', item, count });
}

/** Builds a wooden chest on the first free tile around the player (`skip` tiles tried first are left out); returns its id. */
async function buildChest(page: Page, skip = 0): Promise<number> {
  return (await buildChestAt(page, skip)).id;
}

/** Like `buildChest`, with the tile the chest stands on. */
async function buildChestAt(page: Page, skip = 0): Promise<{ id: number; tx: number; ty: number }> {
  const offsets = [
    [1, -2],
    [-2, -2],
    [1, 1],
    [-2, 1],
    [2, -1],
    [-3, -1],
    [0, 2],
    [0, -3],
    [3, 0],
    [-4, 0],
  ].slice(skip);
  for (const [dx, dy] of offsets) {
    const before = await events(page, 'chestPlaced');
    const sim = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
    if (sim.player === null) throw new Error('no player');
    const tx = Math.floor(sim.player.x / TILE) + (dx ?? 0);
    const ty = Math.floor(sim.player.y / TILE) + (dy ?? 0);
    await cmd(page, { type: 'build.place', part: 'kiste_holz', tx, ty });
    // The tick after queuing: ticks may run between two evaluations, the wait must outlast the command's tick.
    const queuedAt = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
    await page.waitForFunction(
      ([t, b]) => {
        const s = (window as unknown as { __dh: Dh }).__dh.state().sim;
        return (s.events['chestPlaced'] ?? 0) > (b as number) || s.tick > (t as number) + 2;
      },
      [queuedAt, before] as const,
    );
    const after = await events(page, 'chestPlaced');
    if (after > before) return { id: after, tx, ty };
  }
  throw new Error('no free tile for the chest');
}

/** Puts the player on the tile south of (tx, ty) and aims at that tile (the mouse stays off the page). */
async function standBelowAndAim(page: Page, tx: number, ty: number): Promise<void> {
  const tick = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await cmd(page, { type: 'player.teleport', x: (tx + 0.5) * TILE, y: (ty + 1.5) * TILE, layer: 0 });
  await cmd(page, { type: 'player.aim', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > (t as number) + 2, tick);
}

async function openChest(page: Page, id: number) {
  await cmd(page, { type: 'storage.open', chest: id });
  const screen = page.getByTestId('ui-kiste');
  await expect(screen).toBeVisible();
  return screen;
}

const bag = (page: Page, item: string) => page.locator(`[data-testid^="kiste-tasche-"][data-item="${item}"]`);
const chestSlot = (page: Page, item: string) => page.locator(`[data-testid^="kiste-slot-"][data-item="${item}"]`);

test('Umlagern mit der Maus, Umbenennen, Etikett, Sortieren, Alles nehmen; Schließen schließt den Deckel', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['kiste_holz', 1],
    ['stein', 20],
    ['holz', 9],
    ['lehm', 4],
  ]);
  const id = await buildChest(page);
  const screen = await openChest(page, id);
  await expect(screen.getByTestId('kiste-name')).toHaveValue('Holzkiste');
  await page.mouse.move(2, 2);
  await bag(page, 'stein').click();
  await expect(chestSlot(page, 'stein').locator('.dh-slot__anzahl')).toHaveText('20');
  await expect(bag(page, 'stein')).toHaveCount(0);
  await bag(page, 'holz').click({ button: 'right' });
  await expect(chestSlot(page, 'holz').locator('.dh-slot__anzahl')).toHaveText('5');
  await expect(bag(page, 'holz').locator('.dh-slot__anzahl')).toHaveText('4');
  await chestSlot(page, 'holz').click();
  await expect(chestSlot(page, 'holz')).toHaveCount(0);
  await expect(bag(page, 'holz').locator('.dh-slot__anzahl')).toHaveText('9');
  // Rename with Enter; the label steps through the items it holds.
  await screen.getByTestId('kiste-name').fill('Baustoffe');
  await screen.getByTestId('kiste-name').press('Enter');
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['chestRenamed'] ?? 0) >= 1);
  await expect(screen.getByTestId('kiste-name')).toHaveValue('Baustoffe');
  await screen.getByTestId('kiste-etikett-weiter').click();
  await expect(screen.getByTestId('kiste-etikett')).toHaveAttribute('data-etikett', 'stein');
  // Sort and take all.
  await bag(page, 'lehm').click();
  await screen.getByTestId('kiste-sortieren').click();
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['chestSorted'] ?? 0) >= 1);
  await screen.getByTestId('kiste-alles-nehmen').click();
  await expect(page.locator('[data-testid^="kiste-slot-"][data-item]')).toHaveCount(0);
  await expect(bag(page, 'stein')).toHaveCount(1);
  const closed = await events(page, 'chestClosed');
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['chestClosed'] ?? 0) > n, closed);
  expect(errors).toEqual([]);
});

test('Alles einlagern lässt die Schnellleiste; Schnellablage füllt passende Kisten; Handwerk nimmt aus der Kiste', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['kiste_holz', 1],
    ['stein', 12],
    ['fasern', 6],
  ]);
  const id = await buildChest(page);
  await openChest(page, id);
  await page.mouse.move(2, 2);
  // The stone goes to the hotbar, the fibres stay in the inventory.
  const hotbar = page.getByTestId('kiste-tasche-schnellleiste-0');
  await cmd(page, { type: 'inventory.move', from: { bereich: 'inventar', index: 1 }, to: { bereich: 'schnellleiste', index: 0 } });
  await expect(hotbar).toHaveAttribute('data-item', 'stein');
  await page.getByTestId('kiste-alles-einlagern').click();
  await expect(chestSlot(page, 'fasern')).toHaveCount(1);
  await expect(hotbar).toHaveAttribute('data-item', 'stein');
  // Quick stash: fibres given again go into the chest that already holds fibres.
  await cmd(page, { type: 'inventory.give', item: 'fasern', count: 3 });
  await expect(bag(page, 'fasern')).toHaveCount(1);
  await page.getByTestId('kiste-schnellablage').click();
  await expect(bag(page, 'fasern')).toHaveCount(0);
  await expect(chestSlot(page, 'fasern').locator('.dh-slot__anzahl')).toHaveText('9');
  await press(page, 'Escape');
  // Crafting takes rope fibres from the chest in reach (§15.1).
  await press(page, 'KeyC');
  await expect(page.getByTestId('ui-handwerk')).toBeVisible();
  await expect(page.getByTestId('rezept-rezept_faserseil')).toContainText('×3');
  await page.getByTestId('handwerk-kisten').click();
  await expect(page.getByTestId('handwerk-kisten')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('rezept-rezept_faserseil')).not.toContainText('×');
  expect(errors).toEqual([]);
});

test('Nur Tastatur: Enter lagert um, Q die Hälfte, Esc schließt', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['kiste_holz', 1],
    ['stein', 8],
  ]);
  const id = await buildChest(page);
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  await openChest(page, id);
  const focused = page.locator('[data-fokus-sichtbar]');
  // An empty chest: the first filled bag slot gets the frame.
  await expect(focused).toHaveAttribute('data-item', 'stein');
  await press(page, 'KeyQ');
  await expect(chestSlot(page, 'stein').locator('.dh-slot__anzahl')).toHaveText('4');
  await press(page, 'Enter');
  await expect(chestSlot(page, 'stein').locator('.dh-slot__anzahl')).toHaveText('8');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-kiste')).toBeHidden();
  expect(errors).toEqual([]);
});

test('E öffnet die Kiste im Spiel und schließt sie nicht im selben Frame wieder', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['kiste_holz', 1],
    ['stein', 5],
  ]);
  const { id, tx, ty } = await buildChestAt(page);
  await standBelowAndAim(page, tx, ty);
  await expect(page.getByTestId('hud-hinweis')).toContainText('Öffnen: Holzkiste');
  const opened = await events(page, 'chestOpened');
  await press(page, 'KeyE');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['chestOpened'] ?? 0) > n, opened);
  const screen = page.getByTestId('ui-kiste');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('kiste')).toHaveAttribute('data-kiste', String(id));
  // A few frames later it is still open, and the lid did not shut.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  await expect(screen).toBeVisible();
  expect(await events(page, 'chestClosed')).toBe(0);
  await page.mouse.move(2, 2);
  await page.locator('[data-testid^="kiste-tasche-"][data-item="stein"]').click();
  await expect(page.locator('[data-testid^="kiste-slot-"][data-item="stein"]')).toHaveCount(1);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});

/** Three wooden chests with stone: two next to the player, one `FERN` tiles east of it (beyond the search radius). */
const FERN = 20;

async function dreiKisten(page: Page): Promise<{ a: number; b: number; c: number }> {
  await start(page, [
    ['kiste_holz', 3],
    ['stein', 20],
    ['holz', 6],
  ]);
  const a = await buildChest(page);
  await cmd(page, { type: 'storage.put', chest: a, from: { bereich: 'inventar', index: 1 }, count: 8 });
  const b = await buildChest(page, 1);
  await cmd(page, { type: 'storage.put', chest: b, from: { bereich: 'inventar', index: 1 }, count: 5 });
  await cmd(page, { type: 'storage.rename', chest: b, name: 'Steinlager' });
  const start0 = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
  if (start0 === null) throw new Error('no player');
  await cmd(page, { type: 'player.teleport', x: start0.x + FERN * TILE, y: start0.y, layer: 0 });
  const c = await buildChest(page);
  await cmd(page, { type: 'storage.put', chest: c, from: { bereich: 'inventar', index: 1 }, count: 4 });
  await cmd(page, { type: 'player.teleport', x: start0.x, y: start0.y, layer: 0 });
  const tick = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > (t as number) + 2, tick);
  return { a, b, c };
}

test('Suche über alle Kisten der Basis ohne Herdfeuer: Funde je Kiste, Ort, Hervorhebung, Tooltip, Nehmen', async ({ page }) => {
  const errors = collectConsole(page);
  const { a, b, c } = await dreiKisten(page);
  const screen = await openChest(page, a);
  await page.mouse.move(2, 2);
  // Tooltips on the chest's slots and in the bags.
  const tip = page.getByTestId('ui-tooltip');
  await chestSlot(page, 'stein').hover();
  await expect(tip).toContainText('Stein');
  await expect(tip).toContainText('Verwendet in');
  await bag(page, 'holz').hover();
  await expect(tip).toContainText('Holz');
  await page.mouse.move(2, 2);
  await screen.getByTestId('kiste-reiter-suche').click();
  await expect(screen.getByTestId('kiste-suche')).toBeVisible();
  await expect(screen.getByTestId('kiste-suche-erklaerung')).toContainText('12 Felder um diese Kiste');
  await screen.getByTestId('kiste-suchfeld').fill('stein');
  await expect(screen.getByTestId('kiste-suche-basis')).toHaveText('Umkreis 12 Felder: 2 Kisten');
  await expect(screen.getByTestId(`kiste-suche-ort-${a}`)).toHaveText('diese Kiste');
  await expect(screen.getByTestId(`kiste-suche-ort-${b}`)).toHaveText(/^\d+ Feld(er)? (nördlich|nordöstlich|östlich|südöstlich|südlich|südwestlich|westlich|nordwestlich)$/);
  await expect(screen.getByTestId(`kiste-suche-kiste-${b}`)).toContainText('Steinlager');
  await expect(screen.getByTestId(`kiste-suche-kiste-${c}`)).toHaveCount(0);
  await expect(screen.getByTestId(`kiste-fund-${b}-0`).locator('.dh-slot__anzahl')).toHaveText('5');
  // The open chest's find is highlighted in its slots; the finds carry the tooltip.
  await expect(chestSlot(page, 'stein')).toHaveAttribute('data-treffer', '');
  await screen.getByTestId(`kiste-fund-${b}-0`).hover();
  await expect(tip).toContainText('Stein');
  await expect(tip).toContainText('Herkunft');
  // A click on a find of the open chest takes it into the bags.
  await screen.getByTestId(`kiste-fund-${a}-0`).click();
  await expect(chestSlot(page, 'stein')).toHaveCount(0);
  await expect(screen.getByTestId(`kiste-suche-kiste-${a}`)).toHaveCount(0);
  await expect(screen.getByTestId(`kiste-suche-kiste-${b}`)).toBeVisible();
  // Nothing found; Esc empties the field.
  await screen.getByTestId('kiste-suchfeld').fill('Eisen');
  await expect(screen.getByTestId('kiste-suche-keine')).toHaveText('„Eisen“ liegt in keiner Kiste der Basis.');
  await screen.getByTestId('kiste-suchfeld').press('Escape');
  await expect(screen.getByTestId('kiste-suchfeld')).toHaveValue('');
  await expect(screen.getByTestId('kiste-suche-erklaerung')).toBeVisible();
  // Back to the bags: the stone taken is there.
  await screen.getByTestId('kiste-reiter-taschen').click();
  await expect(bag(page, 'stein')).toHaveCount(1);
  await expect(bag(page, 'stein').locator('.dh-slot__anzahl')).toHaveText('11');
  expect(errors).toEqual([]);
});

test('Suche nur mit der Tastatur: Reiter, tippen, Enter springt zum Fund mit Tooltip', async ({ page }) => {
  const errors = collectConsole(page);
  const { a, b } = await dreiKisten(page);
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  const screen = await openChest(page, a);
  const focused = page.locator('[data-fokus-sichtbar]');
  // The frame starts on the chest's stone; its tooltip shows at the frame.
  await expect(focused).toHaveAttribute('data-item', 'stein');
  await expect(page.getByTestId('ui-tooltip')).toContainText('Stein');
  // Right into the bags, up to the tabs above them (the name field above the chest keeps the keys for typing), right to
  // "Suche", confirm.
  for (let i = 0; i < 12 && (await focused.getAttribute('data-slot')) === null; i++) await press(page, 'ArrowRight');
  await expect(focused).toHaveAttribute('data-slot', /.+/);
  for (let i = 0; i < 12 && (await focused.getAttribute('role')) !== 'tab'; i++) await press(page, 'ArrowUp');
  await expect(focused).toHaveAttribute('role', 'tab');
  for (let i = 0; i < 3 && (await focused.getAttribute('data-reiter')) !== 'suche'; i++) await press(page, 'ArrowRight');
  await expect(focused).toHaveAttribute('data-reiter', 'suche');
  await press(page, 'Enter');
  await expect(screen.getByTestId('kiste-suche')).toBeVisible();
  // Down into the field, type, Enter: the frame goes to the first find, with its tooltip.
  for (let i = 0; i < 4 && (await focused.getAttribute('data-testid')) !== 'kiste-suchfeld'; i++) await press(page, 'ArrowDown');
  await expect(focused).toHaveAttribute('data-testid', 'kiste-suchfeld');
  await page.keyboard.type('stein');
  await expect(screen.getByTestId(`kiste-suche-kiste-${b}`)).toBeVisible();
  await press(page, 'Enter');
  await expect(focused).toHaveAttribute('data-tip', `fund:${a}:0`);
  await expect(page.getByTestId('ui-tooltip')).toContainText('Stein');
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});
