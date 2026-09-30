/**
 * Wahrnehmung der Kreaturen (M6-14, MASTERPROMPT §19.4 „Sichtkegel 120°, Sichtweite abhängig vom Licht am Spieler (im
 * Dunkeln schwer zu sehen, eigene Lichtquelle ×2), Gehör (Geräuschereignisse mit Radius …; Regen dämpft)“; docs/SPIEL.md
 * §11): die Formeln, der Geräuschbus eines Ticks und im Spiel – abgewandt hört ein Jäger den Sprint, eine Felswand
 * verdeckt die Sicht, im Dunkeln sieht er erst nah, mit Fackel doppelt so weit.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { hearingRadiusTiles, inSightCone, lightSightFactor, sightRangeTiles } from '../../../src/game/creatures/formulas';
import { NoiseBus } from '../../../src/game/creatures/noise';
import { Simulation } from '../../../src/game/sim';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { kreaturWelt, meadow } from './kreatur-testwelt';

const P = BALANCE.ai.perception;
const N = BALANCE.ai.noise;

describe('Sicht (M6-14)', () => {
  it('Sichtweite nach dem Licht am Spieler: dunkel ein Viertel, eigene Lichtquelle doppelt, Nebel und Starkregen senken sie', () => {
    expect(sightRangeTiles(12, 0.8, false, 0, 0)).toBe(12);
    expect(sightRangeTiles(12, 0.05, false, 0, 0)).toBe(12 * P.lightFactor.dunkel);
    expect(sightRangeTiles(12, 0.05, true, 0, 0)).toBe(12 * P.lightFactor.dunkel * P.ownLightFactor);
    expect(sightRangeTiles(12, 0.2, false, 0, 0)).toBe(12 * P.lightFactor.daemmrig);
    expect(lightSightFactor(0.95)).toBe(P.lightFactor.gleissend);
    // Nebel (Dunst 1) kostet 60 %, leichter Regen nichts, Starkregen ab 0,6 bis ein Fünftel.
    expect(sightRangeTiles(10, 0.8, false, 1, 0)).toBeCloseTo(10 * (1 - P.hazeSightLoss), 10);
    expect(sightRangeTiles(10, 0.8, false, 0, 0.5)).toBe(10);
    expect(sightRangeTiles(10, 0.8, false, 0, 1)).toBeCloseTo(10 * (1 - (1 - P.heavyRainFrom) * P.heavyRainSightLoss), 10);
  });

  it('Sichtkegel 120°: vorn und bis 60° zur Seite ja, darüber hinaus und hinten nein', () => {
    const south = Math.PI / 2;
    expect(inSightCone(south, 0, 10)).toBe(true);
    expect(inSightCone(south, Math.sin((59 * Math.PI) / 180) * 10, Math.cos((59 * Math.PI) / 180) * 10)).toBe(true);
    expect(inSightCone(south, Math.sin((61 * Math.PI) / 180) * 10, Math.cos((61 * Math.PI) / 180) * 10)).toBe(false);
    expect(inSightCone(south, 10, 0)).toBe(false);
    expect(inSightCone(south, 0, -10)).toBe(false);
    expect(P.coneDeg).toBe(120);
  });
});

describe('Gehör (M6-14)', () => {
  it('Regen dämpft: ein Sturm halbiert jeden Radius', () => {
    expect(hearingRadiusTiles(8, 1, 0)).toBe(8);
    expect(hearingRadiusTiles(8, 1.5, 0)).toBe(12);
    expect(hearingRadiusTiles(8, 1, 1)).toBe(8 * (1 - P.rainHearingLoss));
  });

  it('der Bus hält die Geräusche des laufenden Ticks: Schritte mit dem Lärm des Körpers, Kampf, Arbeit, Türen, Bauen', () => {
    const sim = new Simulation({ seed: 1 });
    const bus = new NoiseBus();
    bus.usePlayerPosition((_s, out) => {
      out.x = 100;
      out.y = 200;
      out.layer = 0;
      return true;
    });
    const tick = sim.eventTick;
    // Ein Geräusch eines früheren Ticks (die Warteschlange wurde nicht geleert) zählt nicht.
    sim.events.push('attackStarted', { entity: 1, klasse: 'schwert', schwer: false, kombo: 1, angle: 0, reichweite: 20, bogen: 90, item: null, layer: 0, x: 1, y: 1, tick: tick - 1 });
    sim.events.push('playerStep', { entity: 1, terrain: 'gras', water: 'none', noise: 1.5, tick });
    sim.events.push('playerStep', { entity: 1, terrain: 'gras', water: 'none', noise: 0.3, tick });
    sim.events.push('attackStarted', { entity: 1, klasse: 'schwert', schwer: false, kombo: 1, angle: 0, reichweite: 20, bogen: 90, item: null, layer: 0, x: 5, y: 6, tick });
    sim.events.push('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'baum_eiche', action: 'faellen', material: 'holz', hits: 1, hitsNeeded: 5, tooHard: false, xp: null, tick });
    sim.events.push('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'felsen', action: 'abbauen', material: 'stein', hits: 1, hitsNeeded: 5, tooHard: false, xp: null, tick });
    sim.events.push('doorToggled', { layer: 0, tx: 3, ty: 4, part: 'tuer_holz', open: true, tick });
    bus.collect(sim);
    const radii = Array.from({ length: bus.count }, (_, i) => bus.radius(i));
    expect(radii).toEqual([N.step * 1.5, N.step * 0.3, N.attack, N.chop, N.mine, N.door]);
    // Schleichen ist 70 % leiser als Gehen, Sprinten 50 % lauter.
    expect(bus.radius(1) / N.step).toBeCloseTo(1 - 0.7, 10);
    expect(bus.x(0)).toBe(100);
    expect(bus.y(0)).toBe(200);
    expect(bus.source(4)).toBe(NULL_ENTITY);
    // Ein neuer Tick beginnt leer.
    bus.begin(tick + 1);
    expect(bus.count).toBe(0);
  });
});

describe('Wahrnehmung im Spiel', () => {
  it('abgewandt sieht ein Jäger den stehenden Spieler nicht – hört ihn aber sprinten', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 6 });
    // Der Brecher ruht nach Süden blickend; der Spieler steht 6 Kacheln hinter ihm im Norden.
    const e = w.creature('probe_brecher', 20, 12);
    w.run(60);
    expect(w.state(e).target).toBe(NULL_ENTITY);
    w.run(40, [
      { type: 'player.sprint', on: true },
      { type: 'player.move', dx: -1, dy: 0 },
    ]);
    expect(w.state(e).target).toBe(w.sim.player);
  });

  it('eine Felswand verdeckt die Sicht; ohne sie sieht er den Spieler', () => {
    const wall = meadow(40, 30).map((row, y) => (y === 13 ? '.'.repeat(10) + '#'.repeat(20) + '.'.repeat(10) : row));
    const hidden = kreaturWelt(wall, { x: 20, y: 17 });
    const a = hidden.creature('probe_brecher', 20, 10);
    hidden.run(60);
    expect(hidden.state(a).target).toBe(NULL_ENTITY);
    const open = kreaturWelt(meadow(40, 30), { x: 20, y: 17 });
    const b = open.creature('probe_brecher', 20, 10);
    open.run(60);
    expect(open.state(b).target).toBe(open.sim.player);
  });

  it('im Dunkeln sieht er den Spieler erst nah – mit Fackel doppelt so weit', () => {
    const sight = 20 * P.lightFactor.dunkel;
    const at = Math.floor(sight + 2);
    const dark = kreaturWelt(meadow(40, 40), { x: 20, y: 10 + at });
    dark.light.ambient = 0.05;
    const a = dark.creature('probe_brecher', 20, 10);
    dark.run(60);
    expect(dark.state(a).target).toBe(NULL_ENTITY);
    const lit = kreaturWelt(meadow(40, 40), { x: 20, y: 10 + at });
    lit.light.ambient = 0.05;
    lit.light.lit = true;
    const b = lit.creature('probe_brecher', 20, 10);
    lit.run(60);
    expect(lit.state(b).target).toBe(lit.sim.player);
  });
});
