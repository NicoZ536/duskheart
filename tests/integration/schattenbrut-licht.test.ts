/**
 * Schattenbrut meidet Licht (M6-28, MASTERPROMPT §12.4 „Meidet Licht > 0,5“; docs/SPIEL.md §11 „Schattenbrut-Licht“):
 * sechs Schleicher jagen nachts einen Spieler, der im Schein zweier Lichter steht – in 1000 Ticks betritt keiner eine
 * Kachel heller als 0,5, obwohl sie bis an den Rand des Lichts kommen (Pfade mit Lichtsperre, Schritte ins Licht
 * abgewiesen, auch beim Zurückstoßen).
 *
 * M6-37: auch in der Spielwelt (`createSimulation`, tests/integration/kampf-welt.ts) mit der echten Lichtkarte, einer
 * brennenden Fackel in der Hand und einem Lagerfeuer daneben, nachts, gegen die ganze Grundfamilie des Contents (Schleicher,
 * Kriecher, Speier, Lichtfresser) und was der Nachtspawner dazu bringt: in 1000 Ticks steht keine Schattenbrut auf einer
 * Kachel heller als ihre Schwelle (0,5; der Lichtfresser nur gleißendes Licht über 0,9, §12.4 „Ausnahmen“), und sie kommen
 * bis an den Rand des Lichts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { CONTENT } from '../../src/content/index';
import type { SimEventMap } from '../../src/game/sim';
import { TILE_PX } from '../../src/world/model/coords';
import { kreaturWelt, meadow, tileOf } from '../unit/game/kreatur-testwelt';
import { centreOf, kampfWelt, tileAt } from './kampf-welt';

const LIMIT = BALANCE.creatures.shadowBrood.avoidLightAbove;

describe('Schattenbrut im Licht (M6-28)', () => {
  it('in 1000 Ticks betritt keine Schattenbrut Licht über 0,5', () => {
    const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const p = w.pos();
    // Eine Fackel am Spieler (heller als 0,5, nicht gleißend) und ein Lagerfeuer daneben.
    w.light.discs.push({ x: p.x, y: p.y, radius: 5, level: 0.6 }, { x: p.x + 7 * TILE_PX, y: p.y, radius: 4, level: 0.7 });
    const brood = [
      [30, 12],
      [18, 25],
      [42, 25],
      [30, 38],
      [20, 15],
      [40, 36],
    ].map(([x, y]) => w.creature('probe_schleicher', x as number, y as number));
    let nearest = Infinity;
    for (let t = 0; t < 1000; t++) {
      w.run(1);
      for (const e of brood) {
        if (!w.creatures.store.has(e)) continue;
        const at = w.where(e);
        const { tx, ty } = tileOf(at);
        expect(w.light.tileLevel(null, 0, tx, ty), `Tick ${w.sim.tick}`).toBeLessThanOrEqual(LIMIT);
        nearest = Math.min(nearest, Math.hypot(at.x - p.x, at.y - p.y) / TILE_PX);
      }
    }
    expect(brood.every((e) => w.creatures.store.has(e))).toBe(true);
    // They came to the edge of the torch light (radius 5), they did not keep away.
    expect(nearest).toBeLessThan(6.5);
  });
  it('M6-37: in der Spielwelt betritt keine Schattenbrut des Contents in 1000 Ticks Licht über ihrer Schwelle – Fackel und Lagerfeuer', () => {
    const w = kampfWelt({ hour: 22, god: true });
    w.goTo(w.openSpot(w.tile(), 3));
    // A burning torch in the off hand, a camp fire with logs beside the player.
    w.ok('Licht', [
      { type: 'inventory.give', item: 'fackel', count: 1 },
      { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
      { type: 'inventory.give', item: 'holz', count: 4 },
    ]);
    const bag = (item: string): { bereich: 'schnellleiste' | 'inventar'; index: number } => {
      for (const bereich of ['schnellleiste', 'inventar'] as const) {
        const index = w.inventory.state[bereich].findIndex((x) => x?.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`${item} fehlt`);
    };
    w.ok('Fackel in die Nebenhand', [{ type: 'inventory.move', from: bag('fackel'), to: { bereich: 'ausruestung', index: 5 }, count: 1 }]);
    w.ok('Fackel an', [{ type: 'light.toggle' }]);
    const me = w.tile();
    const fire = { tx: me.tx + 2, ty: me.ty };
    w.ok('Lagerfeuer in die Hand', [{ type: 'inventory.move', from: bag('lagerfeuer'), to: { bereich: 'schnellleiste', index: 1 } }]);
    w.ok('wählen', [{ type: 'player.selectHotbar', index: 1 }]);
    const placed = w
      .ok('aufstellen', [{ type: 'player.aim', ...centreOf(fire) }, { type: 'player.useItem' }])
      .find((e) => e[0] === 'lightPlaced')?.[1] as SimEventMap['lightPlaced'] | undefined;
    if (placed === undefined) throw new Error('Lagerfeuer steht nicht');
    w.ok('Holz', [{ type: 'light.fuel', light: placed.light, from: bag('holz'), count: 4 }]);
    w.ok('entzünden', [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }], 30);
    expect(w.light.carried?.burn.lit).toBe(true);
    expect(w.lightAt(me)).toBeGreaterThan(LIMIT);
    // The base family north of the player (a new creature faces south: it sees the player's light), a dozen tiles off in
    // the dark; the light eater comes later.
    const spots = [
      ['schleicher', 0, -12],
      ['schleicher', 9, -9],
      ['kriecher', -6, -10],
      ['speier', 5, -12],
    ] as const;
    for (const [id, dx, dy] of spots) {
      const at = { tx: me.tx + dx, ty: me.ty + dy };
      expect(w.lightAt(at), `${id} erscheint im Dunkeln`).toBeLessThan(0.15);
      w.spawn(id, 1, at);
    }
    const threshold = (creature: string): number => CONTENT.collection('aiProfiles').get(CONTENT.collection('creatures').get(creature).ki).meidetLicht ?? 1;
    expect(threshold('schleicher')).toBe(LIMIT);
    expect(threshold('lichtfresser')).toBeGreaterThan(BALANCE.light.map.stages.glaringAbove - 1e-9);
    const p = w.pos();
    const at = { x: 0, y: 0 };
    /** Runs `ticks` ticks; every tick no living shadow brood stands on a tile brighter than its threshold. Nearest approach per kind [tiles]. */
    const watch = (ticks: number): { nearest: Map<string, number>; checks: number; events: SimEventMap['lightExtinguished'][] } => {
      const nearest = new Map<string, number>();
      const events: SimEventMap['lightExtinguished'][] = [];
      let checks = 0;
      for (let t = 0; t < ticks; t++) {
        for (const [type, payload] of w.run()) if (type === 'lightExtinguished') events.push(payload as SimEventMap['lightExtinguished']);
        const store = w.creatures.store;
        for (let i = 0; i < store.size; i++) {
          const s = store.valueAt(i);
          if (s.fadeTick >= 0 || s.health <= 0 || !w.creatures.catalog.get(s.creature).shadow) continue;
          if (!w.creatures.positionOf(store.entityAt(i), at)) continue;
          checks++;
          expect(w.lightAt(tileAt(at)), `${s.creature} Tick ${w.sim.tick}`).toBeLessThanOrEqual(threshold(s.creature) + 1e-9);
          nearest.set(s.creature, Math.min(nearest.get(s.creature) ?? Infinity, Math.hypot(at.x - p.x, at.y - p.y) / TILE_PX));
        }
      }
      return { nearest, checks, events };
    };
    // 1000 ticks with the lights burning: nobody steps into them, but they come to their edge.
    const lit = watch(1000);
    expect(lit.checks).toBeGreaterThanOrEqual(4 * 1000);
    expect(w.light.carried?.burn.lit).toBe(true);
    for (const id of ['schleicher', 'kriecher', 'speier']) {
      expect(lit.nearest.get(id), id).toBeLessThan(9);
      expect(lit.nearest.get(id), id).toBeGreaterThan(1);
    }
    // Then the light eater: it goes nearer than the rest – up to glaring light – and puts the torch out (M6-26, ADR-0110);
    // every brood keeps to its threshold all the while.
    w.spawn('lichtfresser', 1, { tx: me.tx - 8, ty: me.ty - 10 });
    const eaten = watch(1000);
    expect(eaten.nearest.get('lichtfresser')).toBeLessThan(4);
    expect(eaten.events.some((e) => e.reason === 'lichtfresser')).toBe(true);
    expect(w.light.carried?.burn.lit).toBe(false);
  });
});
