/**
 * The music content (docs/SPIEL.md §24, §29; M7-03 … M7-05, M7-31; strand A): the five counted pieces – `titel`, `gruenhain`
 * (day and night), `basis`, `kampf`, `borkenvater` –, the stingers' pieces and the songs of the player's instruments
 * (collection `music`, §C "Musikstücke" counts `zaehlt`), the stingers (`stingers`), the songs (`songs`) and the wavetables
 * (`wavetables`). Rendered by src/audio/music/render.ts.
 */
import { MUSIK_BASIS } from './basis';
import { MUSIK_BORKENVATER } from './borkenvater';
import { MUSIK_GRUENHAIN } from './gruenhain';
import { MUSIK_KAMPF } from './kampf';
import { SONG_PIECES, SONGS } from './lieder';
import type { MusicPieceInput } from './schema';
import { STINGER_PIECES, STINGERS } from './stinger';
import { MUSIK_TITEL } from './titel';
import { WAVETABLES } from './wavetables';

/** Every piece: the counted ones, then the stingers' and the songs'. */
export const MUSIC_PIECES: readonly MusicPieceInput[] = [MUSIK_TITEL, MUSIK_GRUENHAIN, MUSIK_BASIS, MUSIK_KAMPF, MUSIK_BORKENVATER, ...STINGER_PIECES, ...SONG_PIECES];

export { SONGS, STINGERS, WAVETABLES };
export { BIOME_MUSIC, MOOD_MUSIC, type BiomeMusic } from './biome';
export * from './schema';
