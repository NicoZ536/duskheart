/**
 * Die Utility-KI der Kreaturen (M6-13, docs/SPIEL.md §11 „KI“, MASTERPROMPT §19.4 „Verhalten“): jede Haltung wählt ihren
 * Zustand – Flucht vor der Bedrohung (scheu, wehrhaft, ohne Mut), Angriff wenn bereit, Jagd, Umkreisen im Rudel, Heimkehr an
 * der Leine (der Nachtmahr kennt keine), Untersuchen von Geräuschen und verlorenen Spuren, Schlaf außerhalb der Stunden, die
 * Ruhezustände nach den Gewichten des Profils – geseedet und deterministisch; im Spiel flieht ein Hase vor dem Spieler, und
 * zwei gleiche Welten laufen gleich.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { AI_PROFILES } from '../../../src/content/creatures/profile';
import { CREATURES } from '../../../src/content/creatures/kreaturen';
import { BRAIN_STATES, createBrainInput, decide, scoreStates, type BrainInput } from '../../../src/game/creatures/ai/brain';
import type { AiState } from '../../../src/game/creatures/state';
import { Rng } from '../../../src/engine/rng';
import { PROBE_PROFILE, kreaturWelt, meadow } from './kreatur-testwelt';

const PROFILES = [...AI_PROFILES, ...PROBE_PROFILE];
const IDLE: readonly AiState[] = ['ruhen', 'grasen', 'umherstreifen'];

function profile(id: string): (typeof PROFILES)[number] {
  const p = PROFILES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no profile ${id}`);
  return p;
}

/** A situation of profile `id`: awake at home, nothing around, a new idle state due. */
function situation(id: string, over: Partial<BrainInput> = {}): BrainInput {
  return Object.assign(createBrainInput(profile(id)), over);
}

function choose(id: string, over: Partial<BrainInput> = {}, seed = 7): AiState {
  return decide(situation(id, over), new Rng(seed));
}

describe('Utility-KI: Haltungen (M6-13)', () => {
  it('scheu: der Hase flieht vor einer Bedrohung in seiner Fluchtdistanz, jenseits davon ruht er weiter', () => {
    const flight = profile('hase').fluchtDistanz;
    expect(choose('hase', { hasTarget: true, seesTarget: true, targetTiles: flight - 1 })).toBe('fliehen');
    expect(IDLE).toContain(choose('hase', { hasTarget: true, seesTarget: true, targetTiles: flight + 1 }));
    // Getroffen flieht er auch vor einem fernen Angreifer.
    expect(choose('hase', { hasTarget: true, alarmed: true, targetTiles: 20 })).toBe('fliehen');
  });

  it('wehrhaft: das Reh flieht – außer es wurde getroffen und kann zurücktreten; unter seinem Mut flieht es doch', () => {
    const near = { hasTarget: true, seesTarget: true, targetTiles: 2 };
    expect(choose('reh', near)).toBe('fliehen');
    expect(choose('reh', { ...near, alarmed: true, attackReady: true })).toBe('angreifen');
    expect(choose('reh', { ...near, alarmed: true, attackReady: true, health: profile('reh').mut / 2 })).toBe('fliehen');
  });

  it('aggressiv: der Wolf jagt, was er kennt, und schlägt zu, wenn ein Angriff bereit ist', () => {
    expect(choose('probe_wolf', { hasTarget: true, seesTarget: true, targetTiles: 8 })).toBe('jagen');
    expect(choose('probe_wolf', { hasTarget: true, seesTarget: true, targetTiles: 1, attackReady: true })).toBe('angreifen');
    // Ohne Sicht kein Schlag, nur die Jagd auf den letzten Ort.
    expect(choose('probe_wolf', { hasTarget: true, seesTarget: false, targetTiles: 1, attackReady: true })).toBe('jagen');
  });

  it('Rudel: wer nicht an der Reihe ist, umkreist statt zu jagen (M6-18)', () => {
    const hunt = { hasTarget: true, seesTarget: true, targetTiles: 3, inPack: true };
    expect(choose('probe_wolf', { ...hunt, attackTurn: false })).toBe('umkreisen');
    expect(choose('probe_wolf', { ...hunt, attackTurn: true })).toBe('jagen');
    expect(choose('probe_wolf', { ...hunt, attackTurn: true, attackReady: true })).toBe('angreifen');
  });

  it('Leine: jenseits davon kehrt die Kreatur heim – die Flucht geht vor, der Nachtmahr kennt keine Leine', () => {
    const leash = profile('hase').leine;
    expect(choose('hase', { homeTiles: leash + 5 })).toBe('heimkehr');
    expect(IDLE).toContain(choose('hase', { homeTiles: leash - 1 }));
    expect(choose('hase', { homeTiles: leash + 5, hasTarget: true, seesTarget: true, targetTiles: 1 })).toBe('fliehen');
    expect(choose('nachtmahr', { homeTiles: 500, hasTarget: true, seesTarget: true, targetTiles: 10 })).toBe('jagen');
    // Weit genug draußen überwiegt die Heimkehr die Jagd (1,2 × Leine).
    expect(choose('probe_wolf', { homeTiles: profile('probe_wolf').leine * 1.3, hasTarget: true, seesTarget: true, targetTiles: 5 })).toBe('heimkehr');
  });

  it('Untersuchen: Geräusche lockt nur, wer nicht scheu ist; eine frische Spur verfolgen feindliche', () => {
    expect(choose('probe_wolf', { heardNoise: true })).toBe('untersuchen');
    expect(IDLE).toContain(choose('hase', { heardNoise: true }));
    expect(choose('probe_wolf', { lostTrail: true })).toBe('untersuchen');
    expect(IDLE).toContain(choose('hase', { lostTrail: true }));
  });

  it('Schlaf: außerhalb seiner Stunden schläft die Kreatur; ein Geräusch weckt eine nicht scheue', () => {
    expect(choose('reh', { awake: false })).toBe('schlafen');
    expect(choose('probe_wolf', { awake: false, heardNoise: true })).toBe('untersuchen');
  });

  it('Schattenbrut im gemiedenen Licht flieht', () => {
    expect(choose('probe_schleicher', { inAvoidedLight: true, hasTarget: true, seesTarget: true, targetTiles: 1, attackReady: true })).toBe('fliehen');
  });

  it('Bewertung: Flucht vor Kampf vor Untersuchen vor Schlaf vor Ruhe (BALANCE.ai.utility)', () => {
    const U = BALANCE.ai.utility;
    expect(U.flee).toBeGreaterThan(U.attack);
    expect(U.attack).toBeGreaterThan(U.hunt);
    expect(U.hunt).toBeGreaterThan(U.investigate);
    expect(U.investigate).toBeGreaterThan(U.sleep);
    expect(U.sleep).toBeGreaterThan(U.idleNoise);
    const out = scoreStates(situation('probe_wolf', { hasTarget: true, seesTarget: true, targetTiles: 1, attackReady: true }), 'ruhen', new Float64Array(BRAIN_STATES.length));
    expect(out[BRAIN_STATES.indexOf('angreifen')]).toBe(U.attack);
    expect(out[BRAIN_STATES.indexOf('jagen')]).toBe(U.hunt);
    expect(out[BRAIN_STATES.indexOf('ruhen')]).toBe(U.idleNoise);
  });
});

