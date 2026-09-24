/**
 * M3-27 in the browser: the HUD over the running game (debug mode with `?spieler=1`), fed by the
 * simulation through the bridge signals and the game's own debug commands.
 *
 * - Voll: the four bars, thermometer, hotbar with off-hand and belt; the status line gives way to the
 *   minimap; the hotbar follows the selected slot, a click on a slot selects it; the fear eye from fear 20 with its
 *   stage; conditions with a running timer; tooltips of thermometer and conditions; an open screen
 *   (inventory) hides the HUD.
 * - Modes from the setting `game.hudMode`: Kontextuell hides full bars and shows a hit bar; Minimal keeps
 *   only warnings (no hotbar, no hint, no minimap).
 * - Interaction hint at the bottom with the key of the device used last: "E" on the keyboard, the A button
 *   of an Xbox pad, the cross of a PlayStation pad (a mocked `navigator.getGamepads`).
 * - Off-hand: the empty slot says what belongs there; a torch shows its flame bar, out and lit, with
 *   the burn time in its name and tooltip; open tooltips follow live values (burn time, condition timer)
 *   and close when the pointer leaves, however often the display re-rendered meanwhile.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number; health: number } | null } };
  command(cmd: unknown): unknown;
  exec(line: string): unknown;
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

function frames(page: Page, n = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const next = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    n,
  );
}

async function command(page: Page, cmd: unknown): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

async function exec(page: Page, line: string): Promise<void> {
  await page.evaluate((l) => (window as unknown as { __dh: Dh }).__dh.exec(l), line);
}

async function start(page: Page): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('hud')).toBeVisible();
}

test('Voll: Werte, Thermometer, Schnellleiste, Furcht-Auge, Zustände mit Timer, Tooltips; Bildschirme verdecken das HUD', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  const hud = page.getByTestId('hud');
  await expect(hud).toHaveAttribute('data-modus', 'full');
  // The status line gives way to the minimap's plate.
  await expect(page.getByTestId('ui-status')).toHaveCount(0);
  await expect(page.getByTestId('hud-minimap')).toBeVisible();
  for (const art of ['leben', 'ausdauer', 'saettigung', 'durst']) await expect(page.getByTestId(`hud-wert-${art}`)).toBeVisible();
  await expect(page.getByTestId('hud-wert-leben').getByRole('meter')).toHaveAttribute('aria-label', 'Leben: 100 von 100');
  await expect(page.getByTestId('hud-thermometer')).toBeVisible();
  await expect(page.getByTestId('hud-nebenhand')).toBeVisible();
  for (let i = 0; i < 10; i++) await expect(page.getByTestId(`hud-schnellleiste-${i}`)).toBeVisible();
  for (let i = 0; i < 3; i++) await expect(page.getByTestId(`hud-guertel-${i}`)).toBeVisible();
  const leiste = page.getByTestId('hud-schnellleiste');
  await expect(leiste).toHaveAttribute('data-auswahl', '0');

  // The selection follows the simulation (player.selectHotbar, as the keys 1–0 send it), and a click on a slot selects it.
  await command(page, { type: 'player.selectHotbar', index: 2 });
  await expect(leiste).toHaveAttribute('data-auswahl', '2');
  await page.getByTestId('hud-schnellleiste-6').click();
  await expect(leiste).toHaveAttribute('data-auswahl', '6');
  await expect(page.getByTestId('hud-schnellleiste-6')).toHaveAttribute('aria-pressed', 'true');

  // Items on the hotbar and the belt: icon, count, the belt key over the slot Q uses next.
  await command(page, { type: 'inventory.give', item: 'apfel', count: 4 });
  await frames(page, 3);
  const apfel = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="hud-schnellleiste-"]')].findIndex((el) => el.getAttribute('data-item') === 'apfel'));
  if (apfel < 0) {
    // The apple went into the main inventory: move it onto the belt.
    await command(page, { type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'guertel', index: 1 } });
  } else await command(page, { type: 'inventory.move', from: { bereich: 'schnellleiste', index: apfel }, to: { bereich: 'guertel', index: 1 } });
  await expect(page.getByTestId('hud-guertel-1')).toHaveAttribute('data-item', 'apfel');
  await expect(page.getByTestId('hud-guertel-1-taste')).toHaveText('Q');
  await expect(page.getByTestId('hud-guertel-1')).toHaveAttribute('aria-label', 'Gürtel 2: Apfel ×4');

  // Fear: the eye from 20 with its stage, gone again below.
  await expect(page.getByTestId('hud-furcht')).toHaveCount(0);
  await command(page, { type: 'fear.set', value: 45 });
  await expect(page.getByTestId('hud-furcht')).toHaveAttribute('data-furcht-stufe', 'fluestern');
  await expect(page.getByTestId('hud-furcht')).toHaveAttribute('aria-label', 'Furcht 45: Flüstern');
  await command(page, { type: 'fear.set', value: 10 });
  await expect(page.getByTestId('hud-furcht')).toHaveCount(0);

  // A condition with its timer; the bleeding costs health and the bar follows.
  await command(page, { type: 'conditions.apply', id: 'blutung' });
  const blutung = page.getByTestId('hud-zustand-blutung');
  await expect(blutung).toBeVisible();
  const erst = Number(await blutung.getAttribute('data-zeit'));
  expect(erst).toBeGreaterThan(25);
  await expect.poll(async () => Number(await blutung.getAttribute('data-zeit'))).toBeLessThan(erst);
  await expect(blutung.locator('.dh-hud-zustand__zeit')).toHaveText(/^\d+s$/);
  await expect.poll(async () => Number(await page.getByTestId('hud-wert-leben').getAttribute('data-wert'))).toBeLessThan(100);

  // Tooltips: condition (description, remaining time) and thermometer (felt temperature, influences).
  await blutung.hover();
  const tip = page.getByTestId('hud-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Blutung');
  await expect(tip).toContainText('Verband');
  await page.getByTestId('hud-thermometer').hover();
  await expect(tip).toContainText('Körpertemperatur');
  await expect(tip).toContainText('Gefühlt');
  await expect(tip).toContainText('Einflüsse');
  await expect(tip).toContainText('Umgebung');
  await page.mouse.move(640, 360);
  await expect(tip).toHaveCount(0);

  // An open screen hides the HUD (the inventory shows bags and values itself).
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('ui-inventar')).toBeVisible();
  await expect(hud).toHaveClass(/dh-hud--verdeckt/);
  await expect(page.getByTestId('hud-werte')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('ui-inventar')).toHaveCount(0);
  await expect(page.getByTestId('hud-werte')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Modi: Kontextuell blendet ruhende Leisten aus und einen Treffer ein, Minimal zeigt nur Warnungen', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  const hud = page.getByTestId('hud');
  // The optional compass bar (§26, M3-28): off by default, the setting `game.compassBar` shows it.
  await expect(page.getByTestId('hud-kompass')).toHaveCount(0);
  await exec(page, 'set game.compassBar true');
  await expect(page.getByTestId('hud-kompass')).toBeVisible();
  await exec(page, 'set game.compassBar false');
  await expect(page.getByTestId('hud-kompass')).toHaveCount(0);
  await exec(page, 'set game.hudMode contextual');
  await expect(hud).toHaveAttribute('data-modus', 'contextual');
  // Full bars rest: gone after the linger time (game time; the loop runs).
  await expect(page.getByTestId('hud-wert-saettigung')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('hud-wert-leben')).toHaveCount(0);
  await expect(page.getByTestId('hud-schnellleiste')).toBeVisible();
  // A hit (fire): health below its maximum shows the bar.
  await command(page, { type: 'conditions.apply', id: 'brennen' });
  await expect(page.getByTestId('hud-wert-leben')).toBeVisible();

  await exec(page, 'set game.hudMode minimal');
  await expect(hud).toHaveAttribute('data-modus', 'minimal');
  // Burning costs health but not a third of it yet: no bar; the harmful condition shows.
  await expect(page.getByTestId('hud-zustand-brennen')).toBeVisible();
  await expect(page.getByTestId('hud-wert-leben')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('hud-schnellleiste')).toHaveCount(0);
  await expect(page.getByTestId('hud-minimap')).toBeHidden();
  await command(page, { type: 'conditions.apply', id: 'ausgeruht' });
  await frames(page, 3);
  await expect(page.getByTestId('hud-zustand-ausgeruht')).toHaveCount(0);
  // Changing the hotbar selection brings the row back for a moment.
  await command(page, { type: 'player.selectHotbar', index: 4 });
  await expect(page.getByTestId('hud-schnellleiste')).toBeVisible();
  await expect(page.getByTestId('hud-schnellleiste')).toHaveCount(0, { timeout: 20_000 });

  await exec(page, 'set game.hudMode full');
  await expect(page.getByTestId('hud-wert-saettigung')).toBeVisible();
  await expect(page.getByTestId('hud-minimap')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Replaces `navigator.getGamepads` by one pad whose id and pressed button the test sets (`__pad`). */
