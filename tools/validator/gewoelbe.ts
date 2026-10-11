/**
 * Gewölbe-Regel des Content-Validators (MASTERPROMPT §21 „Gewölbe/Dungeons“, §31.4; docs/SPIEL.md §19, §29 „Gewölbe (C)“;
 * M7-10 … M7-16, M7-18, M7-46, Strang C). Reine Funktion über eine Registry und die Sprite-Angaben, damit Tests sie mit Fixtures
 * aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten Content an. Was die zod-Schemas je Datensatz prüfen
 * (Vorlagen-Raster, Türsockel, Plätze, Rätselgrenzen, Telegraph ≥ 0,4 s, Tafel-Ids), steht nicht noch einmal hier – die Regel
 * prüft die Bezüge zwischen den Sammlungen, zu den Sprites und die Lösbarkeit:
 *
 * - **Tilesets** (`vaultTilesets`): je Tileset jede Raumrolle (`VAULT_ROLES`) mit mindestens einer Vorlage – sonst kann die
 *   Grammatik einen Knoten nicht einbetten; jede Legenden-Kachel ein Boden-Terrain, jedes Objekt ein Welt-Objekt.
 * - **Rätsel** (`puzzleTypes`): die fünf Typen von §19, je mindestens drei Varianten, jede per Löser lösbar (die Lösung, Schritt für
 *   Schritt angewandt, löst die Variante); eine Kisten-Karte passt in die Rätselfläche.
 * - **Fallen** (`vaultTraps`): die sechs Fallen von §19; das Sprite jeder Falle mit den Clips, die die Spielansicht zeigt
 *   (src/render/game/vaults.ts).
 * - **Teile**: die Sprites der beweglichen Teile (`gw_<art>`) mit ihren Clips.
 * - **Wächter**: Konstrukt, Fallengeist, Mini-Boss und Mimik sind Kreaturen.
 * - **Belohnungen**: jeder einzigartige Bauplan der Endtruhen ist ein Item mit Block `bauplan`.
 * - **Tafeln** (`tablets`): Nummern lückenlos ab 1; eine Tafel in einem Gewölbe nennt eine Rolle, deren Vorlagen einen Platz
 *   `tafel` haben (Warnung sonst); eine Tafel an einem Ort steht in einem Layout ihres Ortstyps an einer Marke `tafel` mit ihrer Id
 *   (Warnung sonst – dann ist sie nur über die Konsole lesbar).
 * - **Zählung** `vaults` (§C „Gewölbe pro Welt Mittel“, docs/SPIEL.md §29): Σ über die Biome mit Gewölbe-Tileset von
 *   `LOCATION_RULES.gewoelbe.count.medium`.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import { PUZZLE_AREA, VAULT_ROLES, type PuzzleTypeDef, type PuzzleVariantDef, type RoomTemplateDef, type TabletDef, type VaultTilesetDef, type VaultTrapDef } from '../../src/content/dungeons/schema';
import { VAULT_UNIQUE_BLUEPRINTS } from '../../src/content/dungeons/belohnungen';
import type { PlaceLayoutDef } from '../../src/content/places/schema';
import type { ItemDef } from '../../src/content/schema/item';
import { kistenMap, puzzleAct, puzzleInit, puzzleSolve, puzzleSolved } from '../../src/game/puzzles/index';
import { LOCATION_RULES } from '../../src/world/gen/locations';
import { VAULT_GUARDS } from '../../src/world/gen/vaults/plan';

/** Was die Regel von einem Sprite wissen muss. */
export interface GewoelbeSpriteInfo {
  readonly clips: readonly string[];
}

/** Ergebnis der Regel. */
export interface GewoelbeCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** §C „Gewölbe pro Welt Mittel“ nach den Tilesets. */
  readonly vaults: number;
}

