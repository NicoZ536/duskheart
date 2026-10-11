/**
 * Die reinen Modelle der Darstellung von Strang G (docs/SPIEL.md §30; M7-41, M7-42, M7-44, M7-48): Chronik-Reiter (Aufgaben mit
 * Tagebuch, Bestiarium, Herbarium & Fischbuch, Wissen, Rezeptbuch, Statistiken, Erfolge), der Aufgaben-Tracker des HUD, Funke mit
 * Hinweiszeile und die Perk-Wahl – Inhaltsnamen in der aktuellen Sprache, Reihenfolgen, Fortschritt und Spielzeiten aus den
 * Samples der Sitzung; die Signaturen der HUD-Teile ändern sich genau dann, wenn sich das Bild ändern würde.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import type { ChronicleEntry } from '../../../src/game/chronicle/types';
import { createGuideSample } from '../../../src/game/guide/types';
import { createQuestSample, type AchievementsSample, type QuestSample, type SkillsSample, type StatsSample } from '../../../src/game/samples/chronik';
import { aufgabenSignatur, aufgabenZeilen } from '../../../src/ui/hud/aufgaben/modell';
import { funkeAnsicht, funkeSignatur, KEINE_FUEHRUNG } from '../../../src/ui/hud/funke/modell';
import {
  aufgabenAnsicht,
  bestiariumAnsicht,
  CHRONIK_REITER,
  ERFOLG_GESPERRT,
  erfolgeAnsicht,
  herbariumAnsicht,
  naechsterReiter,
  rezeptAnsicht,
  spielzeit,
  statistikAnsicht,
  TAGEBUCH_ZEILEN,
  tagebuchText,
  wissenAnsicht,
} from '../../../src/ui/screens/chronik/modell';
import { perkwahlAnsicht, wahlSchluessel } from '../../../src/ui/screens/perkwahl/modell';

const HZ = BALANCE.time.tickHz;

/** A quest sample with the rows `rows` (the rest of the held record stays empty). */
function quests(onboarding: boolean, ...rows: Partial<QuestSample['rows'][number]>[]): QuestSample {
  const s = createQuestSample();
  rows.forEach((r, i) => Object.assign(s.rows[i] as object, { aktiv: true, erledigt: false, tracked: true, count: 0, need: 0, startedTick: 0 }, r));
  s.count = rows.length;
  s.onboarding = onboarding;
  return s;
}

function eintrag(nr: number, rule: string, values: Record<string, string | number>, day = 1): ChronicleEntry {
  return { nr, tick: nr * 60, day, rule, values };
}

