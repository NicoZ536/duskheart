/**
 * Kreaturbestand der Bildszenarien (M6-Gate-Bildprüfung `brand`: ein Wolf der Nacht drückte sich an den Spieler, eine Wachtel
 * stand an der Flammenwand; src/debug/scenarioCreatures.ts):
 * - um das Thema eines Bildes gehen Feinde in einem weiten, friedliche Tiere in einem engen Umkreis (die Grenze zählt mit),
 *   Kreaturen anderer Ebenen bleiben;
 * - `clearCreatures` lässt sie über den Befehl `despawn` gehen: nach dem nächsten Tick sind sie fort, ohne Kadaver, ohne Beute,
 *   ohne Fehler in den Ticks danach; fernes Wild bleibt;
 * - ohne lesbare Simulation verweigert es das Bild;
 * - `brand` und `stationen-nacht` halten Feinde aus der Ansicht und Tiere von ihrem ganzen Motiv fern (ein Wolf am Spieler,
 *   ein Hase am Sägebock), die übrigen Basisbilder lassen den Bestand leben (seine Tiere stehen dort fern vom Motiv).
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/engine/ecs';
import { basisKreaturenFern, basisMotive } from '../../../src/debug/basisScenarios';
import { clearCreatures, creaturesToClear, livingCreatures, STOCK_CLEARING, VIEW_CLEARING_TILES, type CreatureAt } from '../../../src/debug/scenarioCreatures';
import type { GameCommand } from '../../../src/game/commands';
import { TILE_PX } from '../../../src/world/model/coords';
import { kreaturWelt, meadow, type KreaturWelt } from '../game/kreatur-testwelt';

const FERN = { feindeKacheln: 20, tiereKacheln: 6 } as const;

function at(entity: number, familie: string, tilesEast: number, layer = 0): CreatureAt {
  return { entity: entity as Entity, familie, layer, x: 1000 + tilesEast * TILE_PX, y: 500 };
}

describe('creaturesToClear', () => {
  it('Feinde im weiten, friedliche Tiere im engen Umkreis, die Grenze zählt mit; andere Ebenen bleiben', () => {
    const list = [at(1, 'gegner', 19), at(2, 'gegner', 20), at(3, 'gegner', 21), at(4, 'schattenbrut', 3), at(5, 'friedlich', 6), at(6, 'friedlich', 7), at(7, 'gegner', 2, -1), at(8, 'elite', 10)];
    expect(creaturesToClear(list, 0, 1000, 500, FERN, [])).toEqual([1, 2, 4, 5, 8]);
    // The output list is emptied first.
    const out = [99 as Entity];
    expect(creaturesToClear(list, -1, 1000, 500, FERN, out)).toEqual([7]);
  });

  it('der Bestand einer Kreaturszene geht aus der ganzen Ansicht', () => {
    expect(STOCK_CLEARING).toEqual({ feindeKacheln: VIEW_CLEARING_TILES, tiereKacheln: VIEW_CLEARING_TILES });
    // 640 px of the widest view show ±20 tiles.
    expect(VIEW_CLEARING_TILES).toBeGreaterThan(20);
  });
});

/** The session of a scenario on a creature test world: commands are queued for the next step. */
function session(w: KreaturWelt): { command(raw: unknown): unknown; step(): void; sim(): KreaturWelt['sim'] } {
  let queue: GameCommand[] = [];
  return {
    command(raw) {
      queue.push(raw as GameCommand);
      return undefined;
    },
    step() {
      const cmds = queue;
      queue = [];
      w.run(1, cmds);
    },
    sim: () => w.sim,
  };
}

describe('clearCreatures auf einer Kreaturwelt', () => {
  it('Wolf und nahes Wild gehen nach dem nächsten Tick, ohne Kadaver und Beute; fernes Wild bleibt', () => {
    const w = kreaturWelt(meadow(60, 30), { x: 10, y: 15 }, 1, 'inhalt');
    const wolf = w.creature('wolf', 22, 15);
    const near = w.creature('hase', 14, 16);
    const far = w.creature('hase', 40, 15);
    const s = session(w);
    const centre = w.where(near);
    const fern = { feindeKacheln: 16, tiereKacheln: 5 };
    const ids = (): Entity[] => livingCreatures(w.sim).map((c) => c.entity);
    expect(ids()).toEqual(expect.arrayContaining([wolf, near, far]));
    expect(clearCreatures(s, 0, centre.x, centre.y, fern)).toBe(2);
    s.step();
    expect(ids()).not.toContain(wolf);
    expect(ids()).not.toContain(near);
    expect(ids()).toContain(far);
    expect(w.creatures.carcasses.size).toBe(0);
    expect(w.spilled).toEqual([]);
    // The world runs on without them.
    for (let i = 0; i < 120; i++) s.step();
    expect(ids()).toContain(far);
    expect(clearCreatures(s, 0, centre.x, centre.y, fern)).toBe(0);
  });

  it('ohne lesbare Simulation verweigert es das Bild', () => {
    expect(() => clearCreatures({ command: () => undefined }, 0, 0, 0, FERN)).toThrow(/ScenarioSession\.sim/);
  });
});

describe('Basisbilder', () => {
  it('brand und stationen-nacht halten Feinde aus der Ansicht und Tiere vom ganzen Motiv fern, die übrigen lassen den Bestand leben', () => {
    const fern = basisKreaturenFern();
    const motive = basisMotive();
    for (const name of ['brand', 'stationen-nacht']) {
      const f = fern[name];
      expect(f, name).toBeDefined();
      expect(f?.feindeKacheln, name).toBe(VIEW_CLEARING_TILES);
      // Every tile of the subject – the shed and the fire, the stations, the torches, the player – lies at least one tile (a
      // sprite's reach) inside the animals' circle.
      const motiv = motive[name] ?? [];
      expect(motiv.length, name).toBeGreaterThan(5);
      for (const [x, y] of motiv) expect(Math.hypot(x - (f?.x ?? 0), y - (f?.y ?? 0)), `${name} ${x},${y}`).toBeLessThanOrEqual((f?.tiereKacheln ?? 0) - 1);
    }
    for (const name of ['basis-aussen', 'basis-innen', 'buntglas', 'nebel-innen']) expect(fern[name], name).toBeUndefined();
  });
});
