/**
 * M4-07: the rules of the station screen (src/ui/screens/station/modell.ts) on the game's content – which recipes a
 * station lists (Werkbank II also what Werkbank I makes, a processing station its batches), where a bag stack goes
 * (input, fuel slot, nowhere; wood in the charcoal kiln goes into the input or – alternatively – onto the fuel, the
 * smelting furnace refuses wood as fuel), the status line and the texts of refusals.
 */
import { describe, expect, it } from 'vitest';
import { STATION_REJECT_REASONS } from '../../../src/game/stations/events';
import { createI18n } from '../../../src/i18n';
import { formatPercent } from '../../../src/i18n/format';
import { contentRezeptKontext } from '../../../src/ui/screens/handwerk/modell';
import { ablageAlternative, ablageVon, ablageZiel, ablehnungsText, brenntDarin, eingangsItems, stationsRezepte, stationsStatus } from '../../../src/ui/screens/station/modell';

const ctx = contentRezeptKontext();
const de = createI18n('de', { strict: true });
const item = (id: string) => ctx.book.catalog.get(id);

describe('Rezepte einer Station', () => {
  it('eine Handwerksstation listet die Handrezepte ihrer Linie bis zu ihrer Stufe', () => {
    const bench1 = stationsRezepte(ctx, 'werkbank').map((r) => r.id);
    const bench2 = stationsRezepte(ctx, 'werkbank_2').map((r) => r.id);
    expect(bench1).toContain('rezept_saegebock');
    expect(bench1).not.toContain('rezept_spinnrad');
    expect(bench2).toContain('rezept_spinnrad');
    for (const id of bench1) expect(bench2).toContain(id);
    expect(stationsRezepte(ctx, 'saegebock').map((r) => r.id)).toEqual([
      'rezept_brett',
      'rezept_balken',
      'rezept_dachschindel',
      'rezept_hocker_holz',
      'rezept_bank_holz',
      'rezept_kiste_deko',
      'rezept_holzstapel',
    ]);
  });

  it('eine Verarbeitungsstation listet ihre Chargen, und ihr Eingang nimmt deren Zutaten', () => {
    expect(stationsRezepte(ctx, 'lehmofen').map((r) => r.id)).toEqual(['rezept_ziegel', 'rezept_keramik_topf', 'rezept_glas', 'rezept_vase_keramik']);
    expect([...eingangsItems(ctx, 'lehmofen')].sort()).toEqual(['lehm', 'sand', 'ziegel_roh']);
    expect([...eingangsItems(ctx, 'koehlermeiler')].sort()).toEqual(['holz', 'treibholz']);
  });
});

describe('Wohin ein Stapel geht', () => {
  it('Zutaten in den Eingang, Brennstoff in den Brennstoffplatz, Werkzeuge nirgends', () => {
    const oven = ablageVon(ctx, 'lehmofen');
    expect(ablageZiel(oven, item('lehm'))).toBe('eingang');
    expect(ablageZiel(oven, item('holz'))).toBe('brennstoff');
    expect(ablageZiel(oven, item('zweig'))).toBe('brennstoff');
    expect(ablageZiel(oven, item('stein'))).toBeNull();
    expect(ablageZiel(oven, item('steinaxt'))).toBeNull();
    expect(ablageAlternative(oven, item('lehm'))).toBeNull();
  });

  it('Holz im Köhlermeiler: Eingang, als Alternative Brennstoff', () => {
    const kiln = ablageVon(ctx, 'koehlermeiler');
    expect(ablageZiel(kiln, item('holz'))).toBe('eingang');
    expect(ablageAlternative(kiln, item('holz'))).toBe('brennstoff');
  });

  it('der Schmelzofen nimmt erst Holzkohle als Brennstoff; das Trockengestell hat keinen', () => {
    const furnace = ablageVon(ctx, 'schmelzofen');
    expect(brenntDarin(furnace, item('holz'))).toBe(false);
    expect(ablageZiel(furnace, item('holz'))).toBeNull();
    expect(ablageZiel(furnace, item('holzkohle'))).toBe('brennstoff');
    expect(ablageZiel(furnace, item('kupfererz'))).toBe('eingang');
    const rack = ablageVon(ctx, 'trockengestell');
    expect(rack.brennstoff).toBeNull();
    expect(ablageZiel(rack, item('holz'))).toBeNull();
    expect(ablageZiel(rack, item('fasern'))).toBe('eingang');
  });
});

describe('Statuszeile und Ablehnungen', () => {
  it('nennt die laufende Charge mit Fortschritt, den Grund des Stillstands oder die Bitte um Zutaten', () => {
    const voll = ['lehm', null];
    const leer = [null, null];
    expect(stationsStatus(de, ctx, 'Lehmofen', { rezept: 'rezept_ziegel', fortschritt: 0.42, laeuft: true, halt: null, eingang: voll })).toEqual({ text: `Arbeitet: Ziegel – ${formatPercent('de', 0.42)}`, ton: 'laeuft' });
    expect(stationsStatus(de, ctx, 'Lehmofen', { rezept: 'rezept_ziegel', fortschritt: 0.5, laeuft: false, halt: 'brennstoff', eingang: voll })).toEqual({
      text: de.t('ui.station.stopped.brennstoff', { name: 'Lehmofen' }),
      ton: 'halt',
    });
    // Something lies in the input that no batch uses up: a stop; an empty idle oven asks for a load.
    expect(stationsStatus(de, ctx, 'Lehmofen', { rezept: null, fortschritt: 0, laeuft: false, halt: 'eingang', eingang: voll }).ton).toBe('halt');
    expect(stationsStatus(de, ctx, 'Lehmofen', { rezept: null, fortschritt: 0, laeuft: false, halt: 'eingang', eingang: leer })).toEqual({ text: de.t('ui.station.bereit'), ton: 'still' });
    expect(stationsStatus(de, ctx, 'Lehmofen', { rezept: null, fortschritt: 0, laeuft: false, halt: null, eingang: leer })).toEqual({ text: de.t('ui.station.bereit'), ton: 'still' });
  });

  it('hat für jeden Stationsgrund einen Text und nimmt sonst den der Taschen', () => {
    for (const r of STATION_REJECT_REASONS) expect(ablehnungsText(de, r)).toBe(de.t(`ui.station.reject.${r}`));
    expect(ablehnungsText(de, 'bagsFull')).toBe(de.t('ui.station.reject.bagsFull'));
    expect(ablehnungsText(de, 'noSpace')).toBe(de.t('ui.inventory.reject.noSpace'));
  });
});
