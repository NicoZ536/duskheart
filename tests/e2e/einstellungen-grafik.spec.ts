/**
 * M7-55 Einstellungen I – Grafik und Audio (MASTERPROMPT §29; docs/SPIEL.md §25): im Einstellungsbildschirm des
 * Hauptmenüs (`?debug=1&menue=1`) ändern Tastatur und Maus Qualitätsstufe, Licht-Bänderung, Dithering, Skalierung,
 * Bildratenlimit, CRT und die Lautstärken; nach einem Neuladen stehen dieselben Werte da (localStorage, Version 2 ohne
 * VSync). Das Bildratenlimit wirkt: bei „30 FPS“ läuft die Schleife auf jedem zweiten Bild der Anzeige, bei „An
 * Bildwiederholrate“ auf jedem (`limitedAnimationFrameClock`, `__dh.call('frameLimit')`).
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  state(): { settings: { graphics: Record<string, unknown>; audio: Record<string, unknown> } };
  call(name: string, ...args: unknown[]): unknown;
  exec(line: string): string;
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openMenu(page: Page, query = ''): Promise<void> {
  await page.goto(logicUrl(`menue=1${query === '' ? '' : `&${query}`}`));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await expect(page.getByTestId('ui-hauptmenue')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('menue-einstellungen').click();
  await expect(page.getByTestId('ui-einstellungen')).toBeVisible();
}

const wert = (page: Page, id: string) => page.getByTestId(`einstellung-${id}-wert`);

async function graphics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().settings.graphics);
}

test('Grafik und Audio: Tastatur und Maus ändern die Werte, sie bleiben nach dem Neuladen', async ({ page }) => {
  const errors = collectConsole(page);
  await openMenu(page);
  await openSettings(page);
  await expect(page.getByTestId('einstellungen-reiter-graphics')).toHaveAttribute('aria-selected', 'true');
  // VSync is no row: the frame rate limit's first value couples to the display's refresh rate.
  await expect(page.locator('[data-zeile="graphics.vsync"]')).toHaveCount(0);
  await expect(wert(page, 'graphics.fpsLimit')).toHaveText(/^(An Bildwiederholrate|Match refresh rate)$/);

  // Keyboard: focus the frame rate limit and step it right (0 → 30).
  const fps = page.getByTestId('einstellung-graphics.fpsLimit');
  await fps.hover();
  await page.keyboard.press('ArrowRight');
  await expect(wert(page, 'graphics.fpsLimit')).toHaveText('30 FPS');
  // The mouse: a click on the row steps forward, a click on its left arrow back.
  await page.getByTestId('einstellung-graphics.crt').click();
  await page.getByTestId('einstellung-graphics.dither').click();
  await page.getByTestId('einstellung-graphics.scaleMode').click();
  await page.getByTestId('einstellung-graphics.lightBands').locator('.dh-menue__pfeil').first().click();
  // A detail option of the quality level (the level itself is the URL's `quality=low` on a logic page, set at every start).
  await page.getByTestId('einstellung-graphics.fog').click();
  await expect(wert(page, 'graphics.quality')).toHaveText(/\((angepasst|custom)\)$/);
  const g = await graphics(page);
  expect(g).toMatchObject({ fpsLimit: 30, crt: true, dither: false, scaleMode: 'pixelPerfect', lightBands: 7, fog: false });
  expect('vsync' in g).toBe(false);

  // Audio: Q/E switch tabs; the music one step down.
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('einstellungen-reiter-audio')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('einstellung-audio.music').locator('.dh-menue__pfeil').first().click();
  await page.getByTestId('einstellung-audio.subtitles').click();
  const audio = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().settings.audio);
  expect(audio).toMatchObject({ music: 0.65, subtitles: true });

  // A reload keeps every value (stored as version 2).
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('duskhearth.settings') ?? 'null') as { v: number });
  expect(stored.v).toBe(2);
  await openSettings(page);
  await expect(wert(page, 'graphics.fpsLimit')).toHaveText('30 FPS');
  await expect(wert(page, 'graphics.lightBands')).toHaveText('7');
  await page.getByTestId('einstellungen-reiter-audio').click();
  await expect(wert(page, 'audio.music')).toHaveText(/^65\s?%$/);
  expect(await graphics(page)).toMatchObject({ fpsLimit: 30, crt: true, dither: false, scaleMode: 'pixelPerfect', lightBands: 7 });

  // "Reiter zurücksetzen" restores the tab's section, the other sections stay.
  await page.getByTestId('einstellungen-abschnitt').click();
  await expect(wert(page, 'audio.music')).toHaveText(/^70\s?%$/);
  expect(await graphics(page)).toMatchObject({ fpsLimit: 30 });
  expect(errors).toEqual([]);
});

test('das Bildratenlimit wirkt: 30 FPS läuft auf jedem zweiten Bild der Anzeige, „An Bildwiederholrate“ auf jedem', async ({ page }) => {
  const errors = collectConsole(page);
  // A render scene that draws faster than 30 frames per second under SwiftShader (the limit has something to skip).
  await page.goto('/?debug=1&scenario=palette');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  const measure = async (limit: number): Promise<{ raf: number; ran: number }> => {
    await page.evaluate((l) => (window as unknown as { __dh: Dh }).__dh.exec(`set graphics.fpsLimit ${l}`), limit);
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('frameLimit') as { animationFrames: number; delivered: number });
    await page.waitForTimeout(3000);
    const b = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('frameLimit') as { animationFrames: number; delivered: number });
    return { raf: b.animationFrames - a.animationFrames, ran: b.delivered - a.delivered };
  };
  const coupled = await measure(0);
  expect(coupled.ran).toBe(coupled.raf);
  const capped = await measure(30);
  // The display ran faster than the cap: about every second frame ran, never more than 30 per second (3 s, ±2 of phase).
  expect(capped.raf).toBeGreaterThan(120);
  expect(capped.ran).toBeLessThanOrEqual(92);
  expect(capped.ran / capped.raf).toBeGreaterThan(0.4);
  expect(capped.ran / capped.raf).toBeLessThan(0.6);
  expect(errors).toEqual([]);
});
