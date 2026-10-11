/**
 * Vermittlungs-Regel des Content-Validators (MASTERPROMPT §2.2 „Jede Mechanik wird im Spiel vermittelt (Hinweis, Chronik,
 * Tooltip)“; docs/SPIEL.md §23 „Vermittlungs-Register … Validator-Regel `vermittlung`: fehlender Baustein ⇒ Fehler; Liste der
 * Mechaniken bis M7 im Beleg“; M7-45 – Strang G). Reine Funktion über eine Registry, die i18n-Schlüssel und den Text von
 * PROGRESS.md, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten Content an.
 *
 * Regel `vermittlung` (`checkMechanics`) je Mechanik des Registers (`mechanics`):
 * - der Hinweis ist ein Hinweis aus `guideHints` oder ein Einstiegsschritt `aufgabe:<aufgabe>/<schritt>`, den es gibt;
 * - der Wissenseintrag steht in `knowledge`;
 * - der Tooltip ist ein i18n-Schlüssel in de.json und en.json oder ein Datensatz einer vorhandenen Sammlung;
 * - der Task, der sie brachte, steht in PROGRESS.md.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import type { MechanicDef } from '../../src/content/vermittlung/schema';
import type { QuestDef } from '../../src/content/quests/schema';
import { taskStatus } from './items';

/** Ergebnis der Regel. */
export interface MechanicsCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** Die geprüften Mechaniken (Id und Absatz) – die Liste des Belegs. */
  readonly mechanics: readonly { readonly id: string; readonly paragraph: string; readonly task: string }[];
}

/** `aufgabe:<aufgabe>/<schritt>` eines Einstiegsschritts. */
const STEP_HINT = /^aufgabe:([a-z0-9_]+)\/([a-z0-9_]+)$/;

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

/** Die Vermittlungs-Regel über `registry` mit den i18n-Schlüsseln beider Sprachen und dem Text von PROGRESS.md. */
export function checkMechanics(registry: ContentRegistryView, i18n: { readonly de: ReadonlySet<string>; readonly en: ReadonlySet<string> }, progress: string): MechanicsCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hints = new Set(registry.collections().find((c) => c.name === 'guideHints')?.ids() ?? []);
  const knowledge = new Set(registry.collections().find((c) => c.name === 'knowledge')?.ids() ?? []);
  const quests = new Map(records<QuestDef>(registry, 'quests').map((q) => [q.id, q]));
  const mechanics = records<MechanicDef>(registry, 'mechanics');
  for (const m of mechanics) {
    const tag = `Mechanik ${m.id}`;
    const step = STEP_HINT.exec(m.hinweis);
    if (step !== null) {
      const q = quests.get(step[1] as string);
      if (q === undefined) errors.push(`${tag}: Hinweis ${m.hinweis} – die Aufgabe gibt es nicht`);
      else if (!q.schritte.some((s) => s.id === step[2])) errors.push(`${tag}: Hinweis ${m.hinweis} – die Aufgabe hat diesen Schritt nicht`);
    } else if (!hints.has(m.hinweis)) errors.push(`${tag}: Hinweis ${m.hinweis} fehlt (guideHints oder aufgabe:<aufgabe>/<schritt>)`);
    if (!knowledge.has(m.wissen)) errors.push(`${tag}: Wissenseintrag ${m.wissen} fehlt (knowledge)`);
    if (m.tooltip.art === 'i18n') {
      for (const lang of ['de', 'en'] as const) if (!i18n[lang].has(m.tooltip.schluessel)) errors.push(`${tag}: Tooltip-Schlüssel ${m.tooltip.schluessel} fehlt in ${lang}.json`);
    } else {
      const { sammlung, id } = m.tooltip;
      const c = registry.collections().find((x) => x.name === sammlung);
      if (c === undefined) errors.push(`${tag}: Tooltip-Sammlung ${sammlung} gibt es nicht`);
      else if (!c.ids().includes(id)) errors.push(`${tag}: Tooltip ${sammlung}/${id} gibt es nicht`);
    }
    if (taskStatus(progress, m.task) === null) errors.push(`${tag}: Task ${m.task} steht nicht in PROGRESS.md`);
  }
  return { errors, warnings, mechanics: mechanics.map((m) => ({ id: m.id, paragraph: m.paragraph, task: m.task })) };
}
