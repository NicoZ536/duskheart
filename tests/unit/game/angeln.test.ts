/**
 * M7-24 Angeln (MASTERPROMPT §14 "Angel (T0 Stock + Faser + Knochenhaken …), Köder, Minispiel (Spannung halten, Fisch zieht,
 * Rute biegt sich), … Fischarten nach Biom, Tageszeit, Wetter und Jahreszeit; Reusen (passiv); Eisangeln im Winter"; docs/SPIEL.md
 * §20 "Angeln"):
 * - Fischwahl: wer wo beißt (Biom, Gewässer, Tageszeit, Wetter, Jahreszeit), der Köder verdreifacht das Gewicht seiner Fische,
 *   jeder der acht Fische beißt irgendwo; Reusen fangen nur Reusenfische, zu jeder Stunde;
 * - die Angel: Ablehnungen, E auf Wasser wirft aus, Biss nach hash(Seed, Wurf-Tick), verpasster Biss, Drill (geschickt fängt,
 *   immer ziehen reißt, nie ziehen entkommt), Fang in die Taschen, Abnutzung, EP `fisch_gefangen`, Köder, lose Schnur;
 * - Eisangeln: gefrorenes Wasser nur mit Loch (Spitzhacke), Gewässer `eis`, das Loch friert wieder zu;
 * - Reusen: ins Wasser gesetzt, Fang je 06:00 per Hash bis voll, aktiv ≡ eingefroren + aufgeholt ≡ a → b → c, E leert und nimmt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, SEASON_IDS } from '../../../src/content/balance';
import { FISH } from '../../../src/content/fishing/index';
import { DAY_PHASES, FISH_WATERS } from '../../../src/content/fishing/schema';
import { WEATHER_STATE_IDS } from '../../../src/content/weather';
import type { GameCommand } from '../../../src/game/commands';
import { chooseFish, fishDayPhase, fishFits, type FishConditions } from '../../../src/game/fishing/index';
import { dayTimes } from '../../../src/world/calendar';
import { angelWelt, LAKE_ROWS, type AngelWelt } from './angel-testwelt';
import { OFFSET } from './interaktion-testwelt';

const B = BALANCE.fishing;
const HZ = BALANCE.time.tickHz;

function fits(c: FishConditions): string[] {
  return FISH.filter((f) => fishFits(f, c, false)).map((f) => f.id);
}

describe('Fischwahl', () => {
  it('Biom, Gewässer, Tageszeit, Wetter und Jahreszeit entscheiden, wer beißt', () => {
    const c = (biome: string, water: FishConditions['water'], phase: FishConditions['phase'], season: FishConditions['season'], weather: FishConditions['weather'] = 'klar'): string[] =>
      fits({ biome, water, phase, season, weather });
    expect(c('gruenhain', 'see', 'tag', 'sommer')).toEqual(['barsch', 'hecht']);
    expect(c('gruenhain', 'see', 'nacht', 'sommer')).toEqual(['karpfen']);
    // The eel wants a dull night.
    expect(c('gruenhain', 'see', 'nacht', 'sommer', 'regen')).toEqual(['karpfen', 'aal']);
    expect(c('gruenhain', 'fluss', 'daemmerung', 'fruehling')).toEqual(['forelle', 'hecht']);
    expect(c('frostkamm', 'eis', 'daemmerung', 'winter')).toEqual(['hecht', 'quappe']);
    expect(c('salzkueste', 'meer', 'tag', 'sommer')).toEqual(['hering', 'makrele']);
    expect(c('salzkueste', 'meer', 'nacht', 'winter')).toEqual([]);
    expect(c('glutsand', 'see', 'tag', 'sommer')).toEqual([]);
  });

  it('jeder der acht Fische beißt irgendwo; Reusen fangen nur Reusenfische, zu jeder Stunde und bei jedem Wetter', () => {
    expect(FISH).toHaveLength(8);
    for (const f of FISH) {
      let somewhere = false;
      for (const biome of f.biome) for (const water of FISH_WATERS) for (const phase of DAY_PHASES) for (const season of SEASON_IDS) for (const weather of WEATHER_STATE_IDS) somewhere ||= fishFits(f, { biome, water, phase, season, weather }, false);
      expect(somewhere, f.id).toBe(true);
    }
    const trap = (phase: FishConditions['phase'], weather: FishConditions['weather']): string[] =>
      FISH.filter((f) => fishFits(f, { biome: 'gruenhain', water: 'see', phase, season: 'sommer', weather }, true)).map((f) => f.id);
    expect(trap('tag', 'klar')).toEqual(['barsch', 'karpfen', 'aal']);
    expect(trap('nacht', 'gewitter')).toEqual(trap('tag', 'klar'));
  });

  it('der Köder verdreifacht das Gewicht der Fische, die ihn mögen', () => {
    const c: FishConditions = { biome: 'gruenhain', water: 'see', phase: 'tag', season: 'sommer', weather: 'klar' };
    const worm = { biss: 1.5, fische: ['forelle', 'barsch', 'aal'] };
    const share = (bait: string): number => {
      let perch = 0;
      for (let k = 0; k < 1000; k++) if (chooseFish(FISH, c, false, bait, bait === '' ? undefined : worm, (k + 0.5) / 1000)?.id === 'barsch') perch++;
      return perch / 1000;
    };
    // Perch 1.4 against pike 0.4: 78 % without bait, 4.2 : 0.4 = 91 % with the worm.
    expect(share('')).toBeCloseTo(1.4 / 1.8, 2);
    expect(share('regenwurm')).toBeCloseTo((1.4 * B.baitPreference) / (1.4 * B.baitPreference + 0.4), 2);
    expect(chooseFish(FISH, { ...c, biome: 'glutsand' }, false, '', undefined, 0.5)).toBeNull();
  });

  it('Dämmerung um Sonnenaufgang und -untergang, dazwischen Tag, sonst Nacht', () => {
    const t = dayTimes('sommer');
    expect([fishDayPhase('sommer', t.sunrise), fishDayPhase('sommer', 12), fishDayPhase('sommer', t.sunset + 0.5), fishDayPhase('sommer', 1)]).toEqual(['daemmerung', 'tag', 'daemmerung', 'nacht']);
  });
});

/** A rod (and more) in the hand, the player at the shore (6, 5). */
function amUfer(w: AngelWelt, ...items: string[]): void {
  w.spawn(6, 5);
  for (const item of items.slice(1)) w.inventory.give(w.sim, item, 3);
  w.hold(items[0] ?? 'angel_holz');
  w.sim.events.drain(() => undefined);
}

