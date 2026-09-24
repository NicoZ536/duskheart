/**
 * Validator-Regeln der Zustände (MASTERPROMPT §11.3 „Jeder Zustand: Icon, Dauer, Stapelregel, Tooltip,
 * sichtbare Wirkung“, §31.4; M3-19). Dauer, Stapelregel, Tooltip (DE/EN) und sichtbare Wirkung prüft schon
 * das Schema der Sammlung `conditions` beim Laden; hier kommt das Icon dazu: jeder Zustand braucht das
 * Sprite `zustand_<id>` (docs/SPIEL.md §5) – ein fehlendes Icon ist ein Fehler. Die Icons gelten per
 * Konvention als verwendet (`conditionIconIds`), weil der Code sie aus der Zustands-Id bildet.
 */
import { CONDITIONS, conditionIconId } from '../../src/content/conditions';
import type { ContentRegistryView } from '../../src/content/registry';

/** Sprite-Ids der Zustands-Icons aller Zustände. */
export function conditionIconIds(): string[] {
  return CONDITIONS.map((c) => conditionIconId(c.id));
}

/** Fehler für jeden Zustand der Registry ohne sein Icon unter `spriteIds`. */
export function checkConditionIcons(registry: ContentRegistryView, spriteIds: ReadonlySet<string>): string[] {
  if (!registry.hasCollection('conditions')) return [];
  const collection = registry.collections().find((c) => c.name === 'conditions');
  const errors: string[] = [];
  for (const record of collection?.values() ?? []) {
    const icon = conditionIconId(record.id);
    if (!spriteIds.has(icon)) errors.push(`Zustand ${record.id}: Icon ${icon} fehlt (assets-src/sprites/zustaende)`);
  }
  return errors;
}