describe('Chronik-Modelle (src/ui/screens/chronik/modell.ts)', () => {
  it('sieben Reiter in der Reihenfolge von §23.3; Q/E wechseln im Kreis', () => {
    expect(CHRONIK_REITER).toEqual(['aufgaben', 'bestiarium', 'herbarium', 'wissen', 'rezepte', 'statistik', 'erfolge']);
    expect(naechsterReiter('aufgaben', -1)).toBe('erfolge');
    expect(naechsterReiter('erfolge', 1)).toBe('aufgaben');
    expect(naechsterReiter('wissen', 1)).toBe('rezepte');
  });

  it('Tagebuch: Platzhalter werden zu Inhaltsnamen der Sprache, Zahlen bleiben Zahlen, unbekannte Regeln fallen weg', () => {
    expect(tagebuchText(eintrag(1, 'chronik_ort_entdeckt', { ortstyp: 'aussichtsturm' }), 'de')).toBe('Entdeckt: Aussichtsturm.');
    expect(tagebuchText(eintrag(1, 'chronik_ort_entdeckt', { ortstyp: 'aussichtsturm' }), 'en')).toBe('Discovered: Lookout Tower.');
    expect(tagebuchText(eintrag(2, 'chronik_erstes_lied', { instrument: 'floete' }), 'en')).toContain('the Wooden Flute');
    expect(tagebuchText(eintrag(3, 'erfunden', {}), 'de')).toBeNull();
  });

  it('Aufgaben: Hauptaufgabe zuerst, Einstieg pausiert, Fortschritt nur bei zählbaren Schritten, Tagebuch jüngstes zuerst und begrenzt', () => {
    const q = quests(
      false,
      { quest: 'einstieg', art: 'einstieg', aktiv: false, schritt: 1, schritte: 5 },
      { quest: 'bronzezeit', art: 'neben', aktiv: true, erledigt: true, schritt: 2, schritte: 2, tracked: false },
      { quest: 'hq_sechs_feuer_1', art: 'haupt', schritt: 2, schritte: 4, count: 0, need: 1 },
    );
    const entries: ChronicleEntry[] = [];
    for (let i = 1; i <= TAGEBUCH_ZEILEN + 5; i++) entries.push(eintrag(i, 'chronik_ort_entdeckt', { ortstyp: 'gehoeft' }, 1 + Math.floor(i / 10)));
    const a = aufgabenAnsicht(q, { entries, knowledge: [] }, 'de');
    expect(a.laufend.map((k) => k.quest)).toEqual(['hq_sechs_feuer_1', 'einstieg']);
    expect(a.erledigt.map((k) => k.quest)).toEqual(['bronzezeit']);
    expect(a.einstieg).toBe(false);
    expect(a.verfolgt).toBe(2);
    const haupt = a.laufend[0];
    expect(haupt?.titel).toBe('Die sechs Feuer – Das erste Feuer');
    expect(haupt?.schritt).toMatchObject({ titel: 'Der Hüter des Hains', nr: 3, von: 4, braucht: 0 });
    expect(haupt?.erledigteSchritte).toHaveLength(2);
    expect(a.laufend[1]?.pausiert).toBe(true);
    expect(a.laufend[1]?.schritt?.titel).toBe('Eine Steinaxt');
    // A finished quest shows every step done and no current one.
    expect(a.erledigt[0]?.schritt).toBeNull();
    expect(a.erledigt[0]?.erledigteSchritte).toHaveLength(2);
    expect(a.tagebuch).toHaveLength(TAGEBUCH_ZEILEN);
    expect(a.tagebuch[0]?.nr).toBe(TAGEBUCH_ZEILEN + 5);
    expect(a.tagebuch[0]?.text).toBe('Entdeckt: Verlassenes Gehöft.');
  });

  it('Bestiarium: bekannte zuerst; ungesichtet ohne Namen, Tipp erst mit den Resistenzen', () => {
    const rows = [
      { creature: 'hase', gesichtet: false, resistenzen: false, beute: false, kills: 0 },
      { creature: 'reh', gesichtet: true, resistenzen: false, beute: false, kills: 0 },
      { creature: 'wachtel', gesichtet: true, resistenzen: true, beute: true, kills: 6 },
    ];
    const b = bestiariumAnsicht({ rows }, 'en');
    expect(b.map((r) => r.kreatur)).toEqual(['reh', 'wachtel', 'hase']);
    expect(b[2]).toMatchObject({ bekannt: false, name: null, text: null, hinweis: null });
    expect(b[0]?.name).toBe(CONTENT.collection('creatures').get('reh')?.name.en);
    expect(b[0]?.hinweis).toBeNull();
    expect(b[1]?.hinweis).toBe(CONTENT.collection('creatures').get('wachtel')?.bestiarium.hinweis.en);
  });

  it('Herbarium & Fischbuch: gesammelte Pflanzen und gefangene Fische mit Namen zuerst, die übrigen namenlos dahinter', () => {
    const stats: StatsSample = {
      rows: [
        { stat: 'gesammelt', total: 5, keys: [['busch_sanddorn', 4], ['stein', 1]] },
        { stat: 'gefangen', total: 2, keys: [['karpfen', 2]] },
      ],
      milestones: [],
    };
    const h = herbariumAnsicht(stats, 'de');
    expect(h.pflanzenBekannt).toBe(1);
    expect(h.fischeBekannt).toBe(1);
    expect(h.pflanzen.find((p) => p.id === 'busch_sanddorn')).toEqual({ id: 'busch_sanddorn', name: 'Sanddorn', anzahl: 4 });
    expect(h.pflanzen.find((p) => p.id === 'busch_hasel')?.name).toBeNull();
    // A stone is no plant.
    expect(h.pflanzen.some((p) => p.id === 'stein')).toBe(false);
    expect(h.fische.find((f) => f.id === 'karpfen')?.anzahl).toBe(2);
    expect(h.fische.find((f) => f.id === 'barsch')?.name).toBeNull();
    // Not first in content order (beach grass, berries, trout come before): found ones lead the page.
    expect(h.pflanzen[0]?.id).toBe('busch_sanddorn');
    expect(h.fische[0]?.id).toBe('karpfen');
    expect(h.pflanzen.every((p, i) => i === 0 || p.anzahl === 0)).toBe(true);
  });

  it('Wissen: das Neueste zuerst, mit Titel, Text und Quelle', () => {
    const w = wissenAnsicht({ entries: [], knowledge: [{ id: 'wissen_orte', tick: 1 }, { id: 'wissen_blitze', tick: 2 }, { id: 'erfunden', tick: 3 }] }, 'en');
    expect(w.map((k) => k.id)).toEqual(['wissen_blitze', 'wissen_orte']);
    expect(w[1]).toMatchObject({ titel: 'Places of the Old Ones', quelle: 'mechanik' });
  });

  it('Rezeptbuch: nur bekannte Rezepte, „in der Hand“ zuerst, dann je Station; Gruppen-Zutaten mit dem Gruppennamen', () => {
    const r = rezeptAnsicht(new Set(['rezept_steinaxt', 'rezept_brett', 'rezept_holzkohle']), 'de', 'In der Hand');
    expect(r.map((g) => g.station)).toEqual([null, ...CONTENT.collection('stations').values().map((s) => s.id).filter((s) => s === 'saegebock' || s === 'koehlermeiler')]);
    expect(r[0]?.name).toBe('In der Hand');
    expect(r[0]?.rezepte.map((x) => x.id)).toEqual(['rezept_steinaxt']);
    expect(r[0]?.rezepte[0]?.zutaten).toBe('2× Zweig, 2× Stein, 1× Faserseil');
    const brett = r.flatMap((g) => g.rezepte).find((x) => x.id === 'rezept_brett');
    expect(brett?.zutaten).toBe('1× Bauholz (Holzscheit oder Treibholz)');
  });

  it('Statistiken: Spielzeit als Stunden:Minuten:Sekunden, Meilensteine mit Spielzeit oder offen, Fertigkeiten mit gewählten und offenen Perks', () => {
    expect(spielzeit(0)).toBe('0:00:00');
    expect(spielzeit(50 * HZ + 30)).toBe('0:00:50');
    expect(spielzeit((3 * 3600 + 7 * 60 + 59) * HZ)).toBe('3:07:59');
    const stats: StatsSample = {
      rows: [
        { stat: 'spielzeit', total: 2 * 3600 * HZ + 0.5, keys: [] },
        { stat: 'distanz', total: 1234.75, keys: [] },
      ],
      milestones: [
        { id: 'm_steinaxt', spielzeit: 5 * 60 * HZ },
        { id: 'm_lf1', spielzeit: -1 },
      ],
    };
    const skills: SkillsSample = {
      rows: [{ id: 'holzfaellen', level: 64, xp: 30, xpNext: 120, perks: [{ level: 30, choice: 1 }, { level: 60, choice: null }] }],
      open: [{ skill: 'holzfaellen', level: 60 }],
    };
    const s = statistikAnsicht(stats, skills, 'en');
    expect(s.werte).toEqual([
      { stat: 'spielzeit', name: 'Time played', wert: '2:00:00' },
      { stat: 'distanz', name: CONTENT.collection('stats').get('distanz')?.name.en, wert: '1234' },
    ]);
    expect(s.meilensteine).toEqual([
      { id: 'm_steinaxt', name: CONTENT.collection('milestones').get('m_steinaxt')?.name.en, zeit: '0:05:00' },
      { id: 'm_lf1', name: 'Beacon 1 lit', zeit: null },
    ]);
    expect(s.fertigkeiten[0]).toMatchObject({ id: 'holzfaellen', name: 'Woodcutting', stufe: 64, anteil: 0.25, offen: [60] });
    expect(s.fertigkeiten[0]?.perks).toEqual([CONTENT.collection('perks').get('reiche_staemme')?.name.en]);
  });

  it('Erfolge: erreichte zuerst mit eigenem Symbol und Spielzeit, offene versiegelt mit Fortschritt', () => {
    const sample: AchievementsSample = {
      rows: [
        { id: 'erste_nacht', unlocked: false, spielzeit: -1, count: 0, need: 1 },
        { id: 'feuermacher', unlocked: false, spielzeit: -1, count: 2, need: 5 },
        { id: 'steinzeit', unlocked: true, spielzeit: 90 * 60 * HZ, count: 0, need: 0 },
      ],
    };
    const e = erfolgeAnsicht(sample, 'en');
    expect(e.erreicht).toBe(1);
    expect(e.zeilen.map((z) => z.id)).toEqual(['steinzeit', 'erste_nacht', 'feuermacher']);
    expect(e.zeilen[0]).toMatchObject({ icon: 'erfolg_steinzeit', erreicht: true, zeit: '1:30:00' });
    expect(e.zeilen[1]).toMatchObject({ icon: ERFOLG_GESPERRT, erreicht: false, zeit: null, braucht: 0 });
    expect(e.zeilen[2]).toMatchObject({ name: 'Firemaker', hat: 2, braucht: 5 });
  });
});

