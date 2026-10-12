/**
 * Der Bratspieß über dem Lagerfeuer (M7-102; MASTERPROMPT §18 „Spieß am Feuer“; src/render/game/lights.ts,
 * assets-src/sprites/platzierbar/lagerfeuer_spiess.ts): solange der Spieler ein Gericht am Lagerfeuer gart, zeigt das Feuer
 * den Spieß mit diesem Gericht (`spiess_<erzeugnis>`, Clip `dreht`) – auf dem Fußpunkt des Feuers, knapp davor sortiert, auf
 * seiner Höhe; ohne Auftrag, wenn das Stück stockt, nach dem letzten Stück und bei einem Rezept ohne Spießbild (Holzkohle)
 * steht keiner. Er steht am brennenden Lagerfeuer, das der Figur am nächsten ist; ein Gericht an einer Station, die nicht
 * brennt, trägt keinen (M7-135, ein gebauter Fall: kein Inhalt erreicht die Wache).
 */
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import type { CraftOrder } from '../../../src/game/crafting/state';
import type { CraftingSystem } from '../../../src/game/crafting/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createLightFrame, LightBridge, SPIT_CLIP, SPIT_SPRITE_PREFIX } from '../../../src/render/game/lights';
import { RenderScene } from '../../../src/render/scene';
import { TILE_PX } from '../../../src/world/model/coords';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const OWNER = (() => {
  const owner = new Map<unknown, { id: string; index: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, index) => owner.set(f, { id: s.id, index }));
  return owner;
})();

/** The four spit dishes of the camp fire (src/content/recipes/gerichte.ts „Spit at the camp fire“). */
const DISHES = ['gebratenes_fleisch', 'gebratener_fisch', 'pilzspiess', 'geroesteter_mais'] as const;

function run(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): string[] {
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain((type, e) => {
      if (type === 'commandRejected') refused.push(JSON.stringify(e));
    });
  }
  return refused;
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`kein ${item} im Gepäck`);
}

function playerAt(sim: Simulation): { x: number; y: number } {
  const p = { x: 0, y: 0 };
  if (!(sim.system('player') as unknown as PlayerSystem).position(sim, p)) throw new Error('kein Spieler');
  return p;
}

interface Camp {
  readonly sim: Simulation;
  readonly light: LightSystem;
  readonly crafting: CraftingSystem;
}

/** Noon, the player (god mode) beside a camp fire laid with wood and lit; the bags hold what the spit dishes need. */
function camp(): Camp {
  const sim = createSimulation({ seed: 20261004, worldSize: 'small' });
  run(sim, [{ type: 'player.spawn' }], 2);
  run(sim, [{ type: 'setTime', hour: 12, minute: 0 }, { type: 'debug.god', on: true }]);
  run(sim, [
    { type: 'inventory.give', item: 'lagerfeuer', count: 2 },
    { type: 'inventory.give', item: 'holz', count: 20 },
    { type: 'inventory.give', item: 'forelle', count: 2 },
    { type: 'inventory.give', item: 'wildfleisch_roh', count: 1 },
  ]);
  const light = sim.system('light') as unknown as LightSystem;
  const crafting = sim.system('crafting') as unknown as CraftingSystem;
  lightFireBeside(sim, light, [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]);
  return { sim, light, crafting };
}

/** Places a camp fire on the first free tile at `offsets` [tiles] from the player, lays wood on it and lights it; its id. */
function lightFireBeside(sim: Simulation, light: LightSystem, offsets: readonly (readonly [number, number])[]): number {
  const p = playerAt(sim);
  const before = light.state.placed.length;
  for (const [dx, dy] of offsets) {
    if (light.state.placed.length > before) break;
    run(sim, [{ type: 'light.place', from: slotOf(sim, 'lagerfeuer'), tx: Math.floor(p.x / TILE_PX) + dx, ty: Math.floor(p.y / TILE_PX) + dy }]);
  }
  const fire = light.state.placed[before];
  if (fire === undefined) throw new Error('kein freier Platz für das Lagerfeuer');
  expect(run(sim, [{ type: 'light.fuel', light: fire.id, from: slotOf(sim, 'holz'), count: 4 }])).toEqual([]);
  expect(run(sim, [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }])).toEqual([]);
  return fire.id;
}

