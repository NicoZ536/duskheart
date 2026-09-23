/**
 * M1-14/M1-25 (§4.2): dieselbe Szene bei den vier Beispielauflösungen – interne Größe 480/480/640/480
 * × 270 und scharfe Pixel: jedes interne Pixel erscheint als einfarbiger Block (ganzzahliger Faktor:
 * ganzer Block; sonst Block ohne sein Randpixel), die Balken bleiben schwarz. Geprüft auf dem
 * echten Screenshot des Browsers, ohne Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORT_EXAMPLES } from '../../src/render/viewport';
import { decodePng } from '../../tools/lib/png';
import { checkSharpness, type PresentedLayout } from '../../tools/lib/sharpness';

/** Share of neighbouring internal pixels that must differ, so the block test is not trivial. */
const MIN_CONTRAST_SHARE = 0.05;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

for (const vp of VIEWPORT_EXAMPLES) {
  test.describe(`${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`intern ${vp.internalWidth}×${vp.internalHeight}, scharfe Pixel`, async ({ page }) => {
      const msgs = collectConsole(page);
      await page.goto('/?debug=1&scenario=aufloesungen');
      await page.waitForFunction(() => (window as unknown as { __dh?: { call(n: string): unknown } }).__dh?.call('scenarioReady') === true, undefined, { timeout: 90_000 });
      const layout = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): { viewport: PresentedLayout } } }).__dh.call('renderInfo').viewport);
      expect([layout.internalWidth, layout.internalHeight]).toEqual([vp.internalWidth, vp.internalHeight]);
      const shot = decodePng(await page.screenshot());
      expect([shot.width, shot.height]).toEqual([vp.width, vp.height]);
      const r = checkSharpness(shot, layout);
      expect(r.firstBlur).toBeNull();
      expect(r.uniformBlocks).toBe(r.blocks);
      expect(r.litBarPixels).toBe(0);
      expect(r.contrastEdges).toBeGreaterThan(r.blocks * MIN_CONTRAST_SHARE);
      expect(msgs).toEqual([]);
    });
  });
}
