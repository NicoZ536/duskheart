/**
 * M3-27: texts of the HUD (src/ui/hud/texte.ts; MASTERPROMPT §26 "Fehlermeldungen sagen, was fehlt und wie
 * man es löst", §11.2 thermometer tooltip "gefühlte Temperatur und Einflüsse", §11.3 condition tooltip) in
 * German and English with strict i18n (a missing key throws), the condition timers, wear of a slot, and
 * where a HUD tooltip goes; the new bar fills of the UI kit (satiety, thirst).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { contentConditionCatalog } from '../../../src/game/conditions/catalog';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createI18n, LANGS, type Lang } from '../../../src/i18n';
import { UI_GRAFIKEN } from '../../../src/generated/ui';
import { BAR_ARTEN } from '../../../src/ui/kit/widgets';
import { NO_TIMER } from '../../../src/ui/hud/signale';
import { brennzeit, furchtLabel, furchtTooltip, guertelZeile, itemTooltip, leerTooltip, leistenLabel, leistenTooltip, lichtZeilen, platzLabel, thermoLabel, thermoTooltip, verschleiss, zustandsLabel, zustandsRest, zustandsTooltip, zustandsZeit, type ThermoWerte } from '../../../src/ui/hud/texte';
import type { LightView } from '../../../src/ui/hud/signale';
import { hudTooltipPlatz } from '../../../src/ui/hud/Tooltip';

const i18n = (lang: Lang) => createI18n(lang, { strict: true });
const de = i18n('de');
const en = i18n('en');
/** Formatted numbers use no-break spaces ("36,4 °C", "20 %"); the expectations write plain spaces. */
const n = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ');
const zeilen = (m: { abschnitte: ReadonlyArray<{ zeilen: ReadonlyArray<{ text: string }> }> }): string[] => m.abschnitte.flatMap((a) => a.zeilen.map((z) => n(z.text)));

const KALT: ThermoWerte = { coreC: 36.4, feltC: 8.3, bandLowC: 12, bandHighC: 26, ambientC: 8.3, heatC: 0, roomC: 0, wetness: 40, stage: 'normal', trend: -1 };

