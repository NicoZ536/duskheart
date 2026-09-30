/**
 * Einzelprüfungen des Content-Validators (MASTERPROMPT §31.4). Jede Prüfung ist eine reine
 * Funktion über eine Registry bzw. über Sprachtabellen, damit Tests sie mit Fixtures aufrufen
 * können; `runChecks()` wendet sie auf die echte Registry (`src/content/index.ts`) und die
 * i18n-Dateien an.
 *
 * - Schemas: prüft die Registry schon beim Laden (zod); Ladefehler werden als Fehler gemeldet.
 * - Referenzen: jede deklarierte Referenz (`ref(pfad, sammlung)`) zeigt auf eine vorhandene Sammlung
 *   und eine vorhandene ID.
 * - Content-Texte: jeder `LocalizedText` hat DE und EN, nicht leer (ADR-0005).
 * - i18n-Parität: de.json und en.json haben dieselben, nicht leeren Schlüssel.
 * - Zählbericht: Datensätze je §C-Kategorie (Schlüssel = `CATEGORIES` aus tools/content-targets.ts,
 *   Zählregeln ADR-0006).
 * - Zielwerte: jede Kategorie muss mindestens ihren Wert aus `tools/validator/zielwerte.json`
 *   erreichen (ADR-0007); nach Spielabschluss (`STATUS: FERTIG`) gilt §C als Untergrenze.
 * - Sprites (M1-04/M1-05, `tools/assets/spriteChecks.ts`): nur Palettenfarben, ≤ 12 Farben je Sprite
 *   inkl. Outline (sonst `ausnahmeFarben`-Begründung) – Fehler; verwaiste Einzelpixel und Sprites,
 *   deren Id nirgends in `src/` vorkommt – Warnungen. Sprites, die per Namenskonvention zu Content
 *   gehören (docs/WORLD.md §7: Welt-Objekt-Id = Sprite-Id, `tileset_<terrain>` je Bodentyp,
 *   `tileset_klippe_<gruppe>` je Klippengruppe, docs/SPIEL.md §2/§5: `icon_<item>` je Item,
 *   `ausruestung_<item>` je an der Figur sichtbarem Item, Stumpf und liegender Stamm gefällter Bäume
 *   `treeStumpSpriteId`/`treeTrunkSpriteId`, docs/SPIEL.md §8: `bau_<id>`/`obj_<id>` je Bauteil,
 *   `obj_<id>` je Station, `icon_<kern>` je Glutkern-Nische des Herdfeuers aus `BALANCE.hearth.coreItems`),
 *   gelten als verwendet (`conventionSpriteIds`).
 * - Items (M3-01, `tools/validator/items.ts`): Texte, Icon, Ausrüstungs-Sprite, Quelle, Verwendung
 *   (geplante Verwendungen mit offenem Task: `tools/validator/verwendungen-geplant.ts`), Einordnung
 *   jeder Item-Referenz als Quelle oder Verwendung.
 * - Zustände (M3-19, `tools/validator/zustaende.ts`): jedes Zustands-Icon `zustand_<id>` existiert und gilt
 *   per Konvention als verwendet.
 * - Erreichbarkeit und Stufen (M3-38, `tools/validator/reachability.ts`, `tools/validator/tiers.ts`): jedes Item
 *   von einer Weltquelle aus erreichbar (Werkzeug-Gating nach Abbaukraft, Rezepte, Stationen, Baupläne),
 *   jedes Rezept herstellbar; kein Rezept braucht Material einer höheren Stufe als sein Produkt.
 * - SFX (M3-33, `tools/validator/sfx.ts`): Presets, deren Id nirgends unter `src/` außerhalb der
 *   Preset-Definitionen vorkommt und keiner Konvention folgt – Warnungen.
 * - Gating (M4-33, `tools/validator/gating.ts`): Abbaukraft je Stufe, Härte je Ressource, Schlüssel-Drops der
 *   Spitzhacken, Waffen und Rüstung ohne Boss-Drop, Waffe und Rüstungsset je Stufe mit Werkzeugen (§13.2).
 * - Kreaturen und Spawntabellen (M6-19, M6-27, `tools/validator/kreaturen.ts`): Regel `kreatur` (Sprite mit allen
 *   Zustands-Clips in vier Richtungen, Ausholphase = Daten, Augen der Nachtjäger, Sounds, KI-Profil, Beute, Bestiarium
 *   DE/EN; Beutetabellen und Fallen) und Regel `spawn` (jedes Biom mit Tabelle für Tag, Nacht und Jahreszeiten oder
 *   geplantem Eintrag, `spawn-geplant.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { BALANCE } from '../../src/content/balance';
import type { ContentRegistryView } from '../../src/content/registry';
import { findLocalizedTexts, isContentId, missingLanguages } from '../../src/content/schema/common';
import { ITEMS, itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../src/content/items/index';
import { buildPartSecondSpriteId, buildPartSpriteId } from '../../src/content/buildParts';
import { ALL_BUILD_PARTS } from '../../src/content/buildPartsAlle';
import { STATIONS, stationSpriteId } from '../../src/content/stations';
import { TERRAIN } from '../../src/content/terrain';
import { TRUNK_SPRITE_DIRECTIONS, WORLD_OBJECTS, treeStumpSpriteId, treeTrunkSpriteId } from '../../src/content/worldObjects';
import { KLIPPEN_GRUPPEN, klippenTilesetId, tilesetId } from '../../src/world/autotile';
import { loadSprites } from '../assets/sources';
import { checkSprites, findUnusedSprites, usageFiles } from '../assets/spriteChecks';
import { CATEGORIES, FINAL, type Category, type Targets } from '../content-targets';
import { checkItems } from './items';
import { checkReachability } from './reachability';
import { GEPLANTE_ERREICHBARKEIT } from './reachability-geplant';
import { checkTierOrder } from './tiers';
import { checkSfxUsage, registrySfxIds } from './sfx';
import { GEPLANTE_VERWENDUNGEN } from './verwendungen-geplant';
import { checkConditionIcons, conditionIconIds } from './zustaende';
import { checkGating } from './gating';
import { CREATURES } from '../../src/content/creatures/index';
import { CREATURE_SPRITE_PREFIX, creatureSpriteId } from '../../src/content/creatures/schema';
import { checkCreatures, checkSpawnTables, type CreatureSpriteInfo } from './kreaturen';
import { GEPLANTE_SPAWNTABELLEN } from './spawn-geplant';
import type { Sprite } from '../../assets-src/lib/sprite';

export interface CheckResult {
  errors: string[];
  warnings: string[];
  counts: Partial<Record<Category, number>>;
}

const ROOT = process.cwd();

function isCategory(name: string): name is Category {
  return Object.hasOwn(CATEGORIES, name);
}

/** Leeres Ergebnis mit Zählwert 0 für jede §C-Kategorie. */
export function emptyResult(): CheckResult {
  const counts: Partial<Record<Category, number>> = {};
  for (const c of Object.keys(CATEGORIES) as Category[]) counts[c] = 0;
  return { errors: [], warnings: [], counts };
}

