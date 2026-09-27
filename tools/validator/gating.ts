/**
 * Validator-Regel `gating` (M4-33; MASTERPROMPT §13.2 „Stufen & Gating“): hält den Content an die Tabelle aus
 * src/content/gating.ts. Reine Funktion über eine Registry, damit Tests sie mit Fixtures aufrufen können;
 * `runChecks()` (checks.ts) wendet sie auf die echte Registry an.
 *
 * - **Tabelle:** Abbaukraft je Stufe T0–T7 = 1–8, gleich `BALANCE.tools.miningPowerByTier`.
 * - **Härte je Ressource:** jedes Erz (`erz:<id>`: Erz-Datensatz, Erzknoten `erz_<id>`, Ader `ader_<id>`) und
 *   jeder Boden (`boden:<id>`: `dig.hardness`) hat die Härte der Tabelle; was eine Stufe erschließt, hat ihre
 *   Abbaukraft als Härte.
 * - **Werkzeuge:** jedes Item mit Werkzeugdaten hat die Abbaukraft seiner Stufe.
 * - **Spitzhacken:** jede Spitzhacke ab T1 braucht auf jedem Weg den Schlüssel-Drop ihrer Stufe (Zutat, auch über
 *   Zwischenprodukte); eine, die ohne ihn herstellbar oder zu finden ist, ist ein Fehler.
 * - **Waffen und Rüstung** (Waffen, Rüstungsteile, Schilde) brauchen keinen Boss-Drop – weder einen
 *   Schlüssel-Drop noch ein anderes Item, das nur ein Boss der Tabelle fallen lässt.
 * - **Stufenausrüstung:** jede Stufe, deren Werkzeuge es gibt, hat eine Waffe und ein Rüstungsset (Kopf, Brust,
 *   Beine, Füße) ohne Boss-Drop – oder einen offenen geplanten Task dafür (`GEPLANTE_STUFENAUSRUESTUNG`); ein
 *   erledigter Task ohne das Stück ist ein Fehler, ein Eintrag für ein vorhandenes Stück eine Warnung.
 */
import { BALANCE } from '../../src/content/balance';
import { ARMOR_SET_SLOTS, GATING_TIERS, GEPLANTE_STUFENAUSRUESTUNG, parseResourceKey, RESOURCE_HARDNESS, type GatingTier, type GeplanteStufenausruestung } from '../../src/content/gating';
import { ITEM_RELATIONS } from '../../src/content/items/relations';
import { buildItemIndex, ITEMS_COLLECTION } from '../../src/content/items/usage';
import type { ContentRecord, ContentRegistryView } from '../../src/content/registry';
import { parseItemSource } from '../../src/content/schema/item';
import { taskStatus } from './items';

/** Optionen der Gating-Prüfung (Standard: der Content des Spiels). */
export interface GatingOptions {
  readonly tiers?: readonly GatingTier[];
  readonly hardness?: Readonly<Record<string, number>>;
  readonly miningPower?: readonly number[];
  readonly geplant?: Readonly<Record<number, GeplanteStufenausruestung>>;
  /** Inhalt von PROGRESS.md (Status der geplanten Tasks). */
  readonly progress?: string;
}

/** Ergebnis der Gating-Prüfung. */
export interface GatingResult {
  readonly errors: string[];
  readonly warnings: string[];
}

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

function collection(registry: ContentRegistryView, name: string): readonly ContentRecord[] {
  return registry.collections().find((c) => c.name === name)?.values() ?? [];
}

function find(registry: ContentRegistryView, name: string, id: string): ContentRecord | undefined {
  return registry
    .collections()
    .find((c) => c.name === name)
    ?.find(id);
}

function numberAt(record: object | undefined, ...path: string[]): number | undefined {
  let v: unknown = record;
  for (const k of path) v = typeof v === 'object' && v !== null ? field(v, k) : undefined;
  return typeof v === 'number' ? v : undefined;
}

/** Zutaten eines Rezepts: je Zutat die Items, die sie erfüllen (Gruppe: ihre Mitglieder). */
function ingredientOptions(registry: ContentRegistryView, recipe: ContentRecord): string[][] {
  const zutaten = field(recipe, 'zutaten');
  const out: string[][] = [];
  for (const z of Array.isArray(zutaten) ? zutaten : []) {
    if (typeof z !== 'object' || z === null) continue;
    const item = field(z, 'item');
    const gruppe = field(z, 'gruppe');
    if (typeof item === 'string') out.push([item]);
    else if (typeof gruppe === 'string') {
      const members = field(find(registry, 'ingredientGroups', gruppe) ?? {}, 'items');
      out.push(Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : []);
    }
  }
  return out;
}

function intersect(sets: readonly ReadonlySet<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  const [first, ...rest] = sets as [ReadonlySet<string>, ...ReadonlySet<string>[]];
  return new Set([...first].filter((k) => rest.every((s) => s.has(k))));
}