/** Casts to drawn tile (x, y) by command; returns the refusal reason or null. */
function cast(w: AngelWelt, x: number, y: number): string | null {
  const p = w.px(x, y);
  const ev = w.run(1, [{ type: 'fishing.cast', x: p.x, y: p.y }]);
  const r = ev.get('commandRejected') as { reason: string }[] | undefined;
  return r?.[0]?.reason ?? null;
}

/** Steps until the float dips (at most a minute); returns the tick of the bite or −1. */
function waitBite(w: AngelWelt): number {
  for (let t = 0; t < 60 * HZ; t++) {
    const ev = w.run(1);
    const bite = ev.get('fishBite') as { tick: number }[] | undefined;
    if (bite !== undefined) return bite[0]?.tick ?? -1;
  }
  return -1;
}

/** Fights with `reel(tension)` deciding each tick (the reel is held from the hook on); returns the events of the end. */
function drill(w: AngelWelt, reel: (tension: number) => boolean): Map<string, unknown[]> {
  let on = true;
  for (let t = 0; t < 120 * HZ; t++) {
    const l = w.line();
    if (l.phase === 'gefangen' || l.phase === 'verloren' || l.phase === 'aus') break;
    const want = reel(l.tension);
    const cmds: GameCommand[] = want !== on ? [{ type: 'fishing.reel', on: want }] : [];
    on = want;
    const ev = w.run(1, cmds);
    if (ev.has('fishCaught') || ev.has('fishLost')) return ev;
  }
  return new Map();
}

