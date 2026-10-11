/**
 * Browser entry of the music worker (docs/SPIEL.md §24; ADR draft "OfflineAudioContext → eigener Synth im Worker"): renders
 * requested arrangements with the pure tracker of src/audio/music/render.ts – OfflineAudioContext is not available in
 * workers, the own synth is, and it renders the same bits as Node – keeps them and hands their stems out slice by slice,
 * transferred, as the main thread pulls them (src/audio/music/protocol.ts).
 *
 * Main thread: `browserMusicWorker` in src/audio/runtime.ts, through `MusicBank` (src/audio/music/bank.ts). Renders run in
 * turns with rests between them (`PacedMusicWorker`, M7-81): about half a core, not a whole one for a second.
 */
import { createMusicLibrary } from './library';
import { MusicWorkerCore, PacedMusicWorker, transferablesOf, type MusicWorkerRequest } from './protocol';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const worker = new PacedMusicWorker(
  new MusicWorkerCore(createMusicLibrary()),
  (reply) => scope.postMessage(reply, transferablesOf(reply)),
  (fn, ms) => {
    setTimeout(fn, ms);
  },
  () => performance.now(),
);

scope.onmessage = (ev: MessageEvent<MusicWorkerRequest>) => worker.handle(ev.data);
