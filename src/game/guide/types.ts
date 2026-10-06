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
  funke: string | null;
  funkeUntilTick: number;
  hint: string | null;
  hintUntilTick: number;
}
