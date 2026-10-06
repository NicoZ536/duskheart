/**
 * Orts-Regeln des Content-Validators (MASTERPROMPT §21, §31.4; docs/SPIEL.md §18; M7-07 … M7-09, Strang B). Reine
 * Funktion über eine Registry und die Sprite-Ids, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts)
 * wendet sie auf den echten Content an.
 *
 * Regel `orte` (`checkPlaces`):
 * - jeder Ortstyp ist ein Slot-Typ des Weltgenerators (`LOCATION_TYPES`) und hat sein Kartensymbol als Sprite;
 * - jede Wächter-Kreatur existiert, und ihre Leine am Ort (`leineTiles` oder `BALANCE.places.guardLeashTiles`) reicht über
 *   ihren Streifradius (`streifen` des KI-Profils) – sonst zöge die Leine sie bei jedem Streifzug zurück;
 * - der Segen nennt einen Zustand, den es gibt;
 * - jede Vorlage passt in die Scheibe ihres Slots (Radius der Ortsregel, der Leuchtfeuer-Stätten `LOCATIONS.beaconRadius`)
 *   in mindestens einer erlaubten Lage – sonst wählte der Generator sie nie; Brückenruinen stehen auf dem Brückenkopf und
 *   werden immer gedreht (Norden zum Fluss), ihre Vorlagen sind davon ausgenommen;
 * - Objekte mit mehr als einer Kachel Stellfläche stehen nur in nicht drehbaren Vorlagen und nie in Brückenruinen: die
 *   Stellfläche hängt nach Osten und Norden am Ankerfeld und dreht nicht mit (eine gedrehte 2×1-Stellfläche hätte der Renderer
 *   nicht, eine gedrehte 2×2 läge auf anderen Zellen);
 * - jede Stellflächenzelle eines Objekts liegt in der Vorlage auf einer gestempelten Zelle (nicht `.`, sonst stünde dort
 *   womöglich ein Baum der Streudeko) und trägt kein zweites Objekt;
 * - die Mitte der Vorlage (der Slot-Mittelpunkt) trägt kein blockierendes Objekt – der Ort bleibt zu Fuß erreichbar
 *   (tests/integration/weltgen-validierung.test.ts prüft die Slot-Mitte);
 * - Marken: `truhe` steht auf `ort_truhe_<stufe>` mit der Stufe als Datum, und die Beutetabelle `ort_<ortstyp>_<stufe>`
 *   existiert; `buddel` nennt seine Stufe, die Tabelle `ort_buddelstelle_<stufe>` existiert; `erz` steht auf einem
 *   Erzknoten (`erz_*`);
 * - die Wirkung hat ihre Marke in jeder Vorlage des Typs: `aussicht` → `aussicht`, `segen` → `altar`, `tafel` → `tafel`,
 *   `buddeln` → `buddel`, `krater` → `erz`, `leuchtfeuer` → `leuchtfeuer`;
 * - jeder gezählte Ortstyp hat mindestens eine Vorlage (Fehler); Biome, in denen die Ortsregel den Typ erlaubt, für die es
 *   aber keine Vorlage gibt, sind Warnungen (der Slot bliebe dort ohne Gestalt);
 * - jede Beutetabelle `ort_<ortstyp>_<stufe>` gehört zu einem Ortstyp.
 */
import { BALANCE } from '../../src/content/balance';
import type { PlaceDef, PlaceLayoutDef, PlaceLootDef } from '../../src/content/places/schema';
import type { ContentRecord, ContentRegistryView } from '../../src/content/registry';
import { LOCATION_RULES, LOCATION_TYPES, LOCATIONS, type LocationType } from '../../src/world/gen/locations';
import { NO_MARK, compileLayout, layoutFitsDisc, markOf, type CompiledLayout } from '../../src/world/gen/places';
import type { QuarterTurn } from '../../src/world/gen/places/types';

/** Ergebnis der Regel. */
export interface PlaceCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

/** Die Marke, ohne die eine Wirkung nichts hätte, woran sie wirkt. */
const EFFECT_MARK: Readonly<Partial<Record<PlaceDef['wirkung'], string>>> = {
  aussicht: 'aussicht',
  segen: 'altar',
  tafel: 'tafel',
  buddeln: 'buddel',
  krater: 'erz',
  leuchtfeuer: 'leuchtfeuer',
};

