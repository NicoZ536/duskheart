/**
 * Auslöser-Regel des Content-Validators (docs/SPIEL.md §17 „Validator (G): `ereignis` ∈ `SIM_EVENT_TYPES`, alle Ids verweisen
 * auf vorhandenen Content“; M7-42 … M7-47 – Strang G). Reine Funktion über eine Registry und die Ereignisnamen, damit Tests sie
 * mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie mit `SIM_EVENT_TYPES` auf den echten Content an.
 *
 * Regel `ausloeser` (`checkTriggers`) über jeden Auslöser – Aufgabenstart und -schritte, Erfolge, Hinweise, Wissen,
 * Meilensteine – samt aller verschachtelten:
 * - `ereignis` ist ein Ereignis der Simulation;
 * - `statistik` nennt eine Statistik; einen `schluessel` (außer `*`, die Zahl der Schlüssel) nur bei einer geschlüsselten;
 * - `besitz` ein Item, `zustand` einen Zustand, `freischaltung` eine Freischaltung, `ort` einen Ortstyp, `raum.raumtyp` einen
 *   Raumtyp, `aufgabe` eine Aufgabe (und ihren Schritt).
 * Dazu die Ereignis-Filter der Chronik-Regeln und Statistik-Quellen: ihr `ereignis` ist ein Ereignis der Simulation, der
 * `schluessel` einer Quelle steht nur an einer geschlüsselten Statistik (ohne ihn zählt eine Quelle nur in die Summe – die
 * Reuse, deren Fang je Fisch beim Leeren unbekannt ist).
 */
import type { ContentRegistryView } from '../../src/content/registry';
import { forEachTrigger, type Trigger } from '../../src/content/schema/trigger';
import type { StatDef, StatSourceDef, MilestoneDef } from '../../src/content/stats/schema';
import type { ChronicleRuleDef, KnowledgeDef } from '../../src/content/chronik/schema';
import type { GuideHintDef } from '../../src/content/guide/schema';
import type { AchievementDef, QuestDef } from '../../src/content/quests/schema';

/** `statistik.schluessel` meaning "the number of keys counted" (src/game/stats/system.ts `ALL_KEYS`). */
const ALL_KEYS = '*';

/** Ergebnis der Regel. */
export interface TriggerCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** Zahl der geprüften Auslöser (mit allen verschachtelten). */
  readonly checked: number;
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function ids(registry: ContentRegistryView, name: string): ReadonlySet<string> {
  return new Set(registry.collections().find((c) => c.name === name)?.ids() ?? []);
}

/** Die Auslöser-Regel über `registry`; `events` sind die Ereignisnamen der Simulation (`SIM_EVENT_TYPES`). */
export function checkTriggers(registry: ContentRegistryView, events: readonly string[]): TriggerCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const eventSet = new Set(events);
  const stats = new Map(records<StatDef>(registry, 'stats').map((s) => [s.id, s]));
  const items = ids(registry, 'items');
  const conditions = ids(registry, 'conditions');
  const unlocks = ids(registry, 'unlocks');
  const placeTypes = ids(registry, 'locationTypes');
  const roomTypes = ids(registry, 'roomTypes');
  const quests = new Map(records<QuestDef>(registry, 'quests').map((q) => [q.id, q]));
  let checked = 0;

  const check = (where: string, trigger: Trigger): void =>
    forEachTrigger(trigger, (t) => {
      checked++;
      switch (t.art) {
        case 'ereignis':
          if (!eventSet.has(t.ereignis)) errors.push(`${where}: Ereignis ${t.ereignis} gibt es nicht (SIM_EVENT_TYPES)`);
          break;
        case 'statistik': {
          const s = stats.get(t.statistik);
          if (s === undefined) errors.push(`${where}: Statistik ${t.statistik} gibt es nicht`);
          else if (t.schluessel !== undefined && t.schluessel !== ALL_KEYS && !s.geschluesselt) errors.push(`${where}: Statistik ${t.statistik} ist nicht geschlüsselt, Schlüssel ${t.schluessel} zählt nie`);
          else if (t.schluessel === ALL_KEYS && !s.geschluesselt) errors.push(`${where}: Statistik ${t.statistik} ist nicht geschlüsselt, „*“ zählt keine Schlüssel`);
          break;
        }
        case 'besitz':
          if (!items.has(t.item)) errors.push(`${where}: Item ${t.item} gibt es nicht`);
          break;
        case 'zustand':
          if (!conditions.has(t.zustand)) errors.push(`${where}: Zustand ${t.zustand} gibt es nicht`);
          break;
        case 'freischaltung':
          if (!unlocks.has(t.freischaltung)) errors.push(`${where}: Freischaltung ${t.freischaltung} gibt es nicht`);
          break;
        case 'ort':
          if (!placeTypes.has(t.ortstyp)) errors.push(`${where}: Ortstyp ${t.ortstyp} gibt es nicht`);
          break;
        case 'raum':
          if (t.raumtyp !== undefined && !roomTypes.has(t.raumtyp)) errors.push(`${where}: Raumtyp ${t.raumtyp} gibt es nicht`);
          break;
        case 'aufgabe': {
          const q = quests.get(t.aufgabe);
          if (q === undefined) errors.push(`${where}: Aufgabe ${t.aufgabe} gibt es nicht`);
          else if (t.schritt !== undefined && !q.schritte.some((s) => s.id === t.schritt)) errors.push(`${where}: Aufgabe ${t.aufgabe} hat keinen Schritt ${t.schritt}`);
          break;
        }
        default:
          break;
      }
    });

  for (const q of quests.values()) {
    if (q.start !== undefined) check(`Aufgabe ${q.id} (Start)`, q.start);
    for (const s of q.schritte) check(`Aufgabe ${q.id}/${s.id}`, s.ausloeser);
  }
  for (const a of records<AchievementDef>(registry, 'achievements')) check(`Erfolg ${a.id}`, a.ausloeser);
  for (const h of records<GuideHintDef>(registry, 'guideHints')) check(`Hinweis ${h.id}`, h.ausloeser);
  for (const k of records<KnowledgeDef>(registry, 'knowledge')) check(`Wissen ${k.id}`, k.freischaltung);
  for (const m of records<MilestoneDef>(registry, 'milestones')) check(`Meilenstein ${m.id}`, m.ausloeser);
  for (const r of records<ChronicleRuleDef>(registry, 'chronicleRules')) {
    if (!eventSet.has(r.ereignis)) errors.push(`Chronik-Regel ${r.id}: Ereignis ${r.ereignis} gibt es nicht (SIM_EVENT_TYPES)`);
  }
  for (const src of records<StatSourceDef>(registry, 'statSources')) {
    if (!eventSet.has(src.ereignis)) errors.push(`Statistik-Quelle ${src.id}: Ereignis ${src.ereignis} gibt es nicht (SIM_EVENT_TYPES)`);
    const s = stats.get(src.statistik);
    if (s === undefined) continue;
    if (src.schluessel !== undefined && !s.geschluesselt) errors.push(`Statistik-Quelle ${src.id}: ${s.id} ist nicht geschlüsselt, Schlüssel ${src.schluessel} zählt nie`);
  }
  return { errors, warnings, checked };
}