describe('Utility-KI: Ruhezustände', () => {
  it('ein laufender Ruhezustand bleibt, bis er abläuft, ohne Zufall zu verbrauchen', () => {
    const rng = new Rng(3);
    const before = rng.getState();
    expect(decide(situation('hase', { idleExpired: false, current: 'grasen' }), rng)).toBe('grasen');
    expect(rng.getState()).toEqual(before);
  });

  it('die Wahl folgt den Gewichten des Profils und ist geseedet', () => {
    const w = profile('hase').gewichte;
    const total = w.ruhen + w.grasen + w.umherstreifen;
    const counts: Record<string, number> = { ruhen: 0, grasen: 0, umherstreifen: 0 };
    const rng = new Rng(11);
    const N = 3000;
    const seq: AiState[] = [];
    for (let i = 0; i < N; i++) {
      const s = decide(situation('hase'), rng);
      counts[s] = (counts[s] ?? 0) + 1;
      if (i < 20) seq.push(s);
    }
    for (const k of IDLE) expect((counts[k] ?? 0) / N).toBeCloseTo(w[k as keyof typeof w] / total, 1);
    const again = new Rng(11);
    expect(seq).toEqual(Array.from({ length: 20 }, () => decide(situation('hase'), again)));
    // Nur Ruhe gewichtet: immer Ruhe.
    expect(Array.from({ length: 50 }, (_, i) => choose('probe_brecher', {}, i)).every((s) => s === 'ruhen')).toBe(true);
  });
});

describe('Utility-KI: Profile als Inhalt', () => {
  it('jede Kreatur nennt ein Profil, und jedes Profil wird gebraucht', () => {
    const used = new Set(CREATURES.map((c) => c.ki));
    for (const c of CREATURES) expect(AI_PROFILES.map((p) => p.id)).toContain(c.ki);
    for (const p of AI_PROFILES) expect(used.has(p.id), p.id).toBe(true);
  });
});

describe('Utility-KI im Spiel', () => {
  it('ein Hase hört den Spieler kommen, flieht in seiner Fluchtdistanz und entfernt sich', () => {
    const w = kreaturWelt(meadow(60, 30), { x: 10, y: 15 });
    const hare = w.creature('hase', 22, 15);
    w.run(30);
    const start = w.where(hare);
    // Der Spieler geht auf ihn zu (er sieht nach Süden: nur das Gehör verrät den Spieler).
    let fled = false;
    for (let i = 0; i < 180 && !fled; i++) {
      w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
      fled = w.state(hare).state === 'fliehen';
    }
    expect(fled).toBe(true);
    const p = w.pos();
    const h = w.where(hare);
    expect(Math.hypot(h.x - p.x, h.y - p.y) / 16).toBeLessThanOrEqual(profile('hase').fluchtDistanz + 1);
    w.run(60, [{ type: 'player.move', dx: 0, dy: 0 }]);
    const after = w.where(hare);
    expect(Math.hypot(after.x - w.pos().x, after.y - w.pos().y)).toBeGreaterThan(Math.hypot(h.x - p.x, h.y - p.y));
    expect(after.x).toBeGreaterThan(start.x);
  });

  it('zwei gleiche Welten mit Rudel und Wild laufen bitgleich (Strom `creatures`)', () => {
    const make = (): ReturnType<typeof kreaturWelt> => {
      const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
      w.cheats.god = true;
      // A pack of three (one spawn: one pack), a hare and a deer.
      w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 3, x: w.centre(21, 10).x, y: w.centre(21, 10).y, layer: 0 }]);
      w.creature('hase', 40, 30);
      w.creature('reh', 45, 12);
      return w;
    };
    const a = make();
    const b = make();
    a.run(400);
    b.run(400);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    // Das Rudel hat den Spieler gefunden: wer ihn sah, rief die anderen.
    for (let i = 0; i < 3; i++) expect(a.creatures.store.valueAt(i).target).toBe(a.sim.player);
  });
});
