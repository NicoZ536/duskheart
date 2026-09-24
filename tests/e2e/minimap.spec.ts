/**
 * M3-28 Minimap im Browser (Szenario `hud-minimap`): Minimap mit Tageszeit-Scheibe, Schild und
 * Kompassbalken erscheinen über der Spielansicht, pixelscharf in ganzzahliger UI-Skalierung (bei
 * 1920×1080 ist jeder Designpixel ein einfarbiger 4×4-Block) und nur in Palettenfarben; die Karte zoomt
 * über die Knöpfe (Maus und Tastatur mit Fokusrahmen) und das Mausrad; Schild und Beschreibungen nennen
 * Tag, Jahreszeit, Wetter, Mond und die Richtung der Marker. Keine Konsolenfehler.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PALETTE_HEX } from '../../src/generated/palette';
import { decodePng } from '../../tools/lib/png';

test.use({ viewport: { width: 1920, height: 1080 }, locale: 'de-DE' });
const SKALA = 4;
/** Größte Abweichung je Farbkanal in einem Designpixel: 0 für Leinwände, DOM-Text glättet Glyphenkanten leicht. */
const TOLERANZ_TEXT = 16;
/** Leinwände in Designpixeln (src/ui/hud/minimap/zeichnung.ts, kompass.ts). */
const MINIMAP = { w: 61, h: 76 } as const;
const KOMPASS = { w: 121, h: 16 } as const;

interface Dh {
  call(name: string, ...args: unknown[]): unknown;
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function oeffne(page: Page): Promise<void> {
  await page.goto('/?debug=1&scenario=hud-minimap');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 90_000 });
}

/** Pixel einer Leinwand (über `toDataURL` gelesen – ohne `getImageData`, das Chromium bei Wiederholung anmahnt). */
async function leinwandPixel(canvas: Locator): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const url = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL('image/png'));
  return decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

/** Die deckenden Farben einer Leinwand. */
async function leinwandFarben(canvas: Locator): Promise<string[]> {
  const { rgba } = await leinwandPixel(canvas);
  const out = new Set<string>();
  for (let i = 0; i < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) === 0) continue;
    out.add(`#${[rgba[i], rgba[i + 1], rgba[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`);
  }
  return [...out];
}

async function leinwandBild(canvas: Locator): Promise<string> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
}

/**
 * Prüft, dass das Element auf dem Bildschirm aus einfarbigen SKALA×SKALA-Blöcken besteht – bei Leinwänden
 * nur dort, wo sie deckend sind (durch durchsichtige Ecken scheint die Spielwelt mit ihrem eigenen
 * Subpixel-Versatz, ADR-0014).
 */
async function scharf(page: Page, el: Locator, toleranz = 0): Promise<void> {
  const box = await el.boundingBox();
  if (box === null) throw new Error('kein Layout');
  expect(Number.isInteger(box.x) && Number.isInteger(box.y)).toBe(true);
  const istLeinwand = await el.evaluate((e) => e instanceof HTMLCanvasElement);
  const pixel = istLeinwand ? await leinwandPixel(el) : null;
  const deckend = pixel === null ? null : { w: pixel.width, a: Array.from({ length: pixel.width * pixel.height }, (_, i) => (pixel.rgba[i * 4 + 3] ?? 0) > 0) };
  const img = decodePng(await page.screenshot({ clip: box }));
  let unscharf = 0;
  let geprueft = 0;
  for (let by = 0; by + SKALA <= img.height; by += SKALA) {
    for (let bx = 0; bx + SKALA <= img.width; bx += SKALA) {
      if (deckend !== null && deckend.a[(by / SKALA) * deckend.w + bx / SKALA] !== true) continue;
      geprueft++;
      const o = (by * img.width + bx) * 4;
      for (let dy = 0; dy < SKALA; dy++) {
        for (let dx = 0; dx < SKALA; dx++) {
          const p = ((by + dy) * img.width + bx + dx) * 4;
          for (let c = 0; c < 3; c++) if (Math.abs((img.rgba[p + c] ?? 0) - (img.rgba[o + c] ?? 0)) > toleranz) unscharf++;
        }
      }
    }
  }
  expect(geprueft).toBeGreaterThan(100);
  expect(unscharf).toBe(0);
}

async function warteNeuesBild(canvas: Locator, alt: string): Promise<string> {
  await expect.poll(() => leinwandBild(canvas)).not.toBe(alt);
  return leinwandBild(canvas);
}

