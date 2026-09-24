/**
 * Browser entry of the SFX worker: renders the takes of requested presets with the same synthesis as
 * the main thread (src/audio/dsp/render.ts) and transfers the sample buffers back, one message per preset.
 *
 * Main thread: `new Worker(new URL('./sfx.worker.ts', import.meta.url), { type: 'module' })`, see
 * src/audio/runtime.ts.
 */
import { SFX_PRESETS } from '../content/sfx/index';
import { renderTakes } from './dsp/render';
import type { SfxRenderRequest, SfxRenderResult } from './sfxWorkerProtocol';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const presets = new Map(SFX_PRESETS.map((p) => [p.id, p]));

scope.onmessage = (ev: MessageEvent<SfxRenderRequest>) => {
  for (const id of ev.data.ids) {
    const preset = presets.get(id);
    if (preset === undefined) continue;
    const result: SfxRenderResult = { id, takes: renderTakes(preset) };
    scope.postMessage(result, result.takes.map((t) => t.buffer));
  }
};
