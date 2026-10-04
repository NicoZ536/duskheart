/**
 * Die Leine mit Hysterese (M6-13b; MASTERPROMPT §19.4 „Heimkehr (Leine)“; docs/SPIEL.md §11 „KI“): eine angebundene Kreatur
 * – der Dornling, 8 Kacheln Leine – jagt nur Beute innerhalb ihrer Leine. Geht die Beute darüber hinaus, gibt sie sie auf
 * und kehrt heim; erst wenn die Beute wieder deutlich innerhalb steht (`BALANCE.ai.leash.reengageShare` der Leine), nimmt
 * sie die Jagd wieder auf. So pendelt sie nicht zwischen Jagd und Heimkehr, wenn der Spieler knapp jenseits der Leine
 * stehen bleibt; der Nachtmahr (unerbittlich) kennt keine Leine.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { AI_PROFILES } from '../../../src/content/creatures/index';
import { createBrainInput, decide, type BrainInput } from '../../../src/game/creatures/ai/brain';
import type { AiState } from '../../../src/game/creatures/state';
import { Rng } from '../../../src/engine/rng';
import { TILE_PX } from '../../../src/world/model/coords';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const L = BALANCE.ai.leash;

function profile(id: string): (typeof AI_PROFILES)[number] {
  const p = AI_PROFILES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no profile ${id}`);
  return p;
}

function choose(id: string, over: Partial<BrainInput>): AiState {
  return decide(Object.assign(createBrainInput(profile(id)), over), new Rng(7));
}

describe('Leine im Gehirn (M6-13b)', () => {
  const leine = profile('dornling').leine;
  const seen = { hasTarget: true, seesTarget: true, targetTiles: 3 };

  it('jagt Beute innerhalb der Leine, gibt Beute jenseits davon auf', () => {
    expect(choose('dornling', { ...seen, targetHomeTiles: leine - 0.5 })).toBe('jagen');
    expect(['ruhen', 'grasen', 'umherstreifen']).toContain(choose('dornling', { ...seen, targetHomeTiles: leine + 0.5 }));
    // Beyond its leash itself, without prey in it: home.
    expect(choose('dornling', { ...seen, homeTiles: leine + 1, targetHomeTiles: leine + 3 })).toBe('heimkehr');
    // A lost trail beyond the leash is not followed either.
    expect(['ruhen', 'grasen', 'umherstreifen']).toContain(choose('dornling', { lostTrail: true, targetHomeTiles: leine + 2 }));
    expect(choose('dornling', { lostTrail: true, targetHomeTiles: leine - 2 })).toBe('untersuchen');
  });

  it('Hysterese: aufgegeben nimmt sie die Jagd erst innerhalb von reengageShare der Leine wieder auf', () => {
    expect(L.reengageShare).toBeGreaterThan(0);
    expect(L.reengageShare).toBeLessThan(1);
    const between = leine * (1 + L.reengageShare) / 2;
    expect(choose('dornling', { ...seen, targetHomeTiles: between })).toBe('jagen');
    expect(['ruhen', 'grasen', 'umherstreifen']).toContain(choose('dornling', { ...seen, targetHomeTiles: between, leashed: true }));
    expect(choose('dornling', { ...seen, targetHomeTiles: leine * L.reengageShare - 0.1, leashed: true })).toBe('jagen');
  });

  it('einmal auf dem Heimweg geht sie weiter, bis sie wieder in ihrem Streifgebiet ist', () => {
    const streifen = profile('dornling').streifen;
    expect(choose('dornling', { current: 'heimkehr', homeTiles: leine - 1 })).toBe('heimkehr');
    // Heading home is no idle choice: it draws nothing from the stream.
    const rng = new Rng(5);
    const before = rng.getState();
    expect(decide(Object.assign(createBrainInput(profile('dornling')), { current: 'heimkehr' as const, homeTiles: leine - 1 }), rng)).toBe('heimkehr');
    expect(rng.getState()).toEqual(before);
    expect(choose('dornling', { current: 'heimkehr', homeTiles: streifen + 0.5 })).toBe('heimkehr');
    expect(['ruhen', 'grasen', 'umherstreifen']).toContain(choose('dornling', { current: 'heimkehr', homeTiles: streifen - 0.5 }));
    // Without the way home begun, inside the leash it rests where it is.
    expect(['ruhen', 'grasen', 'umherstreifen']).toContain(choose('dornling', { homeTiles: leine - 1 }));
    // Prey within the leash draws it off its way home.
    expect(choose('dornling', { ...seen, current: 'heimkehr', homeTiles: leine - 1, targetHomeTiles: leine - 2 })).toBe('jagen');
  });

  it('ein Angriff in Reichweite geht vor; der Nachtmahr kennt keine Leine', () => {
    expect(choose('dornling', { ...seen, targetTiles: 1, attackReady: true, targetHomeTiles: leine + 0.5 })).toBe('angreifen');
    expect(choose('nachtmahr', { ...seen, targetHomeTiles: 500, homeTiles: 490 })).toBe('jagen');
  });
});

/** Distance of creature `e` from its home [tiles]. */
function fromHome(w: KreaturWelt, e: number): number {
  const s = w.state(e);
  const p = w.where(e);
  return Math.hypot(p.x - s.homeX, p.y - s.homeY) / TILE_PX;
}

