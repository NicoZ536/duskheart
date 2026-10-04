/**
 * M6-35 "Overlays spawnzonen, wahrnehmung, pfade" (MASTERPROMPT §31.6, §12.4; docs/SPIEL.md §12): the creature overlays
 * over a real simulation at night – the spawn ring tints exactly the tiles where the night spawner may put shadow brood
 * (16–40 tiles, open ground, dark, inside the creatures' zone), with its legend and the wild animals per active chunk;
 * the perception overlay draws every creature's hearing circle and sight cone with its AI state in the page's language;
 * the path overlay shows the paths of the path service's debug log, which it switches on while it shows and off again.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { hearingRadiusTiles } from '../../../src/game/creatures/formulas';
import { insideZone, worldCreatureZone } from '../../../src/game/creatures/zone';
import type { LightSystem } from '../../../src/game/light/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import { GameSession } from '../../../src/game/session';
import { createI18n } from '../../../src/i18n';
import { DebugOverlayList, type DebugOverlayEntry } from '../../../src/render/debugOverlay';
import { WorldOverlays, type OverlayView, type OverlayWorld } from '../../../src/render/world/overlays';
import { worldDimensions } from '../../../src/world/model/worldSize';

const TILE = 16;
const SB = BALANCE.spawn.shadowBrood;

function setup(hour: number) {
  const session = new GameSession({ config: { seed: 20260930, worldSize: 'small', dayLengthMinutes: 12 } });
  session.command({ type: 'player.spawn' });
  session.step();
  session.command({ type: 'debug.god', on: true });
  session.command({ type: 'setTime', hour, minute: 0 });
  session.command({ type: 'setWeather', state: 'klar' });
  session.step();
  const p = session.debugState().player;
  if (p === null) throw new Error('kein Spieler');
  const cast: readonly [string, number, number][] = [
    ['reh', -6, -3],
    ['reh', -7, 2],
    ['hase', 5, -4],
    ['hase', 8, 3],
    ['nachtmahr', 11, 0],
  ];
  for (const [creature, dx, dy] of cast) session.command({ type: 'creature.spawn', creature, count: 1, x: Math.round(p.x + dx * TILE), y: Math.round(p.y + dy * TILE), layer: 0 });
  session.step();
  session.step();
  const i18n = createI18n('de', { strict: true });
  const sim = session.sim;
  const world: OverlayWorld = {
    sim,
    t: (k, params) => i18n.t(k, params),
    layer: 0,
    worldTiles: worldDimensions(sim.config.worldSize).tiles,
    get: (layer, cx, cy) => sim.world.chunks.get(layer, cx, cy),
    isLoading: () => false,
    isActive: (layer, cx, cy) => sim.world.zone.isActive(layer, cx, cy),
    temperature: null,
  };
  const creatures = sim.system('creatures') as CreatureSystem;
  return { session, sim, world, creatures, i18n, x: p.x, y: p.y };
}

function entries(list: DebugOverlayList): DebugOverlayEntry[] {
  return [...Array(list.count).keys()].map((i) => list.entry(i) as DebugOverlayEntry);
}

/** A view of `w` × `h` px centred on (x, y). */
function viewAt(x: number, y: number, w: number, h: number): OverlayView {
  return { left: Math.round(x - w / 2), right: Math.round(x + w / 2), top: Math.round(y - h / 2), bottom: Math.round(y + h / 2) };
}

