/**
 * The switches of the debug cheats (`debug.god`, `debug.noclip`; src/game/cheats/system.ts). One record per
 * simulation, owned by the cheat system and read by the systems it changes: the player's movement
 * (noclip, src/game/player/system.ts), the vitals' damage (god, src/game/survival/system.ts) and the hits of
 * conditions and hallucinations (god, `PlayerHarm` in src/game/conditions/harm.ts). Systems built without it
 * (tests of a single system) behave as with every cheat off.
 */

/** The cheats that are on. */
export interface DebugCheats {
  /** The player takes no damage (falls, hunger, thirst, cold, heat, drowning, conditions, hallucinations). */
  god: boolean;
  /** The player moves through everything at walking speed and never swims. */
  noclip: boolean;
}

/** Every cheat off. */
export function createDebugCheats(): DebugCheats {
  return { god: false, noclip: false };
}
