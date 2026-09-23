/** Browser-side render benchmarks (draw calls, instance counts, JS render-prep time, heap, console errors). */
import { openGame, startBrowserSession } from '../lib/browser';
import type { Measurement } from './thresholds';

export interface RenderBenchResult {
  frames: number;
  drawCallsMax: number;
  spritesMax: number;
  lightsMax: number;
  particlesMax: number;
  prepMsP95: number;
  heapMb: number;
}

export interface RenderScenario {
  /** Scenario name in the report and the threshold file. */
  readonly name: string;
  /** Screenshot scenario loaded in the page (`?scenario=`). */
  readonly scenario: string;
  readonly frames: number;
}

export const RENDER_SCENARIOS: readonly RenderScenario[] = [{ name: 'render:testszene', scenario: 'testszene', frames: 120 }];

export async function runRenderScenarios(list: readonly RenderScenario[]): Promise<Measurement[]> {
  const out: Measurement[] = [];
  const session = await startBrowserSession();
  try {
    for (const s of list) {
      const { page, errors } = await openGame(session, `scenario=${s.scenario}`, { width: 1920, height: 1080 });
      const r = await page.evaluate(async (frames) => {
        const dh = (window as unknown as { __dh: { call(name: 'benchRender', n: number): Promise<RenderBenchResult> } }).__dh;
        return dh.call('benchRender', frames);
      }, s.frames);
      out.push(
        { scenario: s.name, metric: 'draw calls (max)', value: r.drawCallsMax, unit: '' },
        { scenario: s.name, metric: 'render prep p95', value: r.prepMsP95, unit: 'ms' },
        { scenario: s.name, metric: 'JS heap', value: r.heapMb, unit: 'MB' },
        { scenario: s.name, metric: 'console errors', value: errors.length, unit: '' },
      );
      if (errors.length > 0) console.error(errors.join('\n'));
      await page.close();
    }
  } finally {
    await session.close();
  }
  return out;
}
