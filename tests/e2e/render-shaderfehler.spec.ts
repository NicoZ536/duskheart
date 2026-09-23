/**
 * M1-09: Ein fehlerhafter Shader (Hot-Reload im Dev-Server, hier über `__dh.call('shaderEdit', …)`)
 * zeigt das Fehler-Overlay mit Datei und Zeile, statt abzustürzen: das Spiel rendert mit dem letzten
 * funktionierenden Programm weiter. Nach der Korrektur verschwindet das Overlay.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  ready: boolean;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

const FILE = 'sprite_gbuffer.frag';
const BROKEN_LINE = '  float kaputt = nichtDeklariert * 2.0;';
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [480, 540],
  [960, 700],
  [1400, 300],
  [300, 900],
];

/** 1920×1080: internal 480×270 at exactly ×4 (no linear step, palette-exact pixels). */
test.use({ locale: 'de-DE', viewport: { width: 1920, height: 1080 } });

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhRender }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

function probe(page: Page): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, POINTS);
}

test('fehlerhafter Shader: Overlay mit Datei und Zeile, Spiel rendert mit dem letzten guten Programm weiter', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=palette-swap');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
  const before = await probe(page);
  const overlay = page.getByTestId('shader-error-overlay');
  await expect(overlay).toHaveCount(0);

  const source = await dh<string>(page, 'shaderSource', FILE);
  const lines = source.split('\n');
  const mainLine = lines.findIndex((l) => l.startsWith('void main()'));
  expect(mainLine).toBeGreaterThan(0);
  lines.splice(mainLine + 1, 0, BROKEN_LINE);
  const result = await dh<{ shaderErrors: string[] }>(page, 'shaderEdit', FILE, lines.join('\n'));
  expect(result.shaderErrors).toEqual(['sprite-gbuffer']);

  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Shader-Fehler');
  await expect(overlay).toContainText(`${FILE}, Zeile ${mainLine + 2}`);
  await expect(overlay).toContainText('nichtDeklariert');
  await expect(overlay).toContainText('letzten funktionierenden Fassung');

  // The game keeps running: frames advance and the image is the one of the last good program.
  const frames = await dh<number>(page, 'frames');
  await page.waitForFunction((f) => ((window as unknown as { __dh: DhRender }).__dh.call('frames') as number) > f + 10, frames);
  expect(await probe(page)).toEqual(before);

  await dh(page, 'shaderEdit', FILE, null);
  await expect(overlay).toHaveCount(0);
  expect((await dh<{ shaderErrors: string[] }>(page, 'renderInfo')).shaderErrors).toEqual([]);
  expect(await probe(page)).toEqual(before);
  // The only console output is the reported shader error itself.
  expect(msgs.length).toBeGreaterThan(0);
  for (const m of msgs) expect(m).toMatch(/^error: ShaderError|^error: Shader „sprite-gbuffer“/);
});