async function mockGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = { id: '', press: -1 };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    const buttons = (): { pressed: boolean; touched: boolean; value: number }[] => Array.from({ length: 17 }, (_, i) => ({ pressed: i === pad.press, touched: i === pad.press, value: i === pad.press ? 1 : 0 }));
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => (pad.id === '' ? [] : [{ id: pad.id, index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: buttons(), timestamp: 0 }]),
    });
  });
}

/** A pad with `id` presses the Home button once (it has no action): the last device is now the gamepad. */
async function usePad(page: Page, id: string): Promise<void> {
  await page.evaluate((padId) => {
    const pad = (window as unknown as { __pad: { id: string; press: number } }).__pad;
    pad.id = padId;
    pad.press = 16;
    window.dispatchEvent(new Event('gamepadconnected'));
  }, id);
  await frames(page, 3);
  await page.evaluate(() => {
    (window as unknown as { __pad: { press: number } }).__pad.press = -1;
  });
  await frames(page, 2);
}

test('Interaktionshinweis mit der Taste des Geräts: E, Xbox-A, PlayStation-Kreuz', async ({ page }) => {
  const errors = collectConsole(page);
  await mockGamepad(page);
  await start(page);
  // Flints thrown at the feet lie in reach until the magnet takes them: freeze the world then.
  await command(page, { type: 'inventory.give', item: 'feuerstein', count: 3 });
  await frames(page, 3);
  const pos = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player);
  if (pos === null) throw new Error('kein Spieler');
  const index = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="hud-schnellleiste-"]')].findIndex((el) => el.getAttribute('data-item') === 'feuerstein'));
  const from = index >= 0 ? { bereich: 'schnellleiste', index } : { bereich: 'inventar', index: 0 };
  await command(page, { type: 'action.throw', from, x: pos.x, y: pos.y + 6 });
  const hinweis = page.getByTestId('hud-hinweis');
  // Checked every frame: time freezes in the frame the hint appears (the magnet waits 0,25 s).
  await page.waitForFunction(
    () => {
      if (document.querySelector('[data-testid="hud-hinweis"]') === null) return false;
      (window as unknown as { __dh: { freezeTime(on: boolean): void } }).__dh.freezeTime(true);
      return true;
    },
    undefined,
    { timeout: 10_000, polling: 'raf' },
  );
  await expect(hinweis).toContainText('Aufheben: Feuerstein');
  await expect(hinweis).toHaveAttribute('data-geraet', 'tastatur');
  await expect(hinweis.locator('.dh-hud-taste')).toHaveAttribute('data-taste', 'E');
  await expect(hinweis).toHaveAttribute('aria-label', /^E: Aufheben: Feuerstein/);

  await usePad(page, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)');
  await expect(hinweis).toHaveAttribute('data-geraet', 'xbox');
  await expect(hinweis.locator('.dh-hud-taste--knopf')).toHaveAttribute('data-taste', 'A');
  await expect(hinweis.locator('img[data-sprite="ui_taste_xbox"]')).toHaveAttribute('data-frame', '0');
  // On a gamepad the hotbar shows LB/RB instead of the number keys.
  await expect(page.getByTestId('hud-schnellleiste').locator('.dh-hud-unten__blaettern')).toHaveCount(2);
  await expect(page.getByTestId('hud-schnellleiste').locator('.dh-hud-platz__ziffer')).toHaveCount(0);

  await usePad(page, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
  await expect(hinweis).toHaveAttribute('data-geraet', 'playstation');
  await expect(hinweis.locator('.dh-hud-taste--knopf')).toHaveAttribute('data-taste', 'Kreuz');
  await expect(hinweis.locator('img[data-sprite="ui_taste_ps"]')).toHaveAttribute('data-frame', '0');

  // Back on the keyboard: E again.
  await page.mouse.move(100, 100);
  await page.keyboard.press('Shift');
  await expect(hinweis).toHaveAttribute('data-geraet', 'tastatur');
  await expect(hinweis.locator('.dh-hud-taste')).toHaveAttribute('data-taste', 'E');
  expect(errors).toEqual([]);
});

