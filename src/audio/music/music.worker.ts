/**
 * Browser entry of the music worker (docs/SPIEL.md §24; ADR draft "OfflineAudioContext → eigener Synth im Worker"): renders
 * requested arrangements with the pure tracker of src/audio/music/render.ts – OfflineAudioContext is not available in
 * workers, the own synth is, and it renders the same bits as Node – and transfers the stems back, one message per request.
 *
 * Main thread: `browserMusicWorker` in src/audio/runtime.ts, through `MusicBank` (src/audio/music/bank.ts).
 */
import { createMusicLibrary } from './library';
import { handleMusicRequest, transferablesOf, type MusicRenderRequest } from './protocol';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const library = createMusicLibrary();

scope.onmessage = (ev: MessageEvent<MusicRenderRequest>) => {
  const result = handleMusicRequest(ev.data, library);
  scope.postMessage(result, transferablesOf(result));
};
