/**
 * Der Kreaturtakt ohne geboxte Gleitkommazahlen (M6-16d, §30 „Keine Allokationen in Hot-Loops“; Bench
 * `sim:kreaturen-50`): die Wege, auf denen der Takt Zahlen ohne Funktionsargumente weitergibt, rechnen genau wie die Formeln
 * und die Kollision, die sie ersetzen – Bit für Bit:
 * - die Sichtlinie (src/game/creatures/sight.ts) ist der Punkt-Sweep der Kollision (`sweepCircle`, Radius 0, Flugregeln)
 *   auf Felsen, Bäumen, Plateaus und Wasser;
 * - `turnBodyTowards` ist `turnTowards`, `inSightConeOf` ist `inSightCone`, `sightRangeOf(sightFactors(…))` ist
 *   `sightRangeTiles`, der Regenfaktor des Gehörs ist der von `hearingRadiusTiles`;
 * - der Katalog löst Annäherungsreichweite, Telegraph-Ticks je Schwierigkeit und die Zeiten des Profils einmal auf;
 * - Pfad-Tickets: ein verbrauchtes Ticket bleibt in der Liste, bis die nächste Anfrage es ersetzt; stirbt seine Kreatur,
 *   bricht das keine Anfrage ab, die der Pfaddienst inzwischen mit demselben Platz einer anderen Kreatur stellt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DIFFICULTIES } from '../../../src/content/balance/death';
import { Rng } from '../../../src/engine/rng';
import { secondsToTicks } from '../../../src/game/combat/formulas';
import { contentCreatureCatalog } from '../../../src/game/creatures/catalog';
import {
  SenseFactors,
  TURN_PER_TICK,
  TurnDirection,
  hearingRadiusTiles,
  hearingRainFactor,
  inSightCone,
  inSightConeOf,
  senseFactorsOf,
  sightFactors,
  sightRangeOf,
  sightRangeTiles,
  turnBodyTowards,
  turnTowards,
  windupPoseTicks,
  windupTicks,
} from '../../../src/game/creatures/formulas';
import { SightLine } from '../../../src/game/creatures/sight';
import type { PathTicket } from '../../../src/world/path/types';
import { BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, type MoverRules } from '../../../src/world/collision/tiles';
import { createSweepHit, sweepCircle } from '../../../src/world/collision/sweep';
import { kreaturWelt, meadow, OFFSET, T } from './kreatur-testwelt';

/** What blocks a creature's sight (the creature system's rules). */
const SIGHT: MoverRules = Object.freeze({ blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_WALL | BLOCK_VOID, mode: 'fly', dropDown: false });
/** Flight rules that ignore objects (a second rule set: the walk must not depend on the sight rules). */
const HIGH: MoverRules = Object.freeze({ blockMask: BLOCK_SOLID | BLOCK_WALL | BLOCK_VOID, mode: 'fly', dropDown: false });

/** A 40 × 30 map with rocks, trees, a pond and a plateau two levels high (rows of `draw`). */
function rough(): string[] {
  const rng = new Rng(16);
  return Array.from({ length: 30 }, (_, y) =>
    Array.from({ length: 40 }, (_, x) => {
      if (x >= 26 && x <= 33 && y >= 8 && y <= 16) return '2';
      if ((x - 8) * (x - 8) + (y - 20) * (y - 20) < 12) return 'w';
      const v = rng.next();
      return v < 0.05 ? '#' : v < 0.1 ? 'T' : '.';
    }).join(''),
  );
}

