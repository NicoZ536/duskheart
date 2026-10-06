/**
 * M7-23 Bäume aus Setzlingen, Obstbäume (MASTERPROMPT §17 "Bäume aus Setzlingen, Obstbäume mit saisonaler Ernte"; docs/SPIEL.md
 * §20 "Bäume aus Setzlingen"):
 * - jeder Setzling pflanzt seinen Baum; gepflanzt wird auf Wiese oder Erde, nicht auf Sand, Wasser, Fels, Gebautem oder unter
 *   einem Objekt;
 * - der Setzling wächst um 06:00 je Tag um 1/`treeGrowDays` (Objektzustand `growth` 0 … < 1) und ist danach der Baum; solange er
 *   wächst, ist er weder fällbar noch pflückbar;
 * - eingefroren holt er jeden verpassten Morgen auf – gleich wie tickend, in einem oder zwei Stücken; in Basen wächst er auch;
 * - ein Apfelbaum aus dem Setzling trägt im Herbst Äpfel, im Sommer nicht.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { isSapling } from '../../../src/game/gathering/objectState';
import { field, gatherWorld, OFFSET, type GatherWorld } from './interaktion-testwelt';

const GROW_DAYS = BALANCE.farming.treeGrowDays;

/** Meadow with sand at (3, 1), shallow water at (5, 1), rock at (7, 1) and an oak at (9, 1). */
function welt(): GatherWorld {
  return gatherWorld(field(16, 12, ['', '...S.s.#.E']));
}

function state(w: GatherWorld, x: number, y: number): { growth: number } | undefined {
  const { chunk, i } = w.at(x, y);
  return chunk.objectState.get(i);
}

function plant(w: GatherWorld, x: number, y: number, object: string): void {
  const { tx, ty } = w.tile(x, y);
  expect(w.gathering.saplingProblem(0, tx, ty, object), `${object} at ${x},${y}`).toBeNull();
  w.gathering.plantSapling(w.sim, 0, tx, ty, object);
}

/** Steps through the next 06:00 (the zone active): the dawn's `dailyTick`. */
function dawn(w: GatherWorld): Map<string, unknown[]> {
  const perDay = w.sim.clock.ticksPerDay;
  w.sim.skipTicks(perDay - (w.sim.tick % perDay) - 1);
  return w.run(2);
}

describe('Setzlinge pflanzen', () => {
  it('jeder Setzling pflanzt seinen Baum, die Obstbäume eingeschlossen', () => {
    const saplings = CONTENT.collection('items').values().filter((i) => i.pflanzt !== undefined);
    // The nine Grünhain trees that leave a stump with a sapling (src/content/items/setzlinge.ts).
    expect(saplings.length).toBeGreaterThanOrEqual(9);
    for (const s of saplings) expect(CONTENT.collection('worldObjects').find(s.pflanzt as string), s.id).toBeDefined();
    expect(saplings.map((s) => s.pflanzt)).toEqual(expect.arrayContaining(['baum_apfelbaum', 'baum_kirschbaum', 'baum_birnbaum', 'baum_walnussbaum']));
  });

  it('auf Wiese und Erde – nicht auf Sand, Wasser, Fels oder unter einem Baum', () => {
    const w = welt();
    const problem = (x: number, y: number): string | null => {
      const { tx, ty } = w.tile(x, y);
      return w.gathering.saplingProblem(0, tx, ty, 'baum_apfelbaum');
    };
    expect([problem(1, 1), problem(3, 1), problem(5, 1), problem(7, 1), problem(9, 1)]).toEqual([null, 'notDiggable', 'notDiggable', 'notDiggable', 'notDiggable']);
    expect(w.gathering.saplingProblem(0, OFFSET + 1, OFFSET + 1, 'gibts_nicht')).toBe('nothing');
    w.gathering.addGroundClaims((layer, tx) => layer === 0 && tx === OFFSET + 1);
    expect(problem(1, 4)).toBe('builtOver');
    plant(w, 3, 5, 'baum_apfelbaum');
    expect(w.objectAt(3, 5)).toBe('baum_apfelbaum');
    expect(state(w, 3, 5)?.growth).toBe(0);
    expect(w.gathering.saplingAt(0, OFFSET + 3, OFFSET + 5)).toBe(true);
  });
});

