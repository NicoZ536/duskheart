/**
 * The quest tracker's model (MASTERPROMPT §26 "rechts Aufgaben- und Rezept-Tracker"; docs/SPIEL.md §30 "Aufgaben-Tracker (HUD,
 * über dem Rezept-Tracker) – sampleQuests"; M7-42): the tracked running quests (at most `BALANCE.quests.trackedMax`, the
 * simulation's choice) with their title, the current step, its hint and its progress when it counts ("2/5"). Pure – the
 * component (Aufgaben.tsx) feeds it the session's held sample every frame and re-renders only when a line changed.
 */
import { CONTENT } from '../../../content/index';
import type { QuestSample } from '../../../game/samples/chronik';
import type { Lang } from '../../../i18n';

/** One tracked quest as the HUD shows it. */
export interface AufgabenZeile {
  readonly quest: string;
  readonly haupt: boolean;
  readonly titel: string;
  readonly schritt: string;
  readonly hinweis: string;
  /** Step `nr` of `von` (1-based). */
  readonly nr: number;
  readonly von: number;
  /** Progress of the step when it counts (`braucht` 0: no number). */
  readonly hat: number;
  readonly braucht: number;
}

/** The tracked running quests of `sample` in `lang` (content order; the main quest first). */
export function aufgabenZeilen(sample: Readonly<QuestSample>, lang: Lang): AufgabenZeile[] {
  const out: AufgabenZeile[] = [];
  for (let i = 0; i < sample.count; i++) {
    const r = sample.rows[i];
    if (r === undefined || !r.tracked || !r.aktiv) continue;
    const def = CONTENT.collection('quests').find(r.quest);
    const step = def?.schritte[r.schritt];
    if (def === undefined || step === undefined) continue;
    out.push({
      quest: r.quest,
      haupt: def.art === 'haupt',
      titel: def.titel[lang],
      schritt: step.titel[lang],
      hinweis: step.hinweis[lang],
      nr: r.schritt + 1,
      von: r.schritte,
      hat: Math.floor(r.count),
      braucht: r.need > 1 ? Math.ceil(r.need) : 0,
    });
  }
  out.sort((a, b) => Number(b.haupt) - Number(a.haupt));
  return out;
}

/** Whether two line lists show the same (the component re-renders only on a change). */
export function gleicheAufgaben(a: readonly AufgabenZeile[], b: readonly AufgabenZeile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as AufgabenZeile;
    const y = b[i] as AufgabenZeile;
    if (x.quest !== y.quest || x.nr !== y.nr || x.hat !== y.hat || x.braucht !== y.braucht || x.titel !== y.titel || x.schritt !== y.schritt) return false;
  }
  return true;
}

/**
 * A number that changes whenever the tracker would show something else (tracked quest, step, progress, onboarding) – read
 * every frame without allocating; the lines are built only when it moved.
 */
export function aufgabenSignatur(sample: Readonly<QuestSample>): number {
  let h = sample.count * 31 + (sample.onboarding ? 7 : 0);
  for (let i = 0; i < sample.count; i++) {
    const r = sample.rows[i];
    if (r === undefined || !r.tracked || !r.aktiv) continue;
    h = (Math.imul(h, 1_000_003) + i * 8191 + r.schritt * 131 + Math.floor(r.count) * 17 + Math.ceil(r.need)) | 0;
  }
  return h;
}
