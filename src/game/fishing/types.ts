/**
 * Fishing at runtime (docs/SPIEL.md §20 "Angeln", ADR-0207; strand D, system `fishing`): the cast, the bite and the fight in
 * the simulation (tension held between 0 and 1), fish traps per chunk (a catch per 06:00, caught up per crossed 06:00), ice
 * fishing. The renderer and the HUD mini-game read one held record through `GameSession.sampleFishing`.
 */
export const FISHING_PHASES = ['aus', 'wurf', 'warten', 'biss', 'drill', 'gefangen', 'verloren'] as const;
export type FishingPhase = (typeof FISHING_PHASES)[number];
/** Read by the renderer (line, float, rod bend) and the HUD mini-game through `GameSession.sampleFishing` (held record). */
export interface FishingSample {
  phase: FishingPhase;
  /** Float position [world px]. */
  floatX: number;
  floatY: number;
  /** Line tension 0–1 (breaks at 1, fish escapes at 0). */
  tension: number;
  /** Pull of the fish −1 … 1 (direction for the rod bend). */
  pull: number;
  fish: string;
  /** Layer of the line (strand D, additive). */
  layer: number;
  /** The reel is held (E or `fishing.reel`): the rod bends harder, the HUD lights the reel (strand D, additive). */
  reeling: boolean;
  /** Distance of the hooked fish from the shore [tiles] (strand D, additive). */
  distance: number;
  /** The hooked fish is in the air (a leap: the HUD flashes, strand D, additive). */
  leaping: boolean;
  /** Why the fish got away (`gerissen`, `entkommen`, `verpasst`) in the phase `verloren`, else '' (strand D, additive). */
  grund: string;
}
