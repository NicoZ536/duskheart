/**
 * M3-29 Meldungsquelle (src/ui/hud/meldungen/quelle.ts, inhalte.ts, textgroesse.ts, Meldungen.tsx):
 * Sim-Ereignisse werden zu Meldungen (Aufsammeln mit Name und Rarität, Taschen voll, Warnstufen mit
 * Zustands-Icon, Rückkehr zu „normal“ still), „Die Dunkelheit naht“ genau beim Überschreiten der
 * Abendschwelle an der Oberfläche (Finstermond-Zusatz), abgelehnte Spielerbefehle als Warnung mit Grund und
 * Lösung (Debug-Befehle, fortlaufende Eingaben und ein schon angezeigter Interaktionsgrund bleiben still),
 * Texte in beiden Sprachen und die Textgröße auf ganzen Schriftpixeln.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/engine/events';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import type { SimEventMap } from '../../../src/game/sim';
import { createI18n } from '../../../src/i18n';
import type { SkySample } from '../../../src/game/session';
import { ablehnungsText } from '../../../src/ui/hud/meldungen/ablehnung';
import { entdeckung, MELDUNG_SFX, WARN_STUFEN, type MeldungInhalt } from '../../../src/ui/hud/meldungen/inhalte';
import { hudWeltdienste } from '../../../src/ui/hud/minimap/Weltanzeigen';
import { meldungsText } from '../../../src/ui/hud/meldungen/Meldungen';
import { DUNKELHEIT_VORLAUF_MIN, DunkelheitsWaechter, meldungenQuelle, type MeldungenSitzung } from '../../../src/ui/hud/meldungen/quelle';
import { textFaktor } from '../../../src/ui/hud/meldungen/textgroesse';
import type { MeldungEingabe } from '../../../src/ui/hud/meldungen/warteschlange';
import { neueMinimapLage, type MinimapLage } from '../../../src/ui/hud/minimap/lage';

/** Sitzung, die Ereignisse von Hand auslöst. */
function sitzung(): MeldungenSitzung & { bus: EventBus<SimEventMap> } {
  const bus = new EventBus<SimEventMap>();
  return { bus, onEvent: (type, handler) => bus.on(type, handler) };
}

