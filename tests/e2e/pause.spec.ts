/**
 * M3-31 in the browser: the pause menu (Esc) over the running game, the automatic pause on a tab
 * switch, and menus usable with the keyboard alone (focus frame, arrow keys, Enter, Esc).
 *
 * - Esc opens the menu and the simulation rests (the tick stands); "Weiter" (Enter) continues.
 * - `visibilitychange` to hidden pauses the loop and opens the menu; when the tab returns the menu
 *   keeps the game paused until "Weiter".
 * - Keyboard only: the focus frame walks the entries; the settings view changes a setting that takes
 *   effect at once (game speed, language) and Esc goes back view by view.
 * - "Speichern" saves the world into IndexedDB and says when; "Zum Titel" asks first.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: unknown }; settings: { language: string; accessibility: { gameSpeed: number } } };
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

function state(page: Page): Promise<ReturnType<Dh['state']>> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state());
}

async function tick(page: Page): Promise<number> {
  return (await state(page)).sim.tick;
}

async function start(page: Page): Promise<void> {
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
}

/** Whether the simulation advances within `ms`. */
async function advances(page: Page, ms = 500): Promise<boolean> {
  const t0 = await tick(page);
  await page.waitForTimeout(ms);
  return (await tick(page)) > t0;
}

/** Sets the page's visibility as a tab switch would and fires `visibilitychange`. */
function setHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const framed = (page: Page) => page.locator('[data-fokus-sichtbar]');

test('Esc öffnet das Pausemenü, die Simulation ruht; Weiter (Enter) setzt fort', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  expect(await advances(page)).toBe(true);
  await press(page, 'Escape');
  const menu = page.getByTestId('ui-pause');
  await expect(menu).toBeVisible();
  expect(await advances(page)).toBe(false);
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-weiter');
  await press(page, 'ArrowDown');
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-einstellungen');
  await press(page, 'ArrowUp');
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-weiter');
  await press(page, 'Enter');
  await expect(menu).toBeHidden();
  expect(await advances(page)).toBe(true);
  // Esc in the open menu continues, too.
  await press(page, 'Escape');
  await expect(menu).toBeVisible();
  await press(page, 'Escape');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('Tab-Wechsel pausiert und öffnet das Menü; zurück im Tab bleibt die Pause bis „Weiter“', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  await setHidden(page, true);
  const menu = page.getByTestId('ui-pause');
  await expect(menu).toBeVisible();
  expect(await advances(page)).toBe(false);
  await setHidden(page, false);
  expect(await advances(page)).toBe(false);
  // Keyboard only: the first key shows the focus frame on "Weiter", Enter continues.
  await press(page, 'ArrowDown');
  await press(page, 'ArrowUp');
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-weiter');
  await press(page, 'Enter');
  await expect(menu).toBeHidden();
  expect(await advances(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('Einstellungen nur mit der Tastatur: Spieltempo und Sprache wirken sofort, Esc geht Ansicht für Ansicht zurück', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  await press(page, 'Escape');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await expect(page.getByTestId('einstellung-language')).toBeVisible();
  await expect(framed(page)).toHaveAttribute('data-einstellung', 'language');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await expect(framed(page)).toHaveAttribute('data-einstellung', 'gameSpeed');
  await expect(page.getByTestId('einstellung-beschreibung')).toContainText('Spielgeschehen');
  await press(page, 'ArrowLeft');
  await expect(page.getByTestId('einstellung-gameSpeed-wert')).toHaveText(/^95\s%$/);
  expect((await state(page)).settings.accessibility.gameSpeed).toBe(0.95);
  await press(page, 'ArrowRight');
  expect((await state(page)).settings.accessibility.gameSpeed).toBe(1);
  // Language: the whole menu switches without reloading.
  await press(page, 'ArrowUp');
  await press(page, 'ArrowUp');
  await press(page, 'ArrowRight');
  await expect(page.getByTestId('einstellung-language-wert')).toHaveText('English');
  await expect(page.getByTestId('einstellungen-zurueck')).toHaveText('Back');
  expect((await state(page)).settings.language).toBe('en');
  await press(page, 'Enter');
  expect((await state(page)).settings.language).toBe('de');
  await press(page, 'Escape');
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-weiter');
  await expect(page.getByTestId('pause-einstellungen')).toBeVisible();
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-pause')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Speichern schreibt die Welt und nennt Tag und Uhrzeit; Zum Titel fragt vorher', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page);
  await press(page, 'Escape');
  await page.getByTestId('pause-speichern').click();
  await expect(page.getByTestId('pause-status')).toHaveText(/^Gespeichert: Tag 1, \d\d:\d\d$/, { timeout: 30_000 });
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('duskhearth');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(db.objectStoreNames[0] ?? '', 'readonly');
          const count = tx.objectStore(db.objectStoreNames[0] ?? '').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  expect(stored).toBeGreaterThan(0);
  await page.getByTestId('pause-titel').click();
  await expect(page.getByTestId('pause-titel-ja')).toBeVisible();
  await expect(framed(page)).toHaveCount(0);
  await press(page, 'ArrowDown');
  await expect(framed(page)).toHaveAttribute('data-testid', 'pause-titel-nein');
  await press(page, 'Enter');
  await expect(page.getByTestId('pause-weiter')).toBeVisible();
  await page.getByTestId('pause-titel').click();
  await Promise.all([page.waitForEvent('load'), page.getByTestId('pause-titel-ja').click()]);
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await expect(page.getByTestId('ui-pause')).toHaveCount(0);
  expect(errors).toEqual([]);
});
