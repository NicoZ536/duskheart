/**
 * Konsolenbefehl der Küche (src/debug/kuecheCommands.ts; docs/SPIEL.md §21 „Debug“, M7-29): `spoil [stunden]` lässt alle
 * verderblichen Vorräte der Taschen und der aktiven Zone altern (`spoilage.advance`, nächster Tick; ohne Zahl ein Tag).
 * Die Hilfe ist ein i18n-Schlüssel, Texte DE/EN aus den Tabellen (strikt).
 */
import { describe, expect, it } from 'vitest';
import { createDebugConsole } from '../../../src/debug/console';
import { registerKuecheCommands } from '../../../src/debug/kuecheCommands';
import type { GameCommand } from '../../../src/game/commands';
import { createI18n } from '../../../src/i18n';

function setup(lang: 'de' | 'en') {
  const i18n = createI18n(lang, { strict: true });
  const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
  const con = createDebugConsole({ t });
  const sent: unknown[] = [];
  registerKuecheCommands(con, { t, session: { command: (raw: unknown) => (sent.push(raw), raw as GameCommand) } });
  return { con, sent, i18n };
}

describe('Konsole: Küche (M7-29)', () => {
  it('spoil schickt spoilage.advance mit den Stunden, ohne Zahl einen Tag; zu viele Stunden lehnt die Konsole ab', () => {
    const { con, sent } = setup('de');
    expect(con.exec('spoil 48')).toBe('Vorräte altern um 48 Stunden.');
    expect(con.exec('spoil')).toBe('Vorräte altern um 24 Stunden.');
    expect(sent).toEqual([
      { type: 'spoilage.advance', hours: 48 },
      { type: 'spoilage.advance', hours: 24 },
    ]);
    expect(con.exec('spoil 0')).not.toContain('altern');
    expect(con.exec('spoil 100000')).not.toContain('altern');
    expect(sent).toHaveLength(2);
  });

  it('Hilfe in beiden Sprachen mit Beispiel; der Hilfetext ist ein i18n-Schlüssel', () => {
    for (const lang of ['de', 'en'] as const) {
      const { con, i18n } = setup(lang);
      expect(con.exec('help spoil')).toContain('spoil 48');
      for (const c of con.commands()) expect(i18n.has(c.help), c.name).toBe(true);
    }
    expect(setup('en').con.exec('spoil 6')).toBe('Supplies age by 6 hours.');
  });
});