describe('Meldungen aus Sim-Ereignissen', () => {
  it('abgelehnte Spielerbefehle warnen mit Grund und Lösung; Debug, Bewegung und schon gezeigte Gründe bleiben still', () => {
    const s = sitzung();
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    meldungenQuelle(s, contentItemCatalog(), (e) => out.push(e));
    s.bus.emit('commandRejected', { type: 'light.toggle', reason: 'noLight', tick: 1 });
    s.bus.emit('commandRejected', { type: 'sleep.start', reason: 'tooEarly', tick: 2 });
    s.bus.emit('commandRejected', { type: 'player.interact', reason: 'nothingToInteract', tick: 3 });
    s.bus.emit('commandRejected', { type: 'player.interact', reason: 'needsTool', tick: 4 });
    s.bus.emit('commandRejected', { type: 'death.kill', reason: 'dead', tick: 5 });
    s.bus.emit('commandRejected', { type: 'player.move', reason: 'noPlayer', tick: 6 });
    s.bus.emit('commandRejected', { type: 'inventory.move', reason: 'slotEmpty', tick: 7 });
    expect(out.map((e) => [e.art, e.daten.symbol, e.daten.text])).toEqual([
      ['warnung', 'ui_meldung_hinweis', 'ui.light.reject.noLight'],
      ['warnung', 'ui_meldung_hinweis', 'ui.sleep.reject.tooEarly'],
      ['warnung', 'ui_meldung_hinweis', 'ui.interaction.block.nothingToInteract'],
    ]);
    const i18n = createI18n('de', { strict: true });
    expect(meldungsText(i18n, 'de', (out[0] as MeldungEingabe<MeldungInhalt>).daten, 1)).toBe('Du trägst kein Licht – lege eine Fackel in die Nebenhand.');
  });

  it('Gründe der Taschen reicht ein anderer Bereich weiter; ohne Text bleibt es still', () => {
    expect(ablehnungsText('action.useBelt', 'slotEmpty')).toBe('ui.inventory.reject.slotEmpty');
    expect(ablehnungsText('action.drink', 'saltWater')).toBe('ui.action.reject.saltWater');
    expect(ablehnungsText('craft.start', 'notEnough')).toBe('ui.craft.reject.notEnough');
    expect(ablehnungsText('player.useItem', 'nothingToCure')).toBe('ui.tools.reject.nothingToCure');
    expect(ablehnungsText('light.place', 'busy')).toBeNull();
    expect(ablehnungsText('debug.unlock', 'unknownSkill')).toBeNull();
  });

  it('wer schläft, erfährt warum E, Benutzen, Licht und Handwerk nichts tun; im Tod spricht der Todesbildschirm', () => {
    expect(ablehnungsText('player.interact', 'asleep')).toBe('ui.interaction.block.asleep');
    expect(ablehnungsText('player.interact', 'dead')).toBeNull();
    expect(ablehnungsText('player.useItem', 'asleep')).toBe('ui.tools.reject.asleep');
    expect(ablehnungsText('light.toggle', 'asleep')).toBe('ui.light.reject.asleep');
    expect(ablehnungsText('light.place', 'dead')).toBe('ui.light.reject.dead');
    expect(ablehnungsText('craft.start', 'asleep')).toBe('ui.craft.reject.asleep');
    const i18n = createI18n('en', { strict: true });
    expect(i18n.t('ui.interaction.block.asleep')).toBe('You are asleep – a movement key wakes you.');
  });

  it('Aufsammeln mit Name, Rarität und Item-Icon; unbekannte Items bleiben still', () => {
    const s = sitzung();
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    meldungenQuelle(s, contentItemCatalog(), (e) => out.push(e));
    s.bus.emit('itemsAdded', { item: 'feuerstein', count: 3, tick: 1 });
    s.bus.emit('itemsAdded', { item: 'leuchtpilz', count: 1, tick: 2 });
    s.bus.emit('itemsAdded', { item: 'gibt_es_nicht', count: 1, tick: 3 });
    expect(out.map((e) => [e.art, e.schluessel, e.anzahl, e.daten.symbol, e.daten.raritaet])).toEqual([
      ['aufsammeln', 'feuerstein', 3, 'icon_feuerstein', 'gewoehnlich'],
      ['aufsammeln', 'leuchtpilz', 1, 'icon_leuchtpilz', 'ungewoehnlich'],
    ]);
    expect(out[0]?.daten.name?.de).toBe('Feuerstein');
  });

  it('volle Taschen und schlechtere Stufen warnen, die Rückkehr zu „normal“ nicht; trennen hört auf', () => {
    const s = sitzung();
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    const q = meldungenQuelle(s, contentItemCatalog(), (e) => out.push(e));
    s.bus.emit('inventoryFull', { item: 'stein', count: 2, tick: 1 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'satiety', stage: 'hungrig', previous: 'satt', tick: 2 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'satiety', stage: 'satt', previous: 'hungrig', tick: 3 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'temperature', stage: 'normal', previous: 'frierend', tick: 4 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'temperature', stage: 'erfrierend', previous: 'unterkuehlt', tick: 5 });
    expect(out.map((e) => [e.art, e.schluessel, e.daten.symbol])).toEqual([
      ['warnung', 'taschen_voll', 'ui_meldung_taschen_voll'],
      ['warnung', 'stufe_hungrig', 'zustand_hungrig'],
      ['warnung', 'stufe_erfrierend', 'zustand_erfrierend'],
    ]);
    q.trenne();
    s.bus.emit('itemsAdded', { item: 'holz', count: 1, tick: 6 });
    expect(out).toHaveLength(3);
  });
});

describe('Dienste der Weltanzeigen', () => {
  it('neue Warnungen und Entdeckungen klingen einmal, Aufsammeln, Doppel und Ablehnungen bleiben still', () => {
    const s = sitzung();
    const gespielt: string[] = [];
    const d = hudWeltdienste(Object.assign(s, { sampleFocus: () => false, sampleSky: (out: SkySample) => out, mapChunk: () => undefined, startBeach: () => false }), {
      uhr: () => 5,
      klang: { play: (cue) => gespielt.push(cue.id) > 0 },
    });
    s.bus.emit('itemsAdded', { item: 'holz', count: 2, tick: 1 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'thirst', stage: 'durstig', previous: 'getraenkt', tick: 2 });
    s.bus.emit('survivalStageChanged', { entity: 1, stat: 'thirst', stage: 'durstig', previous: 'getraenkt', tick: 3 });
    // A refusal shows, but its sound is the error sound of the audio kernel.
    s.bus.emit('commandRejected', { type: 'light.toggle', reason: 'noLight', tick: 4 });
    expect(gespielt).toEqual([MELDUNG_SFX]);
    expect(d.warteschlange.sichtbar.map((m) => m.schluessel)).toEqual(['holz', 'stufe_durstig', 'ablehnung_ui.light.reject.noLight']);
    d.meldungsQuelle?.trenne();
  });
});