describe('Sichtlinie = Punkt-Sweep der Kollision (M6-16d)', () => {
  it('auf 4 000 Linien zwischen beliebigen Punkten, drei Ebenen und zwei Regelwerken dasselbe Urteil', () => {
    const w = kreaturWelt(rough());
    const grid = w.collision.grid;
    const rng = new Rng(3);
    const line = new SightLine();
    const out = createSweepHit();
    let blocked = 0;
    let free = 0;
    for (let n = 0; n < 4000; n++) {
      line.x0 = (OFFSET + rng.float(0, 40)) * T;
      line.y0 = (OFFSET + rng.float(0, 30)) * T;
      // Mostly short lines (sight ranges), now and then across the whole map; some exactly along a tile edge.
      const len = rng.next() < 0.8 ? rng.float(0, 12) * T : rng.float(0, 40) * T;
      const a = rng.next() < 0.1 ? (rng.int(0, 4) * Math.PI) / 2 : rng.float(-Math.PI, Math.PI);
      line.x1 = line.x0 + Math.cos(a) * len;
      line.y1 = line.y0 + Math.sin(a) * len;
      const level = rng.int(0, 3);
      const rules = n % 2 === 0 ? SIGHT : HIGH;
      const sweep = !sweepCircle(grid, 0, line.x0, line.y0, line.x1, line.y1, 0, rules, level, out).hit;
      expect(line.clear(grid, 0, rules, level), `Linie ${n}: (${line.x0}, ${line.y0}) → (${line.x1}, ${line.y1}) auf Ebene ${level}`).toBe(sweep);
      if (sweep) free++;
      else blocked++;
    }
    // Both verdicts occur often (the map is neither empty nor walled in).
    expect(blocked).toBeGreaterThan(800);
    expect(free).toBeGreaterThan(800);
  });

  it('Grenzfälle: Diagonalen genau durch Kachelecken und Linien, die genau auf einer Kachelkante enden', () => {
    // Rocks on a checkerboard: through a corner, one of the two cells beside the line blocks and the other does not – the
    // walk must take the same cell at a tie as the sweep (y first).
    const rows = Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => ((x + y) % 2 === 0 && x > 0 && y > 0 && x < 11 && y < 11 ? '#' : '.')).join(''));
    const w = kreaturWelt(rows);
    const grid = w.collision.grid;
    const line = new SightLine();
    const out = createSweepHit();
    let cases = 0;
    let differ = 0;
    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const) {
          for (const steps of [0.5, 1, 2, 3]) {
            // From a corner along a diagonal (or along an edge), ending on a corner or an edge.
            line.x0 = (OFFSET + x) * T;
            line.y0 = (OFFSET + y) * T;
            line.x1 = line.x0 + dx * steps * T;
            line.y1 = line.y0 + dy * steps * T;
            const sweep = !sweepCircle(grid, 0, line.x0, line.y0, line.x1, line.y1, 0, SIGHT, 0, out).hit;
            expect(line.clear(grid, 0, SIGHT, 0), `(${x}, ${y}) → (${dx}, ${dy}) × ${steps}`).toBe(sweep);
            // The same line from the centre of a tile, ending exactly on the edge of the next tile.
            line.x0 = (OFFSET + x + 0.5) * T;
            line.y0 = (OFFSET + y + 0.5) * T;
            line.x1 = line.x0 + dx * (steps + 0.5) * T;
            line.y1 = line.y0 + dy * (steps + 0.5) * T;
            const edge = !sweepCircle(grid, 0, line.x0, line.y0, line.x1, line.y1, 0, SIGHT, 0, out).hit;
            expect(line.clear(grid, 0, SIGHT, 0), `Mitte (${x}, ${y}) → (${dx}, ${dy}) × ${steps + 0.5}`).toBe(edge);
            cases += 2;
            if (sweep !== edge) differ++;
          }
        }
      }
    }
    expect(cases).toBe(11 * 11 * 8 * 4 * 2);
    expect(differ).toBeGreaterThan(0);
  });

  it('eine Linie der Länge null urteilt über ihre Kachel; unendliche Koordinaten sind ein Fehler', () => {
    const w = kreaturWelt(['.#']);
    const grid = w.collision.grid;
    const line = new SightLine();
    line.x0 = line.x1 = (OFFSET + 0.5) * T;
    line.y0 = line.y1 = (OFFSET + 0.5) * T;
    expect(line.clear(grid, 0, SIGHT, 0)).toBe(true);
    line.x0 = line.x1 = (OFFSET + 1.5) * T;
    expect(line.clear(grid, 0, SIGHT, 0)).toBe(false);
    line.x1 = Number.POSITIVE_INFINITY;
    expect(() => line.clear(grid, 0, SIGHT, 0)).toThrow(RangeError);
    line.x1 = Number.NaN;
    expect(() => line.clear(grid, 0, SIGHT, 0)).toThrow(RangeError);
  });
});

