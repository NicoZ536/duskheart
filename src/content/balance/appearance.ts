/**
 * Balance values of the player's appearance (MASTERPROMPT §26 "Charaktererstellung"; docs/SPIEL.md §26 "Aussehen"; M7-52) –
 * group `BALANCE.appearance` (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 */

export const APPEARANCE_BALANCE = {
  /** Shortest name of the figure [characters]. docs/SPIEL.md §26 "Name (1–20 Zeichen)" – a name, never an empty label. */
  nameMinChars: 1,
  /**
   * Longest name of the figure [characters]. docs/SPIEL.md §26 "Name (1–20 Zeichen)": one line of the world list and the
   * pause menu's title at the pixel font's width, long enough for a first and a last name.
   */
  nameMaxChars: 20,
} as const;