/** Ortstypen, deren Vorlagen nicht in der Slot-Scheibe stehen (Brückenkopf). */
const OUTSIDE_DISC: ReadonlySet<string> = new Set(['brueckenruine']);
/** Ortstypen, deren Vorlagen immer gedreht werden (der Brückenkopf zeigt zum Fluss). */
const ALWAYS_TURNED: ReadonlySet<string> = new Set(['brueckenruine']);
const QUARTER_TURNS: readonly QuarterTurn[] = [0, 1, 2, 3];
const TIER_OF_CHEST = /^ort_truhe_(\d+)$/;
const LOOT_ID = /^ort_(.+)_(\d+)$/;

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function find<T>(registry: ContentRegistryView, name: string, id: string): T | undefined {
  return registry.collections().find((c) => c.name === name)?.find(id) as T | undefined;
}

/** Slot-Radius eines Ortstyps [Kacheln], oder null für Typen ohne Scheibe (Brückenruine) und unbekannte. */
export function slotRadius(type: string): number | null {
  if (OUTSIDE_DISC.has(type)) return null;
  if (type === 'leuchtfeuer') return LOCATIONS.beaconRadius;
  return LOCATION_RULES[type as LocationType]?.radius ?? null;
}

/** Ob die Vorlage in irgendeiner erlaubten Lage in eine Scheibe vom Radius `radius` passt. */
function fitsSomehow(layout: CompiledLayout, radius: number): boolean {
  if (!layout.drehbar) return layoutFitsDisc(layout, 0, false, radius);
  return QUARTER_TURNS.some((r) => layoutFitsDisc(layout, r, false, radius) || layoutFitsDisc(layout, r, true, radius));
}

/** Stellflächen der Objekte einer Vorlage: auf gestempelten Zellen, ohne Überlappung, nicht über der Mitte (blockierend). */
function footprintErrors(registry: ContentRegistryView, def: PlaceLayoutDef): string[] {
  const out: string[] = [];
  const h = def.zeilen.length;
  const w = def.zeilen[0]?.length ?? 0;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const charAt = (x: number, y: number): string | null => (x < 0 || y < 0 || x >= w || y >= h ? null : (def.zeilen[y] ?? '').charAt(x));
  def.zeilen.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const id = def.legende[row.charAt(x)]?.objekt;
      if (id === undefined) continue;
      const obj = find<ContentRecord & { footprint: { w: number; h: number }; blocking: boolean }>(registry, 'worldObjects', id);
      if (obj === undefined) continue;
      for (let dy = 0; dy < obj.footprint.h; dy++) {
        for (let dx = 0; dx < obj.footprint.w; dx++) {
          const fx = x + dx;
          const fy = y - dy;
          if (obj.blocking && fx === cx && fy === cy) out.push(`Ortsvorlage ${def.id}: ${id} bei ${x},${y} versperrt die Mitte ${cx},${cy}`);
          if (dx === 0 && dy === 0) continue;
          const c = charAt(fx, fy);
          if (c === null || c === '.') out.push(`Ortsvorlage ${def.id}: Stellfläche von ${id} bei ${x},${y} reicht auf ${fx},${fy} (außerhalb oder nicht gestempelt)`);
          else if (def.legende[c]?.objekt !== undefined) out.push(`Ortsvorlage ${def.id}: Stellfläche von ${id} bei ${x},${y} überdeckt ${def.legende[c]?.objekt} auf ${fx},${fy}`);
        }
      }
    }
  });
  return out;
}