describe('Aufgaben-Tracker (src/ui/hud/aufgaben/modell.ts)', () => {
  it('nur verfolgte laufende Aufgaben, die Hauptaufgabe oben, Zähler nur bei zählbaren Schritten', () => {
    const q = quests(
      true,
      { quest: 'einstieg', art: 'einstieg', schritt: 0, schritte: 5, count: 2.5, need: 5 },
      { quest: 'bronzezeit', art: 'neben', schritt: 0, schritte: 2, tracked: false },
      { quest: 'hq_sechs_feuer_1', art: 'haupt', schritt: 1, schritte: 4, need: 1 },
    );
    const z = aufgabenZeilen(q, 'en');
    expect(z.map((r) => r.quest)).toEqual(['hq_sechs_feuer_1', 'einstieg']);
    expect(z[1]).toMatchObject({ titel: 'The First Hours', nr: 1, von: 5, hat: 2, braucht: 5 });
    expect(z[0]?.braucht).toBe(0);
  });

  it('die Signatur ändert sich mit Schritt, Fortschritt und Verfolgen – sonst nicht', () => {
    const q = quests(true, { quest: 'einstieg', art: 'einstieg', schritt: 0, schritte: 5, count: 1, need: 5 });
    const a = aufgabenSignatur(q);
    expect(aufgabenSignatur(q)).toBe(a);
    (q.rows[0] as { count: number }).count = 2;
    const b = aufgabenSignatur(q);
    expect(b).not.toBe(a);
    (q.rows[0] as { schritt: number }).schritt = 1;
    const c = aufgabenSignatur(q);
    expect(c).not.toBe(b);
    (q.rows[0] as { tracked: boolean }).tracked = false;
    expect(aufgabenSignatur(q)).not.toBe(c);
  });
});

