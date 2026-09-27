/**
 * M4-20: the reading sample behind the hearth screen on a real session (src/game/samples/basis.ts through
 * `GameSession.sampleHearth`, and the screen's signals `createHerdQuelle`) – a hearthfire built on the start beach,
 * cold and empty, then fuelled and lit: burning, the game time its fire lasts, the glow of the piece in the fire,
 * the store and the radius; the overview of its base lists exactly the chests of `HearthSystem.overview` (not one
 * far away), nearest first, and the search finds their stones through `StorageSystem.search`; nothing counts as
 * changed while nothing changes; walking away leaves the reach, putting it out ends the overview. Nothing is read
 * from the simulation by the UI (ADR-0010); the test compares with the systems directly.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { HearthSystem } from '../../../src/game/hearth/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import { createHearthSample } from '../../../src/game/samples/basis';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { TILE_PX } from '../../../src/world/model/coords';
import { createHerdQuelle } from '../../../src/ui/screens/herdfeuer/ansicht';

/** Game minutes per hour. */
const MIN_JE_H = 60;
const FULL_SIM_TIMEOUT_MS = 30_000;

interface Basis {
  readonly s: GameSession;
  readonly hearth: number;
  readonly anchor: { tx: number; ty: number };
  readonly near: number;
  readonly far: number;
}

function sessionMitSpieler(): GameSession {
  const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
  s.command({ type: 'player.spawn' });
  s.command({ type: 'setWeather', state: 'klar' });
  s.step();
  return s;
}

function spielerKachel(s: GameSession): { tx: number; ty: number } {
  const at = s.debugState().player;
  if (at === null) throw new Error('no player');
  return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
}

/** Places `part` on the first of `offsets` from the player's tile that takes it; returns the new id and the anchor. */
function bauen(s: GameSession, part: string, event: 'hearthBuilt' | 'chestPlaced', offsets: ReadonlyArray<readonly [number, number]>): { id: number; tx: number; ty: number } {
  const p = spielerKachel(s);
  for (const [dx, dy] of offsets) {
    const before = s.debugState().events[event];
    s.command({ type: 'build.place', part, tx: p.tx + dx, ty: p.ty + dy });
    s.step();
    const after = s.debugState().events[event];
    if (after > before) return { id: after, tx: p.tx + dx, ty: p.ty + dy };
  }
  throw new Error(`no spot for ${part}`);
}