test('Minimap, Scheibe und Kompass: scharf, Palettenfarben, Beschreibung', async ({ page }) => {
  const errors = collectConsole(page);
  await oeffne(page);
  const minimap = page.getByTestId('hud-minimap');
  await expect(minimap).toHaveAttribute('data-bereit', '1');
  const karte = minimap.locator('canvas');
  const kompass = page.getByTestId('hud-kompass').locator('canvas');
  expect(await karte.boundingBox()).toMatchObject({ width: MINIMAP.w * SKALA, height: MINIMAP.h * SKALA });
  expect(await kompass.boundingBox()).toMatchObject({ width: KOMPASS.w * SKALA, height: KOMPASS.h * SKALA });
  // Oben rechts mit 2 Designpixeln Rand, Kompass mittig.
  const kb = await karte.boundingBox();
  expect((kb?.x ?? 0) + (kb?.width ?? 0)).toBe(1920 - 2 * SKALA);
  const cb = await kompass.boundingBox();
  expect((cb?.x ?? 0) + (cb?.width ?? 0) / 2).toBe(960 + SKALA / 2);
  const palette = new Set(PALETTE_HEX.map((h) => h.toLowerCase()));
  for (const c of [karte, kompass]) {
    const farben = await leinwandFarben(c);
    expect(farben.length).toBeGreaterThan(8);
    expect(farben.filter((f) => !palette.has(f))).toEqual([]);
  }
  await scharf(page, karte);
  await scharf(page, kompass);
  await scharf(page, page.getByTestId('hud-minimap-info'), TOLERANZ_TEXT);
  await expect(page.getByTestId('hud-minimap-info')).toHaveText('Tag 1 · Frühling');
  await expect(page.getByTestId('hud-minimap-info').locator('img')).toHaveAttribute('alt', 'Klar');
  const beschreibung = (await karte.getAttribute('aria-label')) ?? '';
  expect(beschreibung).toContain('17:20 Uhr, Tag');
  expect(beschreibung).toMatch(/Dein Grab im (Nordosten|Osten|Norden)\./);
  expect(beschreibung).toContain('Startstrand');
  await expect(kompass).toHaveAttribute('aria-label', /^Kompass, Blick nach Norden\. /);
  expect(errors).toEqual([]);
});

test('Zoom: Knöpfe mit Maus und Tastatur (Fokusrahmen), Mausrad; Grenzen gesperrt', async ({ page }) => {
  const errors = collectConsole(page);
  await oeffne(page);
  const minimap = page.getByTestId('hud-minimap');
  const karte = minimap.locator('canvas');
  const raus = page.getByTestId('hud-minimap-raus');
  const rein = page.getByTestId('hud-minimap-rein');
  await expect(minimap).toHaveAttribute('data-zoom', '1');
  let bild = await leinwandBild(karte);
  await raus.click();
  await expect(minimap).toHaveAttribute('data-zoom', '2');
  bild = await warteNeuesBild(karte, bild);
  await rein.click();
  await rein.click();
  await expect(minimap).toHaveAttribute('data-zoom', '0');
  await expect(rein).toBeDisabled();
  bild = await warteNeuesBild(karte, bild);
  // Tastatur: Der Knopf ist ein echter, fokussierbarer Knopf (im Fokussystem M3-31 als `data-fokus`
  // markiert); mit Tastaturfokus zeigt er die Hover-Grafik des Kits als Fokusrahmen, Enter zoomt.
  await expect(raus).toHaveAttribute('data-fokus', '');
  await page.keyboard.press('Shift');
  await raus.focus();
  expect(await raus.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))).toBe(true);
  expect(await raus.evaluate((el) => getComputedStyle(el).borderImageSource)).toContain('knopf_hover');
  await page.keyboard.press('Enter');
  await expect(minimap).toHaveAttribute('data-zoom', '1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(minimap).toHaveAttribute('data-zoom', '3');
  await expect(raus).toBeDisabled();
  bild = await warteNeuesBild(karte, bild);
  // Mausrad über der Karte: nach vorn näher.
  await karte.hover();
  await page.mouse.wheel(0, -100);
  await expect(minimap).toHaveAttribute('data-zoom', '2');
  await warteNeuesBild(karte, bild);
  expect(errors).toEqual([]);
});
