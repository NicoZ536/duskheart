/**
 * The build mode on a real session (`GameSession`, its bridge `createUiBridge`, the ghost `GhostView` over the
 * session's simulation, the controller `BauSteuerung` with the commands `bauBefehle` – the path a click takes in the
 * game; MASTERPROMPT §16.3, §16.6; M4-22 … M4-25, Review M4 "Dächer in einem Zug"):
 *
 * - **Roofs in one drag:** the whole straw roof of a 7 × 7 house dragged in one go reaches the simulation ordered by
 *   the distance to a support (the ghost's `chainRoofs`), so every tile – the inner 3 × 3 too, three tiles from the
 *   walls – is carried by those placed before it in the same tick: 49 roof tiles, no refusal. The same anchors from the
 *   inside out leave the middle ones without support (the order is what makes it work).
 * - **Tools:** the dismantle tool takes a wall back whole within 30 s (and 60 % later), the upgrade tool turns plank
 *   walls into stone walls taking the stone walls from the bags, the repair tool mends walls damaged by fire (the debug
 *   command `fire.ignite` as rain sets in, which puts it out) for their share of planks, and a station comes back whole – each by the
 *   commands the controller sends through the bridge.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import { GameSession } from '../../../src/game/session';
import { BuildGhost, createGhostFrame, GhostView, type BuildTool } from '../../../src/render/game/ghost';
import type { WorldCollision } from '../../../src/game/player/collision';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import type { Action } from '../../../src/engine/input/actions';
import { createUiBridge } from '../../../src/ui/bridge';
import { bauBefehle } from '../../../src/ui/screens/bau/BauModus';
import { BauSteuerung, type BauEingabe } from '../../../src/ui/screens/bau/steuerung';
import { BAU_SPIEL_CONFIG } from '../game/bau-spielwelt';

const FULL_SIM_TIMEOUT_MS = 90_000;
const TICK_HZ = BALANCE.time.tickHz;
const NO_POINTER = { inside: false, x: 0, y: 0 } as const;
/** Side of the free site [tiles]: the 7 × 7 house with room around it; the player stands in its middle. */
const SITE = 11;
/** How far from the spawn the site may lie [tiles]. */
const SEARCH = 60;

/** Input of one frame: the actions pressed and held. */
class Eingabe implements BauEingabe {
  gedrueckt = new Set<Action>();
  gehalten = new Set<Action>();
  lastDevice: BauEingabe['lastDevice'] = 'keyboard';
  wasPressed(a: Action): boolean {
    return this.gedrueckt.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.gedrueckt.has(a);
  }
  isDown(a: Action): boolean {
    return this.gehalten.has(a) || this.gedrueckt.has(a);
  }
  setContext(): void {}
}

interface Bau {
  readonly s: GameSession;
  readonly ghost: BuildGhost;
  readonly st: BauSteuerung;
  /** North-west corner of a free `SITE` × `SITE` site [world tiles]; the player stands in its middle. */
  readonly x0: number;
  readonly y0: number;
  /** One rendered frame: the ghost judges (the pointer on world tile (tx, ty)), then the controller reads `input`. */
  frame(tx: number, ty: number, input: Eingabe): void;
  /** Steps `n` ticks. */
  step(n?: number): void;
  count(item: string): number;
  slotOf(item: string): SlotRef;
  events(type: string): number;
}