interface Drawn {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly heightBase: number;
  readonly outline: boolean;
}

/**
 * What the light bridge draws with the figure at `figure` (default: the player) at `time`; `focus` the tile of the
 * interaction's use target, `level` the height level of every tile.
 */
function draw(c: Camp, bridge: LightBridge, time = 0, figure = playerAt(c.sim), focus = { tx: -1, ty: -1 }, level = 0): Drawn[] {
  const scene = new RenderScene();
  scene.beginFrame(0);
  const out: Drawn[] = [];
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc): number => {
    const o = OWNER.get(d.frame);
    out.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, depth: d.depth, heightBase: d.heightBase, outline: d.outline });
    return push(d);
  };
  const frame = createLightFrame();
  frame.hasFigure = true;
  frame.figureX = figure.x;
  frame.figureY = figure.y;
  frame.left = figure.x - 40 * TILE_PX;
  frame.top = figure.y - 40 * TILE_PX;
  frame.right = figure.x + 40 * TILE_PX;
  frame.bottom = figure.y + 40 * TILE_PX;
  frame.time = time;
  frame.focusTx = focus.tx;
  frame.focusTy = focus.ty;
  frame.levelAt = () => level;
  bridge.fill(scene, ATLAS, c.sim, frame);
  return out;
}

const spits = (drawn: readonly Drawn[]): Drawn[] => drawn.filter((d) => d.sprite.startsWith(SPIT_SPRITE_PREFIX));