describe('Funke und Hinweiszeile (src/ui/hud/funke/modell.ts)', () => {
  it('Dialogzeile vor Kommentar, Hinweis daneben; abgelaufene Anzeigen verschwinden', () => {
    const s = createGuideSample();
    s.tick = 100;
    expect(funkeAnsicht(s, 'de')).toBe(KEINE_FUEHRUNG);
    s.dialog = 'funke_staette';
    s.dialogLine = 0;
    s.funkeUntilTick = 200;
    s.hint = 'hinweis_aufgaben';
    s.hintUntilTick = 150;
    expect(funkeAnsicht(s, 'en')).toEqual({
      funke: 'It burned here. Cold now, full of shadows.',
      funkeId: 'funke_staette:0',
      hinweis: 'Your quests are on the right. In the chronicle (J) you choose which to follow.',
      hinweisId: 'hinweis_aufgaben',
    });
    s.dialog = null;
    s.funke = 'funke_ort_erster';
    expect(funkeAnsicht(s, 'de').funkeId).toBe('funke_ort_erster');
    s.tick = 160;
    expect(funkeAnsicht(s, 'de').hinweis).toBeNull();
    s.tick = 200;
    expect(funkeAnsicht(s, 'de')).toBe(KEINE_FUEHRUNG);
  });

  it('die Signatur folgt dem Bild: andere Zeile, anderer Hinweis, Ablauf', () => {
    const s = createGuideSample();
    s.tick = 10;
    s.dialog = 'funke_erwachen';
    s.dialogLine = 0;
    s.funkeUntilTick = 50;
    const a = funkeSignatur(s);
    s.dialogLine = 1;
    const b = funkeSignatur(s);
    expect(b).not.toBe(a);
    s.hint = 'hinweis_aufgaben';
    s.hintUntilTick = 50;
    const c = funkeSignatur(s);
    expect(c).not.toBe(b);
    s.tick = 49;
    expect(funkeSignatur(s)).toBe(c);
    s.tick = 50;
    expect(funkeSignatur(s)).toBe(0);
  });
});