describe('Overlay spawnzonen', () => {
  it('tönt genau die Kacheln, auf die der Nacht-Spawner Schattenbrut setzen darf, mit Legende und Wildtieren je Chunk', () => {
    const { sim, world, creatures, x, y } = setup(23);
    const o = new WorldOverlays();
    o.enabled.spawnzonen = true;
    const list = new DebugOverlayList();
    // The whole ring in view.
    const view = viewAt(x, y, (SB.maxTiles + 2) * 2 * TILE, (SB.maxTiles + 2) * 2 * TILE);
    o.fill(list, view, world);
    const tinted = new Set(
      entries(list)
        .filter((e) => e.kind === 'rect' && e.width === TILE && e.height === TILE)
        .map((e) => `${e.x / TILE}:${e.y / TILE}`),
    );
    expect(o.stats.spawnTiles).toBe(tinted.size);
    expect(o.stats.spawnTiles).toBeGreaterThan(100);
    expect(o.stats.spawnBlockedTiles).toBe(0);
    // The spawner's rule, from the simulation's own collision grid, light map and zone.
    const grid = (sim.system('world-collision') as WorldCollision).grid;
    const map = (sim.system('light') as LightSystem).mapFor(sim);
    const zone = worldCreatureZone(sim.world);
    const expected = new Set<string>();
    for (let ty = Math.floor((y - SB.maxTiles * TILE) / TILE); ty <= Math.floor((y + SB.maxTiles * TILE) / TILE); ty++) {
      for (let tx = Math.floor((x - SB.maxTiles * TILE) / TILE); tx <= Math.floor((x + SB.maxTiles * TILE) / TILE); tx++) {
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE;
        const d2 = (cx - x) ** 2 + (cy - y) ** 2;
        if (d2 < (SB.minTiles * TILE) ** 2 || d2 > (SB.maxTiles * TILE) ** 2) continue;
        if (!insideZone(zone, 0, cx, cy) || !grid.openAt(0, tx, ty) || map.tileLevel(0, tx, ty) >= SB.maxLight) continue;
        expected.add(`${tx}:${ty}`);
      }
    }
    expect([...tinted].sort()).toEqual([...expected].sort());
    const labels = entries(list).filter((e) => e.kind === 'label');
    expect(labels.map((e) => e.text)).toContain(`Spawnring der Schattenbrut: ${SB.minTiles}–${SB.maxTiles} Kacheln, nur im Dunkeln`);
    // "Wildtiere: n" on the active chunks: together the wild animals at home in view (the Nachtmahr is none).
    const stock = labels.filter((e) => e.text.startsWith('Wildtiere: ')).map((e) => Number(e.text.slice('Wildtiere: '.length)));
    expect(stock.length).toBeGreaterThan(0);
    let wild = 0;
    for (let i = 0; i < creatures.store.size; i++) {
      const c = creatures.store.valueAt(i);
      if (!(creatures.catalog.find(c.creature)?.shadow ?? false) && world.isActive(0, c.homeCx, c.homeCy)) wild++;
    }
    expect(stock.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(wild);
    expect(stock.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
  });

  it('am Mittag ist kein Fleck dunkel genug: keine getönte Kachel, der Ring bleibt gestrichelt', () => {
    const { world, x, y } = setup(12);
    const o = new WorldOverlays();
    o.enabled.spawnzonen = true;
    const list = new DebugOverlayList();
    o.fill(list, viewAt(x, y, 640, 360), world);
    expect(o.stats.spawnTiles).toBe(0);
    const dots = entries(list).filter((e) => e.kind === 'rect' && e.width === 1);
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) expect(Math.hypot(d.x - x, d.y - y)).toBeGreaterThan(SB.minTiles * TILE - 2);
  });
});

describe('Overlay wahrnehmung', () => {
  it('jede Kreatur im Bild: ihr Hörkreis, ihr Sichtkegel, ihr KI-Zustand auf Deutsch', () => {
    const { world, creatures, i18n, x, y } = setup(23);
    const o = new WorldOverlays();
    o.enabled.wahrnehmung = true;
    const list = new DebugOverlayList();
    const view = viewAt(x, y, 640, 360);
    o.fill(list, view, world);
    const all = entries(list);
    const states = new Set(['ruhen', 'umherstreifen', 'grasen', 'fliehen', 'untersuchen', 'jagen', 'angreifen', 'umkreisen', 'rueckzug', 'heimkehr', 'schlafen'].map((s) => i18n.t(`debug.overlay.ki.${s}`)));
    const labels = all.filter((e) => e.kind === 'label');
    expect(labels.length).toBe(o.stats.perceived);
    expect(o.stats.perceived).toBeGreaterThanOrEqual(5);
    for (const l of labels) expect(states.has(l.text)).toBe(true);
    // The hearing circle of every creature standing in view: dots at its radius around it.
    const pos = { x: 0, y: 0 };
    let checked = 0;
    for (let i = 0; i < creatures.store.size; i++) {
      const s = creatures.store.valueAt(i);
      if (s.layer !== 0 || !creatures.positionOf(creatures.store.entityAt(i), pos)) continue;
      if (pos.x < view.left || pos.x >= view.right || pos.y < view.top || pos.y >= view.bottom) continue;
      const kind = creatures.catalog.get(s.creature);
      const r = hearingRadiusTiles(BALANCE.ai.noise.step, kind.profile.gehoer, 0) * TILE;
      const onCircle = all.filter((e) => e.kind === 'rect' && e.width === 1 && Math.abs(Math.hypot(e.x - Math.round(pos.x), e.y - Math.round(pos.y)) - r) < 1);
      expect(onCircle.length, `Hörkreis: ${s.creature}`).toBeGreaterThan(8);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
    // Off: nothing.
    o.enabled.wahrnehmung = false;
    const none = new DebugOverlayList();
    o.fill(none, view, world);
    expect(none.count).toBe(0);
    expect(o.stats.perceived).toBe(0);
  });
});

describe('Overlay pfade', () => {
  it('zeigt die Pfade des Debug-Logs mit Länge und Rechner; das Log läuft nur, solange das Overlay zeigt', () => {
    const { session, world, creatures, x, y } = setup(23);
    const o = new WorldOverlays();
    o.enabled.pfade = true;
    const view = viewAt(x, y, 1280, 720);
    // The first frame switches the log on; the creatures ask for paths while the simulation runs.
    o.fill(new DebugOverlayList(), view, world);
    for (let k = 0; k < 240; k++) session.step();
    const list = new DebugOverlayList();
    o.fill(list, view, world);
    expect(o.stats.paths).toBeGreaterThan(0);
    const labels = entries(list).filter((e) => e.kind === 'label');
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l.text).toMatch(/^\d+ · (Simulation|Worker)$/);
    let logged = 0;
    creatures.paths.forEachDebugPath(() => logged++);
    expect(logged).toBeGreaterThanOrEqual(o.stats.paths);
    // Another overlay instead: the log is switched off (and forgets).
    o.enabled.pfade = false;
    o.enabled.wahrnehmung = true;
    o.fill(new DebugOverlayList(), view, world);
    let after = 0;
    creatures.paths.forEachDebugPath(() => after++);
    expect(after).toBe(0);
    expect(o.stats.paths).toBe(0);
    // With no overlay at all the game view calls `idle`: the counters stay at zero, the log off.
    o.enabled.wahrnehmung = false;
    o.enabled.pfade = true;
    o.fill(new DebugOverlayList(), view, world);
    // A swing makes noise (BALANCE.ai.noise.attack): the Nachtmahr 11 tiles away hears it and hunts the player – it asks for
    // a path for sure (the deer and hares of the world roam only now and then, M6-27b placed the world's own stock anew).
    session.command({ type: 'combat.attack', on: true });
    session.step();
    session.command({ type: 'combat.attack', on: false });
    for (let k = 0; k < 120; k++) session.step();
    o.fill(new DebugOverlayList(), view, world);
    expect(o.stats.paths + o.stats.pendingPaths).toBeGreaterThan(0);
    o.enabled.pfade = false;
    o.idle(session.sim);
    expect(o.stats).toEqual({ chunks: 0, collisionTiles: 0, temperatureTiles: 0, spawnTiles: 0, spawnBlockedTiles: 0, perceived: 0, paths: 0, pendingPaths: 0 });
    let idle = 0;
    creatures.paths.forEachDebugPath(() => idle++);
    expect(idle).toBe(0);
  });
});
