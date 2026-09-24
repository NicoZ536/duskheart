/**
 * Save roundtrip of the participant `skills` (M3-32): level, progress within the level and the perk
 * choices of every skill survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { totalXpForLevel } from '../../../../src/game/skills/formulas';
import { lifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

describe('save roundtrip: skills', () => {
  it('restores levels, progress and perk choices', () => {
    const report = expectRoundtrip(
      () => lifeWorld(meadow(8, 8)),
      (w) => {
        w.spawn(3, 3);
        w.life.skills.award(w.sim, 'erz_abgebaut', totalXpForLevel(31) / 10);
        w.life.skills.award(w.sim, 'baum_treffer', 13);
        w.run(1, [{ type: 'skills.choosePerk', skill: 'bergbau', level: 30, choice: 1 }]);
      },
      (w) => w.sim.participant('skills'),
    );
    expect(report.id).toBe('skills');
    const data = JSON.parse(report.canonical) as { skills: Record<string, { level: number; xp: number; perks: unknown[] }> };
    expect(data.skills.bergbau).toMatchObject({ level: 31, perks: [{ level: 30, choice: 1 }] });
    expect(data.skills.holzfaellen?.xp).toBe(13);
  });

  it('refuses snapshots whose perk choices do not match the level', () => {
    const w = lifeWorld(meadow(4, 4));
    const p = w.sim.participant('skills');
    const data = p.serialize() as { skills: Record<string, { level: number; xp: number; perks: unknown[] }> };
    const bad = { skills: { ...data.skills, bergbau: { level: 35, xp: 0, perks: [] } } };
    expect(() => p.deserialize(bad)).toThrow(TypeError);
    expect(() => p.deserialize({ skills: {} })).toThrow(TypeError);
  });
});
