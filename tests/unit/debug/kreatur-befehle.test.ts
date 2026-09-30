/**
 * Konsolenbefehle für Kreaturen (src/debug/creatureCommands.ts; MASTERPROMPT §31.6 „spawn … kill“): `spawn <kreatur>
 * [anzahl]` lässt Kreaturen vor dem Spieler erscheinen (`creature.spawn`, Rudeltiere zusammen als Rudel), `kill <radius>`
 * lässt die Kreaturen im Umkreis fallen (`creature.kill`, Kadaver und Beute wie im Kampf); `kill` ohne Radius bleibt der
 * Tod des Spielers. Alles über Spielbefehle (validiert, nächster Tick); Texte DE/EN aus den i18n-Tabellen (strikt).
 */
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/game/session';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createI18n } from '../../../src/i18n';
import { createDebugConsole } from '../../../src/debug/console';
import { registerCreatureCommands } from '../../../src/debug/creatureCommands';
import { registerPlayerCommands } from '../../../src/debug/playerCommands';

function setup(lang: 'de' | 'en' = 'de') {
  const i18n = createI18n(lang, { strict: true });
  const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
  const con = createDebugConsole({ t });
  const session = new GameSession({ config: { seed: 20260930, worldSize: 'small', dayLengthMinutes: 12 } });
  registerPlayerCommands(con, { t, lang: () => i18n.lang, session, inspecting: () => false, setInspecting: () => undefined });
  registerCreatureCommands(con, { t, lang: () => i18n.lang, session });
  const creatures = (): CreatureSystem => session.sim.system('creatures') as CreatureSystem;
  const count = (id: string): number => {
    let n = 0;
    const store = creatures().store;
    for (let i = 0; i < store.size; i++) if (store.valueAt(i).creature === id) n++;
    return n;
  };
  return { con, session, creatures, count };
}

describe('Konsole: Kreaturen (M6)', () => {
  it('spawn lässt Kreaturen vor dem Spieler erscheinen; ohne Spieler nicht, unbekannte Ids nennt die Konsole', () => {
    const { con, session, count } = setup();
    expect(con.exec('spawn reh')).toBe('Kein Spieler in der Welt – im Debug-Modus erscheint er mit ?spieler=1.');
    session.command({ type: 'player.spawn' });
    session.step();
    const before = count('reh');
    expect(con.exec('spawn reh 3')).toBe('Reh ×3 erscheint.');
    session.step();
    expect(count('reh')).toBe(before + 3);
    expect(con.exec('spawn gibtsnicht')).not.toContain('erscheint');
    expect(con.exec('help spawn')).toContain('spawn hase 3');
    const en = setup('en');
    en.session.command({ type: 'player.spawn' });
    en.session.step();
    expect(en.con.exec('spawn nachtmahr')).toBe('Nightmare ×1 appears.');
  });

  it('kill <radius> lässt die Kreaturen im Umkreis fallen, kill ohne Radius bleibt der Tod des Spielers', () => {
    const { con, session, count, creatures } = setup('en');
    session.command({ type: 'player.spawn' });
    session.step();
    con.exec('spawn hase 4');
    session.step();
    expect(count('hase')).toBeGreaterThanOrEqual(4);
    const carcasses = creatures().carcasses.size;
    expect(con.exec('kill 6')).toBe('The creatures within 6 tiles fall.');
    session.step();
    session.step();
    expect(creatures().carcasses.size).toBeGreaterThanOrEqual(carcasses + 4);
    expect(session.debugState().player?.health).toBeGreaterThan(0);
    expect(con.exec('kill')).toBe("The player's light goes out.");
    session.step();
    expect(session.debugState().player?.health).toBe(0);
  });
});