describe('HUD-Texte', () => {
  it('Zustands-Timer: Sekunden, Minuten:Sekunden unter zehn Minuten, dann Minuten; ohne Ende leer', () => {
    expect(zustandsZeit(de, 45)).toBe('45s');
    expect(zustandsZeit(de, 125)).toBe('2:05');
    expect(zustandsZeit(de, 599)).toBe('9:59');
    expect(zustandsZeit(de, 601)).toBe('11m');
    expect(zustandsZeit(de, NO_TIMER)).toBe('');
  });

  it('Zustände: Name, Stärke, Restzeit in Worten; Heilung und Werte ohne Ablauf erklärt', () => {
    const cat = contentConditionCatalog();
    const blutung = cat.get('blutung');
    expect(zustandsLabel(de, blutung, 3, 12)).toBe('Blutung ×3, Noch 12 s');
    expect(zustandsLabel(en, blutung, 1, 90)).toBe('Bleeding, 1 min 30 s left');
    expect(zustandsRest(de, cat.get('knochenbruch'), NO_TIMER)).toBe('Hält an, bis du es behandelst');
    expect(zustandsRest(en, cat.get('hungrig'), NO_TIMER)).toBe('Ends once the value recovers');
    const tip = zustandsTooltip(de, blutung, 2, 20);
    expect(tip.titel).toBe('Blutung');
    expect(tip.abschnitte[0]?.kopf).toBe('Gefahr – kostet Leben');
    expect(zeilen(tip)).toEqual([blutung.beschreibung.de, 'Stärke 2', 'Noch 20 s']);
  });

  it('jeder Zustand und jede Furchtstufe hat Texte in beiden Sprachen', () => {
    for (const lang of LANGS) {
      const t = i18n(lang);
      for (const def of contentConditionCatalog().list) expect(zustandsTooltip(t, def, 1, def.dauer.art === 'zeit' ? def.dauer.sekunden : NO_TIMER).titel.length).toBeGreaterThan(0);
      for (const stage of ['ruhig', 'unruhig', 'fluestern', 'trugbilder', 'bedrohlich', 'nachtmahr'] as const) {
        expect(furchtLabel(t, 45, stage).length).toBeGreaterThan(0);
        expect(zeilen(furchtTooltip(t, 45, stage))).toHaveLength(2);
      }
    }
  });

  it('Leisten: Wert von Maximum, Hinweis mit den Grenzen aus der Balance und klarer Handlung', () => {
    const satt = BALANCE.survival.health.regenAboveSatiety;
    expect(leistenLabel(de, 'leben', 87.6, 100)).toBe('Leben: 87 von 100');
    expect(leistenLabel(en, 'durst', 12, 100)).toBe('Thirst: 12 of 100');
    expect(zeilen(leistenTooltip(de, 'saettigung', satt - 1, 100))).toEqual([`${satt - 1} von 100`, `Unter ${satt} heilt dein Leben nicht mehr – iss etwas.`]);
    expect(leistenTooltip(de, 'saettigung', satt - 1, 100).abschnitte[0]?.zeilen[1]?.ton).toBe('warn');
    expect(leistenTooltip(de, 'saettigung', satt + 1, 100).abschnitte[0]?.zeilen[1]?.ton).toBe('dim');
    expect(zeilen(leistenTooltip(en, 'leben', 50, 100))[1]).toContain(`${BALANCE.survival.health.regenDamageFreeSeconds} s`);
  });

  it('Thermometer: Kern mit Trend, gefühlt, Wohlfühlbereich, Einflüsse (Umgebung, Nässe, Kleidung) und Rat', () => {
    expect(n(thermoLabel(de, KALT))).toBe('Körpertemperatur 36,4 °C, Normal, fällt');
    const tip = thermoTooltip(de, KALT);
    expect(tip.titel).toBe('Körpertemperatur');
    const z = zeilen(tip);
    expect(z).toContain('Kern: 36,4 °C, fällt');
    expect(z).toContain('Gefühlt: 8,3 °C');
    expect(z).toContain('Wohlfühlbereich: 12,0 °C bis 26,0 °C');
    expect(z).toContain('Umgebung: 8,3 °C');
    expect(z).toContain('Nässe 40 % – die Kleidung wärmt schlechter');
    expect(z).toContain('Kleidung wärmt: +6,0 °C');
    expect(z.at(-1)).toBe('Zu kalt – geh ans Feuer, trockne dich oder zieh Wärmeres an.');
    // Heat sources and a room only when they act; hot gets its own advice.
    const heiss = zeilen(thermoTooltip(en, { ...KALT, feltC: 31, heatC: 15, roomC: 2, wetness: 0, bandLowC: 18, stage: 'erhitzt', trend: 2 }));
    expect(heiss).toContain('Heat sources: +15.0 °C');
    expect(heiss).toContain('Room: +2.0 °C');
    expect(heiss.some((l) => l.startsWith('Wetness'))).toBe(false);
    expect(heiss.at(-1)).toBe('Too hot – find shade, drink something and take off warm clothing.');
    expect(zeilen(thermoTooltip(en, { ...KALT, feltC: 20, wetness: 0 })).at(-1)).toBe('You feel comfortable.');
  });

  it('Plätze: Name mit Anzahl, leer mit Platznummer; Verschleiß erst unter voll', () => {
    const cat = contentItemCatalog();
    const holz = cat.get('holz');
    expect(platzLabel(de, 'schnellleiste', '1', newStack(holz, 64), holz)).toBe('Platz 1: Holz ×64');
    expect(platzLabel(en, 'guertel', '3', null, undefined)).toBe('Belt 3: empty');
    const beeren = cat.get('himbeeren');
    expect(verschleiss(newStack(beeren, 3), beeren, null)).toBeNull();
    expect(verschleiss({ ...newStack(beeren, 3), frische: 40 }, beeren, null)).toEqual({ anteil: 0.4, art: 'frische' });
    expect(verschleiss({ item: 'x', count: 1, haltbarkeit: 30 }, holz, 120)).toEqual({ anteil: 0.25, art: 'haltbarkeit' });
  });

  it('Platz-Tooltip: Art · Stufe, Rarität ab Ungewöhnlich als Wort in ihrer Farbe, Anzahl, Werkzeug, Nährwerte, Haltbarkeit, Frische, Zusatz', () => {
    const cat = contentItemCatalog();
    const beeren = cat.get('himbeeren');
    const tip = itemTooltip(de, { ...newStack(beeren, 3), frische: 20 }, beeren, null, 'var(--x)');
    expect(tip.titel).toBe('Himbeeren');
    expect(tip.titelFarbe).toBe('var(--x)');
    const e = beeren.essbar;
    if (e === undefined) throw new Error('Himbeeren sind essbar');
    expect(zeilen(tip)).toEqual(['Nahrung · Stufe 0', 'Anzahl: 3', `Sättigung +${e.saettigung} · Durst +${e.durst}`, 'Frische 20 %']);
    // Stale food warns (below a quarter), like the red wear bar.
    expect(tip.abschnitte[0]?.zeilen.at(-1)?.ton).toBe('warn');
    const axt = cat.get('steinaxt');
    const neu = newStack(axt, 1);
    const max = neu.haltbarkeit ?? 0;
    const w = axt.werkzeug;
    if (w === undefined) throw new Error('Steinaxt ist ein Werkzeug');
    expect(zeilen(itemTooltip(en, neu, axt, max, 'var(--x)'))).toEqual([`Tool · Tier ${axt.stufe}`, `Axe · Mining power ${w.abbaukraft}`, `Durability ${max}/${max}`]);
    expect(zeilen(itemTooltip(en, { ...neu, haltbarkeit: 0 }, axt, max, 'var(--x)'))).toEqual([`Tool · Tier ${axt.stufe}`, `Axe · Mining power ${w.abbaukraft}`, 'Broken – repair it at a workbench']);
    const pilz = cat.get('leuchtpilz');
    expect(pilz.raritaet).toBe('ungewoehnlich');
    const selten = itemTooltip(de, newStack(pilz, 4), pilz, null, 'var(--dh-raritaet-ungewoehnlich)');
    expect(selten.abschnitte[0]?.zeilen[1]).toEqual({ text: 'Ungewöhnlich', ton: 'text', farbe: 'var(--dh-raritaet-ungewoehnlich)' });
    const mitZusatz = itemTooltip(de, newStack(cat.get('apfel'), 6), cat.get('apfel'), null, 'var(--x)', [guertelZeile(de, 'Q', cat.get('apfel'))]);
    expect(mitZusatz.abschnitte).toHaveLength(2);
    expect(zeilen(mitZusatz).at(-1)).toBe('Q: Apfel essen oder trinken');
  });

  it('leere Plätze sagen, was hingehört und wie man es nutzt', () => {
    expect(leerTooltip(de, 'nebenhand', 'Tab', null)).toEqual({
      titel: 'Nebenhand',
      abschnitte: [{ zeilen: [{ text: 'Eine Fackel hier leuchtet dir, ein Schild fängt Treffer ab. Ausrüsten im Inventar (Tab).', ton: 'dim' }] }],
    });
    expect(zeilen(leerTooltip(en, 'guertel', null, 'Q'))).toEqual(['Put food or potions on your belt to use them with Q.']);
    expect(zeilen(leerTooltip(en, 'guertel', null, null))).toEqual(['Put food or potions on your belt to use them quickly.']);
  });

  it('getragenes Licht: Brenndauer, aus mit Schalter, Regen, Gürtel; wenig Rest warnt', () => {
    const slot = { bereich: 'ausruestung', index: 5 } as const;
    const an: LightView = { slot, lit: true, belt: false, seconds: 192, share: 0.8, rain: false };
    expect(brennzeit(de, 192)).toBe('3 min 12 s');
    expect(brennzeit(en, 45)).toBe('45 s');
    expect(lichtZeilen(de, an, 'F')).toEqual([{ text: 'Brennt noch 3 min 12 s', ton: 'gut' }]);
    expect(lichtZeilen(de, { ...an, share: 0.1, seconds: 24 }, 'F')[0]).toEqual({ text: 'Brennt noch 24 s', ton: 'warn' });
    expect(lichtZeilen(en, { ...an, lit: false }, 'F').map((z) => z.text)).toEqual(['Out – F lights it', 'Burn time left: 3 min 12 s']);
    expect(lichtZeilen(en, { ...an, lit: false }, null)[0]?.text).toBe('Out – the light key lights it');
    expect(lichtZeilen(de, { ...an, rain: true, belt: true }, 'F').map((z) => z.text)).toEqual(['Brennt noch 3 min 12 s', 'Im Regen brennt das Licht schneller herunter.', 'Am Gürtel leuchtet das Licht schwächer.']);
  });
});

