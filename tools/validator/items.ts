/**
 * Item-Regeln des Content-Validators (MASTERPROMPT §31.4, §2.2; docs/SPIEL.md §2). Reine Funktion über
 * eine Registry, die Sprite-Ids und den Stand von PROGRESS.md, damit Tests sie mit Fixtures aufrufen
 * können; `runChecks()` (checks.ts) wendet sie auf die echte Registry an.
 *
 * Jedes Item braucht:
 * - Texte `name` und `beschreibung` in DE und EN (die Registry prüft das schon beim Laden; hier auch für
 *   laxe Schemas),
 * - sein Icon `icon_<id>` und – wenn es an der Figur zu sehen ist (Rüstung, Werkzeug, Waffe, Schild,
 *   Licht) – sein Ausrüstungs-Sprite `ausruestung_<id>`,
 * - mindestens eine Quelle (deklarierte `quellen` oder abgeleitete, z. B. `drops` eines Welt-Objekts);
 *   deklarierte Quellen müssen auflösen (`welt:<objekt>` lässt das Item wirklich fallen,
 *   `graben:<terrain>` ist grabbar),
 * - mindestens eine Verwendung (aus den eigenen Daten oder aus Referenzen anderer Sammlungen), außer
 *   es ist als `endprodukt` markiert oder seine Verwendung ist mit einem offenen Backlog-Task geplant
 *   (verwendungen-geplant.ts).
 * Außerdem muss jede Referenz auf `items` in `ITEM_RELATIONS` als Quelle oder Verwendung eingeordnet sein.
 */
