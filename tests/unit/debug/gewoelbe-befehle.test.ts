/**
 * Konsolenbefehle der Gewölbe (src/debug/gewoelbeCommands.ts; docs/SPIEL.md §30 „Debug: Konsole … `vault <n>`, `solve`“; M7-10 …
 * M7-13, M7-46): `vault [n]` bringt den Spieler ins n-nächste Gewölbe hinab (Ebene −1, neben den Aufgang), `solve [rätsel]` löst
 * die Rätsel des Gewölbes, in dem er steht (`vault.solve`: ihre Türen öffnen sich), `tafel` liest die nächste Erbauer-Tafel wie
 * E vor ihr (`tabletRead`). Alles über Spielbefehle (validiert, nächster Tick); außerhalb eines Gewölbes und ohne Spieler nicht;
 * die Hilfetexte sind i18n-Schlüssel in beiden Sprachen (strikt).
 */
import { describe, expect, it } from 'vitest';
import { createDebugConsole } from '../../../src/debug/console';
import { registerGewoelbeCommands } from '../../../src/debug/gewoelbeCommands';
import type { GameCommand } from '../../../src/game/commands';
import { createPlayerSample, GameSession } from '../../../src/game/session';
import type { VaultsSystem } from '../../../src/game/vaults/system';
import { createI18n } from '../../../src/i18n';
import { TILE_PX } from '../../../src/world/model/coords';

describe('Konsole: Gewölbe (M7)', () => {
  it('vault führt hinab, solve löst alle Rätsel, tafel liest die nächste Tafel; außerhalb nicht', () => {
    const i18n = createI18n('de', { strict: true });
    const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
    const con = createDebugConsole({ t });
    // The reference save's world (seed 3, small): its vaults lie within reach of the spawn.
    const session = new GameSession({ config: { seed: 3, worldSize: 'small', dayLengthMinutes: 12 } });
    registerGewoelbeCommands(con, { t, session });
    const vaults = session.sim.system('vaults') as VaultsSystem;
    const plans = session.sim.world.generated.vaults;
    expect(plans.length).toBeGreaterThan(0);
    const seen = new Map<string, unknown[]>();
    session.onEvent('tabletRead', (e) => seen.set('tabletRead', [...(seen.get('tabletRead') ?? []), e]));
    session.onEvent('puzzleSolved', (e) => seen.set('puzzleSolved', [...(seen.get('puzzleSolved') ?? []), e]));
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) session.step();
    };
    session.command({ type: 'player.spawn' });
    step(2);
    // Outside a vault: neither solve nor tafel.
    expect(con.exec('solve')).toBe('Du stehst in keinem Gewölbe.');
    expect(con.exec('tafel')).toBe('Du stehst in keinem Gewölbe.');
    expect(con.exec(`vault ${plans.length}`)).toBe(`Kein Gewölbe Nummer ${plans.length} – die Welt hat ${plans.length}.`);
    const out = con.exec('vault');
    expect(out).toMatch(/^Hinab ins Gewölbe \d+ \(\w+, \d+ Räume\)\.$/u);
    step(30);
    const p = createPlayerSample();
    expect(session.samplePlayer(p)).toBe(true);
    expect(p.layer).toBe(-1);
    const slot = Number(/Gewölbe (\d+)/u.exec(out)?.[1]);
    const plan = plans.find((v) => v.slot === slot)!;
    expect(Math.floor(p.x / TILE_PX)).toBe(plan.entrance.tx);
    expect(Math.floor(p.y / TILE_PX)).toBe(plan.entrance.ty + 1);
    expect(vaults.state(slot)?.entered).toBe(true);
    // solve: every puzzle of the vault, its puzzle doors open.
    expect(con.exec('solve')).toBe(`Alle Rätsel von Gewölbe ${slot} gelöst.`);
    step(2);
    expect(plan.puzzles.every((z) => vaults.isSolved(slot, z.id))).toBe(true);
    expect(seen.get('puzzleSolved') ?? []).toHaveLength(plan.puzzles.length);
    expect(plan.doors.filter((d) => d.kind === 'raetsel').every((d) => vaults.isDoorOpen(slot, d.id))).toBe(true);
    // tafel: the nearest tablet (the world's vaults hold two or three) read as E in front of it does.
    expect(plan.tablets.length).toBeGreaterThan(0);
    const read = con.exec('tafel');
    step(2);
    expect(read).toMatch(/^Tafel tafel_\d\d bei -?\d+, -?\d+ gelesen\.$/u);
    const tablet = /Tafel (tafel_\d\d)/u.exec(read)?.[1];
    expect(plan.tablets.map((x) => x.tablet)).toContain(tablet);
    expect(seen.get('tabletRead')).toEqual([expect.objectContaining({ tablet, quelle: 'gewoelbe', ort: slot })]);
  });

  it('ohne Spieler nichts; die Hilfe ist ein i18n-Schlüssel in beiden Sprachen', () => {
    for (const lang of ['de', 'en'] as const) {
      const i18n = createI18n(lang, { strict: true });
      const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
      const con = createDebugConsole({ t });
      const queued: unknown[] = [];
      const session = { command: (raw: unknown) => (queued.push(raw), raw as GameCommand), samplePlayer: () => false, sim: { world: { generated: { vaults: [] } } } } as unknown as Parameters<typeof registerGewoelbeCommands>[1]['session'];
      registerGewoelbeCommands(con, { t, session });
      for (const line of ['vault', 'solve', 'tafel']) expect(con.exec(line)).toBe(t('debug.cmd.player.none'));
      expect(queued).toEqual([]);
      expect(con.commands().map((c) => c.name).filter((n) => n !== 'help' && n !== 'clear').sort()).toEqual(['solve', 'tafel', 'vault']);
      for (const c of con.commands()) expect(i18n.has(c.help), c.name).toBe(true);
      expect(con.exec('help vault')).toContain(lang === 'de' ? '„vault 2“' : '“vault 2”');
    }
  });
});
