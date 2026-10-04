/**
 * The chronicle's diary and knowledge (docs/SPIEL.md §23 "Tagebuch", ADR-0175; strand G, system `chronicle`, an observer):
 * entries from the chronicle rules of every strand (src/content/chronik/), knowledge unlocked by triggers. An entry keeps the
 * rule and the payload values; the text is built in the UI (language switch without restart). Saved (participant `chronicle`).
 */

/** A diary entry; the text is built in the UI (language switch without restart). */
export interface ChronicleEntry {
  readonly nr: number;
  readonly tick: number;
  readonly day: number;
  readonly rule: string;
  readonly values: Readonly<Record<string, string | number>>;
}
