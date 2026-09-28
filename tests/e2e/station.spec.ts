/**
 * M4-07 in the browser: the station screen over the running game. Stations are set up next to the player on the
 * start beach with `station.place` (the first tile around the player that takes it) and used with `station.use` –
 * the screen opens on the simulation's `stationOpened`.
 *
 * - A workbench shows its recipe book: search, filter, quantity, "Herstellen" (the queue runs while the player
 *   stands at the bench, a sawbuck arrives in the bags), the station in reach, a missing ingredient with its hint.
 * - A clay oven shows input, fuel and output: clay into the input and wood onto the fuel slot by clicking the bags,
 *   the batch runs (progress, glow, status line), the pot lands in the output and "Alles nehmen" takes it; what the
 *   oven does not take is refused with a text.
 * - Keyboard only; Esc closes; walking away (teleport) closes the screen.
 * - In the real game E opens it: standing at the workbench, aimed at it, the hint reads "Benutzen: Werkbank", E opens
 *   the screen and the press that opened it does not close it again in the same frame.
 * - Item tooltips (§26, "Herkunft"/"Verwendet in"): on the oven's slots, bags and ingredients – on hover and on the
 *   keyboard's focus frame.
 * - Repair (M4-09, `repair.item`): a worn stone axe (given worn with `inventory.give {haltbarkeit}`, M5-38 – wear by
 *   hits is tested in Node, tests/unit/game/baeume.test.ts), the workbench's tab "Reparieren" lists it with its
 *   durability and the material (a twig) at hand; "Reparieren" mends it – the durability is full again (the inventory's
 *   tooltip), the twig is gone from the bags; by mouse, and by keyboard alone (the tabs are reached by walking up).
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  command(cmd: unknown): unknown;
  setSpeed(f: number): void;
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

/** Starts the game with the player and gives `items` in order (with a third number: pieces worn to that durability). */
async function start(page: Page, items: ReadonlyArray<readonly [string, number, number?]>): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count, haltbarkeit] of items) await cmd(page, { type: 'inventory.give', item, count, ...(haltbarkeit === undefined ? {} : { haltbarkeit }) });
}

/** Sets up the station of inventory slot 0 on the first free tile around the player; returns its id. */
async function placeStation(page: Page): Promise<number> {
  return (await placeStationAt(page)).id;
}

/** Like `placeStation`, with the north-west tile of the station's footprint. */
async function placeStationAt(page: Page): Promise<{ id: number; tx: number; ty: number }> {
  const offsets = [
    [1, -2],
    [-2, -2],
    [1, 1],
    [-2, 1],
    [2, -1],
    [-3, -1],
    [0, 2],
    [0, -3],
  ];
  for (const [dx, dy] of offsets) {
    const before = await events(page, 'stationPlaced');
    const at = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
    if (at === null) throw new Error('no player');
    const tx = Math.floor(at.x / TILE) + (dx ?? 0);
    const ty = Math.floor(at.y / TILE) + (dy ?? 0);
    await cmd(page, { type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty });
    await page.waitForFunction(
      ([t, b]) => {
        const dh = (window as unknown as { __dh: Dh }).__dh.state().sim;
        return (dh.events['stationPlaced'] ?? 0) > (b as number) || dh.tick > (t as number) + 2;
      },
      [await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick), before] as const,
    );
    const after = await events(page, 'stationPlaced');
    if (after > before) return { id: after, tx, ty };
  }
  throw new Error('no free tile for the station');
}

async function openStation(page: Page, id: number) {
  await cmd(page, { type: 'station.use', station: id });
  const screen = page.getByTestId('ui-station');
  await expect(screen).toBeVisible();
  return screen;
}

async function countInBags(page: Page, item: string): Promise<number> {
  return page.evaluate((id) => {
    let total = 0;
    for (const el of document.querySelectorAll(`[data-testid^="station-tasche-"][data-item="${id}"]`)) total += Number(el.querySelector('.dh-slot__anzahl')?.textContent ?? '1');
    return total;
  }, item);
}