/**
 * Boss-Drops, die ein Item auf jedem Weg braucht: ein Boss-Drop braucht sich selbst; ein Item mit einer Quelle
 * außer Rezepten (Welt, Graben, Beute, Ort, Händlerin) nichts; sonst die Schnittmenge über seine Rezepte, je
 * Rezept die Vereinigung über seine Zutaten (eine Gruppe: die Schnittmenge über ihre Mitglieder).
 */
function bossNeeds(registry: ContentRegistryView, bossDrops: ReadonlySet<string>): (item: string) => ReadonlySet<string> {
  const sources = buildItemIndex(registry, ITEM_RELATIONS).sources;
  const recipes = collection(registry, 'recipes');
  const byProduct = new Map<string, ContentRecord[]>();
  for (const r of recipes) {
    const product = field(field(r, 'ergebnis') ?? {}, 'item');
    if (typeof product === 'string') byProduct.set(product, [...(byProduct.get(product) ?? []), r]);
  }
  const memo = new Map<string, ReadonlySet<string>>();
  const busy = new Set<string>();
  const needs = (item: string): ReadonlySet<string> => {
    const known = memo.get(item);
    if (known !== undefined) return known;
    if (bossDrops.has(item)) return new Set([item]);
    if (busy.has(item)) return new Set();
    busy.add(item);
    const other = (sources.get(item) ?? []).some((s) => parseItemSource(s)?.kind !== 'rezept');
    const made = byProduct.get(item) ?? [];
    let result: ReadonlySet<string> = new Set();
    if (!other && made.length > 0) {
      result = intersect(made.map((r) => new Set(ingredientOptions(registry, r).flatMap((options) => [...intersect(options.map(needs))]))));
    }
    busy.delete(item);
    memo.set(item, result);
    return result;
  };
  return needs;
}