describe('Wachstum um 06:00', () => {
  it(`je Morgen 1/${GROW_DAYS}; nach ${GROW_DAYS} Morgen steht der Baum (saplingGrown)`, () => {
    const w = welt();
    plant(w, 3, 5, 'baum_apfelbaum');
    for (let d = 1; d < GROW_DAYS; d++) {
      const ev = dawn(w);
      expect(state(w, 3, 5)?.growth, `Tag ${d}`).toBeCloseTo(d / GROW_DAYS, 12);
      expect(ev.get('saplingGrown')).toBeUndefined();
      // Between the dawns nothing grows.
      w.run(BALANCE.time.tickHz * 2);
      expect(state(w, 3, 5)?.growth).toBeCloseTo(d / GROW_DAYS, 12);
    }
    const ev = dawn(w);
    expect(ev.get('saplingGrown')).toEqual([expect.objectContaining({ object: 'baum_apfelbaum', tx: OFFSET + 3, ty: OFFSET + 5 })]);
    expect(state(w, 3, 5)).toBeUndefined();
    expect(w.objectAt(3, 5)).toBe('baum_apfelbaum');
  });

  it('solange er wächst, ist er weder fällbar noch pflückbar', () => {
    const w = welt();
    plant(w, 3, 5, 'baum_apfelbaum');
    w.season('herbst');
    w.spawn(3, 7);
    w.hold('probe_steinaxt');
    w.run(2);
    expect(w.interaction.focus.subject).not.toBe('baum_apfelbaum');
    const ev = w.run(BALANCE.time.tickHz, [{ type: 'player.interact', on: true }]);
    expect(ev.get('harvested')).toBeUndefined();
    expect(isSapling(state(w, 3, 5)?.growth ?? -9)).toBe(true);
  });

  it('eingefroren holt er jeden verpassten Morgen auf: gleich wie tickend, in einem und in zwei Stücken', () => {
    const ticking = welt();
    const once = welt();
    const twice = welt();
    for (const w of [ticking, once, twice]) {
      plant(w, 3, 5, 'baum_kirschbaum');
      plant(w, 6, 6, 'baum_eiche');
    }
    dawn(ticking);
    dawn(ticking);
    dawn(ticking);
    const end = ticking.sim.tick;
    const chunkOf = (w: GatherWorld) => w.at(3, 5).chunk;
    for (const w of [once, twice]) w.active = [];
    once.sim.skipTicks(end - once.sim.tick);
    once.gathering.catchUp(chunkOf(once), 0, once.sim.tick);
    const mid = Math.floor(end * 0.45);
    twice.sim.skipTicks(mid);
    twice.gathering.catchUp(chunkOf(twice), 0, mid);
    twice.sim.skipTicks(end - mid);
    twice.gathering.catchUp(chunkOf(twice), mid, end);
    for (const w of [once, twice]) {
      expect(state(w, 3, 5)).toEqual(state(ticking, 3, 5));
      expect(state(w, 6, 6)).toEqual(state(ticking, 6, 6));
    }
    expect(state(ticking, 3, 5)?.growth).toBeCloseTo(3 / GROW_DAYS, 12);
  });

  it('in einer Basis wächst der Setzling (gesperrt ist nur das Nachwachsen gefällter Bäume)', () => {
    const w = welt();
    w.gathering.addBaseAreas({ inBase: () => true });
    plant(w, 3, 5, 'baum_eiche');
    for (let d = 0; d < GROW_DAYS; d++) dawn(w);
    expect(state(w, 3, 5)).toBeUndefined();
    expect(w.objectAt(3, 5)).toBe('baum_eiche');
  });
});

describe('Obstbäume aus dem Setzling', () => {
  it('der gewachsene Apfelbaum trägt im Herbst Äpfel, im Sommer nicht', () => {
    const w = welt();
    plant(w, 3, 5, 'baum_apfelbaum');
    w.active = [];
    w.sim.skipTicks(GROW_DAYS * w.sim.clock.ticksPerDay);
    w.gathering.catchUp(w.at(3, 5).chunk, 0, w.sim.tick);
    w.active = [w.at(3, 5).chunk];
    expect(state(w, 3, 5)).toBeUndefined();
    w.spawn(3, 7);
    w.run(2);
    expect(w.calendar.seasonOfDay(w.sim.clock.day)).toBe('sommer');
    expect(w.interaction.focus).not.toMatchObject({ subject: 'baum_apfelbaum', action: 'ernten' });
    w.season('herbst');
    w.run(2);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', subject: 'baum_apfelbaum', action: 'ernten', byHand: true });
    const ev = w.runUntil(() => !w.interaction.working, 600, [{ type: 'player.interact', on: true }]);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ action: 'ernten' })]);
    w.collect();
    expect(w.inventory.count('apfel')).toBeGreaterThanOrEqual(2);
  });
});
