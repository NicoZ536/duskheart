/** Browser-side render benchmarks (draw calls, instance counts, JS render-prep time). */
import { openGame, startGameSession } from '../lib/browser';

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
  name: string;
  scenario: string;
  frames: number;
  limits: { drawCalls: number; prepMsP95: number; heapMb: number; minSprites?: number; minLights?: number };
}

/** Budget §30: Draw-Calls ≤ 150, Render-Vorbereitung ≤ 3 ms (Marge ×1,5 für den Headless-Messaufbau), Heap ≤ 350 MB. */
export const RENDER_SCENARIOS: RenderScenario[] = [
  { name: 'render:testszene', scenario: 'testszene', frames: 120, limits: { drawCalls: 150, prepMsP95: 4.5, heapMb: 350 } },
];

export async function runRenderScenarios(list: readonly RenderScenario[]): Promise<Array<{ name: string; metric: string; value: number; limit: number; unit: string }>> {
  const rows: Array<{ name: string; metric: string; value: number; limit: number; unit: string }> = [];
  const session = await startGameSession();
  try {
    for (const s of list) {
      const { page, errors } = await openGame(session, `scenario=${s.scenario}`, { width: 1920, height: 1080 });
      const r = await page.evaluate(async (frames) => {
        const dh = (window as unknown as { __dh: { call(name: 'benchRender', n: number): Promise<RenderBenchResult> } }).__dh;
        return dh.call('benchRender', frames);
      }, s.frames);
      rows.push({ name: s.name, metric: 'draw calls (max)', value: r.drawCallsMax, limit: s.limits.drawCalls, unit: '' });
      rows.push({ name: s.name, metric: 'render prep p95', value: r.prepMsP95, limit: s.limits.prepMsP95, unit: 'ms' });
      rows.push({ name: s.name, metric: 'JS heap', value: r.heapMb, limit: s.limits.heapMb, unit: 'MB' });
      if (s.limits.minSprites !== undefined) rows.push({ name: s.name, metric: 'sprites fehlen', value: Math.max(0, s.limits.minSprites - r.spritesMax), limit: 0, unit: '' });
      if (s.limits.minLights !== undefined) rows.push({ name: s.name, metric: 'lights fehlen', value: Math.max(0, s.limits.minLights - r.lightsMax), limit: 0, unit: '' });
      rows.push({ name: s.name, metric: 'console errors', value: errors.length, limit: 0, unit: '' });
      if (errors.length > 0) console.error(errors.join('\n'));
      await page.close();
    }
  } finally {
    await session.close();
  }
  return rows;
}
