/**
 * Which room the listener stands in, for the reverb (M7-01, src/audio/reverb.ts `reverbRoomFor`): the player's layer, a
 * roof or an interior around them (`RoomsSystem.playerIndoors`), the size of their room (`playerRoom`), a vault
 * (`VaultsApi.playerVault` – strand C's system, found by its id and method once it is registered: the slot its tick holds,
 * an integer – this probe runs four times a second, in code V8 has not optimised, where working out the tile from the
 * fractional position boxed numbers on every read). Read-only, no allocation: the systems are looked up once per
 * simulation, the situation is a held record.
 */
import type { Simulation } from '../game/sim';
import { PlayerSystem } from '../game/player/system';
import { RoomsSystem } from '../game/rooms/system';
import type { VaultsApi } from '../game/vaults/types';
import { HeldPoint } from '../engine/heldRecords';
import type { RoomSituation } from './reverb';

/** A fresh situation (open sky on the surface). */
export function createRoomSituation(): RoomSituation {
  return { layer: 0, indoors: false, roomTiles: 0, inVault: false };
}

export class RoomProbe {
  private sim: Simulation | null = null;
  private player: PlayerSystem | null = null;
  private rooms: RoomsSystem | null = null;
  private vaults: Pick<VaultsApi, 'playerVault'> | null = null;
  /** The player's position, overwritten in place (a class of its own: its fields stay numbers, ADR-0275). */
  private readonly pos = new HeldPoint();

  /** Reads the player's surroundings into `out`; false (and `out` the open sky) without a player. */
  read(sim: Simulation | undefined, out: RoomSituation): boolean {
    out.indoors = false;
    out.roomTiles = 0;
    out.inVault = false;
    if (sim === undefined) {
      out.layer = 0;
      return false;
    }
    if (this.sim !== sim) {
      this.sim = sim;
      this.player = null;
      this.rooms = null;
      this.vaults = null;
      for (const s of sim.systems) {
        if (s instanceof PlayerSystem) this.player = s;
        else if (s instanceof RoomsSystem) this.rooms = s;
        else if (s.id === 'vaults' && typeof (s as unknown as Record<string, unknown>).playerVault === 'function') this.vaults = s as unknown as Pick<VaultsApi, 'playerVault'>;
      }
    }
    const body = this.player?.body(sim);
    if (body === undefined || this.player === null || !this.player.position(sim, this.pos)) {
      out.layer = 0;
      return false;
    }
    out.layer = body.layer;
    if (this.rooms !== null) {
      out.indoors = this.rooms.playerIndoors(sim);
      out.roomTiles = this.rooms.playerRoom(sim)?.region.size ?? 0;
    }
    if (this.vaults !== null) out.inVault = this.vaults.playerVault() >= 0;
    return true;
  }
}
