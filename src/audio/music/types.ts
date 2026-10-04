/**
 * The music system (docs/SPIEL.md §24 "Musik-System", ADR-0175; strand A): the director reads the simulation only (a probe
 * filled each frame), picks a mood – title, exploration (the biome's piece, day or night arrangement), base, fight, boss,
 * vault, silence – crossfades with hysteresis, raises the danger layer by the nearest hunting foe, ducks under stingers and
 * keeps quiet nights quiet. Pieces are rendered to one Float32 stem per layer at 32 kHz, bit-identical in Node and the worker.
 */
import type { MusicArrangementKind, MusicLayer } from '../../content/music/schema';

export const MUSIC_MOODS = ['titel', 'erkundung', 'basis', 'kampf', 'boss', 'gewoelbe', 'stille'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
/** A rendered piece: one Float32 stem per layer at 32 kHz (bit-identical in Node and in the worker). */
export interface RenderedPiece {
  readonly piece: string;
  readonly arrangement: MusicArrangementKind;
  readonly sampleRate: number;
  readonly loopStartSample: number;
  readonly lengthSamples: number;
  readonly stems: Readonly<Partial<Record<MusicLayer, Float32Array>>>;
}
/** What the director reads from the simulation each frame (read-only, filled by src/audio/music/probe.ts). */
export interface MusicProbe {
  mood: MusicMood;
  biome: string;
  night: boolean;
  /** Distance to the nearest hunting enemy [tiles], or −1. */
  dangerTiles: number;
  boss: string;
}
/** Event → stinger table (src/audio/music/stingers.ts): `placeDiscovered` → `entdeckung`, `beaconLit` → `leuchtfeuer` … */
export type StingerTable = Readonly<Record<string, string>>;
