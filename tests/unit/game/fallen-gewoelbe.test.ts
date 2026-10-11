/**
 * The vault traps (M7-14; MASTERPROMPT §21 "Fallen: Speerfallen, Pfeilwerfer, Rollsteine, Fallgruben, … einstürzende Böden,
 * Pendelklingen", §4.6 "Gefahren … Vorwarnung"; docs/SPIEL.md §19 "Fallen M7"): every trap warns at least 0.4 s before it
 * strikes (`vaultTrapArmed` → `vaultTrapTriggered`), hurts the player with cause `falle` – rolling dodges it, stepping away in the
 * warning too –, cools down, senses creatures as well and hurts them; the dart stops at the first body, the boulder rolls down
 * its whole lane and comes back after its reset, the collapsing floor stays a hole, the blade swings on its beat (a pure function
 * of the tick); nothing runs while the player is outside; a save in the middle of a warning strikes at the same tick.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { TRAP_TELEGRAPH_MIN, type VaultTrapDef } from '../../../src/content/dungeons/schema';
import { secondsToTicks } from '../../../src/game/combat/formulas';
import { trapBeatTicks, trapRearmTicks, trapWarnTicks } from '../../../src/game/vaults/formulas';
import { TRAP_SPENT } from '../../../src/game/vaults/state';
import { vaultRaster } from '../../../src/world/gen/vaults/raster';
import type { VaultPlan, VaultTrapPlan } from '../../../src/world/gen/vaults/types';
import { TILE_PX } from '../../../src/world/model/coords';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from './gewoelbe-testwelt';

const TRAPS = CONTENT.collection('vaultTraps');
const def = (id: string): VaultTrapDef => TRAPS.get(id);

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

/** Free floor tiles of the start room, row by row (not the way up, nothing standing on them). */
function startFloor(plan: VaultPlan): { tx: number; ty: number }[] {
  const r = vaultRaster(plan);
  const room = plan.rooms.find((x) => x.node === plan.graph.start)!;
  const out: { tx: number; ty: number }[] = [];
  for (let ty = room.y0 + 2; ty < room.y0 + 14; ty++) {
    for (let tx = room.x0 + 2; tx < room.x0 + 14; tx++) {
      const i = (ty - r.y0) * r.w + (tx - r.x0);
      if (r.solid[i] === 0 && r.object[i] === null && i !== r.entrance) out.push({ tx, ty });
    }
  }
  return out;
}

/** A world whose vault has exactly the traps `make` puts into its start room (no puzzle parts or doors there move). */
function trapWelt(make: (floor: { tx: number; ty: number }[], plan: VaultPlan) => VaultTrapPlan[]): GewoelbeWelt {
  return gewoelbeWelt({ plan: (p) => ({ ...p, traps: make(startFloor(p), p) }) });
}

/** A trap of `type` at tile `at`, striking east along a free lane of `reach` tiles. */
function trap(id: number, type: string, at: { tx: number; ty: number }, dir: 0 | 1 | 2 | 3 = 1, reach = 3): VaultTrapPlan {
  return { id, type, tx: at.tx, ty: at.ty, dir, reach };
}

/** Floor tile of the start room with `n` free floor tiles east of it. */
function laneStart(floor: { tx: number; ty: number }[], n: number): { tx: number; ty: number } {
  const free = new Set(floor.map((f) => `${f.tx},${f.ty}`));
  const s = floor.find((f) => [...Array(n + 1).keys()].every((k) => free.has(`${f.tx + k},${f.ty}`)));
  if (s === undefined) throw new Error('no lane');
  return s;
}

/** Runs until `type` comes (at most `max` ticks); returns the events of that tick and the ticks run. */
function runUntil(w: GewoelbeWelt, type: string, max: number): { ev: Map<string, unknown[]>; ticks: number } {
  for (let t = 1; t <= max; t++) {
    const ev = w.run(1);
    if (events(ev, type).length > 0) return { ev, ticks: t };
  }
  throw new Error(`no ${type} within ${max} ticks`);
}

