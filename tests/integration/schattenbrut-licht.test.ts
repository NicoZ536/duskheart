/**
 * Schattenbrut meidet Licht (M6-28, MASTERPROMPT §12.4 „Meidet Licht > 0,5“; docs/SPIEL.md §11 „Schattenbrut-Licht“):
 * sechs Schleicher jagen nachts einen Spieler, der im Schein zweier Lichter steht – in 1000 Ticks betritt keiner eine
 * Kachel heller als 0,5, obwohl sie bis an den Rand des Lichts kommen (Pfade mit Lichtsperre, Schritte ins Licht
 * abgewiesen, auch beim Zurückstoßen).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { TILE_PX } from '../../src/world/model/coords';
import { kreaturWelt, meadow, tileOf } from '../unit/game/kreatur-testwelt';

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
});