/** Die Rätseltypen von §19 und die Varianten je Typ (M7-12, M7-13). */
export const GEWOELBE_PUZZLE_TYPES = ['kisten', 'hebel', 'feuerschalen', 'verborgene_wand', 'glocken'] as const;
export const GEWOELBE_VARIANTS_MIN = 3;
/** Die Fallen von §19 (M7-14). */
export const GEWOELBE_TRAPS = ['speerfalle', 'pfeilwerfer', 'rollstein', 'fallgrube', 'einsturzboden', 'pendelklinge'] as const;
/** Die Clips, die die Spielansicht je Falle zeigt (src/render/game/vaults.ts). */
export const GEWOELBE_TRAP_CLIPS: Readonly<Record<(typeof GEWOELBE_TRAPS)[number], readonly string[]>> = {
  speerfalle: ['ruhe', 'warnung', 'stoss'],
  pfeilwerfer: ['n_ruhe', 'n_warnung', 'o_ruhe', 'o_warnung', 's_ruhe', 's_warnung'],
  rollstein: ['ruhe', 'warnung', 'rollt'],
  fallgrube: ['ruhe', 'warnung', 'offen'],
  einsturzboden: ['ruhe', 'warnung'],
  pendelklinge: ['schwung'],
};
/** Die beweglichen Teile mit ihren Clips (`gw_<art>`, assets-src/sprites/gewoelbe/teile.ts, fallen.ts). */
export const GEWOELBE_PART_CLIPS: Readonly<Record<string, readonly string[]>> = {
  gw_tor_quer: ['schloss', 'raetsel', 'verborgen', 'schloss_offen', 'raetsel_offen', 'verborgen_offen'],
  gw_tor_laengs: ['schloss', 'raetsel', 'verborgen', 'schloss_offen', 'raetsel_offen', 'verborgen_offen'],
  gw_hebel: ['oben', 'unten'],
  gw_schale: ['kalt', 'brennt'],
  gw_glocke: ['still', 'geschlagen'],
  gw_risswand: ['ganz', 'luftzug', 'offen'],
  gw_kiste: [],
  gw_platte: ['oben', 'gedrueckt'],
  gw_ruecksetzer: [],
  gw_hinweis: ['hebel', 'schalen', 'glocken', 'glocken_spielt'],
  gw_hinweis_zahl: [],
  gw_sockel_schluessel: ['voll', 'leer'],
  gw_sockel_splitter: ['voll', 'leer'],
  gw_falle_pfeil: [],
  gw_falle_pfeil_senkrecht: [],
  gw_falle_pendel_rille: ['quer', 'laengs'],
};

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function find<T>(registry: ContentRegistryView, name: string, id: string): T | undefined {
  return registry.collections().find((c) => c.name === name)?.find(id) as T | undefined;
}

/** Ob die Lösung des Lösers die Variante wirklich löst (Schritt für Schritt). */
function solvable(v: PuzzleVariantDef): boolean {
  const solution = puzzleSolve(v);
  if (solution === null) return false;
  let state = puzzleInit(v);
  for (const a of solution) state = puzzleAct(v, state, a);
  return puzzleSolved(v, state);
}