/** Prüft die Gating-Regeln (siehe Modulkommentar). */
export function checkGating(registry: ContentRegistryView, options: GatingOptions = {}): GatingResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tiers = options.tiers ?? GATING_TIERS;
  const hardness = options.hardness ?? RESOURCE_HARDNESS;
  const power = options.miningPower ?? BALANCE.tools.miningPowerByTier;
  const geplant = options.geplant ?? GEPLANTE_STUFENAUSRUESTUNG;
  const progress = options.progress ?? '';

  // Tabelle: T0–T7 = Abbaukraft 1–8, gleich den Balancewerten.
  tiers.forEach((t, i) => {
    if (t.abbaukraft !== i + 1) errors.push(`Gating: Stufe T${i} hat Abbaukraft ${t.abbaukraft}, §13.2 verlangt ${i + 1}`);
    if (power[i] !== t.abbaukraft) errors.push(`Gating: BALANCE.tools.miningPowerByTier[${i}] = ${String(power[i])}, die Tabelle nennt ${t.abbaukraft}`);
  });

  // Härte je Ressource.
  for (const [key, h] of Object.entries(hardness)) {
    const res = parseResourceKey(key);
    if (res === null) {
      errors.push(`Gating: Ressource „${key}“ ist weder erz:<id> noch boden:<id>`);
      continue;
    }
    if (res.art === 'erz') {
      const ore = find(registry, 'ores', res.id);
      if (ore === undefined) errors.push(`Gating: Erz ${res.id} fehlt`);
      else if (numberAt(ore, 'hardness') !== h) errors.push(`Gating: Erz ${res.id} hat Härte ${String(numberAt(ore, 'hardness'))}, §13.2 verlangt ${h}`);
      const node = find(registry, 'worldObjects', `erz_${res.id}`);
      if (node !== undefined && numberAt(node, 'hardness') !== h) errors.push(`Gating: Erzknoten erz_${res.id} hat Härte ${String(numberAt(node, 'hardness'))}, §13.2 verlangt ${h}`);
      const vein = find(registry, 'terrain', `ader_${res.id}`);
      const veinHardness = numberAt(vein, 'dig', 'hardness');
      if (veinHardness !== undefined && veinHardness !== h) errors.push(`Gating: Ader ader_${res.id} hat Härte ${veinHardness}, §13.2 verlangt ${h}`);
    } else {
      const ground = find(registry, 'terrain', res.id);
      const dig = numberAt(ground, 'dig', 'hardness');
      if (ground === undefined) errors.push(`Gating: Boden ${res.id} fehlt`);
      else if (dig !== h) errors.push(`Gating: Boden ${res.id} hat Grabhärte ${String(dig)}, §13.2 verlangt ${h}`);
    }
  }
  for (const t of tiers) {
    for (const key of t.erschliesst) {
      const h = hardness[key];
      if (h === undefined) errors.push(`Gating: Stufe T${t.stufe} erschließt ${key}, das keine Härte hat`);
      else if (h !== t.abbaukraft) errors.push(`Gating: ${key} (Härte ${h}) wird von T${t.stufe} erschlossen – seine Härte muss ${t.abbaukraft} sein`);
    }
  }

  const items = collection(registry, ITEMS_COLLECTION);
  const tierOf = (item: ContentRecord): number => numberAt(item, 'stufe') ?? 0;

  // Werkzeuge: Abbaukraft ihrer Stufe.
  for (const item of items) {
    const p = numberAt(item, 'werkzeug', 'abbaukraft');
    const t = tiers[tierOf(item)];
    if (p !== undefined && t !== undefined && p !== t.abbaukraft) errors.push(`Gating: Werkzeug ${item.id} (T${tierOf(item)}) hat Abbaukraft ${p}, die Stufe verlangt ${t.abbaukraft}`);
  }

  // Boss-Drops: Schlüssel-Drops der Tabelle und alles, was nur ein Boss der Tabelle fallen lässt.
  const bosses = new Set(tiers.flatMap((t) => (t.schluessel === null ? [] : [t.schluessel.boss])));
  const bossDrops = new Set(tiers.flatMap((t) => (t.schluessel === null ? [] : [t.schluessel.item])));
  for (const item of items) {
    const q = field(item, 'quellen');
    if (Array.isArray(q) && q.some((s) => typeof s === 'string' && parseItemSource(s)?.kind === 'drop' && bosses.has(parseItemSource(s)?.id ?? ''))) bossDrops.add(item.id);
  }
  const needs = bossNeeds(registry, bossDrops);

  // Spitzhacken ab T1 brauchen den Schlüssel-Drop ihrer Stufe.
  for (const item of items) {
    if (field(field(item, 'werkzeug') ?? {}, 'art') !== 'spitzhacke') continue;
    const t = tiers[tierOf(item)];
    if (t === undefined || t.schluessel === null) continue;
    if (!needs(item.id).has(t.schluessel.item)) errors.push(`Gating: Spitzhacke ${item.id} (T${t.stufe}) ohne Schlüssel-Drop ${t.schluessel.item} (${t.schluessel.boss}) herstellbar oder zu finden`);
  }

  // Waffen und Rüstung brauchen keinen Boss-Drop.
  const armour = (item: ContentRecord): boolean => field(item, 'kategorie') === 'ruestung' || field(item, 'kategorie') === 'schild';
  const weapon = (item: ContentRecord): boolean => field(item, 'kategorie') === 'waffe';
  const free = (item: ContentRecord): boolean => needs(item.id).size === 0;
  for (const item of items) {
    if (!weapon(item) && !armour(item)) continue;
    const need = [...needs(item.id)];
    if (need.length > 0) errors.push(`Gating: ${weapon(item) ? 'Waffe' : 'Rüstung'} ${item.id} (T${tierOf(item)}) braucht den Boss-Drop ${need.join(', ')} – Waffen und Rüstung einer Stufe brauchen keinen`);
  }

  // Jede Stufe mit Werkzeugen hat Waffe und Rüstungsset ohne Boss-Drop (oder einen offenen geplanten Task).
  const open = new Set(items.filter((i) => field(i, 'kategorie') === 'werkzeug').map(tierOf));
  const planned = (t: number, what: 'waffe' | 'ruestung', present: boolean, label: string): void => {
    const task = geplant[t]?.[what];
    if (present) {
      if (task !== undefined) warnings.push(`Gating: geplante ${label} für T${t} (${task}) ist veraltet – Eintrag in GEPLANTE_STUFENAUSRUESTUNG (src/content/gating.ts) streichen`);
      return;
    }
    if (task === undefined) {
      errors.push(`Gating: Stufe T${t} hat Werkzeuge, aber ${label === 'Waffe' ? 'keine Waffe' : 'kein Rüstungsset'} ohne Boss-Drop`);
      return;
    }
    const status = taskStatus(progress, task);
    if (status === null) errors.push(`Gating: geplante ${label} für T${t} nennt unbekannten Task ${task}`);
    else if (status === 'erledigt') errors.push(`Gating: ${label} für T${t} war mit ${task} geplant, der Task ist erledigt – ${label === 'Waffe' ? 'die Waffe' : 'das Rüstungsset'} fehlt aber`);
  };
  for (const t of [...open].sort((a, b) => a - b)) {
    const weaponOk = items.some((i) => weapon(i) && tierOf(i) === t && free(i));
    const setOk = ARMOR_SET_SLOTS.every((slot) => items.some((i) => field(i, 'kategorie') === 'ruestung' && tierOf(i) === t && field(i, 'ausruestung') === slot && free(i)));
    planned(t, 'waffe', weaponOk, 'Waffe');
    planned(t, 'ruestung', setOk, 'Rüstungsset');
  }
  for (const t of Object.keys(geplant).map(Number)) {
    if (!open.has(t)) errors.push(`Gating: geplante Stufenausrüstung für T${t}, aber die Stufe hat noch keine Werkzeuge`);
  }
  return { errors, warnings };
}
