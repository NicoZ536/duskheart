/**
 * Messages of the SFX worker (src/audio/sfx.worker.ts): the main thread asks for presets by id, the worker
 * answers with every take of each preset as transferable sample buffers – the synthesis never blocks a
 * frame (MASTERPROMPT §3.1 "Worker", §30 CPU per frame).
 */

/** Main thread → worker: render these presets, in this order. */
export interface SfxRenderRequest {
  readonly ids: readonly string[];
}

/** Worker → main thread: the takes of one preset (mono, `SFX_SAMPLE_RATE`). */
export interface SfxRenderResult {
  readonly id: string;
  readonly takes: readonly Float32Array<ArrayBuffer>[];
}
