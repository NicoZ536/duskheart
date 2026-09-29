/**
 * M5-27: der Render-Debugger ist komplett – das Nachtlager am Startstrand (Szenario `nacht-fackel`, Spielansicht mit
 * Lagerfeuer und Fackeln) durch jeden Puffer: die elf aus §6.3 (Albedo, Normalen, Höhe, Emissiv, SDF, Sonnenschatten,
 * Licht, GI, Nässe, Nebel, Gameplay-Lichtkarte) und die weiteren der Stränge. Jeder Puffer lässt sich schalten, zeigt
 * ein anderes Bild als das Endbild, trägt seine Beschriftung (Name und Legende), und nichts meldet GL- oder
 * Konsolenfehler. Der GI-Puffer ist leer (schwarz), solange der Renderer keine GI-Pässe hat, und sagt in seiner
 * Beschriftung sachlich, dass GI nicht aktiv ist (kein Versprechen, MASTERPROMPT §2.1); `off` zeigt wieder das Endbild.
 */
import { expect, test, type Page } from '@playwright/test';
import { DEBUG_VIEW_NAMES, REQUIRED_DEBUG_VIEWS } from '../../src/render/debug/catalog';

type Rgba = readonly [number, number, number, number];

interface DhApi {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

/** Spacing of the fine probe grid over the camp [CSS px]. */
const CAMP_STEP = 16;
/** The scenario runs the session's world under SwiftShader: minutes on a loaded machine. */
const SCENARIO_TIMEOUT = 600_000;

/** Buffers with content at the night camp (G-buffer, distance field, the camp's light, the light map comparison, the lit image). */
const WITH_CONTENT: ReadonlySet<string> = new Set(['albedo', 'normal', 'height', 'emissive', 'sdf', 'light', 'lightmap', 'lightmap-quellen', 'material', 'hdr']);

test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(SCENARIO_TIMEOUT + 600_000);

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhApi }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/** A coarse grid over the canvas and a fine one over the camp in its middle (the fire is small). */
function grid(step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = step / 2; y < 720; y += step) for (let x = step / 2; x < 1280; x += step) pts.push([x, y]);
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) pts.push([640 + i * CAMP_STEP, 360 + j * CAMP_STEP]);
  return pts;
}

/**
 * The grid's pixels, read in the second frame after the switch (a view's own pass draws in the frame after the view
 * asked for it). A coarse grid: every probed pixel is a read of its own on the software rasteriser.
 */
function picture(page: Page): Promise<string[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhApi }).__dh;
    await d.readPixel(0, 0);
    const px = await Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
    return px.map((p) => `${p[0]},${p[1]},${p[2]}`);
  }, grid(96));
}

test('jeder Puffer des Render-Debuggers lässt sich schalten, zeigt sein Bild und seine Beschriftung', async ({ page }) => {
  const errors = collectConsole(page);
  // The buffers, not the level, are judged here: "Niedrig" renders the pipeline fastest under SwiftShader.
  await page.goto('/?debug=1&scenario=nacht-fackel&quality=low');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhApi }).__dh?.call('scenarioReady') === true, undefined, { timeout: SCENARIO_TIMEOUT, polling: 500 });
  const available = (await dh<{ available: string[] }>(page, 'renderDebug')).available;
  for (const v of REQUIRED_DEBUG_VIEWS) expect(available, v).toContain(v);
  for (const v of DEBUG_VIEW_NAMES) expect(available, v).toContain(v);
  await dh(page, 'glErrors');

  const caption = page.getByTestId('render-debug-puffer');
  await expect(caption).toHaveCount(0);
  const final = await picture(page);

  for (const view of DEBUG_VIEW_NAMES) {
    const res = await dh<{ current: string }>(page, 'renderDebug', view);
    expect(res.current, view).toBe(view);
    const shown = await picture(page);
    expect((await dh<{ debugView: string }>(page, 'renderInfo')).debugView, view).toBe(view);
    // A buffer, not the final image.
    expect(shown.filter((p, i) => p !== final[i]).length, `${view}: Bild wie das Endbild`).toBeGreaterThan(0);
    await expect(caption, view).toHaveAttribute('data-puffer', view);
    await expect(caption, view).toContainText(/Render-Debugger|Render debugger/);
    expect((await caption.textContent())?.includes('debug.puffer'), `${view}: Schlüssel statt Text`).toBe(false);
    if (view === 'gi') {
      // The radiance cascades' buffer: empty, and its caption says as a fact that GI is not active (review M5 Minor 13).
      expect(shown.every((p) => p === '0,0,0'), 'GI-Puffer leer').toBe(true);
      await expect(caption).toContainText(/nicht aktiv|not active/);
      await expect(caption).toContainText(/leer|empty/);
      await expect(caption).not.toContainText(/M13|kommt|noch nicht|comes|not yet/);
    } else if (WITH_CONTENT.has(view)) {
      // These buffers hold something in every scene with a camp (weather buffers – wetness, fog, snow, puddles – and
      // effect buffers are empty in a dry, clear night and must only be shown).
      expect(new Set(shown).size, `${view}: einfarbig`).toBeGreaterThan(1);
    }
    expect(await dh<string[]>(page, 'glErrors'), view).toEqual([]);
  }

  await dh(page, 'renderDebug', 'off');
  const back = await picture(page);
  expect(back.filter((p, i) => p !== final[i]).length).toBe(0);
  await expect(caption).toHaveCount(0);
  expect(errors).toEqual([]);
});
