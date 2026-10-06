/**
 * M7-49 Die Karte im Browser (MASTERPROMPT §25 "Karte (M): Pergament-Pixel-Look, Nebel über Unerkundetem, Aufdeckung im Radius
 * 20 Tiles … Marker … eigene (Symbol + Name); Zoom; Ebenenwechsel"; docs/SPIEL.md §18): M öffnet und schließt die Karte; das Bild
 * ist eine Leinwand in Palettenfarben, um den Startstrand aufgedeckt, der Rest Pergament; Gehen deckt mehr auf; Zoom über Knöpfe
 * und Mausrad; ein eigener Marker wird mit Symbol und Name gesetzt, umbenannt und entfernt (Ereignisse der Simulation); eine
 * aufgedeckte Höhlenebene bekommt ihren Knopf. Keine Konsolenfehler.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PALETTE_HEX } from '../../src/generated/palette';
import { decodePng } from '../../tools/lib/png';
import { logicUrl } from './logik';

test.use({ viewport: { width: 1920, height: 1080 }, locale: 'de-DE' });

const TILE_PX = 16;

interface Dh {
  ready?: boolean;
  call(name: string, ...args: unknown[]): unknown;
  command(cmd: unknown): unknown;
  state(): { sim: { player: { x: number; y: number } | null; events: Record<string, number> } };
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function starte(page: Page): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
}

async function ereignisse(page: Page, typ: string): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, typ);
}

async function anteil(karte: Locator): Promise<number> {
  return Number(await karte.getByTestId('karte-erkundet').getAttribute('data-anteil'));
}

/** Die Farben der Kartenleinwand (über `toDataURL`). */
async function farben(page: Page): Promise<Set<string>> {
  const url = await page.locator('.dh-karte__leinwand').evaluate((el) => (el as HTMLCanvasElement).toDataURL('image/png'));
  const { rgba } = decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  const out = new Set<string>();
  for (let i = 0; i < rgba.length; i += 4) out.add(`#${[rgba[i], rgba[i + 1], rgba[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`);
  return out;
}

test('Karte: öffnen, aufdecken, zoomen, eigene Marker, Ebenen', async ({ page }) => {
  test.setTimeout(240_000);
  const fehler = collectConsole(page);
  await starte(page);
  const karte = page.getByTestId('ui-karte');

  // M opens the map: around the start beach revealed, the rest parchment; only palette colours.
  await page.keyboard.press('m');
  await expect(karte).toBeVisible();
  await expect.poll(() => anteil(karte), { timeout: 20_000 }).toBeGreaterThan(0);
  const start = await anteil(karte);
  const palette = new Set(PALETTE_HEX.map((h) => h.toLowerCase()));
  await expect.poll(async () => [...(await farben(page))].every((c) => palette.has(c)), { timeout: 10_000 }).toBe(true);
  const f = await farben(page);
  expect(f.has('#efe0a8')).toBe(true); // parchment (sand.4): the mist over the unexplored
  expect(f.size).toBeGreaterThan(3);
  await expect(karte.getByTestId('karte-spieler')).toBeVisible();

  // Zoom: buttons and the wheel.
  await expect(karte.getByTestId('karte-zoom')).toHaveText('×4');
  await karte.getByTestId('karte-zoom-nah').click();
  await expect(karte.getByTestId('karte-zoom')).toHaveText('×8');
  await karte.getByTestId('karte-bild').hover();
  await page.mouse.wheel(0, 300);
  await expect(karte.getByTestId('karte-zoom')).toHaveText('×4');

  // An own marker: symbol, name, place it (at the figure) – the simulation's event and the list.
  const marked = await ereignisse(page, 'mapMarked');
  await karte.getByTestId('karte-symbol-eigen_3').click();
  await karte.getByTestId('karte-name').fill('Testlager');
  await karte.getByTestId('karte-setzen').click();
  await expect.poll(() => ereignisse(page, 'mapMarked')).toBe(marked + 1);
  const liste = karte.getByTestId('karte-eigene');
  await expect(liste).toContainText('Testlager');
  await expect(karte.locator('[data-marker="eigen"]')).toHaveCount(1);
  const id = Number(await liste.locator('[data-eigen]').first().getAttribute('data-eigen'));

  // Rename it, then remove it.
  await karte.getByTestId(`karte-umbenennen-knopf-${id}`).click();
  await karte.getByTestId(`karte-umbenennen-${id}`).fill('Erzlager');
  await karte.getByTestId(`karte-umbenennen-${id}`).press('Enter');
  await expect(liste).toContainText('Erzlager');
  expect(await ereignisse(page, 'mapRenamed')).toBe(1);
  await karte.getByTestId(`karte-entfernen-${id}`).click();
  await expect(liste.locator('[data-eigen]')).toHaveCount(0);
  expect(await ereignisse(page, 'mapUnmarked')).toBe(1);

  // A click on the map picks the spot of the next marker.
  await karte.getByTestId('karte-bild').click({ position: { x: 100, y: 100 } });
  await expect(karte.getByTestId('karte-ziel')).toBeVisible();

  // M closes it; walking 60 tiles reveals more; reopened, the share grew.
  await page.keyboard.press('m');
  await expect(karte).toBeHidden();
  const p = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player as { x: number; y: number });
  await page.evaluate(([x, y]) => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.teleport', x, y, layer: 0 }), [p.x + 60 * TILE_PX, p.y] as const);
  await page.waitForFunction((x) => ((window as unknown as { __dh: Dh }).__dh.state().sim.player?.x ?? 0) > x, p.x + 30 * TILE_PX);
  await page.keyboard.press('m');
  await expect(karte).toBeVisible();
  await expect.poll(() => anteil(karte), { timeout: 20_000 }).toBeGreaterThan(start);

  // A revealed cave layer gets its button; switching shows it.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'map.reveal', layer: -1 }));
  await expect(karte.getByTestId('karte-ebene-1')).toBeVisible({ timeout: 20_000 });
  await karte.getByTestId('karte-ebene-1').click();
  await expect(karte.getByTestId('karte-ebene')).toHaveText('Höhlen, erste Tiefe');
  await expect.poll(() => anteil(karte), { timeout: 20_000 }).toBe(1);
  await karte.getByTestId('karte-figur').click();
  await expect(karte.getByTestId('karte-ebene')).toHaveText('Oberfläche');
  await karte.getByTestId('karte-schliessen').click();
  await expect(karte).toBeHidden();

  expect(fehler).toEqual([]);
});
