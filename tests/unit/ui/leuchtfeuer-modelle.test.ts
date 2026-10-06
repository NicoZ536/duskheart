/**
 * The pure models of strand F's HUD and screens (docs/SPIEL.md §30 "je `modell.ts` rein und unit-getestet"; M7-32, M7-35,
 * M7-37): the boss bar with its phase marks and the title card (`bossAnsicht`), the travel screen (`reiseAnsicht`) and the
 * vision's pages (`visionSeiten`) – in both languages.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { BossSample } from '../../../src/game/bosses/types';
import type { TravelPoint, TravelSample } from '../../../src/game/travel/types';
import { createI18n } from '../../../src/i18n';
import { bossAnsicht, gleicheAnsicht } from '../../../src/ui/hud/boss/modell';
import { punktName, reiseAnsicht } from '../../../src/ui/screens/reisen/modell';
import { visionSeiten } from '../../../src/ui/screens/vision/modell';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function boss(over: Partial<BossSample> = {}): BossSample {
  return { active: true, boss: 'borkenvater', health: 1200, maxHealth: 1200, phase: 0, phaseMarks: [0.7, 0.35], titleUntilTick: 180, ...over };
}

function point(id: string, name = ''): TravelPoint {
  const kind = id.slice(0, id.indexOf(':')) as TravelPoint['kind'];
  return { id, kind, name, layer: 0, tx: 0, ty: 0 };
}

describe('Bossbalken (M7-32)', () => {
  it('ohne wachen Boss nichts; sonst Name, Leben, Phase ab 1, Marken je weiterer Phase, Titelkarte bis zu ihrem Tick', () => {
    expect(bossAnsicht(boss({ active: false }), 0, 'de')).toBeNull();
    const a = bossAnsicht(boss(), 60, 'de');
    expect(a).toMatchObject({ boss: 'borkenvater', name: 'Borkenvater', anteil: 1, leben: 1200, max: 1200, phase: 1 });
    expect(a?.marken).toEqual([
      { anteil: 0.7, erreicht: false },
      { anteil: 0.35, erreicht: false },
    ]);
    expect(a?.titelkarte).toEqual({ titel: 'Der Borkenvater', biom: 'Grünhain' });
    expect(bossAnsicht(boss(), 180, 'en')?.titelkarte).toBeNull();
    expect(bossAnsicht(boss(), 179, 'en')?.titelkarte).toEqual({ titel: 'The Barkfather', biom: 'Greengrove' });
  });

  it('eine Marke gilt als erreicht, sobald das Leben auf ihren Anteil fällt; Leben aufgerundet, nie unter 0', () => {
    const a = bossAnsicht(boss({ health: 0.7 * 1200, phase: 1 }), 500, 'de');
    expect(a?.marken.map((m) => m.erreicht)).toEqual([true, false]);
    expect(a?.phase).toBe(2);
    expect(bossAnsicht(boss({ health: 10.2 }), 500, 'de')?.leben).toBe(11);
    expect(bossAnsicht(boss({ health: -3 }), 500, 'de')?.anteil).toBe(0);
  });

  it('neu gezeichnet nur bei einer Änderung, die man sieht', () => {
    const a = bossAnsicht(boss(), 10, 'de');
    expect(gleicheAnsicht(a, bossAnsicht(boss(), 11, 'de'))).toBe(true);
    expect(gleicheAnsicht(a, bossAnsicht(boss({ health: 1199 }), 11, 'de'))).toBe(false);
    expect(gleicheAnsicht(a, bossAnsicht(boss(), 200, 'de'))).toBe(false);
    expect(gleicheAnsicht(a, bossAnsicht(boss(), 10, 'en'))).toBe(false);
    expect(gleicheAnsicht(null, null)).toBe(true);
    expect(gleicheAnsicht(a, null)).toBe(false);
  });
});

describe('Reisebildschirm (M7-37)', () => {
  it('Namen der Reisepunkte: Leuchtfeuer nach Biom, Herdfeuer und Wegstein nach Nummer, ein benannter Wegstein mit Namen', () => {
    expect(punktName(de, point('leuchtfeuer:1'))).toBe('Leuchtfeuer: Grünhain');
    expect(punktName(en, point('leuchtfeuer:1'))).toBe('Beacon: Greengrove');
    expect(punktName(de, point('herdfeuer:7'))).toBe('Herdfeuer 7');
    expect(punktName(en, point('wegstein:3'))).toBe('Waystone 3');
    expect(punktName(de, point('wegstein:3', 'Am Fluss'))).toBe('Am Fluss');
  });

  it('Ziele mit Preis gegen die Lumen-Scherben der Taschen; die Sperre als Zeile; am Wegstein seine Nummer zum Benennen', () => {
    const sample: TravelSample = { from: 'wegstein:2', fromName: '', points: [point('leuchtfeuer:1'), point('herdfeuer:7')], costs: [3, 1], blocked: null };
    const a = reiseAnsicht(de, sample, 2);
    expect(a.von).toBe('Wegstein 2');
    expect(a.wegstein).toBe(2);
    expect(a.lumen).toBe(2);
    expect(a.ziele).toEqual([
      { id: 'leuchtfeuer:1', art: 'leuchtfeuer', name: 'Leuchtfeuer: Grünhain', kosten: 3, bezahlbar: false },
      { id: 'herdfeuer:7', art: 'herdfeuer', name: 'Herdfeuer 7', kosten: 1, bezahlbar: true },
    ]);
    expect(a.gesperrt).toBeNull();
    // A named waystone the player stands at goes by its name.
    expect(reiseAnsicht(en, { ...sample, fromName: 'Am Pflaster' }, 2).von).toBe('Am Pflaster');
    // Exactly the price in the bags is enough.
    expect(reiseAnsicht(de, sample, 3).ziele.map((z) => z.bezahlbar)).toEqual([true, true]);
    const fight = reiseAnsicht(en, { ...sample, from: 'leuchtfeuer:1', blocked: 'inFight' }, 9);
    expect(fight.wegstein).toBeNull();
    expect(fight.von).toBe('Beacon: Greengrove');
    expect(fight.gesperrt).toBe('Nobody travels in the middle of a fight – get to safety first.');
    // A cost the sample lacks falls back to the least a trip costs.
    expect(reiseAnsicht(de, { ...sample, costs: [] }, 0).ziele.map((z) => z.kosten)).toEqual([BALANCE.travel.minCost, BALANCE.travel.minCost]);
  });

  it('kein Reisepunkt: kein Ausgangsname, keine Ziele', () => {
    expect(reiseAnsicht(de, { from: '', fromName: '', points: [], costs: [], blocked: null }, 0)).toEqual({ von: '', wegstein: null, ziele: [], lumen: 0, gesperrt: null });
  });
});

describe('Vision 1 (M7-35)', () => {
  it('vier Standbilder mit je zwei Zeilen, dann die Seite des Wissens (die LF1-Freischaltungen); Sprache folgt', () => {
    const seiten = visionSeiten(1, 'de');
    expect(seiten.map((s) => s.bild)).toEqual(['vision_1_1', 'vision_1_2', 'vision_1_3', 'vision_1_4', null]);
    expect(seiten.slice(0, 4).every((s) => s.zeilen.length === 2 && (s.sekunden ?? 0) > 0)).toBe(true);
    expect(seiten[0]?.zeilen[0]).toBe('Einst brannten sechs Feuer über Lumara.');
    expect(visionSeiten(1, 'en')[0]?.zeilen[0]).toBe('Once six fires burned over Lumara.');
    expect(seiten[4]).toEqual({ bild: null, zeilen: ['Lumen-Werkbank', 'Lumen-Laterne', 'Wegsteine', 'Glutkern des Grünhains'], sekunden: null });
  });

  it('ein Leuchtfeuer ohne Vision oder eine unbekannte Nummer: keine Seiten', () => {
    expect(visionSeiten(9, 'de')).toEqual([]);
  });
});