/** Prüft Ortstypen, Vorlagen und Beutetabellen (siehe Modulkommentar). */
export function checkPlaces(registry: ContentRegistryView, spriteIds: ReadonlySet<string>): PlaceCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!registry.hasCollection('locationTypes')) return { errors, warnings };
  const types = records<PlaceDef>(registry, 'locationTypes');
  const layouts = records<PlaceLayoutDef>(registry, 'placeLayouts');
  const loot = records<PlaceLootDef>(registry, 'placeLoot');
  const slotTypes: ReadonlySet<string> = new Set(LOCATION_TYPES);

  for (const t of types) {
    if (!slotTypes.has(t.id)) errors.push(`Ortstyp ${t.id}: kein Slot-Typ des Weltgenerators (LOCATION_TYPES)`);
    if (!spriteIds.has(t.kartensymbol)) errors.push(`Ortstyp ${t.id}: Kartensymbol ${t.kartensymbol} fehlt (Sprite)`);
    for (const g of t.waechter) {
      const creature = find<ContentRecord & { ki: string }>(registry, 'creatures', g.creature);
      if (creature === undefined) {
        errors.push(`Ortstyp ${t.id}: Wächter ${g.creature} ist keine Kreatur`);
        continue;
      }
      const profile = find<ContentRecord & { streifen: number }>(registry, 'aiProfiles', creature.ki);
      const leash = g.leineTiles ?? BALANCE.places.guardLeashTiles;
      if (profile !== undefined && leash < profile.streifen) errors.push(`Ortstyp ${t.id}: Leine ${leash} Kacheln des Wächters ${g.creature} kürzer als sein Streifradius ${profile.streifen}`);
    }
    if (t.segen !== undefined && find(registry, 'conditions', t.segen.zustand) === undefined) errors.push(`Ortstyp ${t.id}: Segen-Zustand ${t.segen.zustand} fehlt`);
    const own = layouts.filter((l) => l.ortstyp === t.id);
    if (t.zaehlt && own.length === 0) errors.push(`Ortstyp ${t.id}: keine Ortsvorlage`);
    const rule = LOCATION_RULES[t.id as LocationType];
    if (t.zaehlt && rule !== undefined) {
      const missing = rule.biomes.filter((b) => !own.some((l) => l.biom === b));
      if (missing.length > 0) warnings.push(`Ortstyp ${t.id}: keine Vorlage für ${missing.join(', ')} – Slots dort bleiben ohne Gestalt`);
    }
  }

  for (const def of layouts) {
    const type = types.find((t) => t.id === def.ortstyp);
    let layout: CompiledLayout;
    try {
      layout = compileLayout(def);
    } catch (e) {
      errors.push(`Ortsvorlage ${def.id}: ${(e as Error).message}`);
      continue;
    }
    const radius = slotRadius(def.ortstyp);
    if (radius !== null && !fitsSomehow(layout, radius)) errors.push(`Ortsvorlage ${def.id}: passt in keiner Lage in die Slot-Scheibe (Radius ${radius})`);
    const turned = def.drehbar || ALWAYS_TURNED.has(def.ortstyp);
    const marks = new Set<string>();
    for (const [char, cell] of Object.entries(def.legende)) {
      if (!def.zeilen.some((z) => z.includes(char))) warnings.push(`Ortsvorlage ${def.id}: Legendenzeichen "${char}" kommt in keiner Zeile vor`);
      if (cell.marke !== undefined) marks.add(cell.marke);
      if (cell.objekt !== undefined) {
        const obj = find<ContentRecord & { footprint: { w: number; h: number } }>(registry, 'worldObjects', cell.objekt);
        if (obj !== undefined && turned && (obj.footprint.w > 1 || obj.footprint.h > 1)) errors.push(`Ortsvorlage ${def.id}: ${cell.objekt} (${obj.footprint.w}×${obj.footprint.h}) in einer gedrehten Vorlage`);
      }
      if (cell.marke === 'truhe') {
        const tier = TIER_OF_CHEST.exec(cell.objekt ?? '')?.[1];
        if (tier === undefined || cell.daten !== tier) errors.push(`Ortsvorlage ${def.id}: Truhe "${char}" steht nicht auf ort_truhe_<stufe> mit der Stufe als Datum`);
        else if (find(registry, 'placeLoot', `ort_${def.ortstyp}_${tier}`) === undefined) errors.push(`Ortsvorlage ${def.id}: Beutetabelle ort_${def.ortstyp}_${tier} fehlt`);
      }
      if (cell.marke === 'buddel') {
        if (cell.daten === undefined || !/^\d+$/.test(cell.daten)) errors.push(`Ortsvorlage ${def.id}: Buddelmarke "${char}" ohne Stufe`);
        else if (find(registry, 'placeLoot', `ort_buddelstelle_${cell.daten}`) === undefined) errors.push(`Ortsvorlage ${def.id}: Beutetabelle ort_buddelstelle_${cell.daten} fehlt`);
      }
      if (cell.marke === 'erz' && !(cell.objekt ?? '').startsWith('erz_')) errors.push(`Ortsvorlage ${def.id}: Erzmarke "${char}" ohne Erzknoten`);
    }
    errors.push(...footprintErrors(registry, def));
    const needed = type === undefined ? undefined : EFFECT_MARK[type.wirkung];
    if (needed !== undefined && !marks.has(needed)) errors.push(`Ortsvorlage ${def.id}: Wirkung ${type?.wirkung} ohne Marke ${needed}`);
    // Jede Marke der Legende muss im Raster stehen (die kompilierte Vorlage kennt sie).
    for (const m of marks) if (!layout.mark.some((v) => v !== NO_MARK && markOf(v) === m)) errors.push(`Ortsvorlage ${def.id}: Marke ${m} steht in keiner Zelle`);
  }

  for (const l of loot) {
    const m = LOOT_ID.exec(l.id);
    if (m !== null && !types.some((t) => t.id === m[1])) errors.push(`Beutetabelle ${l.id}: kein Ortstyp ${m[1]}`);
  }
  return { errors, warnings };
}
