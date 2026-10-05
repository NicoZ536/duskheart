/**
 * `wasser-ufer` hält das Hinweisschild frei (M6-Gate Runde 2: ein Hase der Uferbank saß darauf, seine langen Ohren über der
 * Schildkante; src/render/water/scenarios.ts): steht der Spieler am Ufer, gehen die friedlichen Tiere im Umkreis des
 * Schilds über `despawn` (src/render/scenes/creatureStock.ts – die Darstellungsschicht darf src/debug nicht importieren), im
 * Tick des letzten Schritts – kein Tick mehr fürs Bild. Feinde und fernes Wild bleiben; die Spiegelbilder räumen nichts.
 */
import { describe, expect, it } from 'vitest';
import { waterScenarios, WATER_SCENARIOS } from '../../../src/render/water/scenarios';
import { kreaturWelt, type KreaturWelt } from '../game/kreatur-testwelt';
import { meadow } from '../game/kampf-testwelt';

/** World tile of map tile (0, 0) of the creature test worlds (their map lies off the world's origin). */
const MAP = 64;
/** World tile rows of the lake: open water north of row `SHORE` (deep), dry land from it on. */
const SHORE = MAP + 13;
/** Where the camera stands (the showcase): on land south of the lake. */
const CAMERA = { tx: MAP + 20, ty: MAP + 17 } as const;

interface Run {
  readonly commands: { type: string; entity?: number }[];
  readonly steps: number;
}

/**
 * Runs the water scenario `name` against a fake view of a lake – north of the shore row, or (`south`) south of it – and the
 * creature world `w` (its simulation only read).
 */
function run(name: string, w: KreaturWelt, south = false): Run {
  const scenario = waterScenarios().find((s) => s.name === name);
  if (scenario === undefined) throw new Error(name);
  const commands: { type: string; entity?: number }[] = [];
  let steps = 0;
  const render = {
    showScene: () => undefined,
    setDebugView: () => undefined,
    sceneReady: () => true,
    startGameCamera: () => undefined,
    gameCamera: () => ({ layer: 0, ...CAMERA }),
    waterDepth: (_tx: number, ty: number) => ((south ? ty > SHORE : ty < SHORE) ? 2 : 0),
  };
  const session = {
    command: (raw: unknown) => commands.push(raw as { type: string }),
    step: () => steps++,
    state: () => ({ player: { swimming: false }, world: { moonPhase: 4 } }) as never,
    sim: () => w.sim,
  };
  scenario.setup({ freezeAt: () => undefined, render, session });
  for (let i = 0; i < 100 && !scenario.ready(); i++);
  expect(scenario.ready()).toBe(true);
  return { commands, steps };
}

describe('wasser-ufer: das Hinweisschild bleibt frei', () => {
  it('der Hase am Schild geht, der Keiler und der ferne Hase bleiben – ohne einen Tick mehr', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 20 }, 1, 'inhalt');
    // The player ends on the bank one tile inland from the shore row (bank map tile 20,13 → player 20,14).
    const hare = w.creature('hase', 22, 14);
    const boar = w.creature('keiler', 23, 14);
    const far = w.creature('hase', 28, 14);
    expect([Math.floor(w.where(hare).x / 16), Math.floor(w.where(hare).y / 16)]).toEqual([MAP + 22, MAP + 14]);
    const r = run(WATER_SCENARIOS.shore, w);
    const gone = r.commands.filter((c) => c.type === 'despawn').map((c) => c.entity);
    expect(gone).toEqual([hare]);
    expect(gone).not.toContain(boar);
    expect(gone).not.toContain(far);
    // The despawn is queued before the last step back from the bank, which takes it: no tick more for the picture – two
    // ticks at the start, one onto the bank, two facing the water, one back from it.
    const last = r.commands.map((c) => c.type).lastIndexOf('player.teleport');
    expect(r.commands.findIndex((c) => c.type === 'despawn')).toBeLessThan(last);
    expect(r.steps).toBe(6);
  });

  it('die anderen Wasserbilder räumen keinen Bestand', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 20 }, 1, 'inhalt');
    w.creature('hase', 22, 14);
    w.creature('hase', 22, 12);
    for (const name of [WATER_SCENARIOS.mirrorDay, WATER_SCENARIOS.mirrorNight]) {
      expect(run(name, w, true).commands.some((c) => c.type === 'despawn'), name).toBe(false);
    }
  });
});
