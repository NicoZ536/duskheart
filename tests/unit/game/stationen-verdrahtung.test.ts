/**
 * Stationen in der Verdrahtung (M4-03 … M4-06, M4-11; MASTERPROMPT §15.1, §16.1, §23.2 "je Stufe +0,5 % Wirkung im
 * Bereich"):
 * - Schmieden: am Amboss beschleunigt die Schmieden-Stufe das Herstellen (nicht Handwerk); der Schmelzofen arbeitet im
 *   Tempo dessen, der ihn zuletzt belud – gespeichert, und eingefroren aufgeholt exakt wie tickend;
 * - Stationen als Bauteile (Bau-Raster): der Teil-Zuhörer hängt eine Station mit gedrehter Stellfläche an und ab, die
 *   Aufwertung Werkbank I → II tauscht das Bauteil, `station.remove` überlässt sie dem Baumodus;
 * - eine aufgestellte Station steht im Weg (Kollisions-Overlay) und nicht auf dem Spieler.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { BUILD_PARTS, defineBuildParts } from '../../../src/content/buildParts';
import { stationGridListener } from '../../../src/game/building/listeners';
import { BuildingSystem } from '../../../src/game/building/system';
import { craftTicks } from '../../../src/game/crafting/formulas';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { batchTicks } from '../../../src/game/stations/formulas';
import { copyStationsState } from '../../../src/game/stations/state';
import { StationSystem } from '../../../src/game/stations/system';
import { BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { createPartCatalog } from '../../../src/world/structures/catalog';
import { lifeWorld } from './leben-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';
import { stationWorld, type StationWorld } from './stationen-testwelt';

const D = BALANCE.crafting.durationSeconds;
const STAGES = BALANCE.stations.stages;

function events<T>(m: Map<string, unknown[]>, type: string): T[] {
  return (m.get(type) ?? []) as T[];
}

/** The anvil next to the player, every recipe visible, the ingredients of a bronze axe in the bags. */
function anvilWorld(): { w: StationWorld; ticks: () => number } {
  const w = stationWorld();
  w.crafting.unlockAll(w.sim);
  w.place('amboss_bronze', 5, 4);
  w.give('bronzebarren', 3);
  w.give('holz', 2);
  const ticks = (): number => {
    const ev = w.run(1, [{ type: 'craft.start', recipe: 'rezept_bronzeaxt', count: 1 }]);
    expect(events(ev, 'commandRejected')).toEqual([]);
    const started = events<{ ticks: number }>(ev, 'craftStarted');
    return (started[0] as { ticks: number }).ticks;
  };
  return { w, ticks };
}

