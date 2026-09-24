/**
 * Erreichbarkeitsgraph des Content-Validators (M3-38; MASTERPROMPT §31.4, §13.2 „Abbaukraft des Werkzeugs
 * muss ≥ Härte der Ressource sein“, §15.1). Reine Funktion über eine Registry, damit Tests sie mit Fixtures
 * aufrufen können; `runChecks()` (checks.ts) wendet sie auf die echte Registry an.
 *
 * Wurzeln sind die Quellen, die die Welt ohne Herstellung liefert: Welt-Objekte (`welt:`), Graben
 * (`graben:`), Kreaturen-Beute (`drop:`), Funde an Orten (`ort:`) und die Händlerin (`haendlerin`).
 * Welt-Objekte und Graben verlangen ihr Werkzeug: Ein Objekt, das `tool` mit Härte `hardness` braucht
 * (Obst an Bäumen wird von Hand geerntet), bzw. ein Boden, dessen `dig` ein Werkzeug verlangt, liefert erst,
 * wenn ein erreichbares Item mit dieser Werkzeugart und Abbaukraft ≥ Härte existiert.
 * Ein Rezept ist herstellbar, wenn alle Zutaten erreichbar sind, seine Station (ein Item) erreichbar ist
 * und – falls es einen Bauplan verlangt – eine Fundstelle des Bauplans eine Wurzel ist. Sein Produkt wird
 * damit erreichbar (`rezept:`). Die Umgebung „Wasser“ bietet jede Welt.
 *
 * Der Graph wird bis zum Fixpunkt ausgewertet. Fehler: jedes Item, das von keiner Wurzel aus erreichbar
 * ist (Waise, mit dem Grund je Quelle), und jedes Rezept, das nie herstellbar ist (mit den fehlenden
 * Voraussetzungen). Ausgenommen sind Items mit geplanter Erreichbarkeit (reachability-geplant.ts), deren
 * Task noch offen ist, und alles, was nur an ihnen hängt: Ein zweiter Durchlauf nimmt diese Items als
 * erreichbar an; was erst dann erreichbar wird, ist eine Warnung statt eines Fehlers.
 */
import type { ContentRecord, ContentRegistryView } from '../../src/content/registry';
import { ITEM_RELATIONS, type ItemRelation } from '../../src/content/items/relations';
import { buildItemIndex, ITEMS_COLLECTION } from '../../src/content/items/usage';
import { ITEM_SOURCE_KINDS, parseItemSource, type ItemSource } from '../../src/content/schema/item';
import { taskStatus } from './items';
import type { GeplanteErreichbarkeit } from './reachability-geplant';

/** Name der Rezept-Sammlung. */
export const RECIPES_COLLECTION = 'recipes';
/** Werkzeug „keins“ (von Hand). */
const HAND = 'hand';
/** Anlass, bei dem ein Baum Obst trägt, das von Hand gepflückt wird. */
const HAND_OCCASION = 'ernte';

/** Optionen der Erreichbarkeitsprüfung. */
export interface ReachabilityOptions {
  /** Einordnung der Item-Referenzen (Standard: `ITEM_RELATIONS`). */
  readonly relations?: readonly ItemRelation[];
  /** Geplante Erreichbarkeit (Item-Id → Task) und der Inhalt von PROGRESS.md (Status der Tasks). */
  readonly geplant?: Readonly<Record<string, GeplanteErreichbarkeit>>;
  readonly progress?: string;
}

/** Ergebnis der Erreichbarkeitsprüfung. */
export interface ReachabilityResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** Erreichbare Items und herstellbare Rezepte (Diagnose, Tests). */
  readonly items: ReadonlySet<string>;
  readonly recipes: ReadonlySet<string>;
}

/** Werkzeugbedarf einer Quelle. */
interface ToolNeed {
  readonly tool: string;
  readonly hardness: number;
}

/** Eine Menge und ein Item eines Rezepts. */
interface Amount {
  readonly item: string;
  readonly count: number;
}

