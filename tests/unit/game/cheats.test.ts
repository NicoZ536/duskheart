/**
 * M3-35 Debug-Cheats der Konsole (src/game/cheats/system.ts, MASTERPROMPT §31.6 „god, noclip, unlock“):
 * - `debug.god`: kein Schaden – Blutung, Hunger, Durst, Ertrinken, Sturz, Trugbild-Treffer –, `death.kill`
 *   wirkt trotzdem (der ausdrückliche Befehl der Konsole); aus: alles wie zuvor.
 * - `debug.noclip`: Gehen durch Fels, tiefes Wasser und Baum, ohne zu schwimmen, innerhalb der Welt; die
 *   Höhenstufe folgt der Kachel unter den Füßen; ohne Cheat halten Fels und Wasser wie gewohnt.
 * - `debug.unlock`: jede Fertigkeit (oder eine) auf der höchsten Stufe, ihre Talentwahlen offen, mit
 *   denselben Ereignissen wie beim Lernen; eine unbekannte Fertigkeit wird abgelehnt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { lifeWorld } from './leben-testwelt';
import { OFFSET, T, meadow } from './spieler-testwelt';

const K = BALANCE.skills;
/** Ticks of five seconds. */
const FIVE_S = 5 * 60;

describe('debug.god', () => {
  it('schützt vor jedem Schaden, ohne die Heilung anzuhalten', () => {
    const w = lifeWorld(meadow(10, 10));
    w.spawn(5, 5);
    w.run(1, [{ type: 'debug.god', on: true }]);
    expect(w.cheats.god).toBe(true);
    const v = w.vit();
    v.satiety = 0;
    v.thirst = 0;
    const events = w.run(FIVE_S, [
      { type: 'conditions.apply', id: 'blutung' },
      { type: 'conditions.apply', id: 'blutung' },
      { type: 'conditions.apply', id: 'blutung' },
    ]);
    expect(w.vit().health).toBe(100);
    expect(events.get('playerDamaged')).toBeUndefined();
    expect(events.get('playerAfflicted')).toBeUndefined();
    // Instant damage (a fall) and the harm of conditions and hallucinations deal nothing.
    expect(w.vitals.damage(w.sim, 40, 'sturz')).toBe(0);
    expect(w.life.harm.spared).toBe(true);
    expect(w.life.harm.hurt(w.vit(), 10)).toBe(0);
    expect(w.vit().health).toBe(100);
  });

  it('death.kill löscht das Licht auch im Gott-Modus; aus heißt wieder verwundbar', () => {
    const w = lifeWorld(meadow(10, 10));
    w.spawn(5, 5);
    w.run(1, [{ type: 'debug.god', on: true }]);
    w.run(1, [{ type: 'debug.god', on: false }]);
    expect(w.cheats.god).toBe(false);
    w.run(60, [{ type: 'conditions.apply', id: 'blutung' }]);
    expect(w.vit().health).toBeLessThan(100);
    const died = w.run(2, [
      { type: 'debug.god', on: true },
      { type: 'death.kill' },
    ]);
    expect(died.get('playerDied')).toHaveLength(1);
  });
});

describe('debug.noclip', () => {
  /** Rock, deep water and a birch across the way south; a plateau of level 2 below them. */
  const ROWS = ['.....', '.###.', '.www.', '..T..', '.....', '.222.', '.222.', '.....'];

  it('ohne Cheat hält der Fels den Spieler auf', () => {
    const w = lifeWorld(ROWS);
    w.spawn(2, 0);
    w.run(60, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(w.pos().y).toBeLessThan((OFFSET + 1) * T);
  });

  it('geht durch Fels, Wasser und Baum, schwimmt nie, die Stufe folgt der Kachel', () => {
    const w = lifeWorld(ROWS);
    w.spawn(2, 0);
    w.run(1, [{ type: 'debug.noclip', on: true }]);
    const levels: number[] = [];
    let swam = false;
    w.run(1, [{ type: 'player.move', dx: 0, dy: 1 }]);
    for (let i = 0; i < 90; i++) {
      w.run(1);
      swam ||= w.body().swimming;
      levels.push(w.body().level);
    }
    // 4,5 tiles/s for 1,5 s: past rock, water and birch onto the plateau.
    expect(w.pos().y).toBeGreaterThan((OFFSET + 5) * T);
    expect(swam).toBe(false);
    expect(w.body().state).toBe('walk');
    expect(levels).toContain(2);
    expect(w.body().level).toBe(2);
  });

  it('bleibt in der Welt', () => {
    const w = lifeWorld(meadow(4, 4));
    w.spawn(1, 1);
    w.run(1, [
      { type: 'debug.noclip', on: true },
      { type: 'player.teleport', x: 3 * T, y: 3 * T, layer: 0 },
    ]);
    w.run(120, [{ type: 'player.move', dx: -1, dy: -1 }]);
    expect(w.pos().x).toBeGreaterThan(0);
    expect(w.pos().y).toBeGreaterThan(0);
  });
});

describe('debug.unlock', () => {
  it('hebt jede Fertigkeit auf die höchste Stufe und öffnet ihre Talentwahlen', () => {
    const w = lifeWorld(meadow(6, 6));
    w.spawn(2, 2);
    const events = w.run(1, [{ type: 'debug.unlock' }]);
    const defs = w.life.skills.defs;
    for (const def of defs) {
      expect(w.life.skills.level(def.id)).toBe(K.maxLevel);
      expect(w.life.skills.skill(def.id).perks.map((p) => p.level)).toEqual([...K.perkLevels]);
    }
    expect(events.get('skillLevelUp')).toHaveLength(defs.length);
    expect(events.get('perkChoiceOpened')).toHaveLength(defs.length * K.perkLevels.length);
    // Again: nothing left to unlock.
    expect(w.run(1, [{ type: 'debug.unlock' }]).get('skillLevelUp')).toBeUndefined();
  });

  it('eine Fertigkeit allein; eine unbekannte wird abgelehnt', () => {
    const w = lifeWorld(meadow(6, 6));
    w.spawn(2, 2);
    w.run(1, [{ type: 'debug.unlock', skill: 'bergbau' }]);
    expect(w.life.skills.level('bergbau')).toBe(K.maxLevel);
    expect(w.life.skills.level('holzfaellen')).toBe(K.minLevel);
    const rejected = w.run(1, [{ type: 'debug.unlock', skill: 'zauberei' }]).get('commandRejected') as Array<{ reason: string }>;
    expect(rejected.map((r) => r.reason)).toEqual(['unknownSkill']);
  });
});
