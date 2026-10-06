/**
 * M7-50 Boot-Ablauf und Hauptmenü (docs/SPIEL.md §25): der Startauftrag zwischen Menü und Spiel (Sitzungsspeicher,
 * kaputte Aufträge blockieren nie), die Boot-Entscheidung je URL und Auftrag, der Ablauf „Neue Welt“, der Bildschirmstapel
 * des Menüs (Esc schließt bis zum Hauptmenü, gehaltene Richtungen wiederholen), die Zeilen der Weltauswahl und die
 * Tipps des Ladebildschirms.
 */
import { describe, expect, it } from 'vitest';
import { TIPS } from '../../../src/content/tipps';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { createI18n } from '../../../src/i18n';
import { entwurfBefehle, naechsterSchritt, NEUE_WELT_ABLAUF, vorherigerSchritt } from '../../../src/ui/menu/ablauf';
import { MAIN_MENU, MenuController } from '../../../src/ui/menu/controller';
import { MENU_SCREENS, startAuftrag } from '../../../src/ui/menu/MenuApp';
import {
  bootArt,
  clearStartRequest,
  newWorldId,
  readStartRequest,
  START_REQUEST_KEY,
  writeStartRequest,
  type RequestStorage,
  type StartRequest,
} from '../../../src/ui/menu/start';
import { FocusManager } from '../../../src/ui/focus/manager';
import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS } from '../../../src/ui/focus/screens';
import { fuellBreite, GENERIERUNG_ANTEIL, ladeAnteil, tippsDerArt, tippWahl } from '../../../src/ui/screens/laden/modell';
import { auswahlNach, fehlerText, spielSekunden, statusFehler, statusText, weltSeed, weltZeile } from '../../../src/ui/screens/weltauswahl/modell';
import type { WeltEintrag } from '../../../src/ui/menu/hooks';
import { entwurfAus, neueWeltStandard } from '../../../src/ui/screens/neue-welt/modell';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

class MapStorage implements RequestStorage {
  readonly data = new Map<string, string>();
  failWrite = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const NEW: StartRequest = {
  kind: 'new',
  worldId: 'welt-abc-7',
  name: 'Glutküste',
  config: { seed: 7, worldSize: 'small', dayLengthMinutes: 24, resourceDensity: 'reich' },
  commands: [{ type: 'world.setDifficulty', schwierigkeit: 'hart' }],
};

describe('Startauftrag', () => {
  it('wird geschrieben, gelesen und gelöscht; ein kaputter oder fremder Inhalt gilt als keiner', () => {
    const s = new MapStorage();
    expect(readStartRequest(s)).toBeNull();
    expect(writeStartRequest(s, NEW)).toBe(true);
    expect(readStartRequest(s)).toEqual(NEW);
    clearStartRequest(s);
    expect(readStartRequest(s)).toBeNull();
    for (const bad of ['{', '{"kind":"new"}', JSON.stringify({ ...NEW, config: { ...NEW.config, worldSize: 'riesig' } }), JSON.stringify({ kind: 'load', worldId: '' }), JSON.stringify({ ...NEW, extra: 1 })]) {
      s.data.set(START_REQUEST_KEY, bad);
      expect(readStartRequest(s), bad).toBeNull();
    }
    expect(readStartRequest(null)).toBeNull();
    expect(writeStartRequest(null, NEW)).toBe(false);
    s.failWrite = true;
    expect(writeStartRequest(s, { kind: 'load', worldId: 'w' })).toBe(false);
    expect(() => clearStartRequest(null)).not.toThrow();
  });

  it('eine neue Welt bekommt eine Id aus Zeit und Seed', () => {
    expect(newWorldId(36 ** 3, 42)).toBe('welt-1000-42');
    expect(newWorldId(-5, 0)).toBe('welt-0-0');
  });
});

describe('Boot-Entscheidung', () => {
  const menuScenario = (n: string): boolean => n === 'ui-hauptmenue';
  it('ohne Debug: Menü, oder die Welt des Auftrags', () => {
    expect(bootArt('http://h/', false, null, menuScenario)).toEqual({ art: 'menue' });
    expect(bootArt('http://h/', false, NEW, menuScenario)).toEqual({ art: 'neu', request: NEW });
    expect(bootArt('http://h/', false, { kind: 'load', worldId: 'w1' }, menuScenario)).toEqual({ art: 'laden', worldId: 'w1', debug: false });
    // Without debug mode the debug parameters mean nothing.
    expect(bootArt('http://h/?laden=w9&scenario=ui-hauptmenue', false, null, menuScenario)).toEqual({ art: 'menue' });
  });

  it('mit Debug: direkt wie bisher, außer menue=1, Menü-Szenarien, laden= und Aufträge', () => {
    expect(bootArt('http://h/?debug=1', true, null, menuScenario)).toEqual({ art: 'direkt' });
    expect(bootArt('http://h/?debug=1&seed=5&spieler=1', true, null, menuScenario)).toEqual({ art: 'direkt' });
    expect(bootArt('http://h/?debug=1&menue=1', true, null, menuScenario)).toEqual({ art: 'menue' });
    expect(bootArt('http://h/?debug=1&scenario=ui-hauptmenue', true, NEW, menuScenario)).toEqual({ art: 'menue' });
    expect(bootArt('http://h/?debug=1&scenario=nacht-fackel', true, NEW, menuScenario)).toEqual({ art: 'direkt' });
    expect(bootArt('http://h/?debug=1&laden=w9', true, NEW, menuScenario)).toEqual({ art: 'laden', worldId: 'w9', debug: true });
    expect(bootArt('http://h/?debug=1&laden=', true, null, menuScenario)).toEqual({ art: 'direkt' });
    expect(bootArt('http://h/?debug=1&menue=1', true, NEW, menuScenario)).toEqual({ art: 'neu', request: NEW });
    expect(bootArt('http://h/?debug=1', true, { kind: 'load', worldId: 'w2' }, menuScenario)).toEqual({ art: 'laden', worldId: 'w2', debug: false });
  });
});

describe('Ablauf „Neue Welt“', () => {
  it('beginnt mit der Welt; der Auftrag trägt Konfiguration, Name und die Befehle in Ablauf-Reihenfolge', () => {
    expect(NEUE_WELT_ABLAUF[0]).toEqual({ id: 'welt', screen: MENU_SCREENS.neueWelt });
    expect(vorherigerSchritt('welt')).toBeNull();
    expect(naechsterSchritt('fehlt')).toBeNull();
    expect(vorherigerSchritt('fehlt')).toBeNull();
    const form = { ...neueWeltStandard(99, 'Insel'), schwierigkeit: 'hart' as const, friedlich: true };
    const entwurf = entwurfAus(form, 'welt-x-99');
    expect(entwurfBefehle(entwurf)).toEqual([
      { type: 'world.setSettings', friedlich: true },
      { type: 'world.setDifficulty', schwierigkeit: 'hart' },
    ]);
    expect(startAuftrag(entwurf)).toEqual({
      kind: 'new',
      worldId: 'welt-x-99',
      name: 'Insel',
      config: { seed: 99, worldSize: form.groesse, dayLengthMinutes: form.tageslaenge, resourceDensity: 'normal' },
      commands: entwurfBefehle(entwurf),
    });
  });
});

class FakeInput {
  context: InputContext = 'play';
  pressed = new Set<Action>();
  down = new Set<Action>();
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.pressed.has(a);
  }
  isDown(a: Action): boolean {
    return this.down.has(a);
  }
  setContext(c: InputContext): void {
    this.context = c;
  }
}