test('Nebenhand: Fackel mit Flammenleiste, aus und an; Tooltips folgen Live-Werten und schließen zuverlässig', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  const tip = page.getByTestId('hud-tooltip');
  const nebenhand = page.getByTestId('hud-nebenhand');

  // The empty off-hand says what belongs there, the empty belt how to use it.
  await nebenhand.hover();
  await expect(tip).toContainText('Nebenhand');
  await expect(tip).toContainText('Ausrüsten im Inventar');
  await page.getByTestId('hud-guertel-2').hover();
  await expect(tip).toContainText('Gürtel');
  await expect(tip).toContainText('mit Q zu nutzen');
  await page.mouse.move(640, 300);
  await expect(tip).toHaveCount(0);

  // A torch into the off-hand: its flame bar, out at first.
  await command(page, { type: 'inventory.give', item: 'fackel', count: 1 });
  await expect(page.locator('[data-testid^="hud-schnellleiste-"][data-item="fackel"]').or(page.locator('[data-testid="hud-nebenhand"][data-item="fackel"]'))).toHaveCount(1);
  const index = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="hud-schnellleiste-"]')].findIndex((el) => el.getAttribute('data-item') === 'fackel'));
  await command(page, { type: 'inventory.move', from: index >= 0 ? { bereich: 'schnellleiste', index } : { bereich: 'inventar', index: 0 }, to: { bereich: 'ausruestung', index: 5 } });
  await expect(nebenhand).toHaveAttribute('data-item', 'fackel');
  await expect(nebenhand).toHaveAttribute('data-licht', 'aus');
  await expect(page.getByTestId('hud-nebenhand-brand')).toBeVisible();
  await nebenhand.hover();
  await expect(tip).toContainText('Fackel');
  await expect(tip).toContainText('Aus – F zündet es an');

  // Lit (the command of the light key F): the open tooltip follows (burn time, second by second), the slot's name says it too.
  await command(page, { type: 'light.toggle' });
  await expect(nebenhand).toHaveAttribute('data-licht', 'an');
  await expect(tip).toContainText(/Brennt noch \d+ min \d+ s/);
  await expect(nebenhand).toHaveAttribute('aria-label', /^Nebenhand: Fackel, Brennt noch \d+ min \d+ s$/);
  const vorher = await tip.textContent();
  await expect.poll(() => tip.textContent(), { timeout: 5_000 }).not.toBe(vorher);
  await page.mouse.move(640, 300);
  await expect(tip).toHaveCount(0);

  // A condition's timer re-renders its icon every second: its tooltip follows and still closes.
  await command(page, { type: 'conditions.apply', id: 'blutung' });
  const blutung = page.getByTestId('hud-zustand-blutung');
  await blutung.hover();
  await expect(tip).toContainText(/Noch \d+ s/);
  const erst = await tip.textContent();
  await expect.poll(() => tip.textContent(), { timeout: 5_000 }).not.toBe(erst);
  await page.mouse.move(640, 300);
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});
