/**
 * Kreaturbestand der Bildszenarien (M6-Gate-Bildprüfung `brand`: ein Wolf der Nacht drückte sich an den Spieler, eine Wachtel
 * stand an der Flammenwand; src/debug/scenarioCreatures.ts):
 * - um das Thema eines Bildes gehen Feinde in einem weiten, friedliche Tiere in einem engen Umkreis (die Grenze zählt mit),
 *   Kreaturen anderer Ebenen bleiben;
 * - `clearCreatures` lässt sie über den Befehl `despawn` gehen: nach dem nächsten Tick sind sie fort, ohne Kadaver, ohne Beute,
 *   ohne Fehler in den Ticks danach; fernes Wild bleibt;
 * - ohne lesbare Simulation verweigert es das Bild;
 * - `brand` und `stationen-nacht` halten Feinde aus der Ansicht und Tiere von ihrem ganzen Motiv fern (ein Wolf am Spieler,
 *   ein Hase am Sägebock), die übrigen Basisbilder lassen den Bestand leben (seine Tiere stehen dort fern vom Motiv);
 * - der Helfer liegt in der Darstellungsschicht (src/render/scenes/creatureStock.ts): die Wasserbilder dürfen src/debug nicht
 *   importieren und räumen damit das Hinweisschild von `wasser-ufer` (Runde 2: ein Hase saß darauf);
 * - eine für ein Bild entzündete Fackel brennt lange genug, bis das Bild entsteht: die Funken ihrer Zündung sind erloschen
 *   (Runde 2: drei Ticks vor dem Bild entzündet standen sie als eingefrorener Haufen auf der Brust, `kreaturen-kueste-nacht`).
 */
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/engine/ecs';
import { basisKreaturenFern, basisMotive } from '../../../src/debug/basisScenarios';
import { clearCreatures, creaturesToClear, IGNITION_TICKS, ignitionSettleTicks, livingCreatures, settleIgnition, STOCK_CLEARING, VIEW_CLEARING_TILES, type CreatureAt } from '../../../src/debug/scenarioCreatures';
import { coastPicture } from '../../../src/debug/kreaturenKueste';
import { gruenhainPicture } from '../../../src/debug/kreaturenGruenhain';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { FigureFx, SPARKS } from '../../../src/render/game/figureFx';
import type { RenderScene } from '../../../src/render/scene';
import * as stock from '../../../src/render/scenes/creatureStock';
import { BALANCE } from '../../../src/content/balance';
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

describe('Der Helfer der Darstellungsschicht (src/render/scenes/creatureStock.ts)', () => {
  it('ist derselbe, den die Debug-Szenarien nutzen: die Wasserbilder räumen ohne Import aus src/debug', () => {
    expect(clearCreatures).toBe(stock.clearCreatures);
    expect(creaturesToClear).toBe(stock.creaturesToClear);
    expect(livingCreatures).toBe(stock.livingCreatures);
    expect(STOCK_CLEARING).toBe(stock.STOCK_CLEARING);
  });
});

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();

/** Sprites FigureFx draws for its bursts at presentation time `time`. */
function burstSprites(fx: FigureFx, time: number): number {
  let n = 0;
  const scene = { sprite: new SpriteDesc(), sprites: { push: () => n++ } } as unknown as RenderScene;
  fx.drawBursts(scene, MANIFEST, 0, time);
  return n;
}

/**
 * A torch lit in a scenario's tick, then `settle` (true: `settleIgnition`) and the picture's own `after` ticks, its still drawn
 * at one presentation time: the sprites of the ignition's sparks in it.
 */
function sparksInPicture(after: number, settle: boolean): number {
  const sim = { tick: 500, clock: { tickHz: BALANCE.time.tickHz } };
  let ignited: ((e: unknown) => void) | null = null;
  const fx = new FigureFx();
  fx.follow({ sim, onEvent: (name: string, h: (e: unknown) => void) => ((ignited = name === 'lightIgnited' ? h : ignited), () => undefined) } as never);
  // The tick the torch catches in: its event carries the tick being stepped.
  (ignited as ((e: unknown) => void) | null)?.({ x: 100, y: 100, layer: 0, tick: sim.tick, light: 3 });
  sim.tick += 1;
  if (settle) settleIgnition({ step: () => (sim.tick += 1) }, after);
  sim.tick += after;
  const n = burstSprites(fx, 0.4);
  fx.dispose();
  return n;
}

describe('Fackel vor dem Bild (scenarioCreatures.ts settleIgnition)', () => {
  it('die Zündfunken sind erloschen, wenn das Bild entsteht – ohne die Wartezeit stand der Haufen auf der Brust', () => {
    // `kreaturen-kueste-nacht`: two cast steps after the torch's tick; `-klein`: the clearing's tick and two.
    for (const after of [2, 3]) {
      expect(sparksInPicture(after, false), `ohne ${after}`).toBeGreaterThan(0);
      expect(sparksInPicture(after, true), `mit ${after}`).toBe(0);
    }
    // A picture long after the torch (the forming brood: 36 steps) waits no tick more.
    expect(ignitionSettleTicks(36)).toBe(0);
    expect(sparksInPicture(36, false)).toBe(0);
  });

  it('wartet genau die fehlenden Ticks: die Lebenszeit der Funken und einen Tick Spielraum der Darstellung', () => {
    expect(IGNITION_TICKS).toBe(Math.ceil(SPARKS.life * BALANCE.time.tickHz) + 2);
    let steps = 0;
    expect(settleIgnition({ step: () => steps++ }, 3)).toBe(IGNITION_TICKS - 3);
    expect(steps).toBe(IGNITION_TICKS - 3);
    steps = 0;
    expect(settleIgnition({ step: () => steps++ }, IGNITION_TICKS)).toBe(0);
    expect(steps).toBe(0);
    // The pictures that light a torch: their sparks would stand in them without the wait.
    const torch = [gruenhainPicture('kreaturen-gruenhain-klein'), gruenhainPicture('kreaturen-gruenhain-gegner-nacht'), coastPicture('kreaturen-kueste-nacht')];
    for (const p of torch) {
      expect(p?.torch, p?.name).toBe(true);
      expect(ignitionSettleTicks((p?.clearStock === true ? 1 : 0) + (p?.steps ?? 2)), p?.name).toBeGreaterThan(0);
    }
  });
});