test('Werkbank: Rezeptbuch mit Suche, Menge und Warteschlange; Sägebock herstellen; fehlende Zutat mit Hinweis', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['werkbank', 1],
    ['holz', 20],
    ['zweig', 8],
    ['faserseil', 4],
    ['stein', 12],
    ['lehm', 2],
  ]);
  const id = await placeStation(page);
  const screen = await openStation(page, id);
  await expect(screen.getByTestId('station-handwerk')).toBeVisible();
  await expect(screen.locator('.dh-hw__titel').first()).toHaveText('Werkbank');
  await page.mouse.move(2, 2);
  // Only the bench's recipes: the sawbuck, not the hand recipes.
  await expect(page.getByTestId('rezept-rezept_saegebock')).toBeVisible();
  await expect(page.getByTestId('rezept-rezept_faserseil')).toHaveCount(0);
  await page.getByTestId('handwerk-suche').fill('säge');
  await expect(page.locator('[data-testid^="rezept-"]')).toHaveCount(1);
  await page.getByTestId('rezept-rezept_saegebock').click();
  await expect(page.getByTestId('handwerk-ort')).toHaveText('Werkbank in Reichweite');
  await page.getByTestId('handwerk-herstellen').click();
  await expect(page.getByTestId('auftrag-0')).toHaveAttribute('data-rezept', 'rezept_saegebock');
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(8));
  await expect(page.getByTestId('auftrag-0')).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(1));
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['craftCompleted'] ?? 0) >= 1);
  // The clay oven needs 16 clay: 14 missing – dug with a shovel.
  await page.getByTestId('handwerk-suche').fill('lehmofen');
  await page.getByTestId('rezept-rezept_lehmofen').click();
  await expect(page.getByTestId('handwerk-fehlt')).toContainText('Fehlt: 14× Lehm – Graben mit der Schaufel: Lehm');
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-station')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Lehmofen: Eingang, Brennstoff, Charge mit Fortschritt und Glut, Ausgang und „Alles nehmen“', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['lehmofen', 1],
    ['lehm', 3],
    ['holz', 3],
    ['stein', 5],
  ]);
  const id = await placeStation(page);
  await openStation(page, id);
  const panel = page.getByTestId('station-verarbeitung');
  await expect(panel).toHaveAttribute('data-station', 'lehmofen');
  await page.mouse.move(2, 2);
  await expect(page.getByTestId('station-status')).toHaveAttribute('data-ton', 'still');
  // Stone does not go into the oven: dim in the bags, refused with its text.
  const stone = page.locator('[data-testid^="station-tasche-"][data-item="stein"]');
  await expect(stone).toHaveClass(/dh-st__slot--passt-nicht/);
  await stone.click();
  await expect(page.getByTestId('station-hinweis')).toContainText('Das verarbeitet diese Station nicht');
  // Clay into the input, wood onto the fuel: the pot is fired.
  await page.locator('[data-testid^="station-tasche-"][data-item="lehm"]').click();
  await expect(page.getByTestId('station-eingang-0')).toHaveAttribute('data-item', 'lehm');
  await page.locator('[data-testid^="station-tasche-"][data-item="holz"]').click();
  await expect(page.getByTestId('station-brennstoff-0')).toHaveAttribute('data-item', 'holz');
  await expect(page.getByTestId('station-status')).toHaveAttribute('data-ton', 'laeuft');
  await expect(page.getByTestId('station-status')).toContainText('Arbeitet: ');
  await expect(page.locator('.dh-st__glut[data-glueht]')).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(32));
  await expect(page.getByTestId('station-ausgang-0')).toHaveAttribute('data-item', 'keramik_topf', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.setSpeed(1));
  // The clay is used up: the oven asks for the next load.
  await expect(page.getByTestId('station-status')).toHaveAttribute('data-ton', 'still');
  await expect(page.getByTestId('station-status')).toContainText('Leg Zutaten in den Eingang');
  await page.getByTestId('station-alles-nehmen').click();
  await expect(page.getByTestId('station-ausgang-0')).not.toHaveAttribute('data-item');
  expect(await countInBags(page, 'keramik_topf')).toBe(1);
  // Clicking the fuel slot takes the rest of the wood back.
  await page.getByTestId('station-brennstoff-0').click();
  await expect(page.getByTestId('station-brennstoff-0')).not.toHaveAttribute('data-item');
  expect(errors).toEqual([]);
});