// ---------------------------------------------------------------------------------------------
// Zielwerte (ADR-0007)
// ---------------------------------------------------------------------------------------------

/** Pfad der Zielwerte-Datei relativ zur Projektwurzel. */
export const TARGETS_FILE = 'tools/validator/zielwerte.json';

const targetCount = z.number().int().min(0);
const targetsSchema = z
  .object({
    beschreibung: z.string().min(1),
    ziele: z.object(Object.fromEntries((Object.keys(CATEGORIES) as Category[]).map((c) => [c, targetCount])) as Record<Category, typeof targetCount>).strict(),
  })
  .strict();

/** Prüft den Inhalt einer Zielwerte-Datei: jede §C-Kategorie genau einmal, ganze Zahl ≥ 0. */
export function parseTargets(json: unknown): Targets {
  const parsed = targetsSchema.safeParse(json);
  if (!parsed.success) {
    throw new TypeError(`Zielwerte ungültig: ${parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(Datei)'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data.ziele;
}

/** Liest `tools/validator/zielwerte.json` (oder eine andere Datei, z. B. ein Test-Fixture). */
export function loadTargets(file: string = join(ROOT, TARGETS_FILE)): Targets {
  return parseTargets(JSON.parse(readFileSync(file, 'utf8')));
}

/** Erzwungene Ziele: die Zielwerte-Datei, nach Spielabschluss mindestens §C. */
export function effectiveTargets(targets: Targets, finished: boolean): Targets {
  if (!finished) return targets;
  const out = { ...targets };
  for (const c of Object.keys(CATEGORIES) as Category[]) out[c] = Math.max(out[c], FINAL[c]);
  return out;
}

/** Fehler für jede Kategorie, deren Zählwert unter ihrem Ziel liegt. */
export function checkTargets(counts: Partial<Record<Category, number>>, targets: Targets): string[] {
  const errors: string[] = [];
  for (const c of Object.keys(CATEGORIES) as Category[]) {
    const have = counts[c] ?? 0;
    if (have < targets[c]) errors.push(`Mindestmenge ${CATEGORIES[c]}: ${have} < Ziel ${targets[c]} (§C: ${FINAL[c]})`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------------------------

/** Paritätsfehler zweier Sprachtabellen: fehlende, leere oder nicht-String-Werte (§31.4). */
export function checkI18nParity(de: Record<string, unknown>, en: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [a, b, name] of [
    [de, en, 'EN'],
    [en, de, 'DE'],
  ] as const) {
    for (const key of Object.keys(a)) {
      const v = b[key];
      if (typeof v !== 'string' || v.trim() === '') errors.push(`Übersetzung fehlt (${name}): ${key}`);
    }
  }
  return errors;
}

function loadLang(lang: 'de' | 'en'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${lang}.json`), 'utf8')) as Record<string, unknown>;
}

