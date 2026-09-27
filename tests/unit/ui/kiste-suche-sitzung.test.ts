/**
 * M4-21, §16.7 "Suche über alle Kisten der Basis": the reading sample behind the chest screen's search on a real session
 * (src/game/samples/kistensuche.ts through `GameSession.sampleChestSearch`, and the tab's source
 * `createKistenSucheQuelle`) – without a hearth the base of a chest is every chest within `BALANCE.storage
 * .searchRadiusTiles` of it (not one farther away); the finds are exactly those of `StorageSystem.search`, grouped per
 * chest, nearest first, the open chest marked; nothing counts as changed while nothing changes, a stack taken out is
 * seen at once; an empty query finds nothing but still names the base; with a hearthfire built next to the chests its
 * zone is the base. The test reads the simulation to compare; the UI never does (ADR-0010).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createChestSearchSample } from '../../../src/game/samples/kistensuche';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { chestCentre } from '../../../src/game/storage/formulas';
import type { StorageSystem } from '../../../src/game/storage/system';
import { TILE_PX } from '../../../src/world/model/coords';
import { createKistenSucheQuelle } from '../../../src/ui/screens/kiste/sucheQuelle';

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, -2],
  [-2, -2],
  [1, 1],
  [-2, 1],
  [2, -1],
  [-3, -1],
  [0, 2],
  [0, -3],
  [3, 0],
  [-4, 0],
];
/** How far the third chest stands from the first [tiles]: beyond the search radius. */
const FERN = BALANCE.storage.searchRadiusTiles + 8;
const FULL_SIM_TIMEOUT_MS = 30_000;

function storage(s: GameSession): StorageSystem {
  return s.sim.system('storage') as unknown as StorageSystem;
}

function kachel(s: GameSession): { tx: number; ty: number } {
  const at = s.debugState().player;
  if (at === null) throw new Error('no player');
  return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
}

/** Builds `part` on the first of the offsets around the player that takes it; returns the new id. */
function bauen(s: GameSession, part: string, event: 'chestPlaced' | 'hearthBuilt', offsets: ReadonlyArray<readonly [number, number]> = OFFSETS): number {
  const p = kachel(s);
  for (const [dx, dy] of offsets) {
    const before = s.debugState().events[event];
    s.command({ type: 'build.place', part, tx: p.tx + dx, ty: p.ty + dy });
    s.step();
    const after = s.debugState().events[event];
    if (after > before) return after;
  }
  throw new Error(`no spot for ${part}`);
}

/** Three chests: two next to the player (10 and 5 stones), one `FERN` tiles away (4 stones). */
function drei(): { s: GameSession; a: number; b: number; c: number } {
  const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
  s.command({ type: 'player.spawn' });
  s.command({ type: 'setWeather', state: 'klar' });
  s.step();
  s.command({ type: 'inventory.give', item: 'kiste_holz', count: 3 });
  s.command({ type: 'inventory.give', item: 'stein', count: 19 });
  s.command({ type: 'inventory.give', item: 'holz', count: 5 });
  s.step();
  const start = s.debugState().player;
  if (start === null) throw new Error('no player');
  const a = bauen(s, 'kiste_holz', 'chestPlaced');
  s.command({ type: 'storage.put', chest: a, from: { bereich: 'inventar', index: 1 }, count: 10 });
  s.command({ type: 'storage.put', chest: a, from: { bereich: 'inventar', index: 2 } });
  const b = bauen(s, 'kiste_holz', 'chestPlaced');
  s.command({ type: 'storage.put', chest: b, from: { bereich: 'inventar', index: 1 }, count: 5 });
  s.step();
  s.command({ type: 'player.teleport', x: start.x + FERN * TILE_PX, y: start.y, layer: 0 });
  s.step();
  const c = bauen(s, 'kiste_holz', 'chestPlaced');
  s.command({ type: 'storage.put', chest: c, from: { bereich: 'inventar', index: 1 } });
  s.command({ type: 'player.teleport', x: start.x, y: start.y, layer: 0 });
  s.step();
  return { s, a, b, c };
}

