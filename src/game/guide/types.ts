/**
 * The guide (docs/SPIEL.md §23 "Funke", "Einstieg", ADR-0207; strand G, system `guide`, an observer): Funke comments and
 * context hints from the hint tables of every strand (src/content/guide/), never pushy (minimum distance, one-time comments,
 * priority 3 first), switched by the world and by the settings – the UI sends `guide.configure {funke, hints}` at start and on
 * every change, so the simulation stays deterministic. Saved (participant `guide`); the HUD reads one held record
 * (`GameSession.sampleGuide`).
 */
export interface GuideConfig {
  funke: boolean;
  hints: boolean;
  onboarding: boolean;
}
export interface GuideSample {
  /** The Funke comment showing (a hint id), or `null`. */
  funke: string | null;
  funkeUntilTick: number;
  /** The dialog Funke speaks (a dialog id, `funke` is then `null`) and its line, or `null`/−1. */
  dialog: string | null;
  dialogLine: number;
  /** The context hint showing (a hint id), or `null`. */
  hint: string | null;
  hintUntilTick: number;
  /** The simulation's tick when sampled (the HUD fades by it). */
  tick: number;
  /** The switches of the world and the settings. */
  readonly config: GuideConfig;
}

/** An empty sample (held by the session, filled per frame). */
export function createGuideSample(): GuideSample {
  return { funke: null, funkeUntilTick: 0, dialog: null, dialogLine: -1, hint: null, hintUntilTick: 0, tick: 0, config: { funke: true, hints: true, onboarding: true } };
}