describe('Formeln ohne Argumente rechnen wie ihre Vorbilder (M6-16d)', () => {
  it('turnBodyTowards = turnTowards zum Winkel der Richtung, Bit für Bit; Richtung null lässt die Blickrichtung', () => {
    const rng = new Rng(11);
    const dir = new TurnDirection();
    for (let n = 0; n < 20_000; n++) {
      const body = { facing: rng.float(-4 * Math.PI, 4 * Math.PI) };
      dir.x = rng.next() < 0.05 ? 0 : rng.float(-50, 50);
      dir.y = rng.next() < 0.05 ? 0 : rng.float(-50, 50);
      const expected = dir.x === 0 && dir.y === 0 ? body.facing : turnTowards(body.facing, Math.atan2(dir.y, dir.x), TURN_PER_TICK);
      turnBodyTowards(body, dir);
      expect(Object.is(body.facing, expected), `${n}`).toBe(true);
    }
  });

  it('inSightConeOf = inSightCone', () => {
    const rng = new Rng(12);
    const dir = new TurnDirection();
    let inside = 0;
    for (let n = 0; n < 20_000; n++) {
      const body = { facing: rng.float(-Math.PI, Math.PI) };
      dir.x = rng.next() < 0.02 ? 0 : rng.float(-80, 80);
      dir.y = rng.next() < 0.02 ? 0 : rng.float(-80, 80);
      const expected = inSightCone(body.facing, dir.x, dir.y);
      expect(inSightConeOf(body, dir)).toBe(expected);
      if (expected) inside++;
    }
    expect(inside).toBeGreaterThan(4000);
    expect(inside).toBeLessThan(16_000);
  });

  it('sightRangeOf(sightFactors) = sightRangeTiles, der Regenfaktor = der von hearingRadiusTiles – Bit für Bit', () => {
    const rng = new Rng(13);
    const f = new SenseFactors();
    for (let n = 0; n < 20_000; n++) {
      const sight = rng.int(4, 30);
      const level = rng.float(0, 1.2);
      const own = rng.next() < 0.5;
      const haze = rng.next() < 0.3 ? 0 : rng.float(0, 1);
      const rain = rng.next() < 0.3 ? 0 : rng.float(0, 1.2);
      expect(Object.is(sightRangeOf(sight, sightFactors(level, own, haze, rain, f)), sightRangeTiles(sight, level, own, haze, rain))).toBe(true);
      senseFactorsOf({ light: level, lit: own }, { haze, precipitation: rain }, f);
      expect(Object.is(sightRangeOf(sight, f), sightRangeTiles(sight, level, own, haze, rain))).toBe(true);
      expect(f.hearing).toBe(hearingRainFactor(rain));
      const radius = rng.float(1, 18);
      const hearing = rng.float(0.5, 2);
      expect(Object.is(radius * hearing * f.hearing, hearingRadiusTiles(radius, hearing, rain))).toBe(true);
    }
  });
});

describe('Der Katalog löst die Zahlen des Takts einmal auf (M6-16d)', () => {
  it('Annäherungsreichweite, Telegraph je Schwierigkeit, Gedächtnis, Untersuchen und Tarnung jeder Kreatur', () => {
    const catalog = contentCreatureCatalog();
    expect(catalog.kinds.length).toBeGreaterThanOrEqual(22);
    for (const kind of catalog.kinds) {
      const reaches = kind.attacks.filter((a) => a.ausTarnung !== true).map((a) => a.reichweite);
      expect(kind.approachReach, kind.id).toBe(reaches.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...reaches));
      for (const d of DIFFICULTIES) {
        expect([...kind.windup[d]], `${kind.id} ${d}`).toEqual(kind.attacks.map((a) => windupTicks(a, d)));
        expect([...kind.windupPose[d]], `${kind.id} ${d}`).toEqual(kind.attacks.map((a) => windupPoseTicks(a, d)));
      }
      expect(kind.memoryTicks).toBe(secondsToTicks(kind.profile.gedaechtnis));
      expect(kind.investigateTicks).toBe(secondsToTicks(kind.profile.untersuchen));
      const t = kind.profile.tarnung;
      expect(kind.revealTicks).toBe(t === undefined ? 0 : secondsToTicks(t.erwachen, 1));
      expect(kind.hideTicks).toBe(t === undefined ? 0 : secondsToTicks(t.tarnenNach));
    }
    // The Dornling hides: its camouflage resolves to ticks.
    expect(catalog.get('dornling').revealTicks).toBeGreaterThan(0);
  });
});