describe('Suche über die Kisten der Basis', () => {
  it(
    'findet ohne Herdfeuer die Kisten im Suchradius, gruppiert je Kiste wie StorageSystem.search, nächste zuerst',
    () => {
      const { s, a, b, c } = drei();
      const out = createChestSearchSample();
      out.suche = new Set(['stein']);
      expect(s.sampleChestSearch(a, out)).toBe(true);
      expect(out).toMatchObject({ vorhanden: true, herd: false, radius: BALANCE.storage.searchRadiusTiles, kistenGesamt: 2, kistenAnzahl: 2 });
      const st = storage(s);
      const offen = st.chest(a);
      if (offen === undefined) throw new Error('no chest');
      const centre = chestCentre(offen, { x: 0, y: 0 });
      const funde = st.search(offen.layer, Math.floor(centre.x / TILE_PX), Math.floor(centre.y / TILE_PX), (item) => item === 'stein');
      expect(funde.map((f) => f.chest).sort()).toEqual([a, b].sort());
      const [erste, zweite] = out.kisten;
      expect(erste).toMatchObject({ id: a, offen: true, entfernung: 0, dx: 0, dy: 0, fundAnzahl: 1, stueck: 10 });
      expect(erste?.funde[0]?.stack).toBe(funde.find((f) => f.chest === a)?.stack);
      const other = st.chest(b);
      if (other === undefined) throw new Error('no chest');
      const oc = chestCentre(other, { x: 0, y: 0 });
      expect(zweite).toMatchObject({
        id: b,
        offen: false,
        fundAnzahl: 1,
        stueck: 5,
        dx: Math.round((oc.x - centre.x) / TILE_PX),
        dy: Math.round((oc.y - centre.y) / TILE_PX),
        entfernung: Math.round(Math.hypot(oc.x - centre.x, oc.y - centre.y) / TILE_PX),
      });
      expect(out.kisten.slice(0, out.kistenAnzahl).some((k) => k.id === c)).toBe(false);
    },
    FULL_SIM_TIMEOUT_MS,
  );

  it(
    'zählt nur Änderungen und sieht einen herausgenommenen Stapel sofort',
    () => {
      const { s, a, b } = drei();
      const out = createChestSearchSample();
      out.suche = new Set(['stein']);
      s.sampleChestSearch(a, out);
      const stand = out.stand;
      s.sampleChestSearch(a, out);
      expect(out.stand).toBe(stand);
      s.command({ type: 'storage.take', chest: b, index: 0, count: 2 });
      s.step();
      s.sampleChestSearch(a, out);
      expect(out.stand).toBe(stand + 1);
      expect(out.kisten[1]).toMatchObject({ id: b, stueck: 3 });
      // Nothing searched: no finds, the base is still named.
      out.suche = null;
      s.sampleChestSearch(a, out);
      expect(out).toMatchObject({ kistenAnzahl: 0, kistenGesamt: 2 });
      expect(s.sampleChestSearch(a + 100, out)).toBe(false);
      expect(out.vorhanden).toBe(false);
    },
    FULL_SIM_TIMEOUT_MS,
  );

  it(
    'nimmt die Zone eines Herdfeuers als Basis, sobald eines die Kiste deckt',
    () => {
      const { s, a } = drei();
      s.command({ type: 'inventory.give', item: 'herdfeuer', count: 1 });
      s.step();
      const hearthOffsets: Array<readonly [number, number]> = [];
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hearthOffsets.push([dx, dy]);
      bauen(s, 'herdfeuer', 'hearthBuilt', hearthOffsets);
      // The zone changes the base at the next world second.
      for (let i = 0; i < 60; i++) s.step();
      const out = createChestSearchSample();
      out.suche = new Set(['stein']);
      s.sampleChestSearch(a, out);
      expect(out.herd).toBe(true);
      expect(out.radius).toBe(BALANCE.hearth.radiusByCores[0]);
      expect(out.kistenAnzahl).toBeGreaterThanOrEqual(1);
    },
    FULL_SIM_TIMEOUT_MS,
  );
});

describe('Quelle der Suche', () => {
  it(
    'tastet nur aktiv ab, sofort bei neuer Suche, und veröffentlicht nur Änderungen',
    () => {
      const { s, a } = drei();
      const listeners: Array<() => void> = [];
      const frame = (): void => {
        for (const l of listeners) l();
      };
      const q = createKistenSucheQuelle({ sampleChestSearch: (id, out) => s.sampleChestSearch(id, out) }, a, (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      });
      expect(q.ansicht.value).toBeNull();
      q.suchen(new Set(['stein']));
      expect(q.ansicht.value).toBeNull();
      q.aktiv(true);
      const erste = q.ansicht.value;
      expect(erste?.kisten.map((k) => k.stueck)).toEqual([10, 5]);
      for (let i = 0; i < 12; i++) frame();
      expect(q.ansicht.value).toBe(erste);
      q.suchen(new Set(['holz']));
      expect(q.ansicht.value?.kisten.map((k) => k.stueck)).toEqual([5]);
      q.stop();
      expect(listeners).toHaveLength(0);
    },
    FULL_SIM_TIMEOUT_MS,
  );
});