import type { ContentRecord, ContentRegistryView } from '../../src/content/registry';
import { missingLanguages, looksLikeLocalizedText } from '../../src/content/schema/common';
import { ITEM_SOURCE_KINDS, parseItemSource } from '../../src/content/schema/item';
import { buildItemIndex, ITEMS_COLLECTION, itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../src/content/items/index';
import type { ItemRelation } from '../../src/content/items/relations';
import type { GeplanteVerwendung } from './verwendungen-geplant';

/** Eingaben der Item-Prüfung. */
export interface ItemCheckInput {
  readonly registry: ContentRegistryView;
  /** Ids aller vorhandenen Sprites. */
  readonly spriteIds: ReadonlySet<string>;
  /** Geplante Verwendungen (Item-Id → Task). */
  readonly geplant: Readonly<Record<string, GeplanteVerwendung>>;
  /** Inhalt von PROGRESS.md (Status der Tasks). */
  readonly progress: string;
  /** Einordnung der Item-Referenzen (Standard: `ITEM_RELATIONS`). */
  readonly relations?: readonly ItemRelation[];
}

/** Ergebnis der Item-Prüfung. */
export interface ItemCheckResult {
  errors: string[];
  warnings: string[];
}

/** Status eines Backlog-Tasks in PROGRESS.md: `erledigt` (`- [x]`), `offen` (`- [ ]`) oder `null` (nicht gefunden). */
export function taskStatus(progress: string, taskId: string): 'erledigt' | 'offen' | null {
  const escaped = taskId.replace(/[-]/g, '\\-');
  const match = new RegExp(`^- \\[([ xX])\\] ${escaped}(?:\\s|$)`, 'm').exec(progress);
  if (match === null) return null;
  return match[1] === ' ' ? 'offen' : 'erledigt';
}

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

/** Datensatz `id` der Sammlung `name` einer Registry-Sicht, oder `undefined`. */
function recordOf(registry: ContentRegistryView, name: string, id: string): ContentRecord | undefined {
  return registry
    .collections()
    .find((c) => c.name === name)
    ?.find(id);
}

/** Warum die deklarierte Quelle `source` des Items `itemId` nicht auflöst, oder `null`. */
function sourceProblem(registry: ContentRegistryView, itemId: string, source: string): string | null {
  const parsed = parseItemSource(source);
  if (parsed === null) return `Quelle "${source}" hat kein gültiges Format`;
  const collection = ITEM_SOURCE_KINDS[parsed.kind];
  if (collection === null || parsed.id === null) return null;
  if (!registry.hasCollection(collection)) return `Quelle "${source}": Sammlung "${collection}" gibt es (noch) nicht`;
  const target = recordOf(registry, collection, parsed.id);
  if (target === undefined) return `Quelle "${source}": ${collection}/${parsed.id} existiert nicht`;
  if (parsed.kind === 'welt') {
    const drops = field(target, 'drops');
    const dropsItem = Array.isArray(drops) && drops.some((d: unknown) => typeof d === 'object' && d !== null && field(d, 'item') === itemId);
    if (!dropsItem) return `Quelle "${source}": ${parsed.id} lässt "${itemId}" nicht fallen (drops)`;
  }
  if (parsed.kind === 'graben' && (field(target, 'dig') === null || field(target, 'dig') === undefined)) return `Quelle "${source}": ${parsed.id} lässt sich nicht graben`;
  return null;
}

/** Prüft alle Items einer Registry (siehe Modulkommentar). Ohne Sammlung `items` gibt es nichts zu prüfen. */
export function checkItems(input: ItemCheckInput): ItemCheckResult {
  const res: ItemCheckResult = { errors: [], warnings: [] };
  const { registry, spriteIds, geplant, progress } = input;
  const items = registry.collections().find((c) => c.name === ITEMS_COLLECTION);
  if (items === undefined) return res;
  const index = buildItemIndex(registry, input.relations);
  const pending: string[] = [];

  for (const item of items.values()) {
    const id = item.id;
    for (const key of ['name', 'beschreibung']) {
      const text = field(item, key);
      if (!looksLikeLocalizedText(text)) res.errors.push(`Item ${id}: Text "${key}" fehlt`);
      else for (const lang of missingLanguages(text)) res.errors.push(`Item ${id}: Übersetzung fehlt (${lang.toUpperCase()}) in "${key}"`);
    }
    if (!spriteIds.has(itemIconId(id))) res.errors.push(`Item ${id}: Icon ${itemIconId(id)} fehlt`);
    const kategorie = field(item, 'kategorie');
    const ausruestung = field(item, 'ausruestung');
    if (typeof kategorie === 'string') {
      const layer = itemFigureLayer({ kategorie, ausruestung: typeof ausruestung === 'string' ? ausruestung : undefined });
      if (layer !== null && !spriteIds.has(itemLayerSpriteId(id))) res.errors.push(`Item ${id}: Ausrüstungs-Sprite ${itemLayerSpriteId(id)} fehlt (Figuren-Layer ${layer})`);
    }

    const declared = field(item, 'quellen');
    for (const source of Array.isArray(declared) ? declared : []) {
      const problem = typeof source === 'string' ? sourceProblem(registry, id, source) : `Quelle ${JSON.stringify(source)} ist kein Text`;
      if (problem !== null) res.errors.push(`Item ${id}: ${problem}`);
    }
    if ((index.sources.get(id) ?? []).length === 0) res.errors.push(`Item ${id}: keine Quelle (weder deklarierte quellen noch Drops, Rezepte o. Ä.)`);

    const hasUse = (index.uses.get(id) ?? []).length > 0;
    const plan = geplant[id];
    if (hasUse) {
      if (plan !== undefined) res.warnings.push(`Geplante Verwendung für ${id} (${plan.task}) ist veraltet: das Item hat eine Verwendung – Eintrag in tools/validator/verwendungen-geplant.ts streichen`);
      continue;
    }
    if (field(item, 'endprodukt') === true) continue;
    if (plan === undefined) {
      res.errors.push(`Item ${id}: keine Verwendung (kein Rezept, keine Baukosten, nicht ess-, brenn-, trag- oder pflanzbar) und nicht als endprodukt markiert`);
      continue;
    }
    const status = taskStatus(progress, plan.task);
    if (status === null) res.errors.push(`Item ${id}: geplante Verwendung nennt unbekannten Task ${plan.task}`);
    else if (status === 'erledigt') res.errors.push(`Item ${id}: Verwendung war mit ${plan.task} geplant (${plan.zweck}), der Task ist erledigt – das Item hat aber noch keine Verwendung`);
    else pending.push(`${id} → ${plan.task}`);
  }

  for (const id of Object.keys(geplant)) {
    if (!items.has(id)) res.errors.push(`Geplante Verwendung für unbekanntes Item ${id}`);
  }
  for (const ref of index.unclassified) {
    res.errors.push(`Referenz ${ref.collection}/${ref.id}.${ref.at} → items ist weder als Quelle noch als Verwendung eingeordnet (src/content/items/relations.ts)`);
  }
  if (pending.length > 0) res.warnings.push(`Items mit geplanter Verwendung (${pending.length}): ${pending.join(', ')}`);
  return res;
}