describe('vault traps: content', () => {
  it('six traps, each warning at least 0.4 s before it strikes, each with its sprite and sound', () => {
    expect([...TRAPS.ids()].sort()).toEqual(['einsturzboden', 'fallgrube', 'pendelklinge', 'pfeilwerfer', 'rollstein', 'speerfalle']);
    for (const t of TRAPS.values()) {
      expect(t.telegraphSekunden, t.id).toBeGreaterThanOrEqual(TRAP_TELEGRAPH_MIN);
      expect(trapWarnTicks(t), t.id).toBe(secondsToTicks(t.telegraphSekunden));
      expect(CONTENT.collection('sfx').find(t.sound), t.sound).toBeDefined();
    }
  });
});

describe('vault traps at runtime', () => {
  it('a spear plate warns, strikes after its telegraph with cause falle, cools down and strikes again', () => {
    let at = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      at = floor[5]!;
      return [trap(0, 'speerfalle', at)];
    });
    // The plate senses the player in the tick he steps on it.
    const armed = w.goToTile(at.tx, at.ty);
    expect(events(armed, 'vaultTrapArmed')).toEqual([expect.objectContaining({ vault: VAULT_SLOT, trap: 0, typ: 'speerfalle', x: (at.tx + 0.5) * TILE_PX, y: (at.ty + 0.5) * TILE_PX })]);
    const health = w.vit().health;
    const { ev, ticks } = runUntil(w, 'vaultTrapTriggered', 200);
    expect(ticks).toBe(trapWarnTicks(def('speerfalle')));
    expect(events(ev, 'playerDamaged')).toEqual([expect.objectContaining({ cause: 'falle', amount: def('speerfalle').schaden })]);
    expect(w.vit().health).toBe(health - def('speerfalle').schaden);
    // Standing on it: the next warning only after the cooldown.
    const again = runUntil(w, 'vaultTrapArmed', 1000);
    expect(again.ticks).toBe(trapRearmTicks(def('speerfalle')));
  });

  it('stepping off during the warning or rolling through the strike leaves the player unhurt', () => {
    let at = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      at = floor[5]!;
      return [trap(0, 'speerfalle', at)];
    });
    w.goToTile(at.tx, at.ty);
    w.goToTile(at.tx, at.ty - 1);
    const { ev } = runUntil(w, 'vaultTrapTriggered', 200);
    expect(events(ev, 'playerDamaged')).toEqual([]);
    // Back on the plate after the cooldown, rolling at the strike.
    w.goToTile(at.tx, at.ty);
    runUntil(w, 'vaultTrapArmed', 1000);
    w.run(trapWarnTicks(def('speerfalle')) - 1);
    w.body().invulnerableTicks = 10;
    const rolled = w.run(1);
    expect(events(rolled, 'vaultTrapTriggered')).toHaveLength(1);
    expect(events(rolled, 'playerDamaged')).toEqual([]);
  });

  it('the dart stops at the first body in its lane; the boulder hits the whole lane and rolls back after its reset', () => {
    let start = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      start = laneStart(floor, 4);
      return [trap(0, 'pfeilwerfer', start, 1, 4)];
    });
    const wolf = w.creatures.spawnOwned(w.sim, { creature: 'wolf', layer: -1, x: (start.tx + 1.5) * TILE_PX, y: (start.ty + 0.5) * TILE_PX, owner: `gewoelbe:${VAULT_SLOT}` });
    w.goToTile(start.tx + 3, start.ty);
    const wolfHealth = w.state(wolf).health;
    const health = w.vit().health;
    runUntil(w, 'vaultTrapTriggered', 200);
    expect(w.state(wolf).health).toBeLessThan(wolfHealth);
    expect(w.vit().health).toBe(health);

    let lane = { tx: 0, ty: 0 };
    const b = trapWelt((floor) => {
      lane = laneStart(floor, 4);
      return [trap(0, 'rollstein', lane, 1, 4)];
    });
    b.goToTile(lane.tx + 4, lane.ty);
    const before = b.vit().health;
    runUntil(b, 'vaultTrapTriggered', 200);
    expect(b.vit().health).toBe(before - def('rollstein').schaden);
    // The boulder comes back only after `resetSekunden`.
    expect(runUntil(b, 'vaultTrapArmed', 2000).ticks).toBe(trapRearmTicks(def('rollstein')));
    expect(trapRearmTicks(def('rollstein'))).toBe(secondsToTicks(def('rollstein').resetSekunden ?? 0));
  });

  it('a collapsing floor stays a hole (a chunk change, spent for good); a creature on a plate triggers it and is hurt', () => {
    let at = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      at = floor[7]!;
      return [trap(0, 'einsturzboden', at)];
    });
    // The player in the vault, away from the trap; a creature steps on it.
    w.goToTile(at.tx + 4, at.ty + 3);
    const deer = w.creatures.spawnOwned(w.sim, { creature: 'reh', layer: -1, x: (at.tx + 0.5) * TILE_PX, y: (at.ty + 0.5) * TILE_PX, owner: `gewoelbe:${VAULT_SLOT}` });
    // The deer stays on the plate (held there each tick: it would wander off in the two seconds of crumbling).
    const hold = (): void => {
      const row = w.motion.position.indexOf(deer);
      w.motion.position.columns.x[row] = (at.tx + 0.5) * TILE_PX;
      w.motion.position.columns.y[row] = (at.ty + 0.5) * TILE_PX;
    };
    const health = w.state(deer).health;
    expect(events(w.run(1), 'vaultTrapArmed')).toHaveLength(1);
    let struck = false;
    for (let i = 0; i < 400 && !struck; i++) {
      hold();
      struck = events(w.run(1), 'vaultTrapTriggered').length > 0;
    }
    expect(struck).toBe(true);
    expect(w.state(deer).health).toBe(health - def('einsturzboden').schaden);
    expect(w.objectAt(at.tx, at.ty)).toBe('ort_gw_einsturz');
    expect(w.vaults.state(VAULT_SLOT)?.trapReadyTick[0]).toBe(TRAP_SPENT);
    w.goToTile(at.tx, at.ty + 1);
    for (let i = 0; i < 400; i++) expect(events(w.run(1), 'vaultTrapArmed')).toEqual([]);
  });

  it('the blade swings on its beat whether anyone is there or not, and hurts who stands in its arc', () => {
    let at = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      at = laneStart(floor, 2);
      return [trap(0, 'pendelklinge', { tx: at.tx + 1, ty: at.ty }, 0, 3)];
    });
    w.goToTile(at.tx + 4, at.ty + 3);
    const beat = trapBeatTicks(def('pendelklinge'));
    const strikes: number[] = [];
    for (let i = 0; i < beat * 3 + 1; i++) for (const e of events<{ tick: number }>(w.run(1), 'vaultTrapTriggered')) strikes.push(e.tick);
    expect(strikes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < strikes.length; i++) expect((strikes[i] as number) - (strikes[i - 1] as number)).toBe(beat);
    // In the arc (across the lane: the blade's tile and its neighbours east and west).
    w.goToTile(at.tx, at.ty);
    const health = w.vit().health;
    runUntil(w, 'vaultTrapTriggered', beat + 1);
    expect(w.vit().health).toBe(health - def('pendelklinge').schaden);
  });

  it('nothing runs while the player is outside the vault', () => {
    let at = { tx: 0, ty: 0 };
    const w = trapWelt((floor) => {
      at = floor[5]!;
      return [trap(0, 'pendelklinge', at), trap(1, 'speerfalle', floor[9]!)];
    });
    w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 2, 0);
    for (let i = 0; i < 300; i++) {
      const ev = w.run(1);
      expect(events(ev, 'vaultTrapArmed')).toEqual([]);
      expect(events(ev, 'vaultTrapTriggered')).toEqual([]);
    }
  });

  it('a save in the middle of a warning strikes at the same tick after loading', () => {
    let at = { tx: 0, ty: 0 };
    const make = (floor: { tx: number; ty: number }[]): VaultTrapPlan[] => {
      at = floor[5]!;
      return [trap(0, 'fallgrube', at)];
    };
    const a = trapWelt(make);
    a.goToTile(at.tx, at.ty);
    a.run(1);
    a.run(5);
    const snap = a.vaults.save.serialize();
    const strikeA = runUntil(a, 'vaultTrapTriggered', 200).ev;
    const b = trapWelt(make);
    b.goToTile(at.tx, at.ty);
    b.run(5);
    b.vaults.save.deserialize(JSON.parse(JSON.stringify(snap)));
    const strikeB = runUntil(b, 'vaultTrapTriggered', 200).ev;
    expect(events<{ tick: number }>(strikeB, 'vaultTrapTriggered')[0]?.tick).toBe(events<{ tick: number }>(strikeA, 'vaultTrapTriggered')[0]?.tick);
  });
});