/** A session with the player on a free, level site of 11 × 11 tiles near the spawn. */
function bau(): Bau {
  // The small world of the building tests (tests/unit/game/bau-spielwelt.ts): free, level land near the spawn.
  const s = new GameSession({ config: BAU_SPIEL_CONFIG });
  s.command({ type: 'player.spawn' });
  s.command({ type: 'setWeather', state: 'klar' });
  s.command({ type: 'setTime', hour: 11, minute: 0 });
  s.step();
  s.step();
  const bridge = createUiBridge(s);
  const ghost = new BuildGhost();
  const st = new BauSteuerung(ghost, bauBefehle(bridge));
  const view = new GhostView();
  const f = createGhostFrame();
  f.hasFigure = true;
  const events = (type: string): number => (s.debugState().events as Record<string, number>)[type] ?? 0;
  const at = s.debugState().player;
  if (at === null) throw new Error('no player');
  const px = Math.floor(at.x / TILE_PX);
  const py = Math.floor(at.y / TILE_PX);
  // The site: dry, level land without any world object (the free-site rule of tests/unit/game/bau-spielwelt.ts),
  // nearest first; the player then stands in its middle.
  const collision = s.sim.system('world-collision') as unknown as WorldCollision;
  collision.ensureTiles(0, px - SEARCH - SITE, py - SEARCH - SITE, px + SEARCH + SITE, py + SEARCH + SITE);
  const free = (x: number, y: number): boolean => {
    const chunk = s.sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    if ((collision.grid.tileInfo(0, x, y) & BLOCK_ALL) !== 0 || chunk.object[i] !== 0 || ((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0) return false;
    return ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0;
  };
  let site: { x0: number; y0: number } | null = null;
  for (let r = 0; r <= SEARCH && site === null; r++) {
    for (let dy = -r; dy <= r && site === null; dy++) {
      for (let dx = -r; dx <= r && site === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let ok = true;
        for (let y = py + dy; y < py + dy + SITE && ok; y++) for (let x = px + dx; x < px + dx + SITE && ok; x++) ok = free(x, y);
        if (ok) site = { x0: px + dx, y0: py + dy };
      }
    }
  }
  if (site !== null) {
    const half = Math.floor(SITE / 2);
    s.command({ type: 'player.teleport', x: (site.x0 + half + 0.5) * TILE_PX, y: (site.y0 + half + 0.5) * TILE_PX, layer: 0 });
    s.step();
    s.step();
  }
  if (site === null) throw new Error('no free site near the spawn');
  const inventory = s.sim.system('inventory') as unknown as InventorySystem;
  return {
    s,
    ghost,
    st,
    ...site,
    frame(tx, ty, input) {
      const p = s.debugState().player;
      if (p === null) throw new Error('no player');
      f.figureX = p.x;
      f.figureY = p.y;
      ghost.pad = true;
      ghost.padDx = tx - Math.floor(p.x / TILE_PX);
      ghost.padDy = ty - Math.floor(p.y / TILE_PX);
      // Judged afresh (the ghost keeps unchanged verdicts for a few frames).
      for (let i = 0; i < 16; i++) view.update(s.sim, NO_POINTER, f, ghost);
      input.lastDevice = 'gamepad';
      st.frame(input, s.debugState().tick, bridge.state.bags.peek() ?? inventory.state);
      bridge.frame();
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) s.step();
      bridge.frame();
    },
    count: (item) => inventory.count(item),
    slotOf(item) {
      for (const area of BAG_AREAS) {
        const index = inventory.state[area].findIndex((x) => x !== null && x.item === item);
        if (index >= 0) return { bereich: area, index };
      }
      throw new Error(`no ${item}`);
    },
    events,
  };
}

/** Presses the primary button on (tx, ty) and releases it on (ux, uy): a click, or a drag. */
function ziehe(b: Bau, tx: number, ty: number, ux = tx, uy = ty): void {
  const druck = new Eingabe();
  druck.gedrueckt.add('attack');
  b.frame(tx, ty, druck);
  const halten = new Eingabe();
  halten.gehalten.add('attack');
  b.frame(ux, uy, halten);
  b.frame(ux, uy, new Eingabe());
}

function werkzeug(b: Bau, tool: BuildTool): void {
  b.st.oeffnen(null);
  b.st.waehleWerkzeug(tool, null, false);
}

/** The outline of the 7 × 7 house with its north-west corner (x0, y0): 24 plank walls, placed in one tick. */
function hauswaende(b: Bau, x0: number, y0: number): void {
  b.s.command({ type: 'inventory.give', item: 'wand_holz', count: 24 });
  b.step();
  const before = b.events('partPlaced');
  for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 7; x++) if (x === x0 || x === x0 + 6 || y === y0 || y === y0 + 6) b.s.command({ type: 'build.place', part: 'wand_holz', tx: x, ty: y });
  b.step();
  expect(b.events('partPlaced') - before).toBe(24);
}

