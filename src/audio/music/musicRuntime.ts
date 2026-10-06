/**
 * The music of the running game (M7-04; docs/SPIEL.md §24): once per rendered frame the probe reads the simulation
 * (src/audio/music/probe.ts), the director decides piece, arrangement and layers (director.ts), the bank fetches the
 * arrangement from the music worker (bank.ts) and the player plays, crossfades and glides it (player.ts). Stingers wait in
 * a queue for their piece and their turn (stingers.ts); the player's song (the flute or lute it plays, `MusicProbe.song`)
 * plays on the effects bus while the music falls silent.
 *
 * The stingers' pieces are fetched at the start and stay loaded (a few megabytes: a stinger must sound on its frame, not
 * after a render). No allocation per frame once the pieces are loaded.
 */
import type { MusicArrangementKind } from '../../content/music/schema';
import { MUSIC_PIECES, SONGS, arrangementSeconds, type SongInput, type StingerInput } from '../../content/music/index';
import type { Simulation } from '../../game/sim';
import type { AudioContextLike, AudioNodeLike } from '../webAudio';
import { MusicBank, musicKey, type MusicWorkerLike } from './bank';
import { MusicDirector, createMusicDecision } from './director';
import type { MusicLibrary } from './library';
import { MusicPlayer } from './player';
import { MusicProbeReader } from './probe';
import { STINGER_BY_ID, StingerQueue } from './stingers';
import { createMusicProbe } from './types';

/** The arrangement of stingers and songs (they have one). */
const SHORT_ARRANGEMENT: MusicArrangementKind = 'standard';

export interface MusicRuntimeOptions {
  /** Starts the music worker; `null`: render on the main thread in small steps. */
  readonly createWorker: (() => MusicWorkerLike) | null;
  /** Seed of the quiet nights. */
  readonly seed: number;
  /** The pieces for the main-thread fallback (default: the game's content). */
  readonly library?: MusicLibrary;
}

export class MusicRuntime {
  readonly bank: MusicBank;
  readonly director: MusicDirector;
  readonly player: MusicPlayer;
  readonly probe = createMusicProbe();
  readonly decision = createMusicDecision();
  private readonly reader = new MusicProbeReader();
  private readonly stingers = new StingerQueue();
  private readonly keep = new Set<string>();
  private readonly stingerKeys: readonly string[];
  private readonly songs: ReadonlyMap<string, SongInput>;
  private readonly isLoaded = (def: StingerInput): boolean => this.bank.isLoaded(def.stueck, SHORT_ARRANGEMENT);

  constructor(
    private readonly ctx: AudioContextLike,
    buses: { readonly musik: AudioNodeLike; readonly effekte: AudioNodeLike },
    options: MusicRuntimeOptions,
  ) {
    this.bank = new MusicBank(ctx, { createWorker: options.createWorker, ...(options.library === undefined ? {} : { library: options.library }) });
    const seconds = new Map<string, Map<string, number>>();
    for (const p of MUSIC_PIECES) {
      const byArrangement = new Map<string, number>();
      for (const a of p.arrangements) byArrangement.set(a.art, arrangementSeconds(p, a));
      seconds.set(p.id, byArrangement);
    }
    this.director = new MusicDirector({
      seed: options.seed,
      pieceSeconds: (piece, arrangement) => seconds.get(piece)?.get(arrangement) ?? 0,
      hasPiece: (id) => seconds.has(id),
    });
    this.player = new MusicPlayer(ctx, buses.musik, buses.effekte);
    this.songs = new Map(SONGS.map((s) => [s.id, s]));
    const keys: string[] = [];
    for (const def of STINGER_BY_ID.values()) {
      this.bank.prepare(def.stueck, SHORT_ARRANGEMENT);
      keys.push(musicKey(def.stueck, SHORT_ARRANGEMENT));
    }
    this.stingerKeys = keys;
  }

  /** Once per rendered frame: follows the simulation (`undefined`: the title). */
  frame(sim: Simulation | undefined): void {
    const now = this.ctx.currentTime;
    const probe = this.reader.read(sim, this.probe);
    const decision = this.director.update(probe, now, this.decision);
    this.player.apply(decision, decision.piece === '' ? null : this.bank.get(decision.piece, decision.arrangement));
    const song = probe.song === '' ? undefined : this.songs.get(probe.song);
    if (song === undefined) this.player.setSong(null, '');
    else {
      const loaded = this.bank.get(song.stueck, SHORT_ARRANGEMENT);
      if (loaded !== null) this.player.setSong(loaded, loaded.key);
    }
    if (probe.mood === 'stille') this.stingers.clear();
    const stinger = this.stingers.take(now, this.player.stingerPlaying(now), this.isLoaded);
    if (stinger !== null) {
      const loaded = this.bank.get(stinger.stueck, SHORT_ARRANGEMENT);
      if (loaded !== null) this.player.stinger(loaded, stinger.duckDb);
    }
    const keep = this.player.keep(this.keep);
    for (let i = 0; i < this.stingerKeys.length; i++) keep.add(this.stingerKeys[i] as string);
    this.bank.frame(keep);
  }

  /** Asks for stinger `id` (an event of `STINGER_EVENTS`); dropped while the music is silent for the player's song. */
  stinger(id: string): void {
    if (this.probe.mood === 'stille') return;
    this.stingers.request(id, this.ctx.currentTime);
  }

  /** Stops the music (disposal). */
  dispose(): void {
    this.player.stopAll();
  }
}