describe('Perk-Wahl (src/ui/screens/perkwahl/modell.ts)', () => {
  it('die erste offene Wahl mit ihren zwei Perks in Wahlreihenfolge, dazu die Zahl der wartenden', () => {
    const sample: SkillsSample = { rows: [], open: [{ skill: 'holzfaellen', level: 30 }, { skill: 'holzfaellen', level: 60 }, { skill: 'holzfaellen', level: 90 }] };
    const v = perkwahlAnsicht(sample, 'de');
    expect(v).toMatchObject({ fertigkeit: 'holzfaellen', fertigkeitName: 'Holzfällen', stufe: 30, weitere: 2 });
    expect(v?.karten.map((k) => [k.wahl, k.id])).toEqual([
      [0, 'kraftvolle_hiebe'],
      [1, 'reiche_staemme'],
    ]);
    expect(v?.karten[0]?.beschreibung).toBe(CONTENT.collection('perks').get('kraftvolle_hiebe')?.beschreibung.de);
    // A level without perks is no choice; nothing open: no screen.
    expect(perkwahlAnsicht({ rows: [], open: [{ skill: 'holzfaellen', level: 45 }] }, 'de')).toBeNull();
    expect(perkwahlAnsicht({ rows: [], open: [] }, 'de')).toBeNull();
  });

  it('eine auf dem Bildschirm getroffene Wahl gilt als genommen, bis der pausierte Befehl ankommt', () => {
    const sample: SkillsSample = { rows: [], open: [{ skill: 'holzfaellen', level: 30 }, { skill: 'holzfaellen', level: 60 }] };
    const gesendet = new Set([wahlSchluessel('holzfaellen', 30)]);
    const v = perkwahlAnsicht(sample, 'en', undefined, gesendet);
    expect(v).toMatchObject({ stufe: 60, weitere: 0 });
    expect(v?.karten.map((k) => k.id)).toEqual(['foerster', 'holzhauer']);
    gesendet.add(wahlSchluessel('holzfaellen', 60));
    expect(perkwahlAnsicht(sample, 'en', undefined, gesendet)).toBeNull();
  });
});
