/**
 * Rudeltaktik (M6-18, MASTERPROMPT §19.4 „Rudel umkreisen und flankieren (Wölfe)“; docs/SPIEL.md §11 „Gruppentaktik“):
 * Wölfe mit gemeinsamem Ziel verteilen sich auf Winkelplätze um den Spieler – ihre Streuung um ihn liegt über 90° – und
 * es greift nur so viele zugleich an, wie ihr Profil erlaubt; die übrigen umkreisen.
 */
import { describe, expect, it } from 'vitest';
import { angularSpread, packSlotAngle } from '../../src/game/creatures/formulas';
import { PROBE_PROFILE, kreaturWelt, meadow } from '../unit/game/kreatur-testwelt';

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
});
