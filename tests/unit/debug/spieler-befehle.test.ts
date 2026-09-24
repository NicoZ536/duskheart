/**
 * M3-35 console commands for the player (src/debug/playerCommands.ts): `give` puts items into the bags
 * through `inventory.give` (a typo names the closest item), `kill` puts the player's light out through
 * `death.kill`, `god` and `noclip` switch the cheats through `debug.god`/`debug.noclip`, `unlock` raises the
 * skills through `debug.unlock`, `inspect` switches the entity inspector, and `tp` moves the player with
 * `player.teleport` once one exists. Everything goes through game commands (validated, next tick); texts from the i18n
 * tables (strict).
 */
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/game/session';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { SkillsSystem } from '../../../src/game/skills/system';
import { createI18n } from '../../../src/i18n';
import { createDebugConsole } from '../../../src/debug/console';
import { closestItem, registerPlayerCommands } from '../../../src/debug/playerCommands';
import { registerWorldCommands } from '../../../src/debug/worldCommands';

const TILE = 16;

function setup(lang: 'de' | 'en' = 'de') {
  const i18n = createI18n(lang, { strict: true });
  const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
  const con = createDebugConsole({ t });
  const session = new GameSession({ config: { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } });
  let inspecting = false;
  registerPlayerCommands(con, {
    t,
    lang: () => i18n.lang,
    session,
    inspecting: () => inspecting,
    setInspecting: (on) => {
      inspecting = on;
    },
  });
  registerWorldCommands(con, {
    t,
    lang: () => i18n.lang,
    session,
    spawn: () => ({ x: 100, y: 120 }),
    cameraTile: () => null,
    setOverlay: () => undefined,
    overlayState: () => ({ chunks: false, kollision: false, temperatur: false }),
    reloadWithSeed: () => undefined,
  });
  const inventory = (): InventorySystem => session.sim.system('inventory') as InventorySystem;
  return { con, session, inventory, inspecting: () => inspecting };
}

describe('Konsole: Spielerbefehle (M3-35)', () => {
  it('give legt Gegenstände über inventory.give in die Taschen; ein Tippfehler nennt den nächsten Gegenstand', () => {
    const { con, session, inventory } = setup();
    expect(con.exec('give feuerstein 3')).toBe('Kein Spieler in der Welt – im Debug-Modus erscheint er mit ?spieler=1.');
    session.command({ type: 'player.spawn' });
    session.step();
    expect(con.exec('give feuerstein 3')).toBe('Feuerstein ×3 in die Taschen gelegt.');
    expect(con.exec('give steinaxt')).toBe('Steinaxt ×1 in die Taschen gelegt.');
    session.step();
    expect(inventory().count('feuerstein')).toBe(3);
    expect(inventory().count('steinaxt')).toBe(1);
    expect(con.exec('give feuersten 2')).toBe('Unbekannter Gegenstand „feuersten“. Meintest du „feuerstein“?');
    expect(con.exec('give xyzzyqq')).toBe('Unbekannter Gegenstand „xyzzyqq“.');
    expect(con.exec('give holz 0')).toContain('muss zwischen');
    expect(closestItem('holt')).toBe('holz');
  });

  it('kill lässt das Licht des Spielers über death.kill erlöschen', () => {
    const { con, session } = setup('en');
    expect(con.exec('kill')).toBe('No player in the world – in debug mode it appears with ?spieler=1.');
    session.command({ type: 'player.spawn' });
    session.step();
    expect(con.exec('kill')).toBe("The player's light goes out.");
    session.step();
    const s = session.debugState();
    expect(s.player?.health).toBe(0);
    expect(s.events.playerDied).toBe(1);
  });

  it('god und noclip schalten die Cheats über debug.god und debug.noclip an, aus und um', () => {
    const { con, session } = setup();
    expect(con.exec('god an')).toBe('Gott-Modus an: kein Schaden.');
    session.step();
    expect(session.debugState().cheats).toEqual({ god: true, noclip: false });
    expect(con.exec('god')).toBe('Gott-Modus aus.');
    expect(con.exec('noclip')).toBe('Noclip an: Nichts hält dich auf.');
    session.step();
    expect(session.debugState().cheats).toEqual({ god: false, noclip: true });
    expect(con.exec('noclip aus')).toBe('Noclip aus.');
    session.step();
    expect(session.debugState().cheats).toEqual({ god: false, noclip: false });
    expect(con.exec('god vielleicht')).toContain('an');
  });

  it('unlock hebt die Fertigkeiten über debug.unlock auf die höchste Stufe; eine unbekannte nennt die bekannten', () => {
    const { con, session } = setup('en');
    const skills = session.sim.system('skills') as SkillsSystem;
    expect(con.exec('unlock bergbau')).toBe('Mining at level 100 – the perk choices are open.');
    session.step();
    expect(skills.level('bergbau')).toBe(100);
    expect(skills.level('holzfaellen')).toBe(1);
    expect(con.exec('unlock')).toBe('Every skill at level 100 – the perk choices are open.');
    session.step();
    for (const def of skills.defs) expect(skills.level(def.id)).toBe(100);
    const unknown = con.exec('unlock zauberei');
    expect(unknown).toContain('Unknown skill "zauberei". Known: ');
    expect(unknown).toContain('bergbau');
  });

  it('inspect schaltet den Inspektor an, aus und um', () => {
    const { con, inspecting } = setup();
    expect(con.exec('inspect an')).toBe('Inspektor an: Klick auf eine Entität.');
    expect(inspecting()).toBe(true);
    expect(con.exec('inspect')).toBe('Inspektor aus.');
    expect(inspecting()).toBe(false);
    expect(con.exec('inspektor')).toBe('Inspektor an: Klick auf eine Entität.');
    expect(con.exec('inspect aus')).toBe('Inspektor aus.');
  });

  it('tp versetzt den Spieler über player.teleport, sobald es ihn gibt', () => {
    const { con, session } = setup();
    session.command({ type: 'player.spawn' });
    session.step();
    expect(con.exec('tp 120 130')).toBe('Teleport nach (120, 130) auf Ebene 0.');
    session.step();
    const p = session.debugState().player;
    expect({ x: p?.x, y: p?.y }).toEqual({ x: 120 * TILE + TILE / 2, y: 130 * TILE + TILE / 2 });
    // No debug mover appeared: the player is the controlled figure.
    expect(session.debugState().controlled?.entity).toBe(p?.entity);
  });

  it('help nennt die Spielerbefehle', () => {
    const { con } = setup();
    const help = con.exec('help');
    for (const usage of ['give <item> [anzahl]', 'kill', 'god [an|aus]', 'noclip [an|aus]', 'unlock [fertigkeit]', 'inspect [an|aus]']) expect(help).toContain(usage);
  });
});