describe('Bratspieß über dem Lagerfeuer (M7-102)', () => {
  it('jedes Spießgericht hat sein Spießbild: 40 × 32, Anker wie das Lagerfeuer, Clip dreht', () => {
    const fire = MANIFEST.sprites['lagerfeuer'];
    if (fire === undefined) throw new Error('kein Lagerfeuer im Atlas');
    for (const dish of DISHES) {
      const s = MANIFEST.sprites[`${SPIT_SPRITE_PREFIX}${dish}`];
      if (s === undefined) throw new Error(`${dish}: kein Spießbild`);
      expect(s.clips[SPIT_CLIP]?.frames.length, dish).toBe(2);
      const f = s.frames[0];
      expect(f?.h, dish).toBe(32);
      expect(f?.w, dish).toBe(40);
      expect(f?.ay, dish).toBe(fire.frames[0]?.ay);
    }
  });

  it('ein Gericht gart: der Spieß mit ihm steht auf dem Feuer, knapp davor, dreht sich – vorher, stockend und danach keiner', () => {
    const c = camp();
    const bridge = new LightBridge();
    const fire = c.light.state.placed[0];
    if (fire === undefined) throw new Error('kein Feuer');
    const fx = (fire.tx + 0.5) * TILE_PX;
    const fy = (fire.ty + 0.5) * TILE_PX;
    // Without an order: the fire alone.
    expect(spits(draw(c, bridge))).toEqual([]);
    expect(bridge.stats.roasting).toBe(0);

    expect(run(c.sim, [{ type: 'craft.start', recipe: 'rezept_gebratener_fisch', count: 2 }], 2)).toEqual([]);
    const order = c.crafting.orders[0];
    expect(order?.station).toBe('lagerfeuer');
    expect(order?.dauer).toBeGreaterThan(0);
    const drawn = draw(c, bridge);
    const flame = drawn.find((d) => d.sprite === 'lagerfeuer');
    const [spit, ...more] = spits(drawn);
    expect(more).toEqual([]);
    if (spit === undefined || flame === undefined) throw new Error('kein Spieß über dem Feuer');
    expect(spit.sprite).toBe('spiess_gebratener_fisch');
    expect([spit.x, spit.y]).toEqual([fx, fy]);
    expect([flame.x, flame.y]).toEqual([fx, fy]);
    // In front of its fire (over the flame); on its height, outlined with it.
    expect(spit.depth).toBeGreaterThan(fy);
    expect(spit.depth).toBeLessThan(fy + 1);
    expect([spit.heightBase, spit.outline, flame.heightBase, flame.outline]).toEqual([0, false, 0, false]);
    const raised = draw(c, bridge, 0, playerAt(c.sim), { tx: fire.tx, ty: fire.ty }, 2);
    const [high] = spits(raised);
    const highFlame = raised.find((d) => d.sprite === 'lagerfeuer');
    expect(highFlame?.heightBase).toBeGreaterThan(0);
    expect(highFlame?.outline).toBe(true);
    expect([high?.heightBase, high?.outline]).toEqual([highFlame?.heightBase, true]);
    expect(bridge.stats.roasting).toBe(1);
    // The spit turns: its clip's frames over time.
    const clip = MANIFEST.sprites['spiess_gebratener_fisch']?.clips[SPIT_CLIP];
    if (clip === undefined) throw new Error('kein Clip dreht');
    const seen = new Set<number>();
    for (let t = 0; t < 1; t += 0.05) {
      const f = spits(draw(c, bridge, t))[0]?.frame ?? -1;
      expect(clip.frames).toContain(f);
      seen.add(f);
    }
    expect(seen.size).toBe(2);

    // Stalled (stunned: the work waits): no spit.
    run(c.sim, [{ type: 'conditions.apply', id: 'betaeubt', seconds: 1 }], 2);
    expect(c.crafting.blocked).toBe('stunned');
    expect(spits(draw(c, bridge))).toEqual([]);
    // Both pieces done: no spit.
    for (let i = 0; i < 20000 && c.crafting.orders.length > 0; i++) run(c.sim);
    expect(c.crafting.orders).toEqual([]);
    expect(spits(draw(c, bridge))).toEqual([]);
    expect(bridge.stats.roasting).toBe(0);
  });

  it('jedes Spießgericht zeigt sein eigenes Bild; Holzkohle am Feuer zeigt keinen Spieß', () => {
    const c = camp();
    const bridge = new LightBridge();
    run(c.sim, [{ type: 'craft.start', recipe: 'rezept_gebratenes_fleisch', count: 1 }], 2);
    expect(spits(draw(c, bridge)).map((d) => d.sprite)).toEqual(['spiess_gebratenes_fleisch']);
    for (let i = 0; i < 20000 && c.crafting.orders.length > 0; i++) run(c.sim);
    expect(run(c.sim, [{ type: 'craft.start', recipe: 'rezept_holzkohle_lagerfeuer', count: 1 }], 2)).toEqual([]);
    expect(c.crafting.orders[0]?.dauer).toBeGreaterThan(0);
    expect(c.crafting.blocked).toBe(null);
    expect(spits(draw(c, bridge))).toEqual([]);
  });

  it('der Spieß steht am brennenden Lagerfeuer nächst der Figur – ein erloschenes trägt keinen', () => {
    const c = camp();
    const first = c.light.state.placed[0];
    if (first === undefined) throw new Error('kein Feuer');
    // A second fire on the player's other side, not yet lit: the spit stays at the burning one.
    const p = playerAt(c.sim);
    const ptx = Math.floor(p.x / TILE_PX);
    const pty = Math.floor(p.y / TILE_PX);
    const away = [-(first.tx - ptx), -(first.ty - pty)] as const;
    const before = c.light.state.placed.length;
    run(c.sim, [{ type: 'light.place', from: slotOf(c.sim, 'lagerfeuer'), tx: ptx + 2 * away[0], ty: pty + 2 * away[1] }]);
    const second = c.light.state.placed[before];
    if (second === undefined) throw new Error('kein Platz für das zweite Feuer');
    run(c.sim, [{ type: 'craft.start', recipe: 'rezept_gebratener_fisch', count: 2 }], 2);
    const bridge = new LightBridge();
    // The figure beside the unlit second fire: the spit still roasts over the first.
    const beside = { x: (second.tx + 0.5) * TILE_PX, y: (second.ty + 1.5) * TILE_PX };
    expect(spits(draw(c, bridge, 0, beside)).map((d) => [d.x, d.y])).toEqual([[(first.tx + 0.5) * TILE_PX, (first.ty + 0.5) * TILE_PX]]);
    // Lit, it is the nearest burning fire to the figure there.
    expect(run(c.sim, [{ type: 'light.fuel', light: second.id, from: slotOf(c.sim, 'holz'), count: 4 }])).toEqual([]);
    expect(run(c.sim, [{ type: 'light.ignite', tx: second.tx, ty: second.ty }])).toEqual([]);
    expect(spits(draw(c, bridge, 0, beside)).map((d) => [d.x, d.y])).toEqual([[(second.tx + 0.5) * TILE_PX, (second.ty + 0.5) * TILE_PX]]);
    // Beside the first again: there.
    expect(spits(draw(c, bridge)).map((d) => [d.x, d.y])).toEqual([[(first.tx + 0.5) * TILE_PX, (first.ty + 0.5) * TILE_PX]]);
  });

  it('M7-135: ein Spießgericht an einer Station, die nicht brennt, zeigt keinen Spieß (die Wache „Station brennt“)', () => {
    // Every spit dish of the content roasts at the camp fire (brennt): no content case reaches the guard yet. The case is
    // constructed – the running order's station set to the cauldron, which does not burn – as a dish of a later station
    // without a fire would stand there (src/render/game/lights.ts `roasting`).
    const c = camp();
    const bridge = new LightBridge();
    run(c.sim, [{ type: 'craft.start', recipe: 'rezept_gebratener_fisch', count: 1 }], 2);
    expect(spits(draw(c, bridge)).map((d) => d.sprite)).toEqual(['spiess_gebratener_fisch']);
    const order = c.crafting.orders[0] as CraftOrder | undefined;
    if (order === undefined) throw new Error('kein Auftrag');
    expect(c.crafting.recipes.stations.list.find((st) => st.id === 'kessel')?.brennt).toBeUndefined();
    order.station = 'kessel';
    // A fresh bridge (its view of the burning stations is built once per simulation): the fire burns on, the dish is
    // worked – but not at a burning station.
    const fresh = new LightBridge();
    expect(spits(draw(c, fresh))).toEqual([]);
    expect(fresh.stats.roasting).toBe(0);
    order.station = 'lagerfeuer';
    expect(spits(draw(c, fresh)).map((d) => d.sprite)).toEqual(['spiess_gebratener_fisch']);
  });

  it('ein brennender Kamin ist keine Kochstelle (wie in der Simulation): der Spieß bleibt am Lagerfeuer', () => {
    const c = camp();
    const first = c.light.state.placed[0];
    if (first === undefined) throw new Error('kein Feuer');
    const p = playerAt(c.sim);
    const ptx = Math.floor(p.x / TILE_PX);
    const pty = Math.floor(p.y / TILE_PX);
    // A stone fireplace two tiles off on the player's other side (within reach to light it), burning.
    const kx = ptx - 2 * (first.tx - ptx);
    const ky = pty - 2 * (first.ty - pty);
    const kamin = c.light.placeFurniture(c.sim, 'kamin_stein', 0, kx, ky, 2, 1);
    if (kamin === null) throw new Error('kein Platz für den Kamin');
    expect(run(c.sim, [{ type: 'light.fuel', light: kamin, from: slotOf(c.sim, 'holz'), count: 4 }])).toEqual([]);
    expect(run(c.sim, [{ type: 'light.ignite', tx: kx, ty: ky }])).toEqual([]);
    expect(c.light.placed(kamin)?.fire?.lit).toBe(true);
    run(c.sim, [{ type: 'craft.start', recipe: 'rezept_gebratener_fisch', count: 1 }], 2);
    const beside = { x: (kx + 0.5) * TILE_PX, y: (ky + 1.5) * TILE_PX };
    expect(spits(draw(c, new LightBridge(), 0, beside)).map((d) => [d.x, d.y])).toEqual([[(first.tx + 0.5) * TILE_PX, (first.ty + 0.5) * TILE_PX]]);
  });
});
