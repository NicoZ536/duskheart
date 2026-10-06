/**
 * What the music director reads from the simulation each frame (M7-04; docs/SPIEL.md §24 "MusicDirector, liest die
 * Simulation nur"): the mood the world asks for, the biome under the player, day or night, the nearest hunting enemy, the
 * awake boss. Read-only and without allocation per frame (§30): the systems are found once per simulation, the probe is a
 * held record.
 *
 * The mood, by priority: no player → `titel` (the title before a world, the debug views); dead or making music →
 * `stille` (the death screen; the player's own song – `song` – takes over); an awake boss (`BossesApi.awake`) → `boss`; a hunting
 * enemy within `KAMPF_TILES` → `kampf`; inside a vault (`VaultsApi.vaultAt`) → `gewoelbe`; inside a lit hearth's base and
 * no hunter within `DANGER_FAR_TILES` → `basis`; else `erkundung`. Bosses and vaults belong to other strands: their
 * systems are found by id and used through the interfaces of src/game/{bosses,vaults}/types.ts once they are registered.
 */
import { CONTENT } from '../../content/index';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { CreatureSystem } from '../../game/creatures/system';
import type { AiState } from '../../game/creatures/state';
import { HearthSystem } from '../../game/hearth/system';
import { InstrumentsSystem } from '../../game/instruments/system';
import { PlayerSystem } from '../../game/player/system';
import type { Simulation } from '../../game/sim';
import type { SimWorld } from '../../game/world';
import type { BossesApi } from '../../game/bosses/types';
import type { VaultsApi } from '../../game/vaults/types';
import { nightOf } from '../../world/calendar';
import { CHUNK_SHIFT, TILE_PX, tileLocalIndex, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { DANGER_FAR_TILES } from './director';
import { worldOf } from '../simWorld';
import type { MusicProbe } from './types';

/** A hunting enemy this close starts the fight music [tiles]. */
export const KAMPF_TILES = 7;
/** AI states of a creature that hunts its target. */
const HUNTING: ReadonlySet<AiState> = new Set<AiState>(['jagen', 'angreifen', 'umkreisen']);
/** Teams that hunt the player. */
const HOSTILE_TEAMS: ReadonlySet<string> = new Set(['feind', 'schattenbrut']);

interface ProbeSystems {
  readonly sim: Simulation;
  readonly player: PlayerSystem | null;
  readonly creatures: CreatureSystem | null;
  readonly hearth: HearthSystem | null;
  readonly instruments: InstrumentsSystem | null;
  readonly bosses: Pick<BossesApi, 'awake'> | null;
  readonly vaults: Pick<VaultsApi, 'vaultAt'> | null;
}

/** The system registered as `id` if it offers `method` (a strand's API by its interface). */
function apiOf<T>(sim: Simulation, id: string, method: string): T | null {
  for (const s of sim.systems) if (s.id === id && typeof (s as unknown as Record<string, unknown>)[method] === 'function') return s as unknown as T;
  return null;
}

function systemsOf(sim: Simulation): ProbeSystems {
  let player: PlayerSystem | null = null;
  let creatures: CreatureSystem | null = null;
  let hearth: HearthSystem | null = null;
  let instruments: InstrumentsSystem | null = null;
  for (const s of sim.systems) {
    if (s instanceof PlayerSystem) player = s;
    else if (s instanceof CreatureSystem) creatures = s;
    else if (s instanceof HearthSystem) hearth = s;
    else if (s instanceof InstrumentsSystem) instruments = s;
  }
  return { sim, player, creatures, hearth, instruments, bosses: apiOf(sim, 'bosses', 'awake'), vaults: apiOf(sim, 'vaults', 'vaultAt') };
}

/** Fills `MusicProbe`s from one simulation (see module comment). */
export class MusicProbeReader {
  private systems: ProbeSystems | null = null;
  private readonly pos = { x: 0, y: 0 };
  private readonly other = { x: 0, y: 0 };

  /** Reads `sim` (or the title without one) into `out`. */
  read(sim: Simulation | undefined, out: MusicProbe): MusicProbe {
    out.boss = '';
    out.dangerTiles = -1;
    out.song = '';
    if (sim === undefined) {
      out.mood = 'titel';
      return out;
    }
    if (this.systems?.sim !== sim) this.systems = systemsOf(sim);
    const sys = this.systems;
    const body = sys.player?.body(sim);
    const clock = sim.clock;
    const world = worldOf(sim);
    out.night = world !== null && world.calendar.dayPhase === 'nacht';
    out.day = nightOf(clock.day, clock.minuteOfDay / 60);
    if (body === undefined || sys.player === null || !sys.player.position(sim, this.pos)) {
      out.mood = 'titel';
      return out;
    }
    const layer = body.layer;
    const tx = Math.floor(this.pos.x / TILE_PX);
    const ty = Math.floor(this.pos.y / TILE_PX);
    out.biome = (world === null ? null : this.biomeAt(world, layer, tx, ty)) ?? out.biome;
    const vitals = sys.player.vitalsOf(sim.player);
    out.song = sys.instruments?.playing()?.lied ?? '';
    if ((vitals !== undefined && vitals.health <= 0) || out.song !== '') {
      out.mood = 'stille';
      return out;
    }
    out.dangerTiles = this.nearestHunter(sim, sys.creatures, layer);
    const boss = sys.bosses?.awake() ?? null;
    if (boss !== null) {
      // The boss's own fight music (content `bosses.musik`), its id when the content does not know it.
      out.boss = CONTENT.collection('bosses').find(boss)?.musik ?? boss;
      out.mood = 'boss';
    } else if (out.dangerTiles >= 0 && out.dangerTiles <= KAMPF_TILES) out.mood = 'kampf';
    else if (sys.vaults !== null && sys.vaults.vaultAt(layer, tx, ty) >= 0) out.mood = 'gewoelbe';
    else if (out.dangerTiles < 0 && sys.hearth?.zoneAt(sim, layer, tx, ty)?.lit === true) out.mood = 'basis';
    else out.mood = 'erkundung';
    return out;
  }

  /** Distance to the nearest enemy hunting the player [tiles], or −1 (none within `DANGER_FAR_TILES`). */
  private nearestHunter(sim: Simulation, creatures: CreatureSystem | null, layer: Layer): number {
    if (creatures === null) return -1;
    const player: Entity = sim.player;
    if (player === NULL_ENTITY) return -1;
    const store = creatures.store;
    let best = DANGER_FAR_TILES * TILE_PX;
    let found = false;
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      if (s.layer !== layer || s.health <= 0 || s.target !== player || !HUNTING.has(s.state)) continue;
      const kind = creatures.catalog.find(s.creature);
      if (kind === undefined || !HOSTILE_TEAMS.has(kind.def.team)) continue;
      if (!creatures.positionOf(store.entityAt(i), this.other)) continue;
      const d = Math.hypot(this.other.x - this.pos.x, this.other.y - this.pos.y);
      if (d <= best) {
        best = d;
        found = true;
      }
    }
    return found ? best / TILE_PX : -1;
  }

  /** The biome id of a resident tile, or null. */
  private biomeAt(w: SimWorld, layer: Layer, tx: number, ty: number): string | null {
    if (!w.materialized) return null;
    const chunk = w.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return null;
    const id = chunk.biome[tileLocalIndex(tx, ty)] as number;
    return id === 0 ? null : contentWorldIdTables().biomes.stringId(id);
  }
}