describe('Schmieden (§23.2): die Stationen des Schmiedens nutzen ihre Fertigkeit', () => {
  it('die Stationen kennen ihre Fertigkeit aus ihrer Erfahrungsquelle', () => {
    const w = stationWorld();
    expect(w.stations.skillOf('amboss_bronze')).toBe('schmieden');
    expect(w.stations.skillOf('schmelzofen')).toBe('schmieden');
    expect(w.stations.skillOf('werkbank')).toBeNull();
    expect(w.stations.skillOf('lehmofen')).toBeNull();
  });

  it('am Amboss verkürzt die Schmieden-Stufe die Arbeit, die Handwerk-Stufe nicht', () => {
    const plain = anvilWorld().ticks();
    expect(plain).toBe(craftTicks(D.werkzeug, 0, STAGES.amboss_bronze?.tempo ?? 1));
    const handwerk = anvilWorld();
    handwerk.w.life.skills.unlock(handwerk.w.sim, 'handwerk');
    expect(handwerk.ticks()).toBe(craftTicks(D.werkzeug, 0, STAGES.amboss_bronze?.tempo ?? 1));
    const smith = anvilWorld();
    smith.w.life.skills.unlock(smith.w.sim, 'schmieden');
    const bonus = smith.w.life.skills.bonus('schmieden');
    expect(bonus).toBeCloseTo((BALANCE.skills.maxLevel - 1) * BALANCE.skills.bonusPerLevel, 12);
    const fast = smith.ticks();
    expect(fast).toBe(craftTicks(D.werkzeug, bonus, STAGES.amboss_bronze?.tempo ?? 1));
    expect(fast).toBeLessThan(plain);
  });

  it('an der Werkbank bleibt es Handwerk', () => {
    const w = stationWorld();
    w.crafting.unlockAll(w.sim);
    w.place('werkbank', 5, 4);
    w.life.skills.unlock(w.sim, 'handwerk');
    w.life.skills.unlock(w.sim, 'schmieden');
    w.give('zweig', 2);
    w.give('faserseil', 1);
    const ev = w.run(1, [{ type: 'craft.start', recipe: 'rezept_schiene', count: 1 }]);
    expect(events(ev, 'commandRejected')).toEqual([]);
    const started = events<{ ticks: number }>(ev, 'craftStarted')[0] as { ticks: number };
    const recipe = w.crafting.recipes.get('rezept_schiene');
    expect(started.ticks).toBe(craftTicks(D[recipe.dauer], w.life.skills.bonus('handwerk'), STAGES.werkbank?.tempo ?? 1));
  });

  /** A smelting furnace next to the player loaded with copper ore and charcoal; `smith` unlocks Schmieden first. */
  function furnace(smith: boolean): { w: StationWorld; id: number } {
    const w = stationWorld();
    if (smith) w.life.skills.unlock(w.sim, 'schmieden');
    const id = w.place('schmelzofen', 6, 4);
    w.give('kupfererz', 10);
    w.give('holzkohle', 5);
    expect(w.refused({ type: 'station.put', station: id, from: w.slotOf('kupfererz'), bereich: 'eingang' })).toEqual([]);
    expect(w.refused({ type: 'station.put', station: id, from: w.slotOf('holzkohle'), bereich: 'brennstoff' })).toEqual([]);
    return { w, id };
  }

  it('der Schmelzofen arbeitet im Tempo dessen, der ihn belud', () => {
    const slow = furnace(false);
    expect(slow.w.st(slow.id).tempoBonus).toBeUndefined();
    const smith = furnace(true);
    const bonus = smith.w.life.skills.bonus('schmieden');
    expect(smith.w.st(smith.id).tempoBonus).toBe(bonus);
    const tempo = STAGES.schmelzofen?.tempo ?? 1;
    expect(slow.w.st(slow.id).proc?.dauer).toBe(batchTicks(D.schmelzen, tempo));
    expect(smith.w.st(smith.id).proc?.dauer).toBe(batchTicks(D.schmelzen, tempo * (1 + bonus)));
    expect(smith.w.st(smith.id).proc?.dauer).toBeLessThan(slow.w.st(slow.id).proc?.dauer ?? 0);
  });

  it('mit dem Tempo eingefroren und aufgeholt wie tickend; der Spielstand behält es', () => {
    const ticking = furnace(true);
    const frozen = furnace(true);
    frozen.w.active = false;
    const chunk = { layer: 0 as const, cx: (OFFSET + 6) >> CHUNK_SHIFT, cy: (OFFSET + 4) >> CHUNK_SHIFT };
    const from = frozen.w.sim.tick;
    for (let i = 0; i < 3 * D.schmelzen * BALANCE.time.tickHz + 200; i++) {
      ticking.w.run(1);
      frozen.w.run(1);
    }
    frozen.w.active = true;
    frozen.w.stations.catchUp(chunk, from, frozen.w.sim.tick);
    const a = copyStationsState({ placed: [ticking.w.st(ticking.id) as never], nextId: 2 });
    const b = copyStationsState({ placed: [frozen.w.st(frozen.id) as never], nextId: 2 });
    expect(b).toEqual(a);
    expect(a.placed[0]?.proc?.ausgang.some((s) => s !== null && s.item === 'kupferbarren')).toBe(true);
    // Saved and loaded: the bonus stays with the furnace.
    const saved = structuredClone(ticking.w.stations.save.serialize());
    expect((saved as { placed: Array<{ tempoBonus?: number }> }).placed[0]?.tempoBonus).toBe(ticking.w.life.skills.bonus('schmieden'));
    const other = stationWorld();
    other.stations.save.deserialize(structuredClone(saved));
    expect(other.stations.save.serialize()).toEqual(saved);
    expect(() => other.stations.save.deserialize({ ...(saved as object), placed: [{ ...(saved as { placed: object[] }).placed[0], tempoBonus: 5 }] })).toThrow(TypeError);
  });
});

