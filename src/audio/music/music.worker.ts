/**
 * Browser entry of the music worker (docs/SPIEL.md §24; ADR draft "OfflineAudioContext → eigener Synth im Worker"): renders
 * requested arrangements with the pure tracker of src/audio/music/render.ts – OfflineAudioContext is not available in
 * workers, the own synth is, and it renders the same bits as Node – keeps them and hands their stems out slice by slice,
 * transferred, as the main thread pulls them (src/audio/music/protocol.ts).
 *
 * Main thread: `browserMusicWorker` in src/audio/runtime.ts, through `MusicBank` (src/audio/music/bank.ts).
 */
import { createMusicLibrary } from './library';
import { MusicWorkerCore, transferablesOf, type MusicWorkerRequest } from './protocol';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const core = new MusicWorkerCore(createMusicLibrary());

scope.onmessage = (ev: MessageEvent<MusicWorkerRequest>) => {
  const reply = core.handle(ev.data);
  if (reply !== null) scope.postMessage(reply, transferablesOf(reply));
};
