/**
 * Konsolenbefehle der Orte, der Karte und der Weltereignisse (src/debug/orteCommands.ts; docs/SPIEL.md §30 „Debug: Konsole
 * `reveal`, `event <id>`, `strike`“): `reveal [tiefe]` deckt eine ganze Ebene auf (`map.reveal`), `event <id> [an|aus]`
 * startet oder beendet ein Weltereignis (`worldEvent.start`/`stop`), `strike [dx] [dy]` lässt einen Blitz einschlagen
 * (`lightning.strike`, ohne Spieler nicht). Alles über Spielbefehle (validiert, nächster Tick); die Hilfetexte sind
 * i18n-Schlüssel (kein übersetzter Text: die Konsole übersetzt sie selbst), Texte DE/EN aus den Tabellen (strikt).
 */
import { describe, expect, it } from 'vitest';
import { createDebugConsole } from '../../../src/debug/console';
import { registerOrteCommands } from '../../../src/debug/orteCommands';
import type { GameCommand } from '../../../src/game/commands';
import { countRevealed } from '../../../src/game/map/formulas';
import type { MapSystem } from '../../../src/game/map/system';
import { GameSession } from '../../../src/game/session';
import type { WorldEventsSystem } from '../../../src/game/worldevents/system';
import { createI18n } from '../../../src/i18n';

function setup(lang: 'de' | 'en' = 'de') {
  const i18n = createI18n(lang, { strict: true });
  const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
  const con = createDebugConsole({ t });
  const session = new GameSession({ config: { seed: 20261006, worldSize: 'small', dayLengthMinutes: 12 } });
  registerOrteCommands(con, { t, session });
  const map = session.sim.system('map') as MapSystem;
  const events = session.sim.system('world-events') as WorldEventsSystem;
  return { con, session, map, events };
}

describe('Konsole: Orte, Karte, Weltereignisse (M7)', () => {
  it('reveal deckt eine Ebene oder alle auf; die Hilfe nennt Beispiele in beiden Sprachen', () => {
    const { con, session, map } = setup();
    expect(con.exec('reveal 1')).toBe('Die Karte zeigt die Ebene 1.');
    session.step();
    const side = map.side;
    expect(countRevealed(map.mask(-1) ?? new Uint8Array(0))).toBe(side * side);
    expect(map.mask(-2)).toBeNull();
    expect(con.exec('reveal')).toBe('Die Karte zeigt alle Ebenen.');
    session.step();
    expect(countRevealed(map.mask(-3) ?? new Uint8Array(0))).toBe(side * side);
    expect(con.exec('reveal 9')).not.toContain('Karte zeigt');
    expect(con.exec('help reveal')).toContain('reveal 1');
    // The help alone needs no world: an English console over a session that takes nothing.
    const en = createI18n('en', { strict: true });
    const hilfe = createDebugConsole({ t: (k, p) => en.t(k, p) });
    registerOrteCommands(hilfe, { t: (k, p) => en.t(k, p), session: { command: (raw: unknown) => raw as GameCommand, samplePlayer: () => false } });
    expect(hilfe.exec('help strike')).toContain('strike 4 -3');
    // The help of a command is its i18n key (the console translates it in the reader's language), never a translated text.
    for (const c of hilfe.commands()) expect(en.has(c.help), c.name).toBe(true);
  });

  it('event startet und beendet ein Weltereignis; nur umgesetzte Ereignisse', () => {
    const { con, session, events } = setup('en');
    expect(con.exec('event lumenregen')).toBe('World event lumenregen begins.');
    session.step();
    expect(events.activeBig()).toBe('lumenregen');
    expect(con.exec('event lumenregen aus')).toBe('World event lumenregen ends.');
    session.step();
    expect(events.phase('lumenregen')).toBe('ruhe');
    expect(con.exec('event flut')).not.toContain('begins');
  });

  it('strike lässt einen Blitz neben dem Spieler einschlagen, ohne Spieler nicht', () => {
    // The console's part: the game command it queues (the bolt itself: tests/unit/game/blitze.test.ts) – over a session that
    // records the commands, with and without a player.
    const i18n = createI18n('de', { strict: true });
    const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
    const queued: unknown[] = [];
    let player = false;
    const con = createDebugConsole({ t });
    registerOrteCommands(con, { t, session: { command: (raw: unknown) => (queued.push(raw), raw as GameCommand), samplePlayer: () => player } });
    expect(con.exec('strike')).toBe('Kein Spieler in der Welt – im Debug-Modus erscheint er mit ?spieler=1.');
    expect(queued).toEqual([]);
    player = true;
    expect(con.exec('strike 4 -3')).toBe('Ein Blitz schlägt ein (4, -3).');
    expect(con.exec('strike')).toBe('Ein Blitz schlägt ein (0, 0).');
    expect(queued).toEqual([
      { type: 'lightning.strike', dx: 4, dy: -3 },
      { type: 'lightning.strike', dx: 0, dy: 0 },
    ]);
    expect(con.exec('strike 999 0')).not.toContain('schlägt ein');
  });
});