/** Die Gewölbe-Regel über `registry` mit den Sprite-Angaben `sprites` (Sprite-Id → Clips). */
export function checkGewoelbe(registry: ContentRegistryView, sprites: ReadonlyMap<string, GewoelbeSpriteInfo>): GewoelbeCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tilesets = records<VaultTilesetDef>(registry, 'vaultTilesets');
  const templates = records<RoomTemplateDef>(registry, 'roomTemplates');
  // Tilesets: every role has a template; legend tiles are terrain and world objects.
  for (const t of tilesets) {
    const own = templates.filter((r) => r.tileset === t.id);
    for (const role of VAULT_ROLES) if (!own.some((r) => r.rolle === role)) errors.push(`Gewölbe-Tileset ${t.id}: keine Raumvorlage der Rolle ${role}`);
    for (const [ch, cell] of Object.entries(t.legende)) {
      if (cell.boden !== undefined && find(registry, 'terrain', cell.boden) === undefined) errors.push(`Gewölbe-Tileset ${t.id}: Legende „${ch}“ nennt das Terrain ${cell.boden}, das es nicht gibt`);
      if (cell.objekt !== undefined && find(registry, 'worldObjects', cell.objekt) === undefined) errors.push(`Gewölbe-Tileset ${t.id}: Legende „${ch}“ nennt das Welt-Objekt ${cell.objekt}, das es nicht gibt`);
    }
  }
  // Puzzles: the five types, three variants each, every variant solvable.
  const types = records<PuzzleTypeDef>(registry, 'puzzleTypes');
  for (const id of GEWOELBE_PUZZLE_TYPES) {
    const type = types.find((t) => t.id === id);
    if (type === undefined) {
      errors.push(`Rätseltyp ${id} fehlt (docs/SPIEL.md §19)`);
      continue;
    }
    if (type.varianten.length < GEWOELBE_VARIANTS_MIN) errors.push(`Rätseltyp ${id}: ${type.varianten.length} Varianten, mindestens ${GEWOELBE_VARIANTS_MIN}`);
    for (const v of type.varianten) {
      if (v.typ !== id) errors.push(`Rätseltyp ${id}: Variante ${v.id} ist vom Typ ${v.typ}`);
      if (!solvable(v)) errors.push(`Rätselvariante ${v.id}: der Löser findet keine Lösung, die sie löst`);
      if (v.typ === 'kisten') {
        const m = kistenMap(v);
        if (m.w > PUZZLE_AREA.w || m.h > PUZZLE_AREA.h) errors.push(`Rätselvariante ${v.id}: Karte ${m.w}×${m.h} passt nicht in die Rätselfläche ${PUZZLE_AREA.w}×${PUZZLE_AREA.h}`);
      }
    }
  }
  // Traps: the six of §19 with their sprites and clips.
  const traps = records<VaultTrapDef>(registry, 'vaultTraps');
  for (const id of GEWOELBE_TRAPS) {
    const trap = traps.find((t) => t.id === id);
    if (trap === undefined) {
      errors.push(`Gewölbe-Falle ${id} fehlt (docs/SPIEL.md §19)`);
      continue;
    }
    const sprite = sprites.get(trap.sprite);
    if (sprite === undefined) {
      errors.push(`Gewölbe-Falle ${id}: Sprite ${trap.sprite} fehlt`);
      continue;
    }
    for (const clip of GEWOELBE_TRAP_CLIPS[id]) if (!sprite.clips.includes(clip)) errors.push(`Gewölbe-Falle ${id}: Sprite ${trap.sprite} ohne Clip ${clip}`);
  }
  // Moving parts.
  for (const [id, clips] of Object.entries(GEWOELBE_PART_CLIPS)) {
    const sprite = sprites.get(id);
    if (sprite === undefined) {
      errors.push(`Gewölbe-Teil: Sprite ${id} fehlt`);
      continue;
    }
    for (const clip of clips) if (!sprite.clips.includes(clip)) errors.push(`Gewölbe-Teil: Sprite ${id} ohne Clip ${clip}`);
  }
  // Guards.
  for (const [role, creature] of Object.entries(VAULT_GUARDS)) {
    if (find(registry, 'creatures', creature) === undefined) errors.push(`Gewölbe-Wächter ${role}: Kreatur ${creature} fehlt`);
  }
  // Unique blueprints of the end chests.
  for (const id of VAULT_UNIQUE_BLUEPRINTS) {
    const item = find<ItemDef>(registry, 'items', id);
    if (item === undefined) errors.push(`Gewölbe-Endtruhe: Bauplan ${id} ist kein Item`);
    else if (item.bauplan === undefined) errors.push(`Gewölbe-Endtruhe: ${id} hat keinen Block bauplan`);
  }
  // Tablets.
  const tablets = [...records<TabletDef>(registry, 'tablets')].sort((a, b) => a.nummer - b.nummer);
  tablets.forEach((t, i) => {
    if (t.nummer !== i + 1) errors.push(`Erbauer-Tafel ${t.id}: Nummer ${t.nummer}, erwartet ${i + 1} (lückenlos ab 1)`);
  });
  const layouts = records<PlaceLayoutDef>(registry, 'placeLayouts');
  for (const t of tablets) {
    const f = t.fundort;
    if (f.art === 'gewoelbe') {
      const role = f.rolle;
      if (role !== undefined && !templates.some((r) => r.rolle === role && r.plaetze.some((p) => p.art === 'tafel'))) {
        warnings.push(`Erbauer-Tafel ${t.id}: keine Vorlage der Rolle ${role} hat einen Platz tafel – die Tafel liegt dann an einem freien Bodenfeld`);
      }
      continue;
    }
    if (find(registry, 'locationTypes', f.ortstyp) === undefined) {
      errors.push(`Erbauer-Tafel ${t.id}: Ortstyp ${f.ortstyp} gibt es nicht`);
      continue;
    }
    const named = layouts.some((l) => l.ortstyp === f.ortstyp && Object.values(l.legende).some((c) => c.marke === 'tafel' && c.daten === t.id));
    if (!named) warnings.push(`Erbauer-Tafel ${t.id}: kein Layout des Ortstyps ${f.ortstyp} nennt sie an einer Marke tafel (Daten ${t.id}) – bis dahin nur über die Konsole lesbar`);
  }
  // §C "Gewölbe pro Welt Mittel": the vault slots of the biomes that have a tileset.
  const perBiome = LOCATION_RULES.gewoelbe?.count.medium ?? 0;
  const vaults = new Set(tilesets.map((t) => t.biom)).size * perBiome;
  return { errors, warnings, vaults };
}
