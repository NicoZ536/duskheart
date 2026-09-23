/**
 * M0-11/M0-12: Ohne WebGL2 zeigt das Spiel eine verständliche Meldung auf Deutsch bzw. Englisch
 * (Sprache aus dem Browser), stürzt nicht ab und erzeugt keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

/** Makes `canvas.getContext('webgl2')` fail like on a browser without WebGL2. */
async function blockWebGl2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

const CASES = [
  { locale: 'de-DE', lang: 'de', title: 'WebGL2 ist nicht verfügbar', hint: /Hardwarebeschleunigung/, retry: 'Erneut versuchen' },
  { locale: 'en-US', lang: 'en', title: 'WebGL2 is not available', hint: /hardware acceleration/, retry: 'Try again' },
] as const;

for (const c of CASES) {
  test.describe(`ohne WebGL2 (${c.locale})`, () => {
    test.use({ locale: c.locale });

    test('zeigt eine verständliche Meldung ohne Konsolenfehler', async ({ page }) => {
      const msgs = collectConsole(page);
      await blockWebGl2(page);
      await page.goto('/?debug=1');
      const box = page.locator('[data-testid="no-webgl2"]');
      await expect(box).toBeVisible();
      await expect(box.locator('h1')).toHaveText(c.title);
      await expect(box).toContainText(c.hint);
      await expect(box.getByRole('button')).toHaveText(c.retry);
      await expect(box).toHaveAttribute('role', 'alert');
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(c.lang);
      // No crash: the page stays responsive and nothing else was started.
      expect(await page.evaluate(() => typeof (window as unknown as { __dh?: unknown }).__dh)).toBe('undefined');
      expect(msgs).toEqual([]);
    });
  });
}