/** Die Felder eines Rezepts, die der Graph liest. */
interface RecipeNode {
  readonly id: string;
  readonly product: string | null;
  readonly inputs: readonly Amount[];
  readonly station: string | null;
  /** Fundstellen des Bauplans (`null` = ohne Bauplan). */
  readonly blueprint: readonly string[] | null;
}

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

function collectionOf(registry: ContentRegistryView, name: string): ReturnType<ContentRegistryView['collections']>[number] | undefined {
  return registry.collections().find((c) => c.name === name);
}

function recordOf(registry: ContentRegistryView, name: string, id: string): ContentRecord | undefined {
  return collectionOf(registry, name)?.find(id);
}

function amountOf(value: unknown): Amount | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = field(value, 'item');
  const count = field(value, 'anzahl');
  return typeof item === 'string' ? { item, count: typeof count === 'number' ? count : 1 } : null;
}

/** Liest ein Rezept defensiv (Fixtures dürfen unvollständig sein). */
function recipeNode(record: ContentRecord): RecipeNode {
  const product = amountOf(field(record, 'ergebnis'));
  const inputs = field(record, 'zutaten');
  const station = field(record, 'station');
  const blueprint = field(record, 'bauplan');
  const sources = typeof blueprint === 'object' && blueprint !== null ? field(blueprint, 'quellen') : undefined;
  return {
    id: record.id,
    product: product?.item ?? null,
    inputs: Array.isArray(inputs) ? inputs.map(amountOf).filter((a): a is Amount => a !== null) : [],
    station: typeof station === 'string' ? station : null,
    blueprint: Array.isArray(sources) ? sources.filter((s): s is string => typeof s === 'string') : null,
  };
}

/** Werkzeugart und Abbaukraft eines Items, oder `null`. */
function toolOf(item: ContentRecord): ToolNeed | null {
  const tool = field(item, 'werkzeug');
  if (typeof tool !== 'object' || tool === null) return null;
  const art = field(tool, 'art');
  const power = field(tool, 'abbaukraft');
  return typeof art === 'string' && typeof power === 'number' ? { tool: art, hardness: power } : null;
}

/**
 * Werkzeugbedarf, mit dem `itemId` aus dem Welt-Objekt bzw. Boden `source` kommt: je passendem Drop bzw.
 * Grabvorgang eine Möglichkeit (leer = die Quelle liefert das Item nicht).
 */
function toolNeeds(registry: ContentRegistryView, itemId: string, source: ItemSource): ToolNeed[] {
  if (source.id === null) return [];
  if (source.kind === 'welt') {
    const object = recordOf(registry, 'worldObjects', source.id);
    if (object === undefined) return [];
    const drops = field(object, 'drops');
    const tool = field(object, 'tool');
    const hardness = field(object, 'hardness');
    const needs: ToolNeed[] = [];
    for (const drop of Array.isArray(drops) ? drops : []) {
      if (typeof drop !== 'object' || drop === null || field(drop, 'item') !== itemId) continue;
      if (field(drop, 'anlass') === HAND_OCCASION) needs.push({ tool: HAND, hardness: 0 });
      else needs.push({ tool: typeof tool === 'string' ? tool : HAND, hardness: typeof hardness === 'number' ? hardness : 0 });
    }
    return needs;
  }
  if (source.kind === 'graben') {
    const terrain = recordOf(registry, 'terrain', source.id);
    const dig = terrain === undefined ? undefined : field(terrain, 'dig');
    if (typeof dig !== 'object' || dig === null) return [];
    const tool = field(dig, 'tool');
    const hardness = field(dig, 'hardness');
    return [{ tool: typeof tool === 'string' ? tool : HAND, hardness: typeof hardness === 'number' ? hardness : 0 }];
  }
  return [];
}

/** Erreichbare Items, herstellbare Rezepte und die besten erreichbaren Werkzeuge eines Durchlaufs. */
interface Solution {
  readonly items: Set<string>;
  readonly recipes: Set<string>;
  /** Werkzeugart → höchste erreichbare Abbaukraft. */
  readonly tools: Map<string, number>;
}