describe('HUD-Tooltip: Platz', () => {
  const raum = { width: 1920, height: 1080 };
  it('oben: darunter, links bündig; unten: darüber; immer im Bild und auf ganzen Designpixeln', () => {
    const oben = hudTooltipPlatz({ left: 8, top: 8, width: 36, height: 32 }, { width: 400, height: 200 }, raum, 4);
    expect(oben).toEqual({ left: 8, top: 8 + 32 + 12 });
    const unten = hudTooltipPlatz({ left: 1800, top: 1000, width: 80, height: 80 }, { width: 400, height: 200 }, raum, 4);
    expect(unten.top).toBe(1000 - 12 - 200);
    expect(unten.left).toBe(1920 - 8 - 400);
    const krumm = hudTooltipPlatz({ left: 101, top: 7, width: 30, height: 30 }, { width: 50, height: 50 }, raum, 4);
    expect(krumm.left % 4).toBe(0);
    expect(krumm.top % 4).toBe(0);
  });
});

describe('UI-Kit: Leisten des HUD', () => {
  it('Sättigung und Durst haben eigene Füllungen in der Größe der Leben-Füllung', () => {
    expect(BAR_ARTEN).toEqual(['leben', 'ausdauer', 'saettigung', 'durst']);
    const leben = UI_GRAFIKEN.leiste_leben;
    for (const g of [UI_GRAFIKEN.leiste_saettigung, UI_GRAFIKEN.leiste_durst]) expect([g.width, g.height, g.slice]).toEqual([leben.width, leben.height, leben.slice]);
  });
});
