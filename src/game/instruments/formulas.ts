/**
 * Pure rules of making music and of the net (M7-31): which song plays next, whether a swing catches a cricket. The net
 * draws from a hash of (world seed, swing number, tile) – never from a running random stream: the result depends on the
 * saved swing counter only (docs/SPIEL.md §28 "Zufall … aus Hashes").
 */
import { BALANCE } from '../../content/balance';
import { hash3, hashCombine, hashToUnit } from '../../engine/rng';

const NET = BALANCE.instruments.net;

/** The song an instrument plays when none is named: its songs take turns by the number of plays so far. */
export function nextSong(songs: readonly string[], plays: number): string {
  if (songs.length === 0) throw new RangeError('an instrument knows at least one song');
  return songs[plays % songs.length] as string;
}

/** Chance a swing through grass catches a cricket [0–1]: higher at night (§27 "Grillen nachts"). */
export function cricketChance(night: boolean): number {
  return night ? NET.cricketChanceNight : NET.cricketChanceDay;
}

/** Salt of the net's draws ("netz" in ASCII): its hash stream apart from every other draw of the same tile and counter. */
export const NET_DRAW_SALT = 0x6e65747a;

/** Whether swing number `swing` through grass at tile (tx, ty) catches a cricket. */
export function catchesCricket(seed: number, swing: number, tx: number, ty: number, night: boolean): boolean {
  return hashToUnit(hashCombine(hash3(tx, ty, swing, seed), NET_DRAW_SALT)) < cricketChance(night);
}

/** Whether a swarm caught `caught` times this night still gives a firefly. */
export function swarmGives(caught: number): boolean {
  return caught < NET.firefliesPerSwarmPerNight;
}