describe('Stationen im Bau-Raster (Teil-Zuhörer)', () => {
  /** A life world with building (the game's parts plus Werkbank I and II as station parts), crafting and stations. */
  function gridWorld() {
    const w = lifeWorld(meadow(24, 24));
    w.spawn(10, 10);
    const dropped: unknown[] = [];
    const crafting = w.sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill: (_s, stack) => dropped.push(stack) }));
    crafting.useSkills(w.life.skills);
    const stations = w.sim.addSystem(new StationSystem({ player: w.player, inventory: w.inventory, collision: w.collision, crafting, spill: (_s, stack) => dropped.push(stack), environment: { active: () => true } }));
    const parts = defineBuildParts('probe-stationen', [
      { id: 'werkbank', art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'station' },
      { id: 'werkbank_2', art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'station' },
    ]);
    const building = w.sim.addSystem(new BuildingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, drops: (_s, stack) => dropped.push(stack), catalog: createPartCatalog([...BUILD_PARTS, ...parts]) }));
    stationGridListener(building, stations);
    return { w, stations, building };
  }

  it('bauen hängt die Station mit gedrehter Stellfläche an, abbauen hängt sie ab; station.remove überlässt sie dem Baumodus', () => {
    const { w, stations, building } = gridWorld();
    w.inventory.give(w.sim, 'werkbank', 1);
    const placed = w.run(1, [{ type: 'build.place', part: 'werkbank', tx: OFFSET + 12, ty: OFFSET + 9, rot: 1 }]);
    expect(events(placed, 'commandRejected')).toEqual([]);
    expect(events(placed, 'stationPlaced')).toEqual([expect.objectContaining({ station: 'werkbank', tx: OFFSET + 12, ty: OFFSET + 9 })]);
    const st = stations.placed[0];
    if (st === undefined) throw new Error('no station');
    expect(st.groesse).toEqual({ b: 1, t: 2 });
    expect(stations.stationAt(0, OFFSET + 12, OFFSET + 10)?.id).toBe(st.id);
    expect(stations.stationAt(0, OFFSET + 13, OFFSET + 9)).toBeUndefined();
    const refused = w.run(1, [{ type: 'station.remove', station: st.id }]);
    expect(events<{ reason: string }>(refused, 'commandRejected').map((r) => r.reason)).toEqual(['builtIn']);
    expect(stations.placed).toHaveLength(1);
    const removed = w.run(1, [{ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 10 }]);
    expect(events(removed, 'stationRemoved')).toEqual([expect.objectContaining({ id: st.id, station: 'werkbank' })]);
    expect(stations.placed).toEqual([]);
    expect(building.partAt(0, 'objekt', OFFSET + 12, OFFSET + 9)).toBeUndefined();
    // The part itself came back whole (within 30 s), once.
    expect(w.inventory.count('werkbank')).toBe(1);
  });

  it('build.remove lässt ein Stations-Bauteil mit laufendem Auftrag stehen (inUse, wie station.remove); fertig kommt es herunter', () => {
    const { w, stations, building } = gridWorld();
    w.inventory.give(w.sim, 'werkbank', 1);
    w.run(1, [{ type: 'build.place', part: 'werkbank', tx: OFFSET + 12, ty: OFFSET + 9 }]);
    const st = stations.placed[0];
    if (st === undefined) throw new Error('no station');
    const part = { id: 'werkbank' };
    expect(stations.partRemovalProblem(part, 0, OFFSET + 12, OFFSET + 9)).toBeNull();
    // Werkbank I → II at the part: the order is worked at this station.
    w.inventory.give(w.sim, 'brett', 8);
    w.inventory.give(w.sim, 'balken', 2);
    w.inventory.give(w.sim, 'kupferbarren', 2);
    w.inventory.give(w.sim, 'faserseil', 4);
    const started = w.run(2, [{ type: 'craft.start', recipe: 'rezept_werkbank_2', count: 1 }]);
    expect(events(started, 'commandRejected')).toEqual([]);
    expect(stations.partRemovalProblem(part, 0, OFFSET + 12, OFFSET + 9)).toBe('inUse');
    // Neither the part's anchor nor a foreign part or tile answers for it.
    expect(stations.partRemovalProblem({ id: 'wand_holz' }, 0, OFFSET + 12, OFFSET + 9)).toBeNull();
    expect(stations.partRemovalProblem(part, 0, OFFSET + 13, OFFSET + 9)).toBeNull();
    const refused = w.run(1, [{ type: 'build.remove', tx: OFFSET + 13, ty: OFFSET + 9 }]);
    expect(events<{ reason: string }>(refused, 'commandRejected').map((r) => r.reason)).toEqual(['inUse']);
    expect(events(refused, 'partRemoved')).toEqual([]);
    expect(events(refused, 'stationRemoved')).toEqual([]);
    expect(building.partAt(0, 'objekt', OFFSET + 12, OFFSET + 9)?.id).toBe('werkbank');
    expect(stations.placed.map((p) => p.id)).toEqual([st.id]);
    // Nothing came back: neither the part item nor the ingredients.
    expect([w.inventory.count('werkbank'), w.inventory.count('brett')]).toEqual([0, 0]);
    // The order done, the station (now Werkbank II) is free and comes down with its part.
    const done = w.run(D.gross * BALANCE.time.tickHz + 2);
    expect(events(done, 'stationUpgraded')).toEqual([expect.objectContaining({ id: st.id, to: 'werkbank_2' })]);
    expect(stations.partRemovalProblem({ id: 'werkbank_2' }, 0, OFFSET + 12, OFFSET + 9)).toBeNull();
    const removed = w.run(1, [{ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 9 }]);
    expect(events(removed, 'commandRejected')).toEqual([]);
    expect(events(removed, 'stationRemoved')).toEqual([expect.objectContaining({ id: st.id, station: 'werkbank_2' })]);
    expect(building.partAt(0, 'objekt', OFFSET + 12, OFFSET + 9)).toBeUndefined();
  });

  it('Werkbank I → II an Ort und Stelle: das Bauteil folgt der Station', () => {
    const { w, stations, building } = gridWorld();
    w.inventory.give(w.sim, 'werkbank', 1);
    w.run(1, [{ type: 'build.place', part: 'werkbank', tx: OFFSET + 12, ty: OFFSET + 9 }]);
    const st = stations.placed[0];
    if (st === undefined) throw new Error('no station');
    expect(stations.upgrade(w.sim, st.id, 'werkbank_2')).toBe(true);
    const ev = w.run(1);
    expect(events(ev, 'partUpgraded')).toEqual([expect.objectContaining({ from: 'werkbank', to: 'werkbank_2', tx: OFFSET + 12, ty: OFFSET + 9 })]);
    expect(building.partAt(0, 'objekt', OFFSET + 13, OFFSET + 9)?.id).toBe('werkbank_2');
    expect(stations.placed.map((p) => p.station)).toEqual(['werkbank_2']);
    // The swap is no removal: the station keeps its id and state.
    expect(stations.placed[0]?.id).toBe(st.id);
    expect(building.swapPart(w.sim, 0, 'objekt', OFFSET + 12, OFFSET + 9, 'wand_holz')).toBe(false);
  });
});