describe('Bildschirmstapel des Menüs', () => {
  it('das Hauptmenü bleibt unten; öffnen, ersetzen, zurück, nach Hause', () => {
    const c = new MenuController({ focus: new FocusManager(), input: null });
    expect(c.stack.value).toEqual([MAIN_MENU]);
    c.back();
    expect(c.stack.value).toEqual([MAIN_MENU]);
    c.open(MENU_SCREENS.welten);
    c.open(MENU_SCREENS.welten);
    expect(c.stack.value).toEqual([MAIN_MENU, MENU_SCREENS.welten]);
    c.replace(MENU_SCREENS.neueWelt);
    expect(c.top()).toBe(MENU_SCREENS.neueWelt);
    c.open(MENU_SCREENS.einstellungen);
    c.home();
    expect(c.stack.value).toEqual([MAIN_MENU]);
    c.replace('charakter');
    expect(c.stack.value).toEqual([MAIN_MENU, 'charakter']);
  });

  it('Esc geht erst an den Fokusbereich, sonst schließt er den obersten Bildschirm; das Menü setzt den Kontext ui', () => {
    const input = new FakeInput();
    const focus = new FocusManager();
    const c = new MenuController({ focus, input, now: () => 0 });
    expect(input.context).toBe('ui');
    c.open(MENU_SCREENS.einstellungen);
    input.pressed.add('uiBack');
    c.poll();
    expect(c.stack.value).toEqual([MAIN_MENU]);
    // On the main menu Esc does nothing.
    c.poll();
    expect(c.stack.value).toEqual([MAIN_MENU]);
    // A scope with its own back (a dialog) takes Esc first.
    c.open(MENU_SCREENS.welten);
    let backs = 0;
    const root = { querySelectorAll: () => [], contains: () => false };
    const pop = focus.push({ root, onBack: () => backs++ });
    c.poll();
    expect(backs).toBe(1);
    expect(c.top()).toBe(MENU_SCREENS.welten);
    pop();
  });

  it('eine gehaltene Richtung wiederholt sich nach der Verzögerung im Takt', () => {
    const input = new FakeInput();
    const focus = new FocusManager();
    const moves: string[] = [];
    const root = { querySelectorAll: () => [], contains: () => false };
    focus.push({ root, onAction: (a) => (moves.push(a), true) });
    let now = 0;
    const c = new MenuController({ focus, input, now: () => now });
    input.pressed.add('uiDown');
    input.down.add('uiDown');
    c.poll();
    input.pressed.clear();
    now = REPEAT_DELAY_MS - 1;
    c.poll();
    expect(moves).toEqual(['down']);
    now = REPEAT_DELAY_MS;
    c.poll();
    now += REPEAT_INTERVAL_MS;
    c.poll();
    expect(moves).toEqual(['down', 'down', 'down']);
    input.down.clear();
    now += REPEAT_INTERVAL_MS;
    c.poll();
    expect(moves).toHaveLength(3);
  });
});

