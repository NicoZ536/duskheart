/**
 * M4-07/M4-08/M4-32: the reading samples behind the recipe screens on a real session (src/game/samples/werkstatt.ts
 * through `GameSession.sampleCrafting` / `sampleStation` / `sampleChest`) – the player on the start beach discovers
 * the rope recipe once fibres are in the bags, sees what is at hand, queues rope and watches the queue advance, pins
 * recipes (`craft.pin`: the sample follows the simulation's list) and asks whether water is within reach (none at the
 * spawn on the start beach: the sea is no fresh water);
 * a clay oven set up next to the player shows its slots, the fuel's glow and the batch, and closes its reach when the
 * player walks away. Nothing is read from the simulation directly (ADR-0010).
 */
import { describe, expect, it } from 'vitest';
import { createChestSample, createCraftingSample, createStationSample } from '../../../src/game/samples/werkstatt';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { TILE_PX } from '../../../src/world/model/coords';

function sessionMitSpieler(): GameSession {
  const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
  s.command({ type: 'player.spawn' });
  s.step();
  return s;
}

describe('Abtastung des Handwerks', () => {
  it('zeigt sichtbare Rezepte, Vorrat, Warteschlange mit Fortschritt und Handwerksstufe', () => {
    const s = sessionMitSpieler();
    const out = createCraftingSample();
    out.frageItems = ['fasern'];
    expect(s.sampleCrafting(out)).toBe(true);
    expect(out.sichtbar.has('rezept_faserseil')).toBe(false);
    s.command({ type: 'inventory.give', item: 'fasern', count: 9 });
    s.step();
    s.sampleCrafting(out);
    const stand = out.sichtbarStand;
    expect(out.sichtbar.has('rezept_faserseil')).toBe(true);
    expect(out.imBeutel.get('fasern')).toBe(9);
    expect(out.verfuegbar.get('fasern')).toBe(9);
    expect(out.handwerkStufe).toBeGreaterThanOrEqual(1);
    expect(out.kisten).toBe(true);
    s.command({ type: 'craft.start', recipe: 'rezept_faserseil', count: 2 });
    s.step();
    s.step();
    s.sampleCrafting(out);
    expect(out.auftragAnzahl).toBe(1);
    expect(out.auftraege[0]).toMatchObject({ rezept: 'rezept_faserseil', anzahl: 2, station: null });
    expect(out.auftraege[0]?.fortschritt).toBeGreaterThan(0);
    expect(out.imBeutel.get('fasern')).toBe(3);
    expect(out.blockiert).toBeNull();
    // Nothing new became visible: the set stays as it was.
    expect(out.sichtbarStand).toBe(stand);
  });

  it('zeigt die angehefteten Rezepte der Simulation und prüft Wasser nur auf Nachfrage', () => {
    const s = sessionMitSpieler();
    s.command({ type: 'inventory.give', item: 'fasern', count: 9 });
    s.command({ type: 'inventory.give', item: 'holzeimer', count: 1 });
    s.command({ type: 'craft.pin', recipe: 'rezept_faserseil', on: true });
    s.step();
    const out = createCraftingSample();
    s.sampleCrafting(out);
    expect(out.angeheftet).toEqual(['rezept_faserseil']);
    const stand = out.angeheftetStand;
    s.sampleCrafting(out);
    expect(out.angeheftetStand).toBe(stand);
    s.command({ type: 'craft.pin', recipe: 'rezept_holzeimer_wasser', on: true });
    s.step();
    s.sampleCrafting(out);
    expect(out.angeheftet).toEqual(['rezept_faserseil', 'rezept_holzeimer_wasser']);
    expect(out.angeheftetStand).toBe(stand + 1);
    // Water: answered only when asked; at the spawn on the start beach there is no fresh water in reach.
    out.amWasser = true;
    s.sampleCrafting(out);
    expect(out.amWasser).toBe(true);
    out.frageWasser = true;
    s.sampleCrafting(out);
    expect(out.amWasser).toBe(false);
  });
});

describe('Abtastung einer Station', () => {
  it('zeigt Plätze, Glut und Charge eines Lehmofens und ob der Spieler in Reichweite steht', () => {
    const s = sessionMitSpieler();
    s.command({ type: 'inventory.give', item: 'lehmofen', count: 1 });
    s.command({ type: 'inventory.give', item: 'lehm', count: 6 });
    s.command({ type: 'inventory.give', item: 'holz', count: 4 });
    s.step();
    const placed: number[] = [];
    s.onEvent('stationPlaced', (e) => placed.push(e.id));
    const at = s.debugState().player;
    expect(at).not.toBeNull();
    const ptx = Math.floor((at?.x ?? 0) / TILE_PX);
    const pty = Math.floor((at?.y ?? 0) / TILE_PX);
    // The first free 2 × 2 spot around the player (the beach may have stones and grass tufts).
    const offsets = [
      [1, -1],
      [-2, -1],
      [1, 1],
      [-2, 1],
      [-1, 1],
      [-1, -2],
      [2, 0],
      [-3, 0],
    ] as const;
    for (const [dx, dy] of offsets) {
      if (placed.length > 0) break;
      s.command({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx: ptx + dx, ty: pty + dy });
      s.step();
    }
    expect(placed).toHaveLength(1);
    const id = placed[0] ?? 0;
    const out = createStationSample();
    expect(s.sampleStation(id, out)).toBe(true);
    expect(out).toMatchObject({ vorhanden: true, station: 'lehmofen', verarbeitung: true, inReichweite: true, rezept: null, glut: 0 });
    expect(out.eingang).toEqual([null, null]);
    expect(out.ausgang).toEqual([null, null]);
    const stand = out.stand;
    s.sampleStation(id, out);
    expect(out.stand).toBe(stand);
    // Clay into the input, wood onto the fuel: the oven fires a pot.
    s.command({ type: 'station.put', station: id, from: { bereich: 'inventar', index: 1 }, bereich: 'eingang' });
    s.command({ type: 'station.put', station: id, from: { bereich: 'inventar', index: 2 }, bereich: 'brennstoff' });
    s.step();
    s.step();
    s.sampleStation(id, out);
    expect(out.stand).toBeGreaterThan(stand);
    expect(out.eingang[0]?.item).toBe('lehm');
    expect(out.brennstoff?.item).toBe('holz');
    expect(out.rezept).toBe('rezept_keramik_topf');
    expect(out.laeuft).toBe(true);
    expect(out.fortschritt).toBeGreaterThan(0);
    expect(out.glut).toBeGreaterThan(0);
    // Far away: out of reach; an unknown id: gone.
    s.command({ type: 'player.teleport', x: (ptx + 40) * TILE_PX, y: (pty + 40) * TILE_PX, layer: 0 });
    s.step();
    s.sampleStation(id, out);
    expect(out.inReichweite).toBe(false);
    expect(s.sampleStation(id + 99, out)).toBe(false);
    expect(out.vorhanden).toBe(false);
  });

  it('meldet eine Kiste, die es nicht gibt, als nicht vorhanden', () => {
    const s = sessionMitSpieler();
    const out = createChestSample();
    expect(s.sampleChest(1, out)).toBe(false);
    expect(out.vorhanden).toBe(false);
  });
});