describe('Stationen stehen im Weg (§16.1 Objekte)', () => {
  it('jede Kachel der Stellfläche ist ein Objekt des Kollisions-Overlays; der Spieler bleibt davor stehen', () => {
    const w = stationWorld();
    w.collision.addOverlay(w.stations.collisionOverlay());
    const id = w.place('werkbank', 6, 4);
    const overlay = w.stations.collisionOverlay();
    expect(overlay.overlayAt(0, OFFSET + 6, OFFSET + 4)).toBe(BLOCK_OBJECT);
    expect(overlay.overlayAt(0, OFFSET + 7, OFFSET + 4)).toBe(BLOCK_OBJECT);
    expect(overlay.overlayAt(0, OFFSET + 8, OFFSET + 4)).toBe(0);
    for (let i = 0; i < 60; i++) w.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    const at = { x: 0, y: 0 };
    w.player.position(w.sim, at);
    expect(at.x).toBeLessThanOrEqual((OFFSET + 6) * TILE_PX - BALANCE.player.movement.colliderRadiusPx + 0.001);
    // Taken back: the way is free.
    w.run(1, [{ type: 'station.remove', station: id }]);
    for (let i = 0; i < 60; i++) w.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    w.player.position(w.sim, at);
    expect(at.x).toBeGreaterThan((OFFSET + 8) * TILE_PX);
  });

  it('nicht auf den Spieler: standingThere', () => {
    const w = stationWorld();
    w.give('werkbank', 1);
    expect(w.refused({ type: 'station.place', from: w.slotOf('werkbank'), tx: OFFSET + 3, ty: OFFSET + 4 })).toEqual(['standingThere']);
    expect(w.refused({ type: 'station.place', from: w.slotOf('werkbank'), tx: OFFSET + 5, ty: OFFSET + 4 })).toEqual([]);
  });
});
