/**
 * Der ganze Bestand des Projekts gegen den Content-Validator und die Sprite-Quellen (M6-Gate, ADR-0192; ADR-0036 Stufenleiter):
 * aus den Unit-Tests `tools/validate`, `tools/validator-erreichbarkeit`, `assets/sprite-checks` und `assets/vegetation` hierher verschoben. Jeder dieser Tests lädt
 * jede Sprite-Quelle des Spiels (≈ 3 s allein, 10–15 s unter Last) – in `npm run check` prüft dasselbe der Schritt
 * `validate:content`, `npm run verify` prüft es hier zusätzlich mit den genauen Erwartungen.
 * - `runChecks` lädt die Spiel-Registry und besteht; jede §C-Kategorie wird gezählt.
 * - Die Zielwerte-Datei nennt jede §C-Kategorie, keine liegt über dem Endziel, und der Bestand erfüllt sie.
 * - Die echten Sprites sind palettenrein: keine Fehler, keine Warnung zu Farben oder Einzelpixeln.
 * - Keine Waisen und kein Stufenverstoß im Content, nur die geplante Erreichbarkeit (salpeter → M7-34) als Warnung.
 * - Jedes Welt-Objekt hat ein Sprite mit derselben Id (docs/WORLD.md §7), die Quellen der Welt-Objekte laden fehlerfrei.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_OBJECTS } from '../../src/content/worldObjects';
import { loadSprites } from '../../tools/assets/sources';
import { CATEGORIES, FINAL } from '../../tools/content-targets';
import { checkTargets, emptyResult, loadTargets, runChecks } from '../../tools/validator/checks';

/** One validator run over the real project, shared by the tests that judge it. */
let realRunOnce: ReturnType<typeof runChecks> | undefined;
const realRun = (): ReturnType<typeof runChecks> => (realRunOnce ??= runChecks());

describe('Content-Validator über den echten Bestand', () => {
  it('runChecks loads the game registry and passes', async () => {
    const res = await realRun();
    expect(res.errors).toEqual([]);
    expect(Object.keys(res.counts).sort()).toEqual(Object.keys(CATEGORIES).sort());
    expect(emptyResult().counts.items).toBe(0);
  });

  it('die Zielwerte-Datei des Projekts nennt jede §C-Kategorie und wird erfüllt', async () => {
    const targets = loadTargets();
    expect(Object.keys(targets).sort()).toEqual(Object.keys(CATEGORIES).sort());
    for (const c of Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>) expect(targets[c]).toBeLessThanOrEqual(FINAL[c]);
    expect(checkTargets((await realRun()).counts, targets)).toEqual([]);
  });

  it('ist in validate:content eingebunden: die echten Sprites sind palettenrein', async () => {
    const res = await realRun();
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => /Farben|Einzelpixel/.test(w))).toEqual([]);
  });
});

describe('beide Regeln der Erreichbarkeit laufen im Content-Validator (npm run check)', () => {
  it('runChecks meldet für den Content keine Waisen und keinen Stufenverstoß, aber die geplante Erreichbarkeit', async () => {
    const res = await realRun();
    expect(res.errors.filter((e) => e.includes('Waise') || e.includes('nie herstellbar') || e.startsWith('Stufenreihenfolge'))).toEqual([]);
    expect(res.warnings).toContain('Erst mit geplanter Erreichbarkeit (salpeter → M7-34) erreichbar (1): salpeter');
    expect(res.counts.recipes).toBeGreaterThanOrEqual(12);
  });
});

describe('M2-21 Vegetation und Gestein: Sprites der Welt-Objekte', () => {
  it('jedes Welt-Objekt hat ein Sprite mit derselben Id (docs/WORLD.md §7)', async () => {
    const { sprites, errors } = await loadSprites('assets-src/sprites');
    const ids = new Set(sprites.map((l) => l.sprite.id));
    expect(errors.filter((e) => /baeume|vegetation|gestein|erze|pflanzen|deko/.test(e))).toEqual([]);
    const fehlend = WORLD_OBJECTS.map((o) => o.id).filter((id) => !ids.has(id));
    expect(fehlend).toEqual([]);
  });
});
