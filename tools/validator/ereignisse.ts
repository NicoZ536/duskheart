/**
 * Ereignis-Regel des Content-Validators (MASTERPROMPT §10 „Ereignisse“; docs/SPIEL.md §18; M7-38 – Strang B). Reine Funktion
 * über eine Registry und den Text von PROGRESS.md, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts)
 * wendet sie auf den echten Content an.
 *
 * Regel `ereignisse` (`checkWorldEvents`):
 * - das Register (`worldEvents`) enthält alle elf Ereignisse aus §10 (`SECTION_10_EVENTS`) und keine anderen;
 * - ein umgesetztes Ereignis (`umgesetzt: true`) hat seine Ankündigung auf jedem Kanal: die HUD-Zeile DE/EN mit der Restzeit
 *   `{minuten}`, den Funke-Hinweis (`ankuendigung.funke` gibt es in `guideHints`, Kanal `funke`, ausgelöst von
 *   `worldEventAnnounced` mit `wo.event` = Ereignis) – und seinen Chronik-Vermerk: den Text DE/EN und eine Chronik-Regel
 *   (`chronicleRules`) auf `worldEventStarted` mit `wo.event` = Ereignis; jedes Fehlen ist ein Fehler;
 * - ein noch nicht umgesetztes Ereignis nennt den Task, der es bringt (`umgesetzt: { task }`); den gibt es in PROGRESS.md und
 *   er ist offen – ist er erledigt, muss das Ereignis umgesetzt sein.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import type { WorldEventDef } from '../../src/content/worldEvents/schema';
import type { GuideHintDef } from '../../src/content/guide/schema';
import type { ChronicleRuleDef } from '../../src/content/chronik/schema';
import type { LocalizedText } from '../../src/content/schema/common';
import { taskStatus } from './items';

/** Die elf Ereignisse aus MASTERPROMPT §10 (Register-Ids). */
export const SECTION_10_EVENTS = [
  'schattenflut',
  'finstermond',
  'lumenregen',
  'nebelnacht',
  'sonnenfinsternis',
  'haendlerin',
  'tierwanderung',
  'lawine',
  'waldbrand',
  'flut',
  'erdbeben',
] as const;

/** Ergebnis der Regel. */
export interface WorldEventCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

/** Die Sprachen eines Texts, die fehlen oder leer sind. */
function emptyLanguages(text: LocalizedText | undefined): string[] {
  return (['de', 'en'] as const).filter((lang) => (text?.[lang] ?? '').trim() === '');
}

/** Ob der Auslöser das Ereignis `type` mit `wo.event` = `event` ist. */
function triggeredBy(t: GuideHintDef['ausloeser'] | undefined, type: string, event: string): boolean {
  return t !== undefined && t.art === 'ereignis' && t.ereignis === type && t.wo?.event === event;
}

/** Die Ereignis-Regel über `registry` mit dem Text von PROGRESS.md (`progress`). */
export function checkWorldEvents(registry: ContentRegistryView, progress: string): WorldEventCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const events = records<WorldEventDef>(registry, 'worldEvents');
  const hints = records<GuideHintDef>(registry, 'guideHints');
  const rules = records<ChronicleRuleDef>(registry, 'chronicleRules');
  const ids = new Set(events.map((e) => e.id));

  for (const id of SECTION_10_EVENTS) if (!ids.has(id)) errors.push(`Ereignis ${id} (§10) fehlt im Register worldEvents`);
  const known: ReadonlySet<string> = new Set(SECTION_10_EVENTS);
  for (const e of events) if (!known.has(e.id)) errors.push(`Ereignis ${e.id}: steht nicht in §10 (Register kennt nur dessen elf Ereignisse)`);

  for (const e of events) {
    const tag = `Ereignis ${e.id}`;
    if (e.umgesetzt !== true) {
      const status = taskStatus(progress, e.umgesetzt.task);
      if (status === null) errors.push(`${tag}: Task ${e.umgesetzt.task}, der es umsetzt, fehlt in PROGRESS.md`);
      else if (status === 'erledigt') errors.push(`${tag}: Task ${e.umgesetzt.task} ist erledigt, das Ereignis aber nicht umgesetzt (umgesetzt: true)`);
      continue;
    }
    // Ankündigung: HUD-Zeile mit Restzeit und Funke-Hinweis.
    for (const lang of emptyLanguages(e.ankuendigung?.hud)) errors.push(`${tag}: Ankündigung ohne HUD-Text ${lang.toUpperCase()}`);
    for (const lang of ['de', 'en'] as const) {
      const hud = e.ankuendigung?.hud?.[lang] ?? '';
      if (hud.trim() !== '' && !hud.includes('{minuten}')) errors.push(`${tag}: HUD-Text ${lang.toUpperCase()} nennt die Restzeit nicht ({minuten})`);
    }
    const hint = hints.find((h) => h.id === e.ankuendigung?.funke);
    if (hint === undefined) errors.push(`${tag}: Funke-Hinweis ${e.ankuendigung?.funke ?? '–'} der Ankündigung fehlt (guideHints)`);
    else {
      if (hint.kanal !== 'funke') errors.push(`${tag}: Hinweis ${hint.id} spricht nicht auf dem Funke-Kanal`);
      if (!triggeredBy(hint.ausloeser, 'worldEventAnnounced', e.id)) errors.push(`${tag}: Hinweis ${hint.id} wird nicht von worldEventAnnounced mit event = ${e.id} ausgelöst`);
      for (const lang of emptyLanguages(hint.text)) errors.push(`${tag}: Funke-Hinweis ${hint.id} ohne Text ${lang.toUpperCase()}`);
    }
    // Chronik-Vermerk: Text und Regel auf den Beginn.
    for (const lang of emptyLanguages(e.chronik)) errors.push(`${tag}: Chronik-Text ${lang.toUpperCase()} fehlt`);
    const rule = rules.find((r) => r.ereignis === 'worldEventStarted' && r.wo?.event === e.id);
    if (rule === undefined) errors.push(`${tag}: keine Chronik-Regel auf worldEventStarted mit event = ${e.id} (chronicleRules)`);
    else for (const lang of emptyLanguages(rule.text)) errors.push(`${tag}: Chronik-Regel ${rule.id} ohne Text ${lang.toUpperCase()}`);
  }
  return { errors, warnings };
}
