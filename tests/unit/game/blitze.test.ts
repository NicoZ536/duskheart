/**
 * Lightning (M7-40; MASTERPROMPT §10 "Blitze schlagen bevorzugt in hohe Objekte und Metall, können Bäume und Holzbauten
 * entzünden"; docs/SPIEL.md §18 "Blitze"): a bolt seeks metal before trees and tall things before the open ground, sets a
 * tree alight (fire cause `blitz`), hurts a player beside it (cause `blitz`); in a thunderstorm the strikes come from
 * `hash(seed, 'blitz', region, minute)` – the same for the same world, none under a clear sky, only in the active zone.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { TILE_PX } from '../../../src/world/model/coords';
import { ereignisWelt, OFFSET, type EreignisWelt } from './ereignisse-testwelt';

const W = BALANCE.worldEvents;
const ids = contentWorldIdTables();

/** A meadow of 40 × 30 with trees (`T`) where the rows say; the player at (20, 15). */
function meadow(trees: ReadonlyArray<[number, number]> = []): EreignisWelt {
  const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x) => (trees.some(([tx, ty]) => tx === x && ty === y) ? 'T' : '.')).join(''));
  return ereignisWelt(rows, { x: 20, y: 15 });
}

function struck(map: Map<string, unknown[]>): { x: number; y: number; ziel: string; entzuendet: boolean }[] {
  return (map.get('lightningStruck') ?? []) as { x: number; y: number; ziel: string; entzuendet: boolean }[];
}

/** The drawn tile of a strike's point. */
function tileOf(s: { x: number; y: number }): [number, number] {
  return [Math.floor(s.x / TILE_PX) - OFFSET, Math.floor(s.y / TILE_PX) - OFFSET];
}

describe('lightning: the target', () => {
  it('strikes the nearest tree within its search radius and sets it alight', () => {
    const w = meadow([[23, 12]]);
    const e = w.run(1, [{ type: 'lightning.strike', dx: 1, dy: -2 }]);
    const s = struck(e);
    expect(s).toHaveLength(1);
    expect(tileOf(s[0] as { x: number; y: number })).toEqual([23, 12]);
    expect(s[0]).toEqual(expect.objectContaining({ ziel: 'baum', entzuendet: true }));
    expect((e.get('fireStarted') ?? []) as { cause: string }[]).toEqual([expect.objectContaining({ cause: 'blitz', tx: OFFSET + 23, ty: OFFSET + 12 })]);
  });

  it('prefers metal to a tree, and strikes the open ground when nothing stands near', () => {
    const w = meadow([[23, 12]]);
    const fence = w.chunks.at(OFFSET + 18, OFFSET + 12);
    fence.chunk.object[fence.i] = ids.objects.runtimeId('ort_eisenzaun');
    const e = w.run(1, [{ type: 'lightning.strike', dx: 1, dy: -2 }]);
    expect(struck(e)).toEqual([expect.objectContaining({ ziel: 'metall', entzuendet: false })]);
    expect(tileOf(struck(e)[0] as { x: number; y: number })).toEqual([18, 12]);
    const far = w.run(1, [{ type: 'lightning.strike', dx: 12, dy: 10 }]);
    expect(struck(far)).toEqual([expect.objectContaining({ ziel: 'boden', entzuendet: false })]);
    expect(tileOf(struck(far)[0] as { x: number; y: number })).toEqual([32, 25]);
  });

  it('hurts the player beside it, not one farther away', () => {
    const w = meadow();
    const health = w.vit().health;
    const near = w.run(1, [{ type: 'lightning.strike', dx: 1, dy: 0 }]);
    expect((near.get('playerDamaged') ?? []) as { cause: string; amount: number }[]).toEqual([expect.objectContaining({ cause: 'blitz', amount: W.playerDamage })]);
    expect(w.vit().health).toBe(health - W.playerDamage);
    const away = w.run(1, [{ type: 'lightning.strike', dx: 3, dy: 0 }]);
    expect(away.get('playerDamaged') ?? []).toHaveLength(0);
  });
});

describe('lightning: the storm', () => {
  const storm = (state: 'gewitter' | 'klar', seed = 1): string => {
    const rows = Array.from({ length: 30 }, () => '.'.repeat(40));
    const w = ereignisWelt(rows, { x: 20, y: 15 }, { seed });
    w.weather.state = state;
    // God mode: the storm's strikes near the player do not end the test early.
    w.cheats.god = true;
    const e = w.seconds(120);
    return struck(e)
      .map((s) => tileOf(s).join(','))
      .join(' ');
  };

  it('strikes in a thunderstorm – the same for the same world, other strikes for another seed – and never under a clear sky', () => {
    const a = storm('gewitter');
    // 120 minutes at a chance of 0,25: dozens drawn, those in the drawn (active) area strike.
    expect(a.split(' ').length).toBeGreaterThan(5);
    expect(storm('gewitter')).toBe(a);
    expect(storm('gewitter', 2)).not.toBe(a);
    expect(storm('klar')).toBe('');
    // Every strike lies in the active zone (the drawn 40 × 30) and within the strike range of the player.
    for (const t of a.split(' ')) {
      const [x, y] = t.split(',').map(Number) as [number, number];
      expect(x >= 0 && x < 40 && y >= 0 && y < 30).toBe(true);
      expect(Math.hypot(x - 20, y - 15)).toBeLessThanOrEqual(W.strikeRangeTiles + 1);
    }
  });
});