function slotOf(s: GameSession, item: string): SlotRef {
  const state = (s.sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((x) => x !== null && x.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item}`);
}

function basis(): Basis {
  const s = sessionMitSpieler();
  for (const [item, count] of [
    ['herdfeuer', 1],
    ['kiste_holz', 2],
    ['holz', 6],
    ['holzkohle', 2],
    ['stein', 9],
  ] as const) {
    s.command({ type: 'inventory.give', item, count });
  }
  s.step();
  const start = s.debugState().player;
  if (start === null) throw new Error('no player');
  const hearth = bauen(s, 'herdfeuer', 'hearthBuilt', [
    [-1, -4],
    [-1, 2],
    [-5, -1],
    [3, -1],
  ]);
  const near = bauen(s, 'kiste_holz', 'chestPlaced', [
    [2, 0],
    [-2, 0],
    [2, 1],
    [-2, 1],
    [3, 0],
  ]);
  // A second chest 22 tiles east: outside the base's 12 tiles.
  s.command({ type: 'player.teleport', x: start.x + 22 * TILE_PX, y: start.y, layer: 0 });
  s.step();
  const far = bauen(s, 'kiste_holz', 'chestPlaced', [
    [2, 0],
    [-2, 0],
    [2, 1],
    [0, 2],
  ]);
  s.command({ type: 'storage.put', chest: far.id, from: slotOf(s, 'stein'), count: 4 });
  // Back to the hearth: stand on the tile south of its ring.
  s.command({ type: 'player.teleport', x: (hearth.tx + 1.5) * TILE_PX, y: (hearth.ty + 3.5) * TILE_PX, layer: 0 });
  s.step();
  s.command({ type: 'storage.put', chest: near.id, from: slotOf(s, 'stein') });
  s.step();
  return { s, hearth: hearth.id, anchor: hearth, near: near.id, far: far.id };
}

describe('Abtastung eines Herdfeuers', () => {
  it(
    'kalt und leer, dann befeuert und entzündet: Restzeit in Spielminuten, Glut, Vorrat, Radius, Reichweite',
    () => {
      const b = basis();
      const out = createHearthSample();
      expect(b.s.sampleHearth(b.hearth, out)).toBe(true);
      expect(out).toMatchObject({ vorhanden: true, id: b.hearth, inReichweite: true, brennt: false, restMinuten: 0, glut: 0, stueck: 0, radius: 12, uebersicht: false, kistenAnzahl: 0 });
      expect(out.kerne).toEqual([null, null, null, null, null, null]);
      expect(out.vorrat).toEqual([]);
      expect(b.s.sampleHearth(999, createHearthSample())).toBe(false);

      b.s.command({ type: 'hearth.fuel', hearth: b.hearth, from: slotOf(b.s, 'holz'), count: 3 });
      b.s.command({ type: 'hearth.fuel', hearth: b.hearth, from: slotOf(b.s, 'holzkohle'), count: 1 });
      b.s.command({ type: 'hearth.ignite', hearth: b.hearth });
      b.s.step();
      const stand = out.stand;
      b.s.sampleHearth(b.hearth, out);
      expect(out.stand).toBeGreaterThan(stand);
      // The first log is in the fire: two logs and the charcoal wait; 1 + 2 + 3 game hours, less the tick it burned.
      expect(out.brennt).toBe(true);
      expect(out.stueck).toBe(3);
      expect(out.vorrat.map((s) => [s.item, s.count])).toEqual([
        ['holz', 2],
        ['holzkohle', 1],
      ]);
      expect(out.restMinuten).toBe(6 * MIN_JE_H);
      expect(out.glut).toBeGreaterThan(0.99);
      expect(out.glut).toBeLessThanOrEqual(1);
      // Two game minutes later.
      const tph = b.s.sim.clock.ticksPerGameHour;
      for (let i = 0; i < (2 * tph) / MIN_JE_H; i++) b.s.step();
      b.s.sampleHearth(b.hearth, out);
      expect(out.restMinuten).toBe(6 * MIN_JE_H - 2);
      expect(out.glut).toBeLessThan(1);
      // The same fire as the hearth system tells it.
      const system = b.s.sim.system('hearth') as unknown as HearthSystem;
      const h = system.hearth(b.hearth);
      if (h === undefined) throw new Error('no hearth');
      const ticksLeft = Math.round(system.secondsLeft(b.s.sim, h) * BALANCE.time.tickHz);
      expect(out.restMinuten).toBe(Math.ceil((ticksLeft * MIN_JE_H) / tph));
      expect(out.vorrat[0]).toBe(h.vorrat[0]);

      // Nothing changed: nothing counts as changed.
      const s1 = out.stand;
      const u1 = out.uebersichtStand;
      b.s.sampleHearth(b.hearth, out);
      expect(out.stand).toBe(s1);
      expect(out.uebersichtStand).toBe(u1);
      // Burning, the sample changes with the shown minute and the glow's hundredths – not with every tick.
      let changes = 0;
      for (let i = 0; i < 30; i++) {
        const before = out.stand;
        b.s.step();
        b.s.sampleHearth(b.hearth, out);
        if (out.stand !== before) changes++;
      }
      expect(changes).toBeLessThanOrEqual(2);
      expect(out.uebersichtStand).toBe(u1);

      // Walking away leaves the reach.
      b.s.command({ type: 'player.teleport', x: (b.anchor.tx + 1.5) * TILE_PX + 10 * TILE_PX, y: (b.anchor.ty + 3.5) * TILE_PX, layer: 0 });
      b.s.step();
      b.s.sampleHearth(b.hearth, out);
      expect(out.inReichweite).toBe(false);
    },
    FULL_SIM_TIMEOUT_MS,
  );

  it(
    'die Lagerübersicht listet die Kisten der Basis wie das Herdfeuer-System, durchsucht sie und endet mit dem Feuer',
    () => {
      const b = basis();
      const out = createHearthSample();
      b.s.command({ type: 'hearth.fuel', hearth: b.hearth, from: slotOf(b.s, 'holz') });
      b.s.command({ type: 'hearth.ignite', hearth: b.hearth });
      b.s.step();
      b.s.sampleHearth(b.hearth, out);
      expect(out.uebersicht).toBe(true);
      const system = b.s.sim.system('hearth') as unknown as HearthSystem;
      const overview = system.overview(b.s.sim, b.hearth);
      expect(overview).not.toBeNull();
      const ids = out.kisten.slice(0, out.kistenAnzahl).map((k) => k.id);
      expect(ids).toEqual(overview?.chests.map((c) => c.id));
      expect(ids).toEqual([b.near]);
      expect(ids).not.toContain(b.far);
      const kiste = out.kisten[0];
      expect(kiste).toMatchObject({ id: b.near, item: 'kiste_holz', name: '', label: null, belegt: 1 });
      expect(kiste?.slots).toHaveLength(16);
      expect(kiste?.slots[0]?.item).toBe('stein');
      expect(kiste?.entfernung).toBeGreaterThanOrEqual(0);
      expect(kiste?.entfernung).toBeLessThanOrEqual(12);

      // Search: the stone of the base's chest, not the one far away.
      const vorher = out.uebersichtStand;
      out.suche = new Set(['stein']);
      b.s.sampleHearth(b.hearth, out);
      expect(out.uebersichtStand).toBeGreaterThan(vorher);
      expect(out.treffer.slice(0, out.trefferAnzahl).map((t) => [t.kiste, t.index, t.stack.item, t.stack.count])).toEqual([[b.near, 0, 'stein', 5]]);
      const gesucht = out.uebersichtStand;
      b.s.sampleHearth(b.hearth, out);
      expect(out.uebersichtStand).toBe(gesucht);
      out.suche = new Set(['obsidian']);
      b.s.sampleHearth(b.hearth, out);
      expect(out.trefferAnzahl).toBe(0);

      // A renamed chest changes the overview.
      b.s.command({ type: 'storage.rename', chest: b.near, name: 'Vorrat' });
      b.s.step();
      const vorUmbenennen = out.uebersichtStand;
      b.s.sampleHearth(b.hearth, out);
      expect(out.kisten[0]?.name).toBe('Vorrat');
      expect(out.uebersichtStand).toBeGreaterThan(vorUmbenennen);

      // Put out: no overview.
      b.s.command({ type: 'hearth.douse', hearth: b.hearth });
      b.s.step();
      b.s.sampleHearth(b.hearth, out);
      expect(out.brennt).toBe(false);
      expect(out.uebersicht).toBe(false);
      expect(out.kistenAnzahl).toBe(0);
      expect(out.trefferAnzahl).toBe(0);
    },
    FULL_SIM_TIMEOUT_MS,
  );

  it(
    'die Signale des Bildschirms: der Herd und die Übersicht je für sich, unverändert dasselbe Objekt; die Suche geht in die Abtastung',
    () => {
      const b = basis();
      const listeners: Array<() => void> = [];
      const quelle = createHerdQuelle(b.s, b.hearth, (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      });
      const frame = (): void => {
        for (const l of [...listeners]) l();
      };
      const herd0 = quelle.herd.value;
      const ueb0 = quelle.uebersicht.value;
      expect(herd0).toMatchObject({ vorhanden: true, brennt: false, stueck: 0, radius: 12 });
      expect(ueb0).toMatchObject({ gezeigt: false, kisten: [], treffer: [] });
      frame();
      expect(quelle.herd.value).toBe(herd0);
      expect(quelle.uebersicht.value).toBe(ueb0);
      b.s.command({ type: 'hearth.fuel', hearth: b.hearth, from: slotOf(b.s, 'holz') });
      b.s.command({ type: 'hearth.ignite', hearth: b.hearth });
      b.s.step();
      frame();
      expect(quelle.herd.value?.brennt).toBe(true);
      expect(quelle.uebersicht.value?.kisten.map((k) => k.id)).toEqual([b.near]);
      expect(quelle.uebersicht.value?.kisten[0]?.plaetze).toBe(16);
      quelle.suchen(new Set(['stein']));
      expect(quelle.uebersicht.value?.treffer.map((t) => t.kiste)).toEqual([b.near]);
      quelle.suchen(null);
      expect(quelle.uebersicht.value?.treffer).toEqual([]);
      quelle.stop();
      expect(listeners).toHaveLength(0);
    },
    FULL_SIM_TIMEOUT_MS,
  );
});