describe('„Die Dunkelheit naht“', () => {
  const lage = (tag: number, minute: number, teil: Partial<MinimapLage> = {}): MinimapLage => ({ ...neueMinimapLage(), vorhanden: true, tag, minute, sonnenuntergang: 18, mondphase: 3, ...teil });
  const schwelle = 18 * 60 - DUNKELHEIT_VORLAUF_MIN;

  it('warnt genau einmal beim Überschreiten der Schwelle, am nächsten Tag wieder', () => {
    const w = new DunkelheitsWaechter();
    expect(w.pruefe(lage(1, schwelle - 2))).toBeNull();
    expect(w.pruefe(lage(1, schwelle - 1))).toBeNull();
    const e = w.pruefe(lage(1, schwelle));
    expect(e?.daten.text).toBe('ui.meldungen.dunkelheit');
    expect(e?.art).toBe('warnung');
    expect(w.pruefe(lage(1, schwelle + 1))).toBeNull();
    expect(w.pruefe(lage(2, schwelle - 1))).toBeNull();
    expect(w.pruefe(lage(2, schwelle + 3))).not.toBeNull();
  });

  it('still beim Einstieg nach der Schwelle (Laden, Zeitsprung), in Höhlen und ohne Figur', () => {
    const w = new DunkelheitsWaechter();
    expect(w.pruefe(lage(1, schwelle + 10))).toBeNull();
    expect(w.pruefe(lage(1, schwelle + 11))).toBeNull();
    const h = new DunkelheitsWaechter();
    h.pruefe(lage(1, schwelle - 1, { ebene: -1 }));
    expect(h.pruefe(lage(1, schwelle, { ebene: -1 }))).toBeNull();
    const o = new DunkelheitsWaechter();
    o.pruefe(lage(1, schwelle - 1, { vorhanden: false }));
    expect(o.pruefe(lage(1, schwelle, { vorhanden: false }))).toBeNull();
  });

  it('in einer Finstermond-Nacht mit Zusatz', () => {
    const w = new DunkelheitsWaechter();
    w.pruefe(lage(1, schwelle - 1, { mondphase: 0 }));
    expect(w.pruefe(lage(1, schwelle, { mondphase: 0 }))?.daten.text).toBe('ui.meldungen.dunkelheitFinstermond');
  });
});

describe('Meldungstexte', () => {
  it('„Feuerstein ×3“ in beiden Sprachen, Entdeckung mit Ortsname, jede Warnstufe mit Satz', () => {
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    const katalog = contentItemCatalog();
    const f = katalog.get('feuerstein');
    const inhalt: MeldungInhalt = { symbol: 'icon_feuerstein', text: 'ui.meldungen.aufsammeln', name: f.name, raritaet: f.raritaet };
    expect(meldungsText(de, 'de', inhalt, 3)).toBe('Feuerstein ×3');
    expect(meldungsText(en, 'en', inhalt, 3)).toBe(`${f.name.en} ×3`);
    const ort = entdeckung('biom_salzkueste', { de: 'Salzküste', en: 'Saltcoast' });
    expect(meldungsText(de, 'de', ort.daten, 1)).toBe('Entdeckt: Salzküste');
    for (const stufe of WARN_STUFEN) {
      expect(de.t(`ui.meldungen.warnung.${stufe}`)).toMatch(/[.!]$/);
      expect(en.t(`ui.meldungen.warnung.${stufe}`)).toMatch(/[.!]$/);
    }
  });
});

describe('Textgröße auf ganzen Schriftpixeln', () => {
  it('rundet auf ganze Bildschirmpixel je Schriftpixel, nie kleiner als die UI-Skalierung', () => {
    expect(textFaktor(1, 1)).toBe(1);
    expect(textFaktor(1, 1.9)).toBe(1);
    expect(textFaktor(1, 2)).toBe(2);
    expect(textFaktor(2, 1.4)).toBe(1);
    expect(textFaktor(2, 1.5)).toBe(1.5);
    expect(textFaktor(2, 2)).toBe(2);
    expect(textFaktor(3, 1.4)).toBe(4 / 3);
    expect(textFaktor(4, 1.25)).toBe(5 / 4);
    expect(textFaktor(4, 5)).toBe(2);
    expect(textFaktor(0, Number.NaN)).toBe(1);
    // Schriftpixel = 10 px × Faktor × Gerätepixel ist immer ganzzahlig.
    for (const d of [1, 2, 3, 4]) for (let t = 1; t <= 2; t += 0.1) expect(Number.isInteger(Math.round(textFaktor(d, t) * d * 1e6) / 1e6)).toBe(true);
  });
});
