/**
 * M1-23 im Browser: die weltnahe UI (Namen, Leisten, Schadenszahlen, Interaktionsmarker) erscheint
 * nach geladener Pixelschrift über der Nacht-Lichtung, in exakt ihren UI-/Palettenfarben (nach Licht
 * und Post gezeichnet, also weder abgedunkelt noch getönt), auf ganzen Pixeln (jedes interne Pixel
 * ein 4×4-Block bei 1920×1080), und verschwindet, wenn ihr Pass abgeschaltet wird – ohne Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { PALETTE_HEX, PALETTE_RAMPS, UI_HEX } from '../../src/generated/palette';
import { paletteRefHex } from '../../src/render/palette/rows';
import { decodePng } from '../../tools/lib/png';

/** 1920×1080: internal 480×270 at exactly ×4; the scene's camera is centred on world (0, 0). */
test.use({ viewport: { width: 1920, height: 1080 } });
const SCALE = 4;
const VIEW_W = 480;
const VIEW_H = 270;

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

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/** Screen rectangle [x0, y0, x1, y1) of a world rectangle. */
function screenRect(wx0: number, wy0: number, wx1: number, wy1: number): [number, number, number, number] {
  return [(wx0 + VIEW_W / 2) * SCALE, (wy0 + VIEW_H / 2) * SCALE, (wx1 + VIEW_W / 2) * SCALE, (wy1 + VIEW_H / 2) * SCALE];
}

/** Pixels of colour `hex` inside `rect`, and whether each of them sits in a uniform 4×4 block. */
async function countColour(page: Page, rect: [number, number, number, number], hex: string): Promise<{ count: number; blocky: boolean }> {
  const img = decodePng(await page.screenshot());
  const v = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const is = (x: number, y: number): boolean => {
    const o = (y * img.width + x) * 4;
    return img.rgba[o] === r && img.rgba[o + 1] === g && img.rgba[o + 2] === b;
  };
  let count = 0;
  let blocky = true;
  for (let y = rect[1]; y < rect[3]; y++) {
    for (let x = rect[0]; x < rect[2]; x++) {
      if (!is(x, y)) continue;
      count++;
      const bx = x - (x % SCALE);
      const by = y - (y % SCALE);
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) if (!is(bx + dx, by + dy)) blocky = false;
    }
  }
  return { count, blocky };
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('Welt-UI: Namen und Leisten pixelscharf in UI-Farben über der Nacht, Pass abschaltbar', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=welt-ui');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 90_000 });
  const info = await dh<{ worldUiFont: string; gameAtlas: string; scene: string }>(page, 'renderInfo');
  expect(info).toMatchObject({ worldUiFont: 'bereit', gameAtlas: 'bereit', scene: 'welt-ui' });

  // The player's name above the head (baseline at world y = 8, centred on x = −40) and the life bar below it.
  const nameRect = screenRect(-62, -2, -18, 11);
  const barRect = screenRect(-52, 10, -28, 16);
  const lifeLight = paletteRefHex('feuer.2', PALETTE_RAMPS, PALETTE_HEX);
  const name = await countColour(page, nameRect, UI_HEX.text);
  const outline = await countColour(page, nameRect, UI_HEX.dunkel);
  const bar = await countColour(page, barRect, lifeLight);
  expect(name.count).toBeGreaterThan(20 * SCALE * SCALE);
  expect(name.blocky).toBe(true);
  expect(outline.count).toBeGreaterThan(name.count);
  // 34 of 50 over 20 px: 14 px fill – 13 in the lit row plus the end column of the lower row.
  expect(bar.count).toBe(14 * SCALE * SCALE);
  expect(bar.blocky).toBe(true);

  // Pass off: the ground at night has none of these exact UI colours; back on: identical again.
  await dh(page, 'renderPass', 'welt-ui', false);
  await nextFrames(page);
  expect((await countColour(page, nameRect, UI_HEX.text)).count).toBe(0);
  expect((await countColour(page, barRect, lifeLight)).count).toBe(0);
  await dh(page, 'renderPass', 'welt-ui', true);
  await nextFrames(page);
  expect((await countColour(page, nameRect, UI_HEX.text)).count).toBe(name.count);
  expect(msgs).toEqual([]);
});