const WELT: WeltEintrag = { id: 'w1', name: 'Glutküste', seed: 4711, groesse: 'medium', tag: 23, ticks: 60 * 3600 * 2.5, gespeichert: Date.UTC(2026, 9, 5, 19, 42) };

describe('Weltauswahl', () => {
  it('eine Zeile nennt Name, Tag, Größe, Spielzeit und die Speicherzeit – in beiden Sprachen', () => {
    expect(spielSekunden(60 * 90)).toBe(90);
    const z = weltZeile(de, WELT);
    expect(z.name).toBe('Glutküste');
    expect(z.details).toMatch(/^Tag 23 · Mittel · 2,5\sh$/);
    expect(z.gespeichert).toMatch(/^Gespeichert \d\d\.\d\d\.\d\d, \d\d:\d\d$/);
    expect(weltZeile(en, WELT).details).toMatch(/^Day 23 · Medium · 2\.5\sh$/);
    expect(weltSeed(WELT)).toBe('DH-4711-medium');
  });

  it('Statuszeile und Auswahl nach einer Änderung der Liste', () => {
    expect(statusText(de, { art: 'leer' })).toBeNull();
    expect(statusText(de, { art: 'kopiert', text: 'DH-1-small' })).toBe('Seed kopiert: DH-1-small');
    expect(statusText(en, { art: 'exportiert', datei: 'a.dhsave' })).toBe('Exported as a.dhsave');
    for (const art of ['arbeitet', 'importiert', 'kopierenFehler', 'geloescht', 'fehler'] as const) {
      const status = art === 'arbeitet' ? { art } : art === 'importiert' || art === 'geloescht' ? { art, name: 'X' } : art === 'kopierenFehler' ? { art, text: 'DH-1-small' } : { art, fehler: 'kaputt' };
      expect(statusText(de, status), art).not.toBeNull();
      expect(statusFehler(status), art).toBe(art === 'fehler');
    }
    const liste = [WELT, { ...WELT, id: 'w2' }];
    expect(auswahlNach(liste, 'w2')).toBe('w2');
    expect(auswahlNach(liste, 'weg')).toBe('w1');
    expect(auswahlNach([], 'w1')).toBeNull();
    expect(fehlerText(new Error('Boom'))).toBe('Boom');
    expect(fehlerText('roh')).toBe('roh');
  });
});

describe('Ladebildschirm', () => {
  it('der Balken folgt den Generierungsschritten und ist voll, sobald die Welt steht', () => {
    expect(ladeAnteil(null, false)).toBe(0);
    expect(ladeAnteil({ kind: 'step', step: 'weltplan', index: 0, count: 8 }, false)).toBe(0);
    expect(ladeAnteil({ kind: 'step', step: 'ressourcen', index: 6, count: 8 }, false)).toBeCloseTo((GENERIERUNG_ANTEIL * 6) / 8, 9);
    expect(ladeAnteil({ kind: 'failed', error: 'x' }, false)).toBe(0);
    expect(ladeAnteil(null, true)).toBe(1);
    expect(fuellBreite(200, 0.5)).toBe(100);
    expect(fuellBreite(200, 0.6749)).toBe(135);
    expect(fuellBreite(200, 2)).toBe(200);
    expect(fuellBreite(200, -1)).toBe(0);
  });

  it('wählt je einen Tipp und eine Lore-Zeile, nie zweimal dieselbe hintereinander', () => {
    const tipps = tippsDerArt(TIPS, 'tipp');
    const lore = tippsDerArt(TIPS, 'lore');
    expect(tipps.length).toBeGreaterThan(20);
    expect(lore.length).toBeGreaterThanOrEqual(10);
    expect(tippWahl(TIPS, 'tipp', 0)?.id).toBe(tipps[0]?.id);
    expect(tippWahl(TIPS, 'tipp', 0.999999)?.id).toBe(tipps[tipps.length - 1]?.id);
    for (let i = 0; i < 20; i++) {
      const was = tipps[i % tipps.length]?.id ?? null;
      expect(tippWahl(TIPS, 'tipp', i / 20, was)?.id).not.toBe(was);
    }
    expect(tippWahl([], 'lore', 0.5)).toBeNull();
    const one = lore.slice(0, 1);
    expect(tippWahl(one, 'lore', 0.5, one[0]?.id ?? null)?.id).toBe(one[0]?.id);
  });
});