describe('Dächer in einem Zug (Review M4)', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('ein 7 × 7-Strohdach in einem Zug: die Simulation bekommt die Anker nach Abstand zur Stütze – alle 49 liegen, keins ohne Stütze', () => {
    const b = bau();
    const x0 = b.x0 + 2;
    const y0 = b.y0 + 2;
    hauswaende(b, x0, y0);
    b.s.command({ type: 'inventory.give', item: 'dach_stroh', count: 49 });
    b.step();
    b.st.oeffnen(null);
    b.st.waehle('dach_stroh');
    const placed = b.events('partPlaced');
    const refused = b.events('commandRejected');
    const druck = new Eingabe();
    druck.gedrueckt.add('attack');
    b.frame(x0, y0, druck);
    const halten = new Eingabe();
    halten.gehalten.add('attack');
    b.frame(x0 + 6, y0 + 6, halten);
    // The ghost judged all 49 placeable (planned tiles carry each other), the tiles over the walls first.
    expect(b.ghost.plan.length / 2).toBe(49);
    expect(b.ghost.okCount).toBe(49);
    const middle = [b.ghost.plan[96], b.ghost.plan[97]];
    expect(middle).toEqual([x0 + 3, y0 + 3]);
    b.frame(x0 + 6, y0 + 6, new Eingabe());
    b.step(2);
    expect(b.events('commandRejected') - refused).toBe(0);
    expect(b.events('partPlaced') - placed).toBe(49);
    expect(b.count('dach_stroh')).toBe(0);
  });

  it('dieselben Anker von innen nach außen: die mittleren Kacheln finden keine Stütze – die Reihenfolge des Plans trägt das Dach', () => {
    const b = bau();
    const x0 = b.x0 + 2;
    const y0 = b.y0 + 2;
    hauswaende(b, x0, y0);
    b.s.command({ type: 'inventory.give', item: 'dach_stroh', count: 49 });
    b.step();
    b.st.oeffnen(null);
    b.st.waehle('dach_stroh');
    const druck = new Eingabe();
    druck.gedrueckt.add('attack');
    b.frame(x0, y0, druck);
    const halten = new Eingabe();
    halten.gehalten.add('attack');
    b.frame(x0 + 6, y0 + 6, halten);
    // The ghost's plan, reversed: the middle tile first, three tiles from any wall and no roof yet around it.
    const plan = [...b.ghost.plan];
    const refused = b.events('commandRejected');
    for (let i = plan.length / 2 - 1; i >= 0; i--) b.s.command({ type: 'build.place', part: 'dach_stroh', tx: plan[2 * i] as number, ty: plan[2 * i + 1] as number });
    b.step(2);
    expect(b.events('commandRejected') - refused).toBeGreaterThan(0);
    expect(b.count('dach_stroh')).toBeGreaterThan(0);
  });
});