test('Nur Tastatur im Ofen; wer weggeht, schließt den Bildschirm', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['lehmofen', 1],
    ['lehm', 6],
    ['holz', 2],
  ]);
  const id = await placeStation(page);
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  await openStation(page, id);
  // Opened by the simulation: the keys used last put the frame on the first filled bag slot.
  const focused = page.locator('[data-fokus-sichtbar]');
  await expect(focused).toHaveAttribute('data-item', 'lehm');
  await press(page, 'KeyQ');
  await expect(page.getByTestId('station-eingang-0')).toHaveAttribute('data-item', 'lehm');
  await expect(page.getByTestId('station-eingang-0').locator('.dh-slot__anzahl')).toHaveText('3');
  await press(page, 'Enter');
  await expect(page.getByTestId('station-eingang-0').locator('.dh-slot__anzahl')).toHaveText('6');
  const at = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
  await cmd(page, { type: 'player.teleport', x: (at?.x ?? 0) + 30 * TILE, y: at?.y ?? 0, layer: 0 });
  await expect(page.getByTestId('ui-station')).toBeHidden();
  expect(errors).toEqual([]);
});

test('E öffnet die Werkbank im Spiel und schließt sie nicht im selben Frame wieder', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['werkbank', 1],
    ['holz', 4],
  ]);
  const { id, tx, ty } = await placeStationAt(page);
  // The workbench is one tile deep: stand on the tile south of its west half and aim at it (the mouse stays off).
  const tick = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await cmd(page, { type: 'player.teleport', x: (tx + 0.5) * TILE, y: (ty + 1.5) * TILE, layer: 0 });
  await cmd(page, { type: 'player.aim', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > (t as number) + 2, tick);
  await expect(page.getByTestId('hud-hinweis')).toContainText('Benutzen: Werkbank');
  const opened = await events(page, 'stationOpened');
  await press(page, 'KeyE');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['stationOpened'] ?? 0) > n, opened);
  const screen = page.getByTestId('ui-station');
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('station-handwerk')).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  await expect(screen).toBeVisible();
  await expect(screen.locator('.dh-hw__titel').first()).toHaveText('Werkbank');
  expect(await events(page, 'stationOpened')).toBe(opened + 1);
  expect(id).toBeGreaterThan(0);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});

test('Tooltips im Ofen: Plätze, Taschen und Zutaten – mit der Maus und am Fokusrahmen', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['lehmofen', 1],
    ['lehm', 6],
    ['holz', 2],
  ]);
  const id = await placeStation(page);
  const screen = await openStation(page, id);
  const tip = page.getByTestId('ui-tooltip');
  // Pointer: a bag stack, a slot of the station, an ingredient of the chosen batch.
  await page.locator('[data-testid^="station-tasche-"][data-item="lehm"]').hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Lehm');
  await expect(tip).toContainText('Herkunft');
  await expect(tip).toContainText('Verwendet in');
  await page.locator('[data-testid^="station-tasche-"][data-item="lehm"]').click();
  await expect(page.getByTestId('station-eingang-0')).toHaveAttribute('data-item', 'lehm');
  await page.getByTestId('station-eingang-0').hover();
  await expect(tip).toContainText('Lehm');
  await page.locator('[data-testid="station-zutaten"] [data-zutat]').first().hover();
  await expect(tip).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden();
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  // Keys: opened again with the keyboard in use, the frame stands on the wood in the bags and carries its tooltip.
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  await openStation(page, id);
  await expect(page.locator('[data-fokus-sichtbar]')).toHaveAttribute('data-item', 'holz');
  await expect(tip).toContainText('Holz');
  await expect(tip).toContainText('Herkunft');
  expect(errors).toEqual([]);
});

