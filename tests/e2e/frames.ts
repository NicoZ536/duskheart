/**
 * Frames the renderer drew (M5 integration; src/render/gl/framePacer.ts). On SwiftShader – the CPU rasteriser of the
 * headless browser – the page keeps at most two frames queued for the rasteriser: its frame callback runs on at the
 * display rate (input, simulation ticks, DOM UI) and draws nothing while the queue is full. A spec that waits for the
 * picture, the render statistics (`renderInfo`, `worldInfo`) or the GL errors of a new state therefore waits for frames
 * the renderer drew (`__dh.call('frames')`), not for animation frames of the page. Input and the DOM UI follow every
 * animation frame: the `press` helpers of the specs keep waiting for those.
 */
import type { Page } from '@playwright/test';

/** Waits until the renderer has drawn `n` more frames (a debug page: `?debug=1`). */
export async function renderedFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(async (count) => {
    const dh = (window as unknown as { __dh: { call(name: 'frames'): number } }).__dh;
    const target = dh.call('frames') + count;
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (dh.call('frames') >= target) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }, n);
}
