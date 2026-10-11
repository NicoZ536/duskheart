/**
 * Statistic sources of the vaults (docs/SPIEL.md §19, §23, §29 `gewoelbe_abgeschlossen`, `raetsel_geloest`; M7-10 … M7-16,
 * strand C): a vault counts as conquered when its mini-boss fell and its end chest is open (`vaultCompleted`, once per vault),
 * a puzzle when it is solved (`puzzleSolved`, keyed by its type – the chronicle shows which kinds the player mastered).
 */
import type { StatSourceInput } from './schema';

export const STAT_SOURCES_C: readonly StatSourceInput[] = [
  { id: 'gewoelbe_abgeschlossen_gewoelbe', statistik: 'gewoelbe_abgeschlossen', ereignis: 'vaultCompleted' },
  { id: 'raetsel_geloest_typ', statistik: 'raetsel_geloest', ereignis: 'puzzleSolved', schluessel: 'typ' },
];