/** Der Graph einer Registry. */
interface Graph {
  readonly registry: ContentRegistryView;
  readonly items: readonly ContentRecord[];
  readonly sources: ReadonlyMap<string, readonly string[]>;
  readonly recipes: readonly RecipeNode[];
  readonly recipeById: ReadonlyMap<string, RecipeNode>;
}

function toolAvailable(sol: Solution, need: ToolNeed): boolean {
  return need.tool === HAND || need.hardness <= 0 || (sol.tools.get(need.tool) ?? Number.NEGATIVE_INFINITY) >= need.hardness;
}

/** Ob die Quelle einer Kreatur, eines Orts oder der Händlerin existiert (fehlende Sammlungen meldet die Item-Prüfung). */
function rootExists(registry: ContentRegistryView, source: ItemSource): boolean {
  const collection = ITEM_SOURCE_KINDS[source.kind];
  return collection === null || source.id === null || recordOf(registry, collection, source.id) !== undefined;
}

/** Ob die Quelle `source` das Item `itemId` in der Lösung `sol` liefert. */
function sourceDelivers(g: Graph, sol: Solution, itemId: string, source: string): boolean {
  const parsed = parseItemSource(source);
  if (parsed === null) return false;
  if (parsed.kind === 'rezept') return parsed.id !== null && sol.recipes.has(parsed.id);
  if (parsed.kind === 'welt' || parsed.kind === 'graben') return toolNeeds(g.registry, itemId, parsed).some((n) => toolAvailable(sol, n));
  return rootExists(g.registry, parsed);
}

/** Ob eine Fundstelle eines Bauplans eine Wurzel ist (Baupläne werden gefunden, nie hergestellt oder abgebaut). */
function blueprintFound(g: Graph, source: string): boolean {
  const parsed = parseItemSource(source);
  if (parsed === null || parsed.kind === 'rezept' || parsed.kind === 'welt' || parsed.kind === 'graben') return false;
  return rootExists(g.registry, parsed);
}

function recipeReady(g: Graph, sol: Solution, r: RecipeNode): boolean {
  return r.product !== null && r.inputs.every((a) => sol.items.has(a.item)) && (r.station === null || sol.items.has(r.station)) && (r.blueprint === null || r.blueprint.some((b) => blueprintFound(g, b)));
}

/** Wertet den Graphen bis zum Fixpunkt aus; `assumed` gelten von Anfang an als erreichbar. */
function solve(g: Graph, assumed: ReadonlySet<string>): Solution {
  const sol: Solution = { items: new Set(), recipes: new Set(), tools: new Map() };
  const reach = (item: ContentRecord): void => {
    sol.items.add(item.id);
    const tool = toolOf(item);
    if (tool !== null) sol.tools.set(tool.tool, Math.max(sol.tools.get(tool.tool) ?? Number.NEGATIVE_INFINITY, tool.hardness));
  };
  for (const item of g.items) if (assumed.has(item.id)) reach(item);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of g.items) {
      if (sol.items.has(item.id) || !(g.sources.get(item.id) ?? []).some((s) => sourceDelivers(g, sol, item.id, s))) continue;
      reach(item);
      changed = true;
    }
    for (const r of g.recipes) {
      if (sol.recipes.has(r.id) || !recipeReady(g, sol, r)) continue;
      sol.recipes.add(r.id);
      changed = true;
    }
  }
  return sol;
}

function recipeProblems(g: Graph, sol: Solution, r: RecipeNode): string[] {
  const out: string[] = [];
  if (r.product === null) out.push('kein Produkt');
  const missing = r.inputs.filter((a) => !sol.items.has(a.item)).map((a) => a.item);
  if (missing.length > 0) out.push(`Zutaten nicht erreichbar: ${missing.join(', ')}`);
  if (r.station !== null && !sol.items.has(r.station)) out.push(`Station ${r.station} nicht erreichbar`);
  if (r.blueprint !== null && !r.blueprint.some((b) => blueprintFound(g, b))) out.push(`Bauplan an keiner Fundstelle (${r.blueprint.join(', ') || 'keine'})`);
  return out;
}