describe('Pfad-Tickets: verbrauchte bleiben, ohne fremde Anfragen zu treffen (M6-16d)', () => {
  it('stirbt eine Kreatur mit verbrauchtem Ticket, läuft die Anfrage der anderen weiter, die denselben Platz erhielt', () => {
    // A long meadow in full light; the player at its west end, relentless hunters (sight 20 tiles) east of it: farther
    // than `directTiles`, they ask for paths.
    const w = kreaturWelt(meadow(40, 9), { x: 3, y: 4 });
    w.light.ambient = 1;
    const tickets = (w.creatures as unknown as { tickets: Map<number, PathTicket> }).tickets;
    const a = w.creature('probe_brecher', 18, 4);
    // Facing the player (west), it sees him (a new creature looks south).
    w.state(a).facing = Math.PI;
    // A asks for paths until it is close (then it steers straight): its last ticket is spent (`pathTicket` 0) and stays.
    let asked = false;
    const close = BALANCE.creatures.movement.directTiles * T;
    for (let i = 0; i < 1200 && !(asked && w.state(a).pathTicket === 0 && w.where(a).x - w.centre(3, 4).x < close); i++) {
      w.run(1);
      if (w.state(a).pathTicket !== 0) asked = true;
    }
    expect(asked).toBe(true);
    expect(w.state(a).pathTicket).toBe(0);
    expect(w.where(a).x - w.centre(3, 4).x).toBeLessThan(close);
    const spent = tickets.get(a);
    expect(spent).toBeDefined();
    // B asks next: the service hands it the slot A's last request left (its spare slots are a stack).
    const b = w.creature('probe_brecher', 22, 4);
    w.state(b).facing = Math.PI;
    for (let i = 0; i < 600 && w.state(b).pathTicket === 0; i++) w.run(1);
    const pending = w.state(b).pathTicket;
    expect(pending).not.toBe(0);
    const bTicket = w.creatures.paths.ticket(pending);
    expect(bTicket).toBe(spent);
    expect(bTicket?.owner).toBe(b);
    // A dies next to the player (B stands beyond the kill radius): B's request is not cancelled with it.
    expect(w.where(b).x - w.centre(3, 4).x).toBeGreaterThan(12 * T);
    w.run(1, [{ type: 'creature.kill', radius: 10 }]);
    expect(w.creatures.store.has(a)).toBe(false);
    expect(w.creatures.store.has(b)).toBe(true);
    expect(w.state(b).pathTicket).toBe(pending);
    expect(w.creatures.paths.ticket(pending)).toBe(bTicket);
    // … and arrives: B walks its path.
    for (let i = 0; i < 60 && w.state(b).pathTicket !== 0; i++) w.run(1);
    expect(w.state(b).pathTicket).toBe(0);
    expect(w.state(b).path.length).toBeGreaterThan(0);
  });

  it('stirbt eine Kreatur mit offener Anfrage, endet die Anfrage mit ihr', () => {
    const w = kreaturWelt(meadow(40, 9), { x: 3, y: 4 });
    w.light.ambient = 1;
    const a = w.creature('probe_brecher', 20, 4);
    w.state(a).facing = Math.PI;
    for (let i = 0; i < 600 && w.state(a).pathTicket === 0; i++) w.run(1);
    const pending = w.state(a).pathTicket;
    expect(pending).not.toBe(0);
    expect(w.creatures.paths.ticket(pending)).toBeDefined();
    w.run(1, [{ type: 'creature.kill', radius: 30 }]);
    expect(w.creatures.store.has(a)).toBe(false);
    expect(w.creatures.paths.ticket(pending)).toBeUndefined();
  });
});

describe('Balance der Sinne bleibt die der Formeln', () => {
  it('der Regen dämpft das Gehör wie in BALANCE.ai.perception beschrieben', () => {
    expect(hearingRainFactor(0)).toBe(1);
    expect(hearingRainFactor(1)).toBeCloseTo(1 - BALANCE.ai.perception.rainHearingLoss, 12);
    expect(hearingRainFactor(2)).toBe(hearingRainFactor(1));
  });
});
