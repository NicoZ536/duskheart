/**
 * Feld-und-Fang-Regel des Content-Validators (MASTERPROMPT §17 „4–6 Wachstumsstufen-Sprites“, §14 „Angeln“, §31.4;
 * docs/SPIEL.md §20, §29 „Feld & Fang“; M7-19 … M7-24, Strang D). Reine Funktion über eine Registry und die Sprite-Angaben,
 * damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten Content an. Was die
 * zod-Schemas je Datensatz prüfen (Stufen 4–6, Saat-Id `saat_<id>`, Listen eindeutig), steht nicht noch einmal hier – die
 * Regel prüft die Bezüge zwischen den Sammlungen und zu den Sprites:
 *
 * Regel `feld`, je Nutzpflanze (`crops`):
 * - das Sprite `feldfrucht_<id>` hat genau eine Frame je Stufe (`stufen`), `feldfrucht_<id>_welk` gibt es;
 * - das Ernte-Item `<id>` gibt es und es nennt die Quelle `ernte:<id>`;
 * - das Saat-Item `saat_<id>` gibt es, sein Block `saat` pflanzt genau diese Nutzpflanze und es nennt `ernte:<id>`
 *   (die Saat fällt bei der Ernte).
 * Je Fischart (`fish`):
 * - das rohe Item `<id>` gibt es und es nennt die Quelle `angeln:<id>`;
 * - jedes Biom ist ein Biom der Welt, jeder Köder ein Item mit Block `koeder`, und ein Köder, der Fische nennt, nennt nur
 *   Fischarten, die es gibt (beide Richtungen: ein Fisch, der einen Köder mag, steht in dessen `fische`, wenn der Köder
 *   Fische nennt).
 * Je Gewässer (`fluss`, `see`, `meer`, `eis`): mindestens eine Fischart beißt dort (sonst wäre ein Wurf dort leer), und in
 * Fluss, See und Meer geht mindestens eine in die Reuse.
 */
import type { CropDef } from '../../src/content/farming/schema';
import { cropSpriteId, cropWiltedSpriteId } from '../../src/content/farming/schema';
import { FISH_WATERS, type FishDef, type FishWater } from '../../src/content/fishing/schema';
import type { ContentRegistryView } from '../../src/content/registry';
import type { ItemDef } from '../../src/content/schema/item';

/** Was die Regel von einem Sprite wissen muss. */
export interface FeldSpriteInfo {
  readonly frames: number;
}

/** Ergebnis der Regel. */
export interface FeldCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

/** Gewässer, in denen eine Reuse steht (Eis nicht: die Reuse wird ins offene Wasser gesetzt, §20). */
const TRAP_WATERS: readonly FishWater[] = ['fluss', 'see', 'meer'];

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function find<T>(registry: ContentRegistryView, name: string, id: string): T | undefined {
  return registry.collections().find((c) => c.name === name)?.find(id) as T | undefined;
}

function sources(item: ItemDef): readonly string[] {
  return (item.quellen ?? []).map((q) => (typeof q === 'string' ? q : JSON.stringify(q)));
}

/** Die Feld-und-Fang-Regel über `registry` mit den Sprite-Angaben `sprites` (Sprite-Id → Zahl der Frames). */
export function checkFeld(registry: ContentRegistryView, sprites: ReadonlyMap<string, FeldSpriteInfo>): FeldCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const c of records<CropDef>(registry, 'crops')) {
    const tag = `Nutzpflanze ${c.id}`;
    const sprite = sprites.get(cropSpriteId(c.id));
    if (sprite === undefined) errors.push(`${tag}: Sprite ${cropSpriteId(c.id)} fehlt`);
    else if (sprite.frames !== c.stufen) errors.push(`${tag}: Sprite ${cropSpriteId(c.id)} hat ${sprite.frames} Frames, die Pflanze ${c.stufen} Stufen`);
    if (!sprites.has(cropWiltedSpriteId(c.id))) errors.push(`${tag}: Sprite ${cropWiltedSpriteId(c.id)} fehlt`);
    const harvest = find<ItemDef>(registry, 'items', c.id);
    if (harvest === undefined) errors.push(`${tag}: Ernte-Item ${c.id} fehlt`);
    else if (!sources(harvest).includes(`ernte:${c.id}`)) errors.push(`${tag}: Ernte-Item ${c.id} nennt die Quelle ernte:${c.id} nicht`);
    const seed = find<ItemDef>(registry, 'items', c.saat);
    if (seed === undefined) errors.push(`${tag}: Saat-Item ${c.saat} fehlt`);
    else {
      if (seed.saat?.pflanze !== c.id) errors.push(`${tag}: Saat-Item ${c.saat} pflanzt ${seed.saat?.pflanze ?? 'nichts'}`);
      if (!sources(seed).includes(`ernte:${c.id}`)) errors.push(`${tag}: Saat-Item ${c.saat} nennt die Quelle ernte:${c.id} nicht`);
    }
  }
  const fish = records<FishDef>(registry, 'fish');
  const fishIds = new Set(fish.map((f) => f.id));
  for (const f of fish) {
    const tag = `Fischart ${f.id}`;
    const item = find<ItemDef>(registry, 'items', f.id);
    if (item === undefined) errors.push(`${tag}: Item ${f.id} fehlt`);
    else if (!sources(item).includes(`angeln:${f.id}`)) errors.push(`${tag}: Item ${f.id} nennt die Quelle angeln:${f.id} nicht`);
    for (const b of f.biome) if (find(registry, 'biomes', b) === undefined) errors.push(`${tag}: unbekanntes Biom ${b}`);
    for (const k of f.koeder ?? []) {
      const bait = find<ItemDef>(registry, 'items', k);
      if (bait?.koeder === undefined) errors.push(`${tag}: Köder ${k} ist kein Item mit Block koeder`);
      else if (bait.koeder.fische !== undefined && !bait.koeder.fische.includes(f.id)) errors.push(`${tag}: mag den Köder ${k}, der Köder nennt ihn nicht in fische`);
    }
  }
  for (const item of records<ItemDef>(registry, 'items')) {
    for (const f of item.koeder?.fische ?? []) if (!fishIds.has(f)) errors.push(`Köder ${item.id}: unbekannte Fischart ${f}`);
  }
  if (fish.length > 0) {
    for (const w of FISH_WATERS) if (!fish.some((f) => f.gewaesser.includes(w))) errors.push(`Gewässer ${w}: keine Fischart beißt dort`);
    for (const w of TRAP_WATERS) if (!fish.some((f) => f.reuse && f.gewaesser.includes(w))) warnings.push(`Gewässer ${w}: keine Fischart geht in die Reuse`);
  }
  return { errors, warnings };
}