describe('Angel: Wurf, Biss, Drill', () => {
  it('Ablehnungen: ohne Angel, zu weit, an Land, aufs Eis ohne Loch, ein zweiter Wurf', () => {
    const w = angelWelt();
    amUfer(w, 'probe_steinaxt');
    expect(cast(w, 10, 5)).toBe('noRod');
    w.hold('angel_holz');
    expect(cast(w, 6 + B.castReachTiles + 2, 5)).toBe('tooFar');
    expect(cast(w, 4, 5)).toBe('noWater');
    w.eis(10, 3);
    expect(cast(w, 10, 3)).toBe('iceClosed');
    expect(cast(w, 10, 5)).toBeNull();
    expect(cast(w, 11, 5)).toBe('lineOut');
  });

  it('E auf Wasser wirft zum Zielpunkt aus; der Schwimmer landet nach einer halben Sekunde', () => {
    const w = angelWelt();
    amUfer(w, 'angel_holz');
    const far = w.px(11, 5);
    w.run(1, [{ type: 'player.aim', x: Math.round(far.x), y: Math.round(far.y) }]);
    w.run(1);
    // The aimed tile is out of E's reach: the tile ahead (shallow water at the shore) carries the use.
    w.run(1, [{ type: 'player.aim', x: Math.round(w.px(8, 5).x), y: Math.round(w.px(8, 5).y) }]);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'auswerfen', subject: 'suesswasser' });
    const ev = w.run(1, [{ type: 'player.interact', on: true }]);
    expect(ev.get('fishCast')).toEqual([expect.objectContaining({ gewaesser: 'see' })]);
    expect(w.line().phase).toBe('wurf');
    w.run(Math.round(B.castSeconds * HZ) + 1, [{ type: 'player.interact', on: false }]);
    expect(w.line().phase).toBe('warten');
  });

  it('mit ausgeworfener Schnur ist E das Einholen – die Blume am Ufer nimmt den Druck nicht', () => {
    // Wildflowers on the tile north of the shore spot (6, 4).
    const w = angelWelt(7, LAKE_ROWS.map((r, y) => (y === 4 ? `${r.slice(0, 6)}L${r.slice(7)}` : r)));
    amUfer(w, 'angel_holz');
    const far = w.px(11, 5);
    const aimFar: GameCommand = { type: 'player.aim', x: Math.round(far.x), y: Math.round(far.y) };
    w.run(2, [aimFar]);
    // No line: the flower beside the player is the nearest target (the aimed point is out of E's reach).
    expect(w.interaction.focus).toMatchObject({ kind: 'object' });
    expect(cast(w, 11, 5)).toBeNull();
    w.run(2, [aimFar]);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'einholen', subject: 'pose' });
    const ev = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(ev.get('castEnded')).toEqual([expect.objectContaining({ grund: 'eingeholt' })]);
    expect(w.objectAt(6, 4)).toBe('deko_blumen');
    // The figure looked at the float while the line was out (the fishing facing source).
    expect(w.body().facing).toBe('right');
  });

  it('der Biss kommt nach hash(Seed, Wurf-Tick): zwei Welten, ein Tick; verpasst ist der Fisch fort', () => {
    const [a, b] = [angelWelt(), angelWelt()];
    for (const w of [a, b]) {
      amUfer(w, 'angel_holz');
      expect(cast(w, 10, 5)).toBeNull();
    }
    const castTick = a.sim.tick - 1;
    const ta = waitBite(a);
    const tb = waitBite(b);
    expect(ta).toBeGreaterThan(0);
    expect(tb).toBe(ta);
    const landed = castTick + Math.round(B.castSeconds * HZ);
    expect(ta - landed).toBeGreaterThanOrEqual(B.biteMinSeconds * HZ);
    expect(ta - landed).toBeLessThanOrEqual(B.biteMaxSeconds * HZ + 2);
    const ev = a.run(Math.round(B.biteWindowSeconds * HZ) + 1);
    expect(ev.get('fishLost')).toEqual([expect.objectContaining({ grund: 'verpasst' })]);
    a.run(Math.round(B.resultSeconds * HZ) + 1);
    expect(a.line().phase).toBe('aus');
  });

  it('Drill: geschickt halten fängt, immer ziehen reißt die Schnur, nie ziehen lässt ihn entkommen', () => {
    const results: Record<string, unknown> = {};
    for (const [name, reel] of [
      ['geschickt', (t: number) => t < 0.65],
      ['immer', () => true],
      ['nie', () => false],
    ] as const) {
      const w = angelWelt();
      amUfer(w, 'angel_holz');
      expect(cast(w, 10, 5)).toBeNull();
      expect(waitBite(w)).toBeGreaterThan(0);
      const hooked = w.run(1, [{ type: 'fishing.reel', on: true }]);
      expect(hooked.get('fishHooked'), name).toHaveLength(1);
      const before = w.inventory.state.schnellleiste[0]?.haltbarkeit ?? 0;
      const ev = drill(w, reel);
      results[name] = ev.has('fishCaught') ? 'gefangen' : (ev.get('fishLost') as { grund: string }[] | undefined)?.[0]?.grund;
      if (name === 'geschickt') {
        const fish = (ev.get('fishCaught') as { fish: string }[])[0]?.fish as string;
        expect(w.inventory.count(fish)).toBe(1);
        expect(w.awarded).toEqual([B.experience]);
        expect(w.inventory.state.schnellleiste[0]?.haltbarkeit).toBe(before - 1);
      } else expect(w.awarded).toEqual([]);
    }
    expect(results).toEqual({ geschickt: 'gefangen', immer: 'gerissen', nie: 'entkommen' });
  });

  it('der Regenwurm: der Biss kommt anderthalbmal so schnell, beim Biss wird er gegessen', () => {
    const plain = angelWelt();
    const baited = angelWelt();
    amUfer(plain, 'angel_holz');
    amUfer(baited, 'angel_holz', 'regenwurm');
    for (const w of [plain, baited]) expect(cast(w, 10, 5)).toBeNull();
    const landed = plain.sim.tick + Math.round(B.castSeconds * HZ);
    const tp = waitBite(plain) - landed;
    const tb = waitBite(baited) - landed;
    expect(tb / tp).toBeCloseTo(1 / 1.5, 1);
    expect(baited.inventory.count('regenwurm')).toBe(2);
  });

  it('die Schnur kommt los: Angel weggesteckt; fishing.cancel holt sie leer ein', () => {
    const w = angelWelt();
    amUfer(w, 'angel_holz', 'probe_steinaxt');
    expect(cast(w, 10, 5)).toBeNull();
    w.run(HZ);
    const ev = w.run(1, [{ type: 'player.selectHotbar', index: 1 }]);
    const loose = ev.get('castEnded') ?? w.run(1).get('castEnded');
    expect(loose).toEqual([expect.objectContaining({ grund: 'losgerissen' })]);
    w.run(1, [{ type: 'player.selectHotbar', index: 0 }]);
    expect(cast(w, 10, 5)).toBeNull();
    const back = w.run(1, [{ type: 'fishing.cancel' }]);
    expect(back.get('castEnded')).toEqual([expect.objectContaining({ grund: 'eingeholt' })]);
    expect(w.line().phase).toBe('aus');
  });
});

