/**
 * M3-29 Meldungsquelle (src/ui/hud/meldungen/quelle.ts, inhalte.ts, textgroesse.ts, Meldungen.tsx):
 * Sim-Ereignisse werden zu Meldungen (Aufsammeln mit Name und Rarität, Taschen voll, Warnstufen mit
 * Zustands-Icon, Rückkehr zu „normal“ still), „Die Dunkelheit naht“ genau beim Überschreiten der
 * Abendschwelle an der Oberfläche (Finstermond-Zusatz), abgelehnte Spielerbefehle als Warnung mit Grund und
 * Lösung (Debug-Befehle, fortlaufende Eingaben und ein schon angezeigter Interaktionsgrund bleiben still),
 * Texte in beiden Sprachen und die Textgröße auf ganzen Schriftpixeln. Ab M4: Stationen, Reparatur, Bauen, Kisten und
 * Herdfeuer mit ihren Gründen – außer den Befehlen der Bildschirme, die ihre Gründe selbst zeigen; neue Rezepte,
 * abgebrochene Aufträge, aufgewertete und stehende Stationen (stumm – ihre Ereignisse klingen im Audiokern).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/engine/events';
import { CONTENT } from '../../../src/content/index';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import type { SimEventMap } from '../../../src/game/sim';
import { createI18n } from '../../../src/i18n';
import type { SkySample } from '../../../src/game/session';
import { ablehnungsText, EIGENE_ZEILE } from '../../../src/ui/hud/meldungen/ablehnung';
import { GAME_COMMAND_TYPES, type GameCommandType } from '../../../src/game/commands';
import { STATION_REJECT_REASONS } from '../../../src/game/stations/events';
import { REPAIR_REJECT_REASONS } from '../../../src/game/repair/events';
import { BUILD_REJECT_REASONS } from '../../../src/game/building/events';
import { STORAGE_REJECT_REASONS } from '../../../src/game/storage/events';
import { HEARTH_REJECT_REASONS } from '../../../src/game/hearth/events';
import { auftragOhneStation, entdeckung, MELDUNG_SFX, WARN_STUFEN, type MeldungInhalt } from '../../../src/ui/hud/meldungen/inhalte';
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

  it('M4: jeder Grund von Stationen, Reparatur, Bauen, Kisten und Herdfeuer hat seinen Text – außer auf Bildschirmen mit eigener Zeile', () => {
    const areas: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      ['station.', 'ui.station.reject', STATION_REJECT_REASONS],
      ['repair.', 'ui.repair.reject', REPAIR_REJECT_REASONS],
      ['build.', 'ui.build.reject', BUILD_REJECT_REASONS],
      ['storage.', 'ui.storage.reject', STORAGE_REJECT_REASONS],
      ['hearth.', 'ui.hearth.reject', HEARTH_REJECT_REASONS],
    ];
    for (const [prefix, area, list] of areas) {
      const types = GAME_COMMAND_TYPES.filter((t) => t.startsWith(prefix));
      expect(types.length, prefix).toBeGreaterThan(0);
      for (const type of types) {
        for (const reason of list) {
          const text = ablehnungsText(type, reason);
          if (EIGENE_ZEILE.has(type)) expect(text, `${type} ${reason}`).toBeNull();
          else expect(text, `${type} ${reason}`).toBe(`${area}.${reason}`);
        }
      }
    }
    // Triggered by E or a key, outside any screen: E on a station, a door, a chest, the hearth; the quick stash.
    expect(ablehnungsText('station.use', 'outOfReach')).toBe('ui.station.reject.outOfReach');
    expect(ablehnungsText('build.door', 'doorwayBlocked')).toBe('ui.build.reject.doorwayBlocked');
    expect(ablehnungsText('build.complete', 'noMaterial')).toBe('ui.build.reject.noMaterial');
    expect(ablehnungsText('storage.quickStash', 'nothingToStore')).toBe('ui.storage.reject.nothingToStore');
    expect(ablehnungsText('hearth.ignite', 'noFuel')).toBe('ui.hearth.reject.noFuel');
    // Their screens show these themselves (build mode, station screen incl. its repair tab, chest and hearth screens); the fire's ignition is a debug command.
    const own: readonly GameCommandType[] = [
      'build.place',
      'build.blueprint',
      'build.remove',
      // The build mode's tools say why in its status line (upgrade, area repair).
      'build.upgrade',
      'build.repair',
      'station.place',
      'station.remove',
      'station.put',
      'station.take',
      'station.takeAll',
      'storage.put',
      'storage.take',
      'storage.sort',
      'hearth.fuel',
      'hearth.take',
      'hearth.douse',
      'hearth.core',
      'hearth.uncore',
      'repair.item',
    ];
    for (const type of own) expect(EIGENE_ZEILE.has(type), type).toBe(true);
    expect(ablehnungsText('fire.ignite', 'nothingToBurn')).toBeNull();
    const i18n = createI18n('de', { strict: true });
    expect(i18n.t('ui.station.reject.standingThere')).toBe('Du stehst selbst dort – tritt zur Seite.');
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

describe('Meldungen aus Handwerk und Stationen (M4)', () => {
  it('neues Rezept, Abbruch, Aufwertung und stehende Station melden sich mit Symbol, Namen und Lösung – stumm', () => {
    const s = sitzung();
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    meldungenQuelle(s, contentItemCatalog(), (e) => out.push(e));
    s.bus.emit('recipeDiscovered', { recipe: 'rezept_steinaxt', tick: 1 });
    s.bus.emit('recipeDiscovered', { recipe: 'rezept_holzeimer_wasser', tick: 1 });
    s.bus.emit('recipeDiscovered', { recipe: 'rezept_gibt_es_nicht', tick: 1 });
    s.bus.emit('craftCancelled', { recipe: 'rezept_faserseil', pieces: 2, reason: 'abgebrochen', tick: 2 });
    // Cancelled by death: the death screen speaks.
    s.bus.emit('craftCancelled', { recipe: 'rezept_faserseil', pieces: 1, reason: 'tod', tick: 3 });
    s.bus.emit('stationUpgraded', { id: 4, from: 'werkbank', to: 'werkbank_2', layer: 0, x: 0, y: 0, tick: 4 });
    s.bus.emit('stationStopped', { id: 5, station: 'lehmofen', reason: 'brennstoff', layer: 0, x: 0, y: 0, tick: 5 });
    s.bus.emit('stationStopped', { id: 5, station: 'lehmofen', reason: 'ausgang', layer: 0, x: 0, y: 0, tick: 6 });
    s.bus.emit('stationStopped', { id: 6, station: 'koehlermeiler', reason: 'eingang', layer: 0, x: 0, y: 0, tick: 7 });
    expect(out.map((e) => [e.art, e.schluessel, e.daten.symbol, e.daten.text, e.daten.stumm])).toEqual([
      ['entdeckung', 'rezept_steinaxt', 'icon_steinaxt', 'ui.craft.discovered', true],
      ['entdeckung', 'rezept_holzeimer_wasser', 'icon_holzeimer_wasser', 'ui.craft.discovered', true],
      ['warnung', 'abgebrochen_rezept_faserseil', 'icon_faserseil', 'ui.craft.cancelled', true],
      ['entdeckung', 'aufgewertet_4_werkbank_2', 'icon_werkbank_2', 'ui.craft.upgraded', true],
      ['warnung', 'steht_5_brennstoff', 'icon_lehmofen', 'ui.station.stopped.brennstoff', true],
      ['warnung', 'steht_5_ausgang', 'icon_lehmofen', 'ui.station.stopped.ausgang', true],
      ['warnung', 'steht_6_eingang', 'icon_koehlermeiler', 'ui.station.stopped.eingang', true],
    ]);
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    const text = (i: number, i18n = de, lang: 'de' | 'en' = 'de'): string => meldungsText(i18n, lang, (out[i] as MeldungEingabe<MeldungInhalt>).daten, 1);
    expect(text(0)).toBe('Neues Rezept: Steinaxt');
    // A recipe with a name of its own is named by it ("Eimer füllen"), not by its product.
    const eimer = CONTENT.collection('recipes').get('rezept_holzeimer_wasser').name;
    expect(text(1)).toBe(`Neues Rezept: ${eimer?.de ?? contentItemCatalog().get('holzeimer_wasser').name.de}`);
    expect(text(2)).toBe('Abgebrochen – die Zutaten sind zurück.');
    expect(text(3)).toBe(`Aufgewertet: ${contentItemCatalog().get('werkbank_2').name.de}`);
    expect(text(4)).toBe('Lehmofen: der Brennstoff ist aus – leg nach.');
    expect(text(4, en, 'en')).toBe(`${contentItemCatalog().get('lehmofen').name.en}: out of fuel – add more.`);
  });

  it('fehlt die Station einer Aufwertung, meldet der Abbruch sie beim Namen: „Abgebrochen – Werkbank fehlt …“ (DE/EN), stumm', () => {
    const s = sitzung();
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    meldungenQuelle(s, contentItemCatalog(), (e) => out.push(e));
    // Werkbank I → II: the workbench was taken down while the piece was worked; the ingredients went back.
    s.bus.emit('craftCancelled', { recipe: 'rezept_werkbank_2', pieces: 1, reason: 'stationWeg', tick: 1 });
    // The same order cancelled by the player keeps its own message; an unknown recipe says nothing.
    s.bus.emit('craftCancelled', { recipe: 'rezept_werkbank_2', pieces: 1, reason: 'abgebrochen', tick: 2 });
    s.bus.emit('craftCancelled', { recipe: 'rezept_gibt_es_nicht', pieces: 1, reason: 'stationWeg', tick: 3 });
    expect(out.map((e) => [e.art, e.schluessel, e.daten.symbol, e.daten.text, e.daten.stumm])).toEqual([
      ['warnung', 'abgebrochen_rezept_werkbank_2_stationWeg', 'icon_werkbank_2', 'ui.craft.cancelledStationName', true],
      ['warnung', 'abgebrochen_rezept_werkbank_2', 'icon_werkbank_2', 'ui.craft.cancelled', true],
    ]);
    const werkbank = contentItemCatalog().get('werkbank').name;
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    const daten = (out[0] as MeldungEingabe<MeldungInhalt>).daten;
    expect(meldungsText(de, 'de', daten, 1)).toBe(`Abgebrochen – ${werkbank.de} fehlt, die Zutaten sind zurück.`);
    expect(meldungsText(en, 'en', daten, 1)).toBe(`Cancelled – ${werkbank.en} missing, the ingredients are back.`);
    // Without a known station the sentence names none.
    expect(meldungsText(de, 'de', auftragOhneStation('rezept_werkbank_2', 'werkbank_2', null).daten, 1)).toBe('Abgebrochen – die Station fehlt, die Zutaten sind zurück.');
    expect(meldungsText(en, 'en', auftragOhneStation('rezept_werkbank_2', 'werkbank_2', null).daten, 1)).toBe('Cancelled – the station is missing, the ingredients are back.');
  });

  it('die neuen Meldungen klingen nicht doppelt: ihre Ereignisse haben im Audiokern schon ihren Klang', () => {
    const s = sitzung();
    const gespielt: string[] = [];
    const d = hudWeltdienste(Object.assign(s, { sampleFocus: () => false, sampleSky: (out: SkySample) => out, mapChunk: () => undefined, startBeach: () => false }), {
      uhr: () => 5,
      klang: { play: (cue) => gespielt.push(cue.id) > 0 },
    });
    s.bus.emit('recipeDiscovered', { recipe: 'rezept_faserseil', tick: 1 });
    s.bus.emit('stationStopped', { id: 1, station: 'lehmofen', reason: 'brennstoff', layer: 0, x: 0, y: 0, tick: 2 });
    expect(d.warteschlange.sichtbar.map((m) => m.schluessel)).toEqual(['rezept_faserseil', 'steht_1_brennstoff']);
    expect(gespielt).toEqual([]);
    d.meldungsQuelle?.trenne();
  });

  it('ein abgelehntes Anheften nennt den Grund aus den Handwerkstexten', () => {
    expect(ablehnungsText('craft.pin', 'recipeHidden')).toBe('ui.craft.reject.recipeHidden');
    expect(ablehnungsText('craft.pin', 'unknownRecipe')).toBe('ui.craft.reject.unknownRecipe');
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
