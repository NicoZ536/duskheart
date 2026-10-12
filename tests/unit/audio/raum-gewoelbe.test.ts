/**
 * The listener's room in a vault (M7-01 reverb "Gewölbe → Halle", strand C's vaults; M7-78 "Frame-Pfad ohne Allokation"): the
 * room probe asks the vaults system for the vault the player stood in at the last tick (`VaultsApi.playerVault`, an integer
 * the tick holds) instead of working the tile out from the fractional position – the probe runs four times a second, in code
 * V8 has not optimised, where that boxed numbers on every read (the audio frame in a real biome world measured 3 B per frame
 * once the vaults system was registered). Outside, on the stairs and back up the slot is −1; down in the box it is the vault's.
 */
import { describe, expect, it } from 'vitest';
import { reverbRoomFor } from '../../../src/audio/reverb';
import { RoomProbe, createRoomSituation } from '../../../src/audio/roomProbe';
import { VAULT_SLOT, gewoelbeWelt } from '../game/gewoelbe-testwelt';

describe('Raum des Hörers im Gewölbe', () => {
  it('draußen kein Gewölbe; hinab: das Gewölbe des Spielers, Halle; wieder oben: draußen', () => {
    const w = gewoelbeWelt();
    w.run(1);
    const probe = new RoomProbe();
    const s = createRoomSituation();
    expect(w.vaults.playerVault()).toBe(-1);
    expect(probe.read(w.sim, s)).toBe(true);
    expect([s.layer, s.inVault]).toEqual([0, false]);
    // Down the stairs (E at the entrance): the next tick holds the vault's slot.
    w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
    w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
    w.run(1);
    expect(w.vaults.playerVault()).toBe(VAULT_SLOT);
    expect(probe.read(w.sim, s)).toBe(true);
    expect([s.layer, s.inVault]).toEqual([-1, true]);
    expect(reverbRoomFor(s)).toBe('halle');
    // Elsewhere on layer −1, outside the vault's box: a cave, no hall.
    w.goToTile(w.plan.box.x0 + w.plan.box.w + 4, w.plan.box.y0 - 4, -1);
    w.run(1);
    expect(w.vaults.playerVault()).toBe(-1);
    expect(probe.read(w.sim, s)).toBe(true);
    expect([s.layer, s.inVault]).toEqual([-1, false]);
    expect(reverbRoomFor(s)).toBe('hoehle');
  });
});