describe('Eisangeln', () => {
  it('die Spitzhacke schlägt ein Loch; der Wurf hinein fischt im Gewässer „eis“; nach zwei Tagen friert es zu', () => {
    const w = angelWelt();
    w.eis(7, 5);
    w.eis(8, 5);
    amUfer(w, 'probe_spitzhacke', 'angel_holz');
    const tx = OFFSET + 7;
    const ty = OFFSET + 5;
    const hole = w.run(1, [{ type: 'fishing.cutHole', tx, ty }]);
    expect(hole.get('iceHoleCut')).toEqual([expect.objectContaining({ tx, ty })]);
    expect(w.run(1, [{ type: 'fishing.cutHole', tx, ty }]).get('commandRejected')).toEqual([expect.objectContaining({ reason: 'holeOpen' })]);
    w.hold('angel_holz');
    w.run(1);
    expect(cast(w, 8, 5)).toBe('iceClosed');
    const ev = w.run(1, [{ type: 'fishing.cast', x: w.px(7, 5).x, y: w.px(7, 5).y }]);
    expect(ev.get('fishCast')).toEqual([expect.objectContaining({ gewaesser: 'eis' })]);
    w.run(1, [{ type: 'fishing.cancel' }]);
    w.sim.skipTicks(B.iceHoleDays * w.sim.clock.ticksPerDay);
    expect(w.fishing.castProblem(0, tx, ty, w.sim.clock.day)).toBe('iceClosed');
    // A pickaxe is needed.
    expect(w.run(1, [{ type: 'fishing.cutHole', tx, ty }]).get('commandRejected')).toEqual([expect.objectContaining({ reason: 'noPickaxe' })]);
  });
});