describe('Werkzeuge über die Brücke (M4-25)', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('Abbauen: binnen 30 s kommt die Wand ganz zurück, danach 60 % (abgerundet); eine Station ganz', () => {
    const b = bau();
    const tx = b.x0 + 3;
    const ty = b.y0 + 3;
    b.s.command({ type: 'inventory.give', item: 'wand_holz', count: 2 });
    b.s.command({ type: 'inventory.give', item: 'werkbank', count: 1 });
    b.step();
    b.s.command({ type: 'build.place', part: 'wand_holz', tx, ty });
    b.s.command({ type: 'build.place', part: 'wand_holz', tx: tx + 2, ty });
    b.step();
    werkzeug(b, 'abbauen');
    ziehe(b, tx, ty);
    b.step();
    expect(b.count('wand_holz')).toBe(1);
    // Past the full refund window: 60 % of three planks, one plank.
    b.step(Math.round((BALANCE.building.refund.fullSeconds + 1) * TICK_HZ));
    const bretter = b.count('brett');
    ziehe(b, tx + 2, ty);
    b.step();
    expect(b.count('wand_holz')).toBe(1);
    expect(b.count('brett')).toBe(bretter + Math.floor(3 * BALANCE.building.refund.lateShare));
    // A station set up and taken back within its window: the whole workbench.
    b.s.command({ type: 'station.place', from: b.slotOf('werkbank'), tx: b.x0 + 5, ty: b.y0 + 6 });
    b.step();
    expect(b.count('werkbank')).toBe(0);
    ziehe(b, b.x0 + 5, b.y0 + 6);
    b.step();
    expect(b.count('werkbank')).toBe(1);
  });

  it('Aufwerten: Holzwände werden Steinwände, die Steinwände kommen aus den Taschen; Reparieren nach Brand mit dem Hammer', () => {
    const b = bau();
    const ty = b.y0 + 2;
    const xs = [b.x0 + 2, b.x0 + 3, b.x0 + 4];
    b.s.command({ type: 'inventory.give', item: 'wand_holz', count: 3 });
    b.s.command({ type: 'inventory.give', item: 'wand_stein', count: 3 });
    b.step();
    for (const x of xs) b.s.command({ type: 'build.place', part: 'wand_holz', tx: x, ty });
    b.step();
    b.st.oeffnen(null);
    b.st.waehle('wand_stein');
    b.st.waehleWerkzeug('aufwerten', null, false);
    const upgraded = b.events('partUpgraded');
    ziehe(b, xs[0] as number, ty, xs[2] as number, ty);
    b.step();
    expect(b.events('partUpgraded') - upgraded).toBe(3);
    expect(b.count('wand_stein')).toBe(0);

    // Fire on two lone plank walls (debug `fire.ignite`) while rain sets in (it blends in over the weather blend):
    // they burn until it falls hard enough, then it puts them out – damaged, not destroyed.
    const wy = b.y0 + 7;
    b.s.command({ type: 'inventory.give', item: 'wand_holz', count: 2 });
    b.step();
    b.s.command({ type: 'build.place', part: 'wand_holz', tx: b.x0 + 2, ty: wy });
    b.s.command({ type: 'build.place', part: 'wand_holz', tx: b.x0 + 6, ty: wy });
    b.step();
    b.s.command({ type: 'setWeather', state: 'regen' });
    b.step(16 * TICK_HZ);
    const aus = b.events('fireOut');
    const weg = b.events('partRemoved');
    b.s.command({ type: 'fire.ignite', tx: b.x0 + 2, ty: wy });
    b.s.command({ type: 'fire.ignite', tx: b.x0 + 6, ty: wy });
    for (let t = 0; t < 30 && b.events('fireOut') - aus < 2; t++) b.step(TICK_HZ);
    expect(b.events('fireOut') - aus).toBe(2);
    expect(b.events('partRemoved') - weg).toBe(0);
    b.s.command({ type: 'setWeather', state: 'klar' });
    b.step();
    expect(b.events('partDamaged')).toBeGreaterThan(0);
    // The repair tool takes the hammer from the hotbar into the hand; the drag mends both for planks.
    b.s.command({ type: 'inventory.give', item: 'steinhammer', count: 1 });
    b.s.command({ type: 'inventory.give', item: 'brett', count: 6 });
    b.step();
    const hammer = b.slotOf('steinhammer');
    expect(hammer.bereich).toBe('schnellleiste');
    b.st.waehleWerkzeug('reparieren', (b.s.sim.system('inventory') as unknown as InventorySystem).state, false);
    b.step();
    const repaired = b.events('partRepaired');
    const bretter = b.count('brett');
    ziehe(b, b.x0 + 1, wy - 1, b.x0 + 7, wy + 1);
    expect(b.ghost.repair).toMatchObject({ damaged: 2, mendable: 2, reason: null });
    const kosten = b.ghost.repair.cost.find((c) => c.item === 'brett')?.count ?? 0;
    b.step();
    expect(b.events('partRepaired') - repaired).toBe(2);
    expect(b.count('brett')).toBe(bretter - kosten);
  });
});
