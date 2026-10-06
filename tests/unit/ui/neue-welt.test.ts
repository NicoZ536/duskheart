/**
 * M7-51 Neue Welt und Welt im Pausemenü (MASTERPROMPT §29; docs/SPIEL.md §25): das Formular (Name, Seed auch als
 * geteiltes „DH-<Seed>-<Größe>“), jede Reglerzeile mit Werten, Schritten und Texten in DE und EN, die Zusammenfassung der
 * Voreinstellung (Faktoren und Todesstrafe der §29-Tabelle), die ersten Befehle einer Welt – in einer Simulation
 * angewandt ergeben sie genau die gewählten Einstellungen, auch unter Unbarmherzig – und die Welt-Ansicht des Pausemenüs
 * (Befehle je Schritt, Sperre unter Unbarmherzig, keine Unbarmherzig-Wahl im laufenden Spiel).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DIFFICULTIES } from '../../../src/content/balance/death';
import { parseGameCommand } from '../../../src/game/commands';
import { createWorldSettingsSample, sampleWorldSettings } from '../../../src/game/samples/weltEinstellungen';
import { createSimulation } from '../../../src/game/setup';
import { createI18n } from '../../../src/i18n';
import {
  entwurfAus,
  NEUE_WELT_ZEILEN,
  neueWeltStandard,
  pruefen,
  schritt,
  seedAus,
  seedEinfuegen,
  startBefehle,
  VOREINSTELLUNG,
  voreinstellung,
  WORLD_NAME_MAX,
  type NeueWeltForm,
} from '../../../src/ui/screens/neue-welt/modell';
import { faktorenText, faktorText, flutText, todText, zeilenWert } from '../../../src/ui/screens/neue-welt/texte';
import { formAusProbe, LAUFENDE_STUFEN, WELT_ZEILEN, weltBefehl, weltSchritt, weltZeileGesperrt } from '../../../src/ui/screens/pause/welt';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function form(over: Partial<NeueWeltForm> = {}): NeueWeltForm {
  return { ...neueWeltStandard(4711, 'Glutküste'), ...over };
}

describe('Neue Welt: Formular', () => {
  it('Standard: Normal, Standardgröße und -tag, Regler auf Voreinstellung; Name und Seed werden geprüft', () => {
    const f = form();
    expect(f).toMatchObject({ schwierigkeit: 'normal', groesse: BALANCE.world.defaultSize, tageslaenge: BALANCE.time.defaultDayLengthMinutes, hungerDurst: null, gegnerschaden: null, schattenflut: 'voreinstellung', friedlich: false });
    expect(pruefen(f)).toEqual({});
    expect(pruefen({ ...f, name: '  ' })).toEqual({ name: 'ui.newWorld.fehler.name' });
    expect(pruefen({ ...f, name: 'x'.repeat(WORLD_NAME_MAX + 1) })).toEqual({ name: 'ui.newWorld.fehler.nameLang' });
    expect(pruefen({ ...f, seedText: 'abc' })).toEqual({ seed: 'ui.newWorld.fehler.seed' });
    expect(pruefen({ ...f, seedText: '4294967296' })).toEqual({ seed: 'ui.newWorld.fehler.seed' });
    expect(seedAus({ seedText: '4294967295' })).toBe(4294967295);
  });

  it('ein eingefügter geteilter Seed setzt Seed und Größe; eine Zahl nur den Seed', () => {
    const f = form({ groesse: 'large' });
    expect(seedEinfuegen(f, 'DH-918273-small')).toMatchObject({ seedText: '918273', groesse: 'small' });
    expect(seedEinfuegen(f, 'dh-5-medium')).toMatchObject({ seedText: '5', groesse: 'medium' });
    expect(seedEinfuegen(f, '123')).toMatchObject({ seedText: '123', groesse: 'large' });
    expect(seedEinfuegen(f, 'DH-1-riesig')).toMatchObject({ seedText: 'DH-1-riesig', groesse: 'large' });
  });

  it('jede Zeile: Name in DE und EN, jeder Wert ein Text, Schritte bleiben in der Liste und ändern nur ihr Feld', () => {
    expect(NEUE_WELT_ZEILEN.map((r) => r.id)).toEqual(['groesse', 'schwierigkeit', 'friedlich', 'tageslaenge', 'jahreszeitenLaenge', 'ressourcendichte', 'hungerDurst', 'gegnerschaden', 'schattenflut', 'logistikRealismus']);
    const f = form();
    const preset = voreinstellung(f);
    for (const row of NEUE_WELT_ZEILEN) {
      for (const i18n of [de, en]) {
        expect(i18n.t(row.labelKey).length, row.id).toBeGreaterThan(0);
        for (const v of row.values) expect(zeilenWert(i18n, row, v, preset).length, `${row.id}=${String(v)}`).toBeGreaterThan(0);
      }
      const up = schritt(row, f, 1);
      const changed = Object.keys(f).filter((k) => f[k as keyof NeueWeltForm] !== up[k as keyof NeueWeltForm]);
      expect(changed.length, row.id).toBeLessThanOrEqual(1);
      expect(row.values, row.id).toContain(row.get(up));
    }
    // Ranges stop at their ends, choices wrap.
    const flut = NEUE_WELT_ZEILEN.find((r) => r.id === 'schattenflut');
    const friedlich = NEUE_WELT_ZEILEN.find((r) => r.id === 'friedlich');
    if (flut === undefined || friedlich === undefined) throw new Error('rows');
    expect(schritt(flut, f, -1).schattenflut).toBe(VOREINSTELLUNG);
    expect(schritt(flut, f, 1).schattenflut).toBe('aus');
    expect(schritt(flut, { ...f, schattenflut: BALANCE.difficulty.shadowFloodRange.max }, 1).schattenflut).toBe(BALANCE.difficulty.shadowFloodRange.max);
    expect(schritt(friedlich, schritt(friedlich, f, 1), 1).friedlich).toBe(false);
  });

  it('die Zusammenfassung der Voreinstellung folgt der §29-Tabelle; Regler überschreiben sie', () => {
    expect(faktorenText(de, voreinstellung(form({ schwierigkeit: 'entspannt' })))).toBe('Hunger/Durst ×0,6\u00a0· Gegnerschaden ×0,6\u00a0· Schattenflut Aus');
    expect(faktorenText(de, voreinstellung(form()))).toBe('Hunger/Durst ×1\u00a0· Gegnerschaden ×1\u00a0· Schattenflut jede 7. Nacht');
    expect(faktorenText(en, voreinstellung(form({ schwierigkeit: 'unbarmherzig' })))).toBe('Hunger/thirst ×1.25\u00a0· enemy damage ×1.5\u00a0· shadow flood every 5 nights');
    expect(voreinstellung(form({ schwierigkeit: 'hart', gegnerschaden: 0.5, schattenflut: 'aus' }))).toMatchObject({ hungerDurst: 1.25, gegnerschaden: 0.5, schattenflut: null });
    expect(todText(de, voreinstellung(form({ schwierigkeit: 'entspannt' })).tod)).toBe('Inventar bleibt');
    // The percent sign follows a no-break space (de-DE).
    expect(todText(de, voreinstellung(form()).tod)).toBe('Inventar im Grab\u00a0· –25\u00a0% Fertigkeitsfortschritt');
    expect(todText(de, voreinstellung(form({ schwierigkeit: 'unbarmherzig' })).tod)).toBe('Alles im Grab\u00a0· –25\u00a0% Fertigkeitsfortschritt\u00a0· Permadeath: Die Welt endet mit dem Tod');
    expect(faktorText(de, 1.25)).toBe('×1,25');
    expect(flutText(en, null)).toBe('Off');
  });
});

describe('Neue Welt: erste Befehle', () => {
  it('eine unveränderte Welt schickt keine; jede Abweichung genau einmal, die Voreinstellung zuletzt', () => {
    expect(startBefehle(form())).toEqual([]);
    const cmds = startBefehle(form({ friedlich: true, hungerDurst: 1.5, gegnerschaden: 0.25, schattenflut: 'aus', logistikRealismus: true, jahreszeitenLaenge: 10, schwierigkeit: 'unbarmherzig' }));
    expect(cmds).toEqual([
      { type: 'world.setSettings', friedlich: true, hungerDurst: 1.5, gegnerschaden: 0.25, schattenflut: null, logistikRealismus: true, jahreszeitenLaenge: 10 },
      { type: 'world.setDifficulty', schwierigkeit: 'unbarmherzig' },
    ]);
    for (const c of cmds) expect(() => parseGameCommand(c)).not.toThrow();
    const e = entwurfAus(form({ seedText: 'DH-9-large', ressourcendichte: 'gering', name: '  Insel  ' }), 'w');
    expect(e).toMatchObject({ worldId: 'w', name: 'Insel', config: { seed: 9, resourceDensity: 'gering' } });
    expect(() => entwurfAus(form({ seedText: 'x' }), 'w')).toThrow(/seed/);
  });

  it('in der Simulation angewandt ergeben sie die gewählte Welt – auch Unbarmherzig, das danach sperrt', () => {
    const chosen = form({ friedlich: true, hungerDurst: 1.5, schattenflut: 6, logistikRealismus: true, jahreszeitenLaenge: 10, schwierigkeit: 'unbarmherzig' });
    const sim = createSimulation({ seed: 3, worldSize: 'small' });
    for (const c of startBefehle(chosen)) sim.commands.push(parseGameCommand(c));
    sim.step();
    const out = createWorldSettingsSample();
    expect(sampleWorldSettings(sim, out)).toBe(true);
    expect(out).toMatchObject({ schwierigkeit: 'unbarmherzig', gesperrt: true, friedlich: true, hungerDurst: 1.5, gegnerschaden: null, schattenflut: 6, logistikRealismus: true, jahreszeitenLaenge: 10, wirkGegnerschaden: 1.5 });
    // The pause menu's world view reads the same values back.
    expect(formAusProbe(out)).toMatchObject({ schwierigkeit: 'unbarmherzig', friedlich: true, hungerDurst: 1.5, schattenflut: 6, logistikRealismus: true, jahreszeitenLaenge: 10 });
  });
});

describe('Pausemenü: Welt', () => {
  const base = formAusProbe({ ...createWorldSettingsSample(), jahreszeitenLaenge: 7, seed: 1, groesse: 'small', tageslaenge: 24 });

  it('ein laufendes Spiel bietet Unbarmherzig nicht an; unter Unbarmherzig ist alles bis auf die Jahreszeitenlänge gesperrt', () => {
    expect(LAUFENDE_STUFEN).toEqual(DIFFICULTIES.filter((d) => d !== 'unbarmherzig'));
    expect(WELT_ZEILEN.find((r) => r.id === 'schwierigkeit')?.values).toEqual(LAUFENDE_STUFEN);
    expect(weltSchritt({ ...base, schwierigkeit: 'hart' }, 'schwierigkeit', 1)).toEqual({ form: { ...base, schwierigkeit: 'hart' }, befehl: null });
    for (const row of WELT_ZEILEN) expect(weltZeileGesperrt('unbarmherzig', row.id), row.id).toBe(row.id !== 'jahreszeitenLaenge');
    for (const d of LAUFENDE_STUFEN) for (const row of WELT_ZEILEN) expect(weltZeileGesperrt(d, row.id)).toBe(false);
    const locked = { ...base, schwierigkeit: 'unbarmherzig' as const };
    expect(weltSchritt(locked, 'friedlich', 1).befehl).toBeNull();
    expect(weltSchritt(locked, 'jahreszeitenLaenge', 1).befehl).toEqual({ type: 'world.setSettings', jahreszeitenLaenge: 8 });
  });

  it('jeder Schritt schickt genau seinen gültigen Befehl', () => {
    expect(weltSchritt(base, 'schwierigkeit', -1).befehl).toEqual({ type: 'world.setDifficulty', schwierigkeit: 'entspannt' });
    expect(weltSchritt(base, 'friedlich', 1).befehl).toEqual({ type: 'world.setSettings', friedlich: true });
    expect(weltSchritt(base, 'hungerDurst', 1).befehl).toEqual({ type: 'world.setSettings', hungerDurst: BALANCE.difficulty.hungerThirstRange.min });
    expect(weltSchritt(base, 'gegnerschaden', 1).befehl).toEqual({ type: 'world.setSettings', gegnerschaden: BALANCE.difficulty.enemyDamageRange.min });
    expect(weltSchritt(base, 'schattenflut', 1).befehl).toEqual({ type: 'world.setSettings', schattenflut: null });
    expect(weltSchritt({ ...base, schattenflut: 'aus' }, 'schattenflut', 1).befehl).toEqual({ type: 'world.setSettings', schattenflut: BALANCE.difficulty.shadowFloodRange.min });
    expect(weltSchritt(base, 'logistikRealismus', 1).befehl).toEqual({ type: 'world.setSettings', logistikRealismus: true });
    expect(weltSchritt(base, 'fehlt', 1).befehl).toBeNull();
    expect(weltBefehl('groesse', base, { ...base, groesse: 'large' })).toBeNull();
    for (const row of WELT_ZEILEN) {
      const b = weltSchritt(base, row.id, 1).befehl ?? weltSchritt(base, row.id, -1).befehl;
      expect(b, row.id).not.toBeNull();
      expect(() => parseGameCommand(b), row.id).not.toThrow();
    }
  });
});