describe('Reusen', () => {
  /** A world with traps at (8, 3), (9, 6) and (10, 9). */
  function reusen(): AngelWelt {
    const w = angelWelt();
    w.spawn(8, 4);
    w.hold('reuse');
    w.inventory.give(w.sim, 'reuse', 2);
    for (const [x, y, sx, sy] of [
      [8, 3, 8, 4],
      [9, 6, 9, 5],
      [10, 9, 10, 8],
    ] as const) {
      w.place(sx, sy);
      const ev = w.run(1, [{ type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: 0 }, tx: OFFSET + x, ty: OFFSET + y }]);
      expect(ev.get('fishTrapPlaced'), `${x},${y}`).toHaveLength(1);
    }
    return w;
  }

  /** The traps' fish by tile. */
  function catches(w: AngelWelt): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const [x, y] of [
      [8, 3],
      [9, 6],
      [10, 9],
    ]) out[`${x},${y}`] = w.fishing.trapAt(0, OFFSET + (x as number), OFFSET + (y as number))?.fish ?? [];
    return out;
  }

  it('ins offene Wasser gesetzt, eine je Kachel – nicht an Land, nicht aufs Eis', () => {
    const w = reusen();
    expect(w.inventory.count('reuse')).toBe(0);
    w.inventory.give(w.sim, 'reuse', 1);
    w.hold('reuse');
    w.place(8, 4);
    const place = (x: number, y: number): unknown => w.run(1, [{ type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: 0 }, tx: OFFSET + x, ty: OFFSET + y }]).get('commandRejected');
    expect(place(8, 3)).toEqual([expect.objectContaining({ reason: 'trapThere' })]);
    expect(place(7, 4)).toEqual([expect.objectContaining({ reason: 'noWater' })]);
    w.eis(9, 4);
    expect(place(9, 4)).toEqual([expect.objectContaining({ reason: 'noWater' })]);
  });

  it('Fang je 06:00 per Hash bis voll; aktiv ≡ eingefroren + aufgeholt ≡ a → b → c', () => {
    const days = 12;
    const active = reusen();
    const perDay = active.sim.clock.ticksPerDay;
    const end = (Math.floor(active.sim.tick / perDay) + days) * perDay + 1;
    // Active: every dawn stepped (the zone active).
    while (active.sim.tick < end) {
      const toDawn = perDay - (active.sim.tick % perDay);
      if (active.sim.tick + toDawn > end) break;
      active.sim.skipTicks(toDawn - 1);
      active.run(2);
    }
    const expected = catches(active);
    const all = Object.values(expected).flat();
    expect(all.length).toBeGreaterThan(3);
    for (const fish of Object.values(expected)) expect(fish.length).toBeLessThanOrEqual(B.trap.capacity);
    expect(new Set(all).size).toBeGreaterThanOrEqual(2);
    for (const f of all) expect(FISH.find((x) => x.id === f)?.reuse, f).toBe(true);

    for (const pieces of [[end], [Math.floor(end / 3), Math.floor(end * 0.7), end]]) {
      const w = reusen();
      const chunk = w.at(8, 3).chunk;
      w.active = [];
      // Frozen: not resident while it catches up (the traps read their water and biome from the chunk handed over).
      w.frozen.add(chunk.id);
      let from = w.sim.tick;
      for (const to of pieces) {
        w.sim.skipTicks(to - w.sim.tick);
        w.fishing.catchUp(chunk, from, w.sim.tick);
        from = w.sim.tick;
      }
      expect(catches(w), pieces.length === 1 ? 'eingefroren' : 'a → b → c').toEqual(expected);
    }
  });

  it('E leert die Reuse in die Taschen und nimmt sie leer zurück', () => {
    const w = reusen();
    w.active = [w.at(8, 3).chunk];
    w.fishing.catchUp(w.at(8, 3).chunk, 0, 10 * w.sim.clock.ticksPerDay);
    const inTrap = [...(w.fishing.trapAt(0, OFFSET + 8, OFFSET + 3)?.fish ?? [])];
    expect(inTrap.length).toBeGreaterThan(0);
    w.place(8, 4);
    w.hold('angel_holz');
    w.run(1, [{ type: 'player.aim', x: Math.round(w.px(8, 3).x), y: Math.round(w.px(8, 3).y) }]);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'leeren', subject: 'reuse' });
    const emptied = w.run(1, [{ type: 'player.interact', on: true }]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    expect(emptied.get('fishTrapEmptied')).toEqual([expect.objectContaining({ anzahl: inTrap.length })]);
    for (const f of new Set(inTrap)) expect(w.inventory.count(f)).toBe(inTrap.filter((x) => x === f).length);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ action: 'nehmen', subject: 'reuse' });
    const taken = w.run(1, [{ type: 'player.interact', on: true }]);
    expect(taken.get('fishTrapTaken')).toHaveLength(1);
    expect(w.inventory.count('reuse')).toBe(1);
  });
});