test('Reparieren an der Werkbank mit der Maus: abgenutzte Axt, Material, volle Haltbarkeit', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['werkbank', 1],
    ['steinaxt', 1, 58],
    ['zweig', 3],
    ['stein', 4],
  ]);
  const id = await placeStation(page);
  const screen = await openStation(page, id);
  await page.mouse.move(2, 2);
  // The tab strip: "Herstellen" (the recipe book) and "Reparieren" with the one worn piece this bench mends.
  await expect(screen.getByTestId('station-handwerk')).toBeVisible();
  await expect(screen.getByTestId('station-reiter-reparieren-zahl')).toHaveText('1');
  await screen.getByTestId('station-reiter-reparieren').click();
  await expect(screen.getByTestId('station-reparatur')).toBeVisible();
  await expect(screen.getByTestId('reparatur-kann')).toHaveText('Repariert bis Stufe 0: Werkzeug, Waffe, Rüstung, Schild');
  const row = screen.getByTestId('reparatur-stueck-schnellleiste:0');
  await expect(row).toHaveAttribute('data-item', 'steinaxt');
  const haltbarkeit = screen.getByTestId('reparatur-haltbarkeit');
  await expect(haltbarkeit).toHaveAttribute('data-wert', '58');
  await expect(haltbarkeit).toHaveAttribute('data-max', '60');
  await expect(screen.getByTestId('reparatur-an')).toHaveText('Repariert an: Werkbank');
  // A little wear costs one piece of the largest ingredient: a twig, three at hand.
  const zweig = screen.locator('[data-testid="reparatur-kosten"] [data-zutat="zweig"]');
  await expect(zweig).toHaveAttribute('data-braucht', '1');
  await expect(zweig).toHaveAttribute('data-hat', '3');
  // The piece carries the item tooltip.
  await row.hover();
  await expect(page.getByTestId('ui-tooltip')).toContainText('Steinaxt');
  await expect(page.getByTestId('ui-tooltip')).toContainText('Haltbarkeit 58/60');
  await page.mouse.move(2, 2);
  const repaired = await events(page, 'itemRepaired');
  await screen.getByTestId('reparatur-reparieren').click();
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['itemRepaired'] ?? 0) > n, repaired);
  await expect(screen.getByTestId('reparatur-hinweis')).toHaveText('Ausgebessert: Steinaxt');
  await expect(screen.getByTestId('reparatur-leer')).toBeVisible();
  await expect(screen.getByTestId('station-reiter-reparieren-zahl')).toHaveCount(0);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  // In the inventory: the axe whole again, one twig taken.
  await press(page, 'KeyI');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  await expect(page.locator('[data-testid^="slot-"][data-item="zweig"] .dh-slot__anzahl')).toHaveText('2');
  await page.getByTestId('slot-schnellleiste-0').hover();
  await expect(page.getByTestId('ui-tooltip')).toContainText('Haltbarkeit 60/60');
  expect(errors).toEqual([]);
});

test('Reparieren nur mit der Tastatur: zu den Reitern hinauf, Stück wählen, reparieren', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectConsole(page);
  await start(page, [
    ['werkbank', 1],
    ['steinaxt', 1, 59],
    ['zweig', 2],
  ]);
  const id = await placeStation(page);
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  const screen = await openStation(page, id);
  const focused = page.locator('[data-fokus-sichtbar]');
  await expect(focused).toHaveCount(1);
  // Up: over the filter into the recipe book's search field, and ↑ there leaves it for the tab strip; right to
  // "Reparieren".
  for (let i = 0; i < 12 && (await focused.getAttribute('role')) !== 'tab'; i++) await press(page, 'ArrowUp');
  await expect(focused).toHaveAttribute('role', 'tab');
  for (let i = 0; i < 3 && (await focused.getAttribute('data-reiter')) !== 'reparieren'; i++) await press(page, 'ArrowRight');
  await expect(focused).toHaveAttribute('data-reiter', 'reparieren');
  await press(page, 'Enter');
  await expect(screen.getByTestId('station-reparatur')).toBeVisible();
  // The frame goes to the worn piece; its tooltip shows at the frame.
  await expect(focused).toHaveAttribute('data-item', 'steinaxt');
  await expect(page.getByTestId('ui-tooltip')).toContainText('Steinaxt');
  // Confirm on the chosen piece jumps to "Reparieren"; confirm mends it.
  await press(page, 'Enter');
  await expect(focused).toHaveAttribute('data-testid', 'reparatur-reparieren');
  const repaired = await events(page, 'itemRepaired');
  await press(page, 'Enter');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['itemRepaired'] ?? 0) > n, repaired);
  await expect(screen.getByTestId('reparatur-leer')).toBeVisible();
  // The mended axe left the list with the detail's button: the frame moved on to the tab. Back to the recipe book.
  await expect(focused).toHaveAttribute('data-reiter', 'reparieren');
  await press(page, 'ArrowLeft');
  await expect(focused).toHaveAttribute('data-reiter', 'herstellen');
  await press(page, 'Enter');
  await expect(screen.getByTestId('station-handwerk')).toBeVisible();
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});
