/**
 * M1-19 „keine GL-Fehler im E2E“ (MASTERPROMPT §6.3 Robustheit): jede Render-Szene, jede Ansicht des
 * Render-Debuggers und das Ab- und Anschalten jedes Passes rendern, ohne dass WebGL einen Fehler
 * meldet (`gl.getError()` nach mehreren Frames, über `__dh.call('glErrors')` geleert) – und ohne
 * Konsolenfehler. Ein absichtlich ungültiger Aufruf belegt, dass beide Wege (Fehlerabfrage und
 * Konsolenwarnung) einen GL-Fehler melden.
 */
import { expect, test, type Page } from '@playwright/test';
import { RENDER_SCENE_IDS } from '../../src/render/scenes/ids';

interface Dh {
  call(name: string, ...args: unknown[]): unknown;
}

interface PassInfo {
  readonly name: string;
  readonly enabled: boolean;
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

async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          left--;
          if (left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** Frames rendered per state before `gl.getError()` is read. */
const FRAMES_PER_STATE = 3;
/** No buffer target of WebGL2 (`bindBuffer` answers with INVALID_ENUM). */
const INVALID_BUFFER_TARGET = 0x1234;

test.use({ viewport: { width: 1280, height: 720 } });

test('keine GL-Fehler: alle Render-Szenen, alle Debug-Puffer, jeder Pass einzeln aus und wieder an', async ({ page }) => {
  test.setTimeout(240_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: { ready?: boolean } }).__dh?.ready === true);
  await frames(page, FRAMES_PER_STATE);
  expect(await dh<string[]>(page, 'glErrors'), 'Start').toEqual([]);
  // The probe itself: a deliberately invalid call on the page's context is reported once, then drained.
  await page.evaluate((target) => (document.getElementById('dh-canvas') as HTMLCanvasElement).getContext('webgl2')?.bindBuffer(target, null), INVALID_BUFFER_TARGET);
  expect(await dh<string[]>(page, 'glErrors')).toEqual(['INVALID_ENUM']);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);

  for (const id of RENDER_SCENE_IDS) {
    await dh(page, 'renderScene', id);
    await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady);
    await frames(page, FRAMES_PER_STATE);
    expect(await dh<string[]>(page, 'glErrors'), `Szene ${id}`).toEqual([]);
  }

  await dh(page, 'renderScene', 'normalmap-licht');
  await frames(page, FRAMES_PER_STATE);
  const views = await dh<{ available: string[] }>(page, 'renderDebug');
  for (const view of [...views.available, 'off']) {
    await dh(page, 'renderDebug', view);
    await frames(page, FRAMES_PER_STATE);
    expect(await dh<string[]>(page, 'glErrors'), `Debug-Puffer ${view}`).toEqual([]);
  }

  const passes = await dh<PassInfo[]>(page, 'renderPass');
  for (const p of passes) {
    await dh(page, 'renderPass', p.name, !p.enabled);
    await frames(page, FRAMES_PER_STATE);
    expect(await dh<string[]>(page, 'glErrors'), `Pass ${p.name} umgeschaltet`).toEqual([]);
    await dh(page, 'renderPass', p.name, p.enabled);
    await frames(page, FRAMES_PER_STATE);
    expect(await dh<string[]>(page, 'glErrors'), `Pass ${p.name} zurück`).toEqual([]);
  }
  // Chromium also logs every GL error as a console warning: only the provoked one may appear.
  expect(msgs).toEqual(['warning: WebGL: INVALID_ENUM: bindBuffer: invalid target']);
});