function sourceProblem(g: Graph, sol: Solution, itemId: string, source: string): string {
  const parsed = parseItemSource(source);
  if (parsed === null) return `${source}: ungültige Quelle`;
  if (parsed.kind === 'rezept') {
    const r = parsed.id === null ? undefined : g.recipeById.get(parsed.id);
    return r === undefined ? `${source}: Rezept fehlt` : `${source}: ${recipeProblems(g, sol, r).join('; ')}`;
  }
  if (parsed.kind === 'welt' || parsed.kind === 'graben') {
    const needs = toolNeeds(g.registry, itemId, parsed);
    if (needs.length === 0) return `${source}: liefert ${itemId} nicht`;
    return `${source}: braucht ${needs.map((n) => `${n.tool} mit Abbaukraft ≥ ${n.hardness}`).join(' oder ')} – kein solches Werkzeug erreichbar`;
  }
  return `${source}: Quelle unbekannt`;
}

/** Prüft den Erreichbarkeitsgraphen (siehe Modulkommentar). Ohne Sammlung `items` gibt es nichts zu prüfen. */
export function checkReachability(registry: ContentRegistryView, options: ReachabilityOptions = {}): ReachabilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const itemCollection = collectionOf(registry, ITEMS_COLLECTION);
  if (itemCollection === undefined) return { errors, warnings, items: new Set(), recipes: new Set() };
  const recipes = (collectionOf(registry, RECIPES_COLLECTION)?.values() ?? []).map(recipeNode);
  const g: Graph = {
    registry,
    items: itemCollection.values(),
    sources: buildItemIndex(registry, options.relations ?? ITEM_RELATIONS).sources,
    recipes,
    recipeById: new Map(recipes.map((r) => [r.id, r])),
  };
  const real = solve(g, new Set());

  // Geplante Erreichbarkeit: offene Einträge gelten im zweiten Durchlauf als erreichbar.
  const geplant = options.geplant ?? {};
  const progress = options.progress ?? '';
  const open = new Set<string>();
  for (const [id, plan] of Object.entries(geplant)) {
    if (!itemCollection.has(id)) {
      errors.push(`Geplante Erreichbarkeit für unbekanntes Item ${id}`);
      continue;
    }
    const status = taskStatus(progress, plan.task);
    if (real.items.has(id)) warnings.push(`Geplante Erreichbarkeit für ${id} (${plan.task}) ist veraltet: das Item ist erreichbar – Eintrag in tools/validator/reachability-geplant.ts streichen`);
    else if (status === null) errors.push(`Item ${id}: geplante Erreichbarkeit nennt unbekannten Task ${plan.task}`);
    else if (status === 'erledigt') errors.push(`Item ${id}: Erreichbarkeit war mit ${plan.task} geplant (${plan.grund}), der Task ist erledigt – das Item ist aber noch nicht erreichbar`);
    else open.add(id);
  }
  const hoped = open.size === 0 ? real : solve(g, open);

  const pending: string[] = [];
  for (const item of g.items) {
    if (real.items.has(item.id)) continue;
    if (hoped.items.has(item.id)) {
      pending.push(item.id);
      continue;
    }
    const sources = g.sources.get(item.id) ?? [];
    const why = sources.length === 0 ? 'keine Quelle' : sources.map((s) => sourceProblem(g, real, item.id, s)).join(' | ');
    errors.push(`Item ${item.id} ist von keiner Weltquelle aus erreichbar (Waise): ${why}`);
  }
  for (const r of g.recipes) {
    if (real.recipes.has(r.id)) continue;
    if (hoped.recipes.has(r.id)) pending.push(r.id);
    else errors.push(`Rezept ${r.id} ist nie herstellbar: ${recipeProblems(g, real, r).join('; ')}`);
  }
  if (pending.length > 0) {
    const plans = [...open].map((id) => `${id} → ${(geplant[id] as GeplanteErreichbarkeit).task}`).join(', ');
    warnings.push(`Erst mit geplanter Erreichbarkeit (${plans}) erreichbar (${pending.length}): ${pending.join(', ')}`);
  }
  return { errors, warnings, items: real.items, recipes: real.recipes };
}
