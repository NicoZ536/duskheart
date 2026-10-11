/**
 * Aufgaben-Regel des Content-Validators (docs/SPIEL.md §23 „Aufgaben“, „Erfolge“; M7-42, M7-47 – Strang G). Reine Funktion
 * über eine Registry und die Sprite-Ids, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie
 * auf den echten Content an.
 *
 * Regel `aufgaben` (`checkQuests`):
 * - jeder Kartenmarker eines Schritts zeigt auf Vorhandenes: einen Ortstyp, ein Leuchtfeuer (Nummer), einen Boss;
 * - eine Belohnung nennt keine Freischaltung: Aufgaben vergeben keine (die Freischaltungs-Registry kennt keine Quelle
 *   `aufgabe`, src/game/unlocks/types.ts) – Fehler;
 * - es gibt genau eine Einstiegsaufgabe (`art: 'einstieg'`) und eine Hauptaufgabe je Akt höchstens einmal;
 * - jeder Erfolg hat sein Symbol `erfolg_<id>`;
 * - Erfolge, Meilensteine und Aufgabenschritte, die eine Statistik ohne Quelle lesen (außer den selbst gezählten `spielzeit`,
 *   `distanz`), sind erst erreichbar, wenn deren Strang die Quelle einträgt – Warnung mit der Statistik;
 * - ein Funke-Dialog, den kein Schritt spricht, ist ungenutzt – Warnung.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import { forEachTrigger, type Trigger } from '../../src/content/schema/trigger';
import { achievementIconId, type AchievementDef, type DialogDef, type QuestDef } from '../../src/content/quests/schema';
import type { MilestoneDef, StatSourceDef } from '../../src/content/stats/schema';

/** Statistiken, die das System `stats` selbst zählt (src/game/stats/system.ts `OWN_STATS`). */
const OWN_STATS: ReadonlySet<string> = new Set(['spielzeit', 'distanz']);

/** Ergebnis der Regel. */
export interface QuestCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

/** Die Aufgaben-Regel über `registry` mit den Sprite-Ids. */
export function checkQuests(registry: ContentRegistryView, spriteIds: ReadonlySet<string>): QuestCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const quests = records<QuestDef>(registry, 'quests');
  const placeTypes = new Set(registry.collections().find((c) => c.name === 'locationTypes')?.ids() ?? []);
  const bosses = new Set(registry.collections().find((c) => c.name === 'bosses')?.ids() ?? []);
  const beacons = new Set(records<{ nummer: number }>(registry, 'beacons').map((b) => b.nummer));
  const sourced = new Set(records<StatSourceDef>(registry, 'statSources').map((s) => s.statistik));
  const unsourced = (where: string, t: Trigger): void =>
    forEachTrigger(t, (x) => {
      if (x.art === 'statistik' && !OWN_STATS.has(x.statistik) && !sourced.has(x.statistik)) warnings.push(`${where}: liest die Statistik ${x.statistik}, die noch keine Quelle hat`);
    });

  const kinds = new Map<string, number>();
  const acts = new Set<number>();
  const spoken = new Set<string>();
  for (const q of quests) {
    kinds.set(q.art, (kinds.get(q.art) ?? 0) + 1);
    if (q.art === 'haupt' && q.akt !== undefined) {
      if (acts.has(q.akt)) errors.push(`Aufgabe ${q.id}: Akt ${q.akt} der Hauptaufgabe gibt es zweimal`);
      acts.add(q.akt);
    }
    if (q.belohnung?.freischaltung !== undefined) errors.push(`Aufgabe ${q.id}: Belohnung nennt die Freischaltung ${q.belohnung.freischaltung} – Aufgaben vergeben keine Freischaltungen (keine Quelle aufgabe in UnlockSource)`);
    if (q.start !== undefined) unsourced(`Aufgabe ${q.id} (Start)`, q.start);
    for (const s of q.schritte) {
      unsourced(`Aufgabe ${q.id}/${s.id}`, s.ausloeser);
      if (s.dialog !== undefined) spoken.add(s.dialog);
      const m = s.marker;
      if (m === undefined) continue;
      if (m.art === 'ort' && !placeTypes.has(m.ortstyp)) errors.push(`Aufgabe ${q.id}/${s.id}: Marker-Ortstyp ${m.ortstyp} gibt es nicht`);
      if (m.art === 'leuchtfeuer' && !beacons.has(m.nummer)) errors.push(`Aufgabe ${q.id}/${s.id}: Leuchtfeuer ${m.nummer} gibt es nicht`);
      if (m.art === 'boss' && !bosses.has(m.boss)) errors.push(`Aufgabe ${q.id}/${s.id}: Boss ${m.boss} gibt es nicht`);
    }
  }
  if ((kinds.get('einstieg') ?? 0) !== 1) errors.push(`Einstieg: ${kinds.get('einstieg') ?? 0} Einstiegsaufgaben, genau eine erwartet (docs/SPIEL.md §23)`);
  for (const a of records<AchievementDef>(registry, 'achievements')) {
    if (!spriteIds.has(achievementIconId(a.id))) errors.push(`Erfolg ${a.id}: Symbol ${achievementIconId(a.id)} fehlt`);
    unsourced(`Erfolg ${a.id}`, a.ausloeser);
  }
  for (const m of records<MilestoneDef>(registry, 'milestones')) unsourced(`Meilenstein ${m.id}`, m.ausloeser);
  for (const d of records<DialogDef>(registry, 'dialogs')) if (d.sprecher === 'funke' && !spoken.has(d.id)) warnings.push(`Dialog ${d.id}: kein Aufgabenschritt spricht ihn`);
  return { errors, warnings };
}