/** Fehlende Übersetzung = Fehler (§31.4); beide Sprachdateien müssen dieselben, nicht leeren Schlüssel haben. */
export function checkI18n(res: CheckResult): void {
  res.errors.push(...checkI18nParity(loadLang('de'), loadLang('en')));
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/** Jede deklarierte Referenz muss eine gültige ID einer vorhandenen Sammlung sein. */
export function checkReferences(registry: ContentRegistryView): string[] {
  const errors: string[] = [];
  for (const r of registry.references()) {
    const where = `${r.collection}/${r.id}.${r.at}`;
    if (!registry.hasCollection(r.target)) errors.push(`Referenz ${where} zeigt auf unbekannte Sammlung "${r.target}"`);
    else if (typeof r.value !== 'string' || !isContentId(r.value)) errors.push(`Referenz ${where} ist keine gültige ID: ${JSON.stringify(r.value)}`);
    else if (!registry.has(r.target, r.value)) errors.push(`Referenz ${where} → ${r.target}/${r.value} existiert nicht`);
  }
  return errors;
}

/** Jeder Content-Text braucht DE und EN, nicht leer (ADR-0005). */
export function checkLocalizedTexts(registry: ContentRegistryView): string[] {
  const errors: string[] = [];
  for (const c of registry.collections()) {
    for (const record of c.values()) {
      for (const { path, text } of findLocalizedTexts(record)) {
        for (const lang of missingLanguages(text)) errors.push(`Übersetzung fehlt (${lang.toUpperCase()}): ${c.name}/${record.id}.${path}`);
      }
    }
  }
  return errors;
}

/** Datensätze je §C-Kategorie; unbekannte Kategorien sind Fehler. Liefert alle Kategorien (fehlende = 0). */
export function countCategories(registry: ContentRegistryView): { counts: Record<Category, number>; errors: string[] } {
  const counts = emptyResult().counts as Record<Category, number>;
  const errors: string[] = [];
  for (const [name, n] of Object.entries(registry.countsByCategory())) {
    if (isCategory(name)) counts[name] += n ?? 0;
    else errors.push(`Unbekannte Zählkategorie "${name}" (erlaubt: ${Object.keys(CATEGORIES).join(', ')})`);
  }
  return { counts, errors };
}

/** Alle Registry-Prüfungen zusammen: Referenzen, Content-Texte, Zählbericht. */
export function validateRegistry(registry: ContentRegistryView): CheckResult {
  const res = emptyResult();
  res.errors.push(...checkReferences(registry), ...checkLocalizedTexts(registry));
  try {
    const { counts, errors } = countCategories(registry);
    res.counts = counts;
    res.errors.push(...errors);
  } catch (err) {
    res.errors.push(`Zählbericht fehlgeschlagen: ${(err as Error).message}`);
  }
  return res;
}

/** Lädt eine Registry; Schema- und Duplikatfehler beim Laden werden zu Validatorfehlern. */
export async function loadRegistry(load: () => ContentRegistryView | Promise<ContentRegistryView>): Promise<{ registry?: ContentRegistryView; errors: string[] }> {
  try {
    return { registry: await load(), errors: [] };
  } catch (err) {
    return { errors: [`Content lässt sich nicht laden: ${(err as Error).message}`] };
  }
}

// ---------------------------------------------------------------------------------------------
// Sprites (Paletten-Validator)
// ---------------------------------------------------------------------------------------------

/** Sprite-Quellen und Suchordner der Nutzungsprüfung, relativ zur Projektwurzel. */
export const SPRITES_DIR = 'assets-src/sprites';
export const USAGE_DIR = 'src';

/**
 * Sprite-Ids, die der Code nicht als Literal nennt, sondern aus Content-Ids bildet (docs/WORLD.md §7):
 * jedes Welt-Objekt zeichnet das Sprite mit seiner eigenen Id, jeder Bodentyp das Tileset
 * `tileset_<terrain>`, jede Klippengruppe `tileset_klippe_<gruppe>`; im Bauraster (docs/SPIEL.md §8) jedes
 * Bauteil `bau_<id>` bzw. als Möbel, Kiste oder Herdfeuer `obj_<id>` (`buildPartSpriteId`, dazu Torseite und
 * Falltürklappe `buildPartSecondSpriteId`), jede Station `obj_<id>` (`stationSpriteId`).
 */
export function conventionSpriteIds(): string[] {
  return [
    ...WORLD_OBJECTS.map((o) => o.id),
    // Felled trees: the stump (M2-20) and the lying trunk in its three directions (M3-11), named by the tree.
    ...WORLD_OBJECTS.filter((o) => o.kind === 'baum').flatMap((o) => [treeStumpSpriteId(o.id), ...TRUNK_SPRITE_DIRECTIONS.map((d) => treeTrunkSpriteId(o.id, d))]),
    ...TERRAIN.filter((t) => t.kind === 'boden').map((t) => tilesetId(t.id)),
    ...KLIPPEN_GRUPPEN.map((g) => klippenTilesetId(g)),
    ...ITEMS.map((i) => itemIconId(i.id)),
    ...ITEMS.filter((i) => itemFigureLayer(i) !== null).map((i) => itemLayerSpriteId(i.id)),
    ...conditionIconIds(),
    // Build grid (M4-13, M4-19 … M4-21): parts and stations as the game view draws them (src/render/game/building.ts, ghost.ts).
    ...ALL_BUILD_PARTS.map((p) => buildPartSpriteId(p.id, p.art)),
    ...ALL_BUILD_PARTS.map((p) => buildPartSecondSpriteId(p.id, p.art)).filter((id): id is string => id !== null),
    ...STATIONS.map((s) => stationSpriteId(s.id)),
    // The hearth screen's ember core niches (M4-20): the icon of each niche's core by its computed id
    // (src/ui/screens/herdfeuer/HerdfeuerScreen.tsx, `icon_<kern>`), the cores themselves arrive with the beacons (M7).
    ...BALANCE.hearth.coreItems.map((id) => itemIconId(id)),
    // Creatures (M6-19, docs/SPIEL.md §11): the sprite `kreatur_<id>` of every creature (src/render/game/creatures.ts).
    ...CREATURES.map((c) => creatureSpriteId(c.id)),
  ];
}

/**
 * Lädt alle Sprites unter `spritesDir` und prüft sie: Ladefehler und Palettenverstöße sind Fehler,
 * Einzelpixel und ungenutzte Sprites (Id kommt in keiner Datei unter `usageDir` vor und gehört nicht
 * per Konvention zu Content, `usedByConvention`) Warnungen.
 */
export async function checkSpriteSources(
  spritesDir: string = join(ROOT, SPRITES_DIR),
  usageDir: string = join(ROOT, USAGE_DIR),
  usedByConvention: readonly string[] = conventionSpriteIds(),
): Promise<{ errors: string[]; warnings: string[]; ids: string[]; sprites: Sprite[] }> {
  const { sprites, errors } = await loadSprites(spritesDir);
  const palette = checkSprites(sprites.map((l) => l.sprite));
  const convention = new Set(usedByConvention);
  const unused = findUnusedSprites(
    sprites.map((l) => l.sprite.id).filter((id) => !convention.has(id)),
    usageFiles(usageDir),
  ).map((id) => `Sprite ${id} wird nirgends verwendet (keine Erwähnung unter ${USAGE_DIR}/)`);
  return { errors: [...errors.map((e) => `Sprite-Quelle ${e}`), ...palette.errors], warnings: [...palette.warnings, ...unused], ids: sprites.map((l) => l.sprite.id), sprites: sprites.map((l) => l.sprite) };
}

/** Prüft die echte Content-Registry, die i18n-Dateien und die Sprite-Quellen. */
export async function runChecks(): Promise<CheckResult> {
  const loaded = await loadRegistry(async () => (await import('../../src/content/index')).CONTENT);
  const res = loaded.registry === undefined ? emptyResult() : validateRegistry(loaded.registry);
  res.errors.unshift(...loaded.errors);
  checkI18n(res);
  const sprites = await checkSpriteSources();
  res.errors.push(...sprites.errors);
  res.warnings.push(...sprites.warnings);
  if (loaded.registry !== undefined) {
    const items = checkItems({
      registry: loaded.registry,
      spriteIds: new Set(sprites.ids),
      geplant: GEPLANTE_VERWENDUNGEN,
      progress: readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8'),
      hearthFuel: new Set(Object.keys(BALANCE.hearth.fuelGameHours)),
    });
    res.errors.push(...items.errors);
    res.warnings.push(...items.warnings);
    const reach = checkReachability(loaded.registry, { geplant: GEPLANTE_ERREICHBARKEIT, progress: readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8') });
    res.errors.push(...reach.errors, ...checkTierOrder(loaded.registry));
    res.warnings.push(...reach.warnings);
    res.errors.push(...checkConditionIcons(loaded.registry, new Set(sprites.ids)));
    // Gating §13.2 (M4-33, tools/validator/gating.ts): mining power, hardness, pickaxe keys, weapons and armour without boss drops.
    const gating = checkGating(loaded.registry, { progress: readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8') });
    res.errors.push(...gating.errors);
    res.warnings.push(...gating.warnings);
    res.warnings.push(...checkSfxUsage(ROOT, registrySfxIds(loaded.registry)));
    // Creatures and spawn tables (M6-19, M6-27, tools/validator/kreaturen.ts): clips, wind-ups, eyes, sounds, profile,
    // loot, bestiary; a spawn table for every biome (or a planned one with an open task).
    const { PALETTE_ROWS } = await import('../../assets-src/paletteRows');
    const creatures = checkCreatures(loaded.registry, await creatureSpriteInfos(sprites.sprites), new Map(PALETTE_ROWS.map((r) => [r.id, r.map])));
    res.errors.push(...creatures.errors);
    res.warnings.push(...creatures.warnings);
    const spawn = checkSpawnTables({ registry: loaded.registry, geplant: GEPLANTE_SPAWNTABELLEN, progress: readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8') });
    res.errors.push(...spawn.errors);
    res.warnings.push(...spawn.warnings);
  }
  return res;
}

/** Palettenindizes, die ein Sprite in irgendeinem Frame verwendet (ohne 0, transparent). */
function spriteColors(s: Sprite): Set<number> {
  const out = new Set<number>();
  for (const f of s.frames) for (let i = 0; i < f.index.length; i++) if ((f.index[i] as number) !== 0) out.add(f.index[i] as number);
  return out;
}

/**
 * Sprite-Angaben der Kreatur-Regel: Größe, Spiegelung, Emissiv und Clips jedes Sprites, dazu die Ausholphasen der
 * Angriffs-Clips aus dem Kreatur-Generator (`assets-src/sprites/kreaturen/_katalog.ts`, dieselben Module wie die
 * Sprite-Suche – nichts wird doppelt erzeugt).
 */
export async function creatureSpriteInfos(sprites: readonly Sprite[]): Promise<Map<string, CreatureSpriteInfo>> {
  const { KREATUREN_M6 } = await import('../../assets-src/sprites/kreaturen/_katalog');
  const windups = new Map<string, Record<string, { von: number; bis: number }>>();
  for (const e of KREATUREN_M6) {
    const w: Record<string, { von: number; bis: number }> = {};
    for (const c of e.ergebnis.clips) if (c.ausholen !== null) w[c.clip] = c.ausholen;
    windups.set(e.ergebnis.sprite.id, w);
  }
  const out = new Map<string, CreatureSpriteInfo>();
  for (const s of sprites) {
    const w = windups.get(s.id);
    out.set(s.id, {
      w: s.w,
      h: s.h,
      spiegelbar: s.spiegelbar,
      emissiv: s.frames.some((f) => f.emissive.some((v) => v !== 0)),
      clips: s.clips,
      ...(s.id.startsWith(CREATURE_SPRITE_PREFIX) ? { farben: spriteColors(s) } : {}),
      ...(w === undefined ? {} : { ausholen: w }),
    });
  }
  return out;
}
