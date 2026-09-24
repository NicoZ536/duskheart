/**
 * M3-32: the skill core (MASTERPROMPT §23.2): 12 skills, levels 1–100, XP need `50 × stufe^1,6`, +0,5 %
 * effect per level, perk choices at 30/60/90, death costs 25 % of the level progress (Normal), XP sources
 * gathering / crafting (reported by their systems) and survival (sneaking, swimming, enduring cold or heat,
 * getting through the night).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { addXp, deathXpLoss, perkLevelsReached, skillBonus, totalXpForLevel, xpToNextLevel } from '../../../src/game/skills/formulas';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;
const SKILLS = CONTENT.collection('skills').values();

function world(rows: readonly string[] = meadow(30, 30)): LifeWorld {
  const w = lifeWorld(rows);
  w.spawn(10, 10);
  return w;
}

describe('Fertigkeiten als Content', () => {
  it('the twelve skills of §23.2, each with its experience sources (ids unique over all skills)', () => {
    expect(SKILLS.map((s) => s.id)).toEqual(['holzfaellen', 'bergbau', 'sammeln', 'handwerk', 'schmieden', 'kochen', 'landwirtschaft', 'nahkampf', 'fernkampf', 'verteidigung', 'ueberleben', 'lumenkunde']);
    const sources = SKILLS.flatMap((s) => s.quellen.map((q) => q.id));
    expect(new Set(sources).size).toBe(sources.length);
    for (const s of SKILLS) {
      expect(s.quellen.length).toBeGreaterThan(0);
      for (const t of [s.name, s.beschreibung, s.wirkung]) expect(t.de.length * t.en.length).toBeGreaterThan(0);
    }
    // Gathering, crafting and survival sources exist (§23.2 "Learning by Doing").
    expect(sources).toEqual(expect.arrayContaining(['baum_gefaellt', 'gestein_abgebaut', 'pflanze_gesammelt', 'gegenstand_hergestellt', 'schleichen', 'schwimmen', 'temperatur_ertragen', 'nacht_ueberstanden']));
  });
});

describe('EP-Kurve (reine Funktionen)', () => {
  it('50 × level^1,6 XP to the next level (whole points), 0 at level 100', () => {
    expect(xpToNextLevel(1)).toBe(50);
    expect(xpToNextLevel(2)).toBe(Math.round(50 * 2 ** 1.6));
    expect(xpToNextLevel(10)).toBe(Math.round(50 * 10 ** 1.6));
    expect(xpToNextLevel(99)).toBe(Math.round(50 * 99 ** 1.6));
    expect(xpToNextLevel(100)).toBe(0);
    expect(() => xpToNextLevel(0)).toThrow(RangeError);
    expect(() => xpToNextLevel(101)).toThrow(RangeError);
    expect(totalXpForLevel(3)).toBe(xpToNextLevel(1) + xpToNextLevel(2));
    for (let l = 2; l < 100; l++) expect(xpToNextLevel(l)).toBeGreaterThan(xpToNextLevel(l - 1));
  });

  it('+0,5 % effect per level above the first', () => {
    expect(skillBonus(1)).toBe(0);
    expect(skillBonus(2)).toBeCloseTo(0.005, 12);
    expect(skillBonus(100)).toBeCloseTo(0.495, 12);
  });

  it('XP carry over several levels; at level 100 the rest is dropped', () => {
    const p = { level: 1, xp: 0 };
    expect(addXp(p, 49)).toBe(0);
    expect(addXp(p, 1 + xpToNextLevel(2) + 10)).toBe(2);
    expect(p).toEqual({ level: 3, xp: 10 });
    const top = { level: 99, xp: 0 };
    expect(addXp(top, 1e9)).toBe(1);
    expect(top).toEqual({ level: 100, xp: 0 });
    expect(addXp(top, 50)).toBe(0);
    expect(addXp(p, -5)).toBe(0);
  });

  it('death takes 25 % of the progress within the level, never a level; perk choices at 30, 60 and 90', () => {
    expect(deathXpLoss(400, 0.25)).toBe(100);
    expect(deathXpLoss(400, 2)).toBe(400);
    expect(perkLevelsReached(29, 30)).toEqual([30]);
    expect(perkLevelsReached(1, 95)).toEqual([30, 60, 90]);
    expect(perkLevelsReached(30, 59)).toEqual([]);
  });
});

describe('Fertigkeitssystem', () => {
  it('an action gives its XP to its skill (xpGained) and levels up (skillLevelUp)', () => {
    const w = world();
    const skills = w.life.skills;
    expect(skills.award(w.sim, 'baum_gefaellt', 7)).toBe(56);
    const ev = w.run(1);
    expect(ev.get('xpGained')).toEqual([expect.objectContaining({ skill: 'holzfaellen', amount: 56, source: 'baum_gefaellt' })]);
    expect(ev.get('skillLevelUp')).toEqual([expect.objectContaining({ skill: 'holzfaellen', level: 2 })]);
    expect(skills.skill('holzfaellen')).toEqual({ level: 2, xp: 6, perks: [] });
    expect(skills.bonus('holzfaellen')).toBeCloseTo(0.005, 12);
    expect(skills.level('bergbau')).toBe(1);
    expect(() => skills.award(w.sim, 'unbekannt')).toThrow(RangeError);
  });

  it('reaching level 30 opens a perk choice; skills.choosePerk takes it once', () => {
    const w = world();
    const skills = w.life.skills;
    skills.award(w.sim, 'erz_abgebaut', totalXpForLevel(30) / 10);
    const ev = w.run(1);
    expect(skills.level('bergbau')).toBe(30);
    expect(ev.get('perkChoiceOpened')).toEqual([expect.objectContaining({ skill: 'bergbau', level: 30 })]);
    const bad = w.run(1, [
      { type: 'skills.choosePerk', skill: 'bergbau', level: 60, choice: 0 },
      { type: 'skills.choosePerk', skill: 'zaubern', level: 30, choice: 0 },
    ]);
    expect((bad.get('commandRejected') as Array<{ reason: string }>).map((r) => r.reason)).toEqual(['noPerkChoice', 'unknownSkill']);
    const chosen = w.run(1, [{ type: 'skills.choosePerk', skill: 'bergbau', level: 30, choice: 1 }]);
    expect(chosen.get('perkChosen')).toEqual([expect.objectContaining({ skill: 'bergbau', level: 30, choice: 1 })]);
    expect(skills.skill('bergbau').perks).toEqual([{ level: 30, choice: 1 }]);
    expect((w.run(1, [{ type: 'skills.choosePerk', skill: 'bergbau', level: 30, choice: 0 }]).get('commandRejected') as Array<{ reason: string }>)[0]?.reason).toBe('noPerkChoice');
  });

  it('survival XP: sneaking and swimming per second, enduring cold, every morning alive', () => {
    const w = world(['..........', '..........', '..wwwwwww.', '..wwwwwww.', '..........']);
    const skills = w.life.skills;
    w.run(1, [{ type: 'player.teleport', x: w.centre(1, 0).x, y: w.centre(1, 0).y, layer: 0 }]);
    w.run(1, [{ type: 'player.sneak', on: true }, { type: 'player.move', dx: 1, dy: 0 }]);
    const x0 = skills.skill('ueberleben').xp;
    w.run(TICK);
    expect(skills.skill('ueberleben').xp - x0).toBeCloseTo(0.2, 6);
    w.run(1, [{ type: 'player.sneak', on: false }, { type: 'player.teleport', x: w.centre(5, 2).x, y: w.centre(5, 2).y, layer: 0 }]);
    const x1 = skills.skill('ueberleben').xp;
    w.run(TICK, [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(skills.skill('ueberleben').xp - x1).toBeCloseTo(0.3, 6);
    // Cold: 10 °C air without clothing is 8 °C below the comfort band.
    const cold = world();
    cold.env.air = 10;
    cold.run(1);
    const c0 = cold.life.skills.skill('ueberleben').xp;
    cold.run(TICK);
    expect(cold.life.skills.skill('ueberleben').xp - c0).toBeCloseTo(0.2, 6);
    // Morning: the daily tick at 06:00 gives the night's XP (a dead player learns nothing).
    const night = world();
    night.jumpToHour(5);
    const n0 = night.life.skills.skill('ueberleben').xp;
    const dawn = night.run(night.sim.clock.ticksPerGameHour + 1);
    expect(dawn.get('xpGained')).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'nacht_ueberstanden', amount: 25 })]));
    expect(night.life.skills.skill('ueberleben').xp - n0).toBeGreaterThanOrEqual(25);
  });

  it('a dead player learns nothing; Ausgeruht adds 5 %', () => {
    const w = world();
    w.run(1, [{ type: 'death.kill' }]);
    expect(w.life.skills.award(w.sim, 'baum_gefaellt')).toBe(0);
    const r = world();
    r.run(1, [{ type: 'conditions.apply', id: 'ausgeruht' }]);
    expect(r.life.skills.award(r.sim, 'gegenstand_hergestellt')).toBeCloseTo(5 * 1.05, 12);
  });
});
