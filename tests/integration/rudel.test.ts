/**
 * Rudeltaktik (M6-18, MASTERPROMPT §19.4 „Rudel umkreisen und flankieren (Wölfe)“; docs/SPIEL.md §11 „Gruppentaktik“):
 * Wölfe mit gemeinsamem Ziel verteilen sich auf Winkelplätze um den Spieler – ihre Streuung um ihn liegt über 90° – und
 * es greift nur so viele zugleich an, wie ihr Profil erlaubt; die übrigen umkreisen.
 *
 * M6-37: auch in der Spielwelt (`createSimulation`, tests/integration/kampf-welt.ts) mit dem Content-Wolf in der
 * Abenddämmerung: das Rudel steht die meiste Zeit über 90° um den Spieler verteilt, die Angriffe wechseln zwischen den
 * Wölfen und kommen von verschiedenen Seiten (flankieren), nie holen mehr aus, als das Profil erlaubt.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/content/index';
import { angularSpread, packSlotAngle } from '../../src/game/creatures/formulas';
import type { SimEventMap } from '../../src/game/sim';
import { PROBE_PROFILE, kreaturWelt, meadow } from '../unit/game/kreatur-testwelt';
import { kampfWelt } from './kampf-welt';

describe('Rudel (M6-18)', () => {
  it('Winkelplätze verteilen sich über den ganzen Kreis', () => {
    const angles = [0, 1, 2].map((i) => packSlotAngle(i, 3, 0.3));
    expect(angularSpread(angles)).toBeCloseTo((4 * Math.PI) / 3, 10);
    expect(angularSpread([0, Math.PI])).toBeCloseTo(Math.PI, 10);
    expect(angularSpread([0.1])).toBe(0);
  });

  it('drei Wölfe umstellen den Spieler: Streuung über 90°, nur einer schlägt zugleich zu', () => {
    const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
    w.cheats.god = true;
    const before = w.creatures.store.size;
    w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 3, x: w.centre(30, 12).x, y: w.centre(30, 12).y, layer: 0 }]);
    const wolves = Array.from({ length: w.creatures.store.size - before }, (_, i) => w.creatures.store.entityAt(before + i));
    expect(wolves).toHaveLength(3);
    const packs = new Set(wolves.map((e) => w.state(e).pack));
    expect(packs.size).toBe(1);
    expect([...packs][0]).toBeGreaterThan(0);
    const allowed = PROBE_PROFILE.find((p) => p.id === 'probe_wolf')?.rudel?.angreiferZugleich ?? 0;
    w.run(600);
    const spreads: number[] = [];
    for (let k = 0; k < 20; k++) {
      w.run(15);
      const p = w.pos();
      const angles = wolves.map((e) => {
        const at = w.where(e);
        return Math.atan2(at.y - p.y, at.x - p.x);
      });
      spreads.push(angularSpread(angles));
      expect(wolves.filter((e) => w.state(e).attackPhase === 'ausholen').length).toBeLessThanOrEqual(allowed);
      for (const e of wolves) expect(w.state(e).target).toBe(w.sim.player);
    }
    const sorted = [...spreads].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    expect(median).toBeGreaterThan(Math.PI / 2);
    // Die Umkreisenden stehen auf dem Ring (ringTiles), nicht im Knäuel.
    expect(wolves.some((e) => w.state(e).state === 'umkreisen')).toBe(true);
  });
  it('M6-37: Content-Wölfe in der Spielwelt umstellen und flankieren – über 90° verteilt, abwechselnd, von mehreren Seiten', () => {
    const w = kampfWelt({ hour: 19, god: true });
    // Open ground around the player (13 × 13 tiles): the ring of the pack (3,5 tiles) fits.
    w.goTo(w.openSpot(w.tile(), 6));
    const t = w.tile();
    const wolves = w.spawn('wolf', 3, { tx: t.tx, ty: t.ty - 8 });
    const packs = new Set(wolves.map((e) => w.creatures.store.get(e)?.pack ?? 0));
    expect(packs.size).toBe(1);
    expect([...packs][0]).toBeGreaterThan(0);
    const allowed = CONTENT.collection('aiProfiles').get('wolf').rudel?.angreiferZugleich ?? 0;
    expect(allowed).toBe(1);
    const p = w.pos();
    const angleOf = (x: number, y: number): number => Math.atan2(y - p.y, x - p.x);
    const attackers = new Set<number>();
    const origins: number[] = [];
    const spreads: number[] = [];
    const at = { x: 0, y: 0 };
    for (let k = 0; k < 60; k++) {
      for (const [type, payload] of w.run([], 15)) {
        const tel = payload as SimEventMap['creatureTelegraph'];
        if (type !== 'creatureTelegraph' || !wolves.includes(tel.entity)) continue;
        attackers.add(tel.entity);
        origins.push(angleOf(tel.x, tel.y));
      }
      if (k < 10) continue;
      spreads.push(angularSpread(wolves.map((e) => (w.creatures.positionOf(e, at) ? angleOf(at.x, at.y) : 0))));
      expect(wolves.filter((e) => w.creatures.store.get(e)?.attackPhase === 'ausholen').length).toBeLessThanOrEqual(allowed);
      for (const e of wolves) expect(w.creatures.store.get(e)?.target, `Wolf ${e}`).toBe(w.sim.player);
    }
    const sorted = [...spreads].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(Math.PI / 2);
    expect(spreads.filter((x) => x > Math.PI / 2).length).toBeGreaterThanOrEqual(Math.ceil(0.75 * spreads.length));
    // They take turns, and the blows come from different sides: flanking.
    expect(attackers.size).toBeGreaterThanOrEqual(2);
    expect(origins.length).toBeGreaterThanOrEqual(4);
    expect(angularSpread(origins)).toBeGreaterThan(Math.PI / 2);
  });
});
