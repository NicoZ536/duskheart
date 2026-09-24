/**
 * M3-29 Benachrichtigungen im Browser (Szenario `hud-meldungen`): die feste Folge zeigt Entdeckung,
 * Warnung und gestapelte Aufsammel-Meldungen („Feuerstein ×3“, „Leuchtpilz ×2“ in Raritätsfarbe), nie
 * mehr als vier gleichzeitig; weiteres Aufsammeln stapelt; über die Zeit blenden Meldungen in harten Stufen
 * aus, Wartende rücken nach (Warnung vor Aufsammeln), am Ende ist der Stapel leer. Pixelscharf, keine
 * Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { PALETTE_HEX, PALETTE_RAMPS, RARITY_REFS } from '../../src/generated/palette';
import { paletteRefHex } from '../../src/render/palette/rows';
import { decodePng } from '../../tools/lib/png';

test.use({ viewport: { width: 1920, height: 1080 }, locale: 'de-DE' });
const SKALA = 4;
/** Größte Abweichung je Farbkanal innerhalb eines Designpixels (Graustufen-Glättung an Glyphenkanten). */
const TOLERANZ = 16;

interface Dh {
  call(name: string, ...args: unknown[]): unknown;
}

interface Steuerung {
  uhr(s: number): void;
  aufsammeln(item: string, n: number): void;
  warnung(stufe: string): void;
  zaehle(): { sichtbar: number; wartend: number };
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
  await page.goto('/?debug=1&scenario=hud-meldungen');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 90_000 });
}

/** Ruft eine Methode der Teststeuerung am Wirt auf (`dhSzenario`, src/ui/hud/minimap/szenario.tsx). */
function steuere<K extends keyof Steuerung>(page: Page, methode: K, ...args: Parameters<Steuerung[K]>): Promise<ReturnType<Steuerung[K]>> {
  return page.evaluate(
    ([m, a]) => {
      const el = document.querySelector('[data-hud-szenario]') as (HTMLElement & { dhSzenario?: Record<string, (...x: unknown[]) => unknown> }) | null;
      const f = el?.dhSzenario?.[m];
      if (f === undefined) throw new Error(`HUD-Szenario: ${m} fehlt`);
      return f(...a);
    },
    [methode, args] as const,
  ) as Promise<ReturnType<Steuerung[K]>>;
}

function texte(page: Page): Promise<string[]> {
  return page.locator('.dh-hud-meldung__text').allInnerTexts();
}

test('feste Folge: vier Schilder, Stapel, Raritätsfarbe, Warnung als Alarm, pixelscharf', async ({ page }) => {
  const errors = collectConsole(page);
  await oeffne(page);
  const stapel = page.getByTestId('hud-meldungen');
  await expect(stapel).toHaveAttribute('data-bereit', '1');
  await expect(stapel).toHaveAttribute('aria-live', 'polite');
  expect(await texte(page)).toEqual(['Entdeckt: Salzküste', 'Die Dunkelheit naht. Entzünde ein Licht.', 'Feuerstein ×3', 'Leuchtpilz ×2']);
  expect(await steuere(page, 'zaehle')).toEqual({ sichtbar: 4, wartend: 2 });
  await expect(page.locator('.dh-hud-meldung[data-art="warnung"]')).toHaveAttribute('role', 'alert');
  const gruen = paletteRefHex(RARITY_REFS.ungewoehnlich, PALETTE_RAMPS, PALETTE_HEX);
  const farbe = await page.locator('.dh-hud-meldung__text', { hasText: 'Leuchtpilz' }).evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(gruen.slice(i, i + 2), 16));
  expect(farbe).toBe(`rgb(${r}, ${g}, ${b})`);
  // Alle Symbole geladen (keine leeren Plätze) und jedes Schild aus ganzen 4×4-Blöcken.
  expect(await page.locator('.dh-hud-meldung img.dh-hud-meldung__symbol').count()).toBe(4);
  // Jedes Schild ist deckend (zwischen ihnen scheint die Spielwelt mit eigenem Subpixel-Versatz durch).
  // DOM-Text glättet Chromium in Graustufen: An Glyphenkanten bleiben Abweichungen bis TOLERANZ je Kanal,
  // echte Unschärfe (halbe Designpixel, skalierte Symbole) wiche um ein Vielfaches ab.
  let unscharf = 0;
  for (const schild of await page.locator('.dh-hud-meldung').all()) {
    const box = await schild.boundingBox();
    if (box === null) throw new Error('kein Layout');
    expect(Number.isInteger(box.x) && Number.isInteger(box.y)).toBe(true);
    const img = decodePng(await page.screenshot({ clip: box }));
    for (let by = 0; by + SKALA <= img.height; by += SKALA) {
      for (let bx = 0; bx + SKALA <= img.width; bx += SKALA) {
        const o = (by * img.width + bx) * 4;
        for (let d = 1; d < SKALA * SKALA; d++) {
          const p = ((by + Math.floor(d / SKALA)) * img.width + bx + (d % SKALA)) * 4;
          for (let c = 0; c < 3; c++) if (Math.abs((img.rgba[p + c] ?? 0) - (img.rgba[o + c] ?? 0)) > TOLERANZ) unscharf++;
        }
      }
    }
  }
  expect(unscharf).toBe(0);
  expect(errors).toEqual([]);
});

test('Stapeln, Ausblenden in Stufen, Nachrücken nach Vorrang, nie mehr als vier', async ({ page }) => {
  const errors = collectConsole(page);
  await oeffne(page);
  // Weiteres Aufsammeln stapelt auf das sichtbare Schild.
  await steuere(page, 'aufsammeln', 'feuerstein', 2);
  await expect(page.locator('.dh-hud-meldung__text', { hasText: 'Feuerstein' })).toHaveText('Feuerstein ×5');
  expect(await page.locator('.dh-hud-meldung').count()).toBe(4);
  // Der Stau verdrängt die älteste Aufsammel-Meldung nach ihrer Mindestzeit (Leuchtpilz; Feuerstein wurde gerade gestapelt).
  await steuere(page, 'uhr', 11.3);
  const leuchtpilz = page.locator('.dh-hud-meldung', { hasText: 'Leuchtpilz' });
  await expect(leuchtpilz).toHaveAttribute('data-phase', 'aus');
  expect(Number(await leuchtpilz.evaluate((el) => getComputedStyle(el).opacity))).toBe(0.75);
  // Danach rückt die Warnung vor dem Holz nach; es sind nie mehr als vier.
  for (const t of [11.7, 12.2, 12.7, 13.2, 14]) {
    await steuere(page, 'uhr', t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.locator('.dh-hud-meldung').count()).toBeLessThanOrEqual(4);
  }
  await expect(page.locator('.dh-hud-meldung__text')).toContainText(['Entdeckt: Salzküste', 'Die Dunkelheit naht. Entzünde ein Licht.']);
  expect(await texte(page)).toContain('Dir ist kalt. Wärm dich an einem Feuer.');
  const vorHolz = await texte(page);
  expect(vorHolz.indexOf('Dir ist kalt. Wärm dich an einem Feuer.')).toBeGreaterThan(-1);
  await steuere(page, 'uhr', 16);
  await expect.poll(() => texte(page)).toContain('Holz ×4');
  // Nach allen Anzeigedauern ist der Stapel leer.
  await steuere(page, 'uhr', 60);
  await expect(page.locator('.dh-hud-meldung')).toHaveCount(0);
  expect(await steuere(page, 'zaehle')).toEqual({ sichtbar: 0, wartend: 0 });
  expect(errors).toEqual([]);
});