describe('Leine im Spiel: der Dornling pendelt nicht (M6-13b)', () => {
  /** A revealed Dornling at map tile (20, 15), the player five tiles east of it, lit (seen at twice the range). */
  function lured(): { w: KreaturWelt; e: number } {
    const w = kreaturWelt(meadow(60, 30), { x: 25, y: 15 });
    w.cheats.god = true;
    w.light.lit = true;
    const e = w.creature('dornling', 20, 15);
    const s = w.state(e);
    // Revealed and facing its prey (a hit would do the same, `creatureRevealed`).
    s.hidden = false;
    s.facing = 0;
    return { w, e };
  }

  /** Walks the player east to map tile x (at most 10 s). */
  function walkTo(w: KreaturWelt, x: number): void {
    const target = w.centre(x, 15).x;
    for (let i = 0; i < 10 * HZ && w.pos().x < target; i++) w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
  }

  it('der Spieler bleibt knapp jenseits der Leine stehen: der Dornling gibt auf, kehrt heim und bleibt dort', () => {
    const { w, e } = lured();
    const leine = profile('dornling').leine;
    w.run(HZ);
    expect(w.state(e).state).toBe('jagen');
    // Out of the leash: three tiles beyond it (out of reach of the whip from its edge).
    walkTo(w, 20 + leine + 3);
    const states: AiState[] = [];
    let farthest = 0;
    let gaveUp = false;
    for (let i = 0; i < 20 * HZ; i++) {
      w.run(1);
      const st = w.state(e).state;
      if (states[states.length - 1] !== st) states.push(st);
      farthest = Math.max(farthest, fromHome(w, e));
      gaveUp ||= w.state(e).leashed;
    }
    // It never goes out again: at most one hunt (the one that was on when the player left), no hunt after turning home.
    const lastHunt = states.lastIndexOf('jagen');
    const firstHome = states.indexOf('heimkehr');
    expect(firstHome === -1 || lastHunt < firstHome).toBe(true);
    expect(states.filter((s) => s === 'jagen').length).toBeLessThanOrEqual(1);
    expect(farthest).toBeLessThanOrEqual(leine + 1);
    // It gave its prey up and went back within its roaming radius.
    expect(gaveUp).toBe(true);
    expect(fromHome(w, e)).toBeLessThanOrEqual(profile('dornling').streifen + 0.5);
  });

  it('kommt der Spieler wieder deutlich innerhalb der Leine, jagt er erneut; knapp innerhalb noch nicht', () => {
    const { w, e } = lured();
    const leine = profile('dornling').leine;
    /** Runs a tick with the Dornling watching the player (it faces him: it never loses sight of its prey). */
    const watching = (commands?: Parameters<KreaturWelt['run']>[1]): AiState => {
      const s = w.state(e);
      const p = w.where(e);
      s.facing = Math.atan2(w.pos().y - p.y, w.pos().x - p.x);
      w.run(1, commands);
      return w.state(e).state;
    };
    const walk = (dx: number, until: (x: number) => boolean): void => {
      for (let i = 0; i < 10 * HZ && !until(w.pos().x); i++) watching(i === 0 ? [{ type: 'player.move', dx, dy: 0 }] : undefined);
      watching([{ type: 'player.move', dx: 0, dy: 0 }]);
    };
    walk(1, (x) => x >= w.centre(20 + leine + 3, 15).x);
    for (let i = 0; i < 12 * HZ; i++) watching();
    expect(w.state(e).leashed).toBe(true);
    expect(fromHome(w, e)).toBeLessThanOrEqual(profile('dornling').streifen + 0.5);
    // Back to just inside the leash (between reengageShare and 1): it sees him, yet stays given up.
    walk(-1, (x) => x <= w.centre(20 + leine - 1, 15).x);
    const between = Array.from({ length: 4 * HZ }, () => watching());
    expect(between).not.toContain('jagen');
    expect(w.state(e).leashed).toBe(true);
    // Well inside (4 tiles from home): it hunts again.
    walk(-1, (x) => x <= w.centre(24, 15).x);
    const inside = Array.from({ length: 2 * HZ }, () => watching());
    expect(inside.some((s) => s === 'jagen' || s === 'angreifen')).toBe(true);
    expect(w.state(e).leashed).toBe(false);
  });
});
