/**
 * M6-35c: die Bildszenarien von `npm run shot` stellen den Spieler dorthin, wo die Interaktion nichts anbietet
 * (`nothingInReach`, src/debug/biomScenarios.ts) – kein „Aufsammeln: Falllaub“ über einem Kreaturenbild. Bodenfunde, die
 * man mit der Hand aufsammelt (`deko_*`), zählen wie jedes Objekt; und der Platz muss für den Spawn offen sein (die neun
 * Kacheln ohne Klippenwand), sonst setzt `player.spawn` den Spieler auf die nächste offene Kachel, neben der ein Fund liegen
 * kann. Geprüft an Kunstwelten und in der Simulation: auf jedem Platz, den `nothingInReach` freigibt, hat die Interaktion
 * nach dem Spawn keinen Fokus.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { nothingInReach } from '../../../src/debug/biomScenarios';
import { InteractionSystem } from '../../../src/game/interaction/system';
import { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import { surfaceShowcase } from '../../../src/render/world/showcase';
import { SurfaceWorldQuery } from '../../../src/render/world/surfaceScene';
import { generateWorld } from '../../../src/world/gen/world';
import { TILE_PX } from '../../../src/world/model/coords';

type Ground = { terrain: string; level: number; water: boolean; solid: boolean };

/** A flat world with `objects` ([x, y, id]) and the height `levelAt` (default 0 everywhere). */
function world(objects: ReadonlyArray<readonly [number, number, string]>, levelAt: (x: number, y: number) => number = () => 0) {
  const obj = new Map(objects.map(([x, y, id]) => [`${x},${y}`, id]));
  return {
    groundAt: (x: number, y: number): Ground => ({ terrain: 'gras', level: levelAt(x, y), water: false, solid: false }),
    objectAt: (x: number, y: number) => obj.get(`${x},${y}`) ?? '',
  };
}

describe('nothingInReach: Bodenfunde und offener Spawnplatz (M6-35c)', () => {
  it('Bodenfunde, die man mit der Hand aufsammelt, zählen wie jedes Objekt', () => {
    const funde = WORLD_OBJECTS.filter((o) => o.kind === 'deko').map((o) => o.id);
    expect(funde).toEqual(expect.arrayContaining(['deko_laub', 'deko_steinchen', 'deko_graeser']));
    for (const id of funde) {
      // Two tiles east: its west edge 1.5 tiles from the feet – in reach; one row further down it is not.
      expect(nothingInReach(world([[2, 0, id]]), 0, 0), id).toBe(false);
      expect(nothingInReach(world([[2, 2, id]]), 0, 0), id).toBe(true);
    }
  });

  it('eine Klippenwand unter den neun Kacheln schließt den Platz aus (der Spawn rückte sonst zur Seite)', () => {
    // A plateau one level up whose edge is two rows north: the row north of the player is its cliff face.
    expect(nothingInReach(world([], (_x, y) => (y <= -2 ? 1 : 0)), 0, 0)).toBe(false);
    // Three rows north and one level up: its face is the row below the edge only – the nine tiles stay open.
    expect(nothingInReach(world([], (_x, y) => (y <= -3 ? 1 : 0)), 0, 0)).toBe(true);
    // Three rows north but two levels up: the face is two rows tall and reaches the row north of the player.
    expect(nothingInReach(world([], (_x, y) => (y <= -3 ? 2 : 0)), 0, 0)).toBe(false);
    // A face beside the player (west neighbour's column) counts as well.
    expect(nothingInReach(world([], (x, y) => (x === -1 && y <= -1 ? 1 : 0)), 0, 0)).toBe(false);
    // Below the player's own row nothing of a plateau to the north matters once it is far enough.
    expect(nothingInReach(world([], (_x, y) => (y <= -5 ? 3 : 0)), 0, 0)).toBe(true);
  });

  it('in der Simulation: wo nothingInReach nichts sieht, hat die Interaktion nach dem Spawn keinen Fokus', { timeout: 60_000 }, () => {
    // The biome series' world (medium) around the Grünhain showcase, where a plateau edge moved the spawn next to fallen
    // leaves (498, 1083 → 499, 1083) before the rule knew cliff faces.
    const seed = 20260923;
    const spot = surfaceShowcase(generateWorld(seed, 'medium'), 'gruenhain');
    const sim = createSimulation({ seed, worldSize: 'medium' });
    const interaction = sim.systems.find((s): s is InteractionSystem => s instanceof InteractionSystem);
    const player = sim.systems.find((s): s is PlayerSystem => s instanceof PlayerSystem);
    if (interaction === undefined || player === undefined) throw new Error('keine Interaktion');
    sim.commands.push({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
    sim.step();
    const q = new SurfaceWorldQuery(sim);
    const at = { x: 0, y: 0 };
    let tested = 0;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -14; dx <= 14; dx++) {
        const tx = spot.tx + dx;
        const ty = spot.ty + dy;
        if (nothingInReach(q, tx, ty) !== true) continue;
        sim.ecs.destroy(sim.player);
        sim.commands.push({ type: 'player.spawn', tx, ty, layer: 0 });
        sim.step();
        sim.step();
        if (!player.position(sim, at)) throw new Error('kein Spieler');
        // The spawn left the player where the scenario stood it, and nothing is in focus there.
        expect([Math.floor(at.x / TILE_PX), Math.floor(at.y / TILE_PX)], `${tx},${ty}`).toEqual([tx, ty]);
        expect(interaction.focus.kind, `${tx},${ty}: ${interaction.focus.subject}`).toBe('none');
        tested++;
      }
    }
    expect(tested).toBeGreaterThanOrEqual(15);
    // The spot of the old picture: a cliff face among its neighbours.
    expect(nothingInReach(q, 498, 1083)).toBe(false);
  });
});
