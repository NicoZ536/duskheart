/**
 * The beacons (MASTERPROMPT §8 "Je Biom ein Leuchtfeuer, bewacht vom Boss des Bioms. Entzünden → die Region heilt sichtbar,
 * Schutzzone, Schnellreisepunkt, neues Wissen, Story-Vision", §4.1, §11.6, §23.1; docs/SPIEL.md §22 "Leuchtfeuer"; strand F,
 * system `beacons`, M7-35, M7-36).
 *
 * - **States** per beacon (content `beacons`, 1–6 in `BEACON_BIOMES` order): `erloschen` → (its boss defeated) `bereit` →
 *   `beacon.ignite` (E within reach) → `entzuendung` for `BALANCE.beacons.ignitionSeconds` → `entzuendet`. A beacon whose
 *   time has not come (`umgesetzt: { task }`) stays dark.
 * - **Lit** (`beaconLit`): the unlocks of the beacon are granted (`leuchtfeuer:<n>`, src/game/unlocks/), its ember core goes into
 *   the bags (or drops at the beacon), the vision waits to be shown (`visionShown`, `beacon.visionSeen`).
 * - **Effects**: the light wave grows from `litTick` (`healing`, `healingAt`; the renderer reads them for the corruption and
 *   the grade), the global healing step by the number lit (`healingStep(litCount())`), the protection zone "Erleuchtet"
 *   (`inZone`: the condition `erleuchtet` at every world tick, a spawn block for the shadow brood), a travel point and a
 *   respawn point in front of it (`respawnSpots`). Before it burns, its site lies in a corrupted stretch (`corruptionAt`).
 * - The beacon is no chunk object: it belongs to this system (position from the site's mark or slot, `sites.ts`), stands in
 *   the way as a 3 × 3 block (`collisionOverlay`) and lights the world when lit (`lightProvider`).
 *
 * Global (`timeScope`; absolute ticks only, nothing to catch up). Save participant `beacons` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { BeaconDef } from '../../content/beacons/schema';
import { BLOCK_OBJECT, type CollisionOverlay } from '../../world/collision/tiles';
import { BEACON_BIOMES } from '../../world/gen/locations';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { BossesApi } from '../bosses/types';
import type { CommandOfType } from '../commands';
import type { BeaconSpot } from '../death/system';
import type { InventorySystem } from '../inventory/system';
import { newStack } from '../items/stack';
import type { ExtraLightProvider } from '../light/system';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { UnlockRegistry } from '../unlocks/types';
import type { BeaconRejectReason } from './events';
import { healedBy, siteCorruption, waveRadiusTiles } from './formulas';
import { worldBeaconSource, type BeaconSite, type BeaconWorld, type BeaconWorldSource } from './sites';
import { beaconsSnapshotSchema, createBeaconState, NO_TICK, type BeaconsSnapshot } from './state';
import type { BeaconsApi, BeaconState } from './types';

/** Id of the beacon system and its save participant. */
export const BEACONS_SYSTEM_ID = 'beacons';
/** Data version of the `beacons` participant. */
export const BEACONS_SAVE_VERSION = 1;
/** The condition of the protection zone (src/content/conditions.ts). */
export const ZONE_CONDITION = 'erleuchtet';
/** Light kind of a lit beacon in the source list (the renderer's colour). */
export const BEACON_LIGHT_KIND = 'leuchtfeuer';

const BE = BALANCE.beacons;
const TICK_HZ = BALANCE.time.tickHz;
const IGNITION_TICKS = Math.round(BE.ignitionSeconds * TICK_HZ);
/** Half the side of a beacon's footprint [tiles] (3 × 3 around its centre tile). */
const HALF = 1;
/** Light ids of the beacons in the source list (above the bosses' range). */
const LIGHT_ID_BASE = 0x6000_0000;

/** What the beacons read from the player's life (bound after `addPlayerLifeSystems`). */
export interface BeaconLife {
  /** Whether the player's light is out. */
  dead(): boolean;
  /** Applies a condition to the player (`erleuchtet` in the zone). */
  condition(sim: Simulation, id: string): void;
}

/** Dependencies of the beacon system. */
export interface BeaconsSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  readonly drops: { spawn(sim: Simulation, stack: ReturnType<typeof newStack>, layer: Layer, x: number, y: number): unknown };
  readonly unlocks: UnlockRegistry;
  readonly bosses: BossesApi;
  /** The sites and regions (default: the generated world). */
  readonly world?: BeaconWorldSource;
  /** The beacons (default: the content collection `beacons`). */
  readonly beacons?: readonly BeaconDef[];
}

/** The beacons as a collision overlay (methods, not closures – M6-16g). */
class BeaconOverlay implements CollisionOverlay {
  constructor(private readonly system: BeaconsSystem) {}

  overlayAt(layer: Layer, tx: number, ty: number): number {
    return this.system.beaconOnTile(layer, tx, ty) >= 0 ? BLOCK_OBJECT : 0;
  }
}

export class BeaconsSystem implements SimSystem, BeaconsApi {
  readonly id = BEACONS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  readonly defs: readonly BeaconDef[];
  private readonly deps: BeaconsSystemDeps;
  private readonly source: BeaconWorldSource;
  private readonly states: BeaconState[];
  private readonly sites: (BeaconSite | null)[];
  private world: BeaconWorld | null = null;
  private life: BeaconLife | null = null;
  private readonly pos = { x: 0, y: 0 };

  constructor(deps: BeaconsSystemDeps) {
    this.deps = deps;
    this.source = deps.world ?? worldBeaconSource();
    this.defs = deps.beacons ?? (CONTENT.collection('beacons').values() as readonly BeaconDef[]);
    this.defs.forEach((d, i) => {
      if (d.nummer !== i + 1 || d.biom !== BEACON_BIOMES[i]) throw new Error(`BeaconsSystem: beacon ${i + 1} must be number ${i + 1} of ${BEACON_BIOMES[i] ?? '?'} (got ${d.id})`);
    });
    this.states = this.defs.map((d) => createBeaconState(d.nummer));
    this.sites = this.defs.map(() => null);
    deps.collision.addOverlay(new BeaconOverlay(this));
    this.commands = {
      'beacon.ignite': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.ignite(s, cmd.beacon, tick)),
      'beacon.visionSeen': (s, cmd, tick) => {
        const st = this.states[cmd.beacon - 1];
        if (st === undefined) return this.refuse(s, cmd.type, tick, 'unknownBeacon');
        if (st.state !== 'entzuendet') return this.refuse(s, cmd.type, tick, 'notLit');
        st.visionShown = true;
      },
      'beacon.debug': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debug(s, cmd, tick)),
    };
    this.save = {
      id: BEACONS_SYSTEM_ID,
      version: BEACONS_SAVE_VERSION,
      // Saves before M7 know no beacons: all dark.
      migrations: [{ from: 0, migrate: (): BeaconsSnapshot => ({ beacons: this.defs.map((d) => createBeaconState(d.nummer)) }) }],
      serialize: (): BeaconsSnapshot => ({ beacons: this.states.map((s) => ({ ...s })) }),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Wiring and queries
  // -------------------------------------------------------------------------------------------

  /** Binds the player's life (death, conditions). */
  useLife(life: BeaconLife): void {
    this.life = life;
  }

  state(nummer: number): Readonly<BeaconState> {
    const s = this.states[nummer - 1];
    if (s === undefined) throw new RangeError(`BeaconsSystem: no beacon ${nummer}`);
    return s;
  }

  /** The site of beacon `nummer` (found once the world is there), or null. */
  site(sim: Simulation, nummer: number): BeaconSite | null {
    return this.siteOf(sim, nummer - 1);
  }

  litCount(): number {
    let n = 0;
    for (const s of this.states) if (s.state === 'entzuendet') n++;
    return n;
  }

  healing(region: number, tick: number): number {
    const w = this.world;
    const r = w?.regions[region];
    if (r === undefined) return 0;
    let h = 0;
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i] as BeaconState;
      const site = this.sites[i];
      if (st.state !== 'entzuendet' || site === null || site === undefined || (this.defs[i] as BeaconDef).biom !== r.biome) continue;
      const dx = r.x - site.tx;
      const dy = r.y - site.ty;
      h = Math.max(h, healedBy(waveRadiusTiles(st.litTick, tick), Math.sqrt(dx * dx + dy * dy)));
    }
    return h;
  }

  /** How far the wave healed the surface tile (tx, ty) at `tick` (0–1): its region's biome must be the beacon's. */
  healingAt(layer: Layer, tx: number, ty: number, tick: number): number {
    const w = this.world;
    if (w === null || layer !== 0) return 0;
    const region = w.regions[w.regionAt(tx, ty)];
    let h = 0;
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i] as BeaconState;
      const site = this.sites[i];
      if (st.state !== 'entzuendet' || site === null || site === undefined) continue;
      if (region !== undefined && (this.defs[i] as BeaconDef).biom !== region.biome) continue;
      const dx = tx - site.tx;
      const dy = ty - site.ty;
      h = Math.max(h, healedBy(waveRadiusTiles(st.litTick, tick), Math.sqrt(dx * dx + dy * dy)));
    }
    return h;
  }

  /**
   * Corruption around the dark beacon sites at the surface tile (tx, ty) (0–1; §12.3 "Verderbnisgebiet", ART.md §5): strongest
   * at a site whose beacon does not burn, fading with the distance; a lit beacon's wave washes it away behind its front.
   */
  corruptionAt(layer: Layer, tx: number, ty: number, tick: number): number {
    if (layer !== 0) return 0;
    let c = 0;
    for (let i = 0; i < this.states.length; i++) {
      const site = this.sites[i];
      if (site === null || site === undefined) continue;
      const st = this.states[i] as BeaconState;
      const dx = tx - site.tx;
      const dy = ty - site.ty;
      const d = Math.sqrt(dx * dx + dy * dy);
      const here = siteCorruption(d) * (st.state === 'entzuendet' ? 1 - healedBy(waveRadiusTiles(st.litTick, tick), d) : 1);
      if (here > c) c = here;
    }
    return c;
  }

  inZone(layer: Layer, tx: number, ty: number): boolean {
    const r2 = BE.zoneTiles * BE.zoneTiles;
    for (let i = 0; i < this.states.length; i++) {
      const site = this.sites[i];
      if ((this.states[i] as BeaconState).state !== 'entzuendet' || site === null || site === undefined || site.layer !== layer) continue;
      const dx = tx - site.tx;
      const dy = ty - site.ty;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  /** Index of the beacon whose 3 × 3 footprint covers tile (tx, ty) of `layer`, or −1. */
  beaconOnTile(layer: Layer, tx: number, ty: number): number {
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      if (s === null || s === undefined || s.layer !== layer) continue;
      if (Math.abs(tx - s.tx) <= HALF && Math.abs(ty - s.ty) <= HALF) return i;
    }
    return -1;
  }

  /** The lit beacons as respawn points (§11.6 "an einem entzündeten Leuchtfeuer"): in front of each, south of its foot. */
  respawnSpots(sim: Simulation): BeaconSpot[] {
    const out: BeaconSpot[] = [];
    for (let i = 0; i < this.states.length; i++) {
      if ((this.states[i] as BeaconState).state !== 'entzuendet') continue;
      const s = this.siteOf(sim, i);
      if (s !== null) out.push({ x: s.x, y: s.y + (HALF + BE.respawnOffsetTiles) * TILE_PX, layer: s.layer });
    }
    return out;
  }

  /** The lit beacon of a travel point within `reachTiles` of (x, y) on `layer` (number), or 0. */
  litBeaconNear(sim: Simulation, layer: Layer, x: number, y: number, reachTiles: number): number {
    for (let i = 0; i < this.states.length; i++) {
      if ((this.states[i] as BeaconState).state !== 'entzuendet') continue;
      const s = this.siteOf(sim, i);
      if (s === null || s.layer !== layer) continue;
      const dx = (x - s.x) / TILE_PX;
      const dy = (y - s.y) / TILE_PX;
      if (dx * dx + dy * dy <= (reachTiles + HALF) * (reachTiles + HALF)) return i + 1;
    }
    return 0;
  }

  /** A collision overlay of the beacons (each a 3 × 3 block). */
  collisionOverlay(): CollisionOverlay {
    return new BeaconOverlay(this);
  }

  /** The lit beacons' light (and the ember of a ready one) in the source list. */
  lightProvider(): ExtraLightProvider {
    return (sim, emit) => {
      for (let i = 0; i < this.states.length; i++) {
        const st = this.states[i] as BeaconState;
        const s = this.sites[i];
        if (s === null || s === undefined || st.state === 'erloschen') continue;
        const l = st.state === 'entzuendet' ? BE.light : BE.emberLight;
        // During the ignition the flame grows from the ember to the full light.
        const grow = st.state === 'entzuendung' ? Math.min(1, (sim.tick - st.ignitionTick) / IGNITION_TICKS) : 1;
        const radius = st.state === 'entzuendung' ? BE.emberLight.radiusTiles + (BE.light.radiusTiles - BE.emberLight.radiusTiles) * grow : l.radiusTiles;
        emit(LIGHT_ID_BASE + i, BEACON_LIGHT_KIND, l.farbe, s.layer, s.x, s.y, l.flameHeightPx, radius * TILE_PX, st.state === 'entzuendung' ? BE.emberLight.intensity + (BE.light.intensity - BE.emberLight.intensity) * grow : l.intensity, l.flicker, 1, Math.ceil(radius));
      }
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const tick = sim.tick;
    for (let i = 0; i < this.states.length; i++) {
      const st = this.states[i] as BeaconState;
      const d = this.defs[i] as BeaconDef;
      if (st.state === 'erloschen') {
        if (d.umgesetzt === true && this.deps.bosses.defeated(d.boss)) st.state = 'bereit';
        continue;
      }
      if (st.state === 'entzuendung' && tick >= st.ignitionTick + IGNITION_TICKS) this.light(sim, i, tick);
    }
    // Sites are found once the world is there (the overlay and the healing need them).
    if (this.world === null) this.resolve(sim);
  }

  /** World tick: the player in a lit beacon's zone is "Erleuchtet" (life regenerates, fear fades; src/content/conditions.ts). */
  worldTick(sim: Simulation): void {
    const life = this.life;
    if (life === null || life.dead()) return;
    const body = this.deps.player.body(sim);
    if (body === undefined || !this.deps.player.position(sim, this.pos)) return;
    if (this.inZone(body.layer, Math.floor(this.pos.x / TILE_PX), Math.floor(this.pos.y / TILE_PX))) life.condition(sim, ZONE_CONDITION);
  }

  // -------------------------------------------------------------------------------------------
  // Lighting
  // -------------------------------------------------------------------------------------------

  private ignite(sim: Simulation, nummer: number, tick: number): BeaconRejectReason | null {
    const i = nummer - 1;
    const st = this.states[i];
    if (st === undefined) return 'unknownBeacon';
    const site = this.siteOf(sim, i);
    if (site === null) return 'noSite';
    const body = this.deps.player.body(sim);
    if (body === undefined || !this.deps.player.position(sim, this.pos)) return 'noPlayer';
    if (this.life?.dead() === true) return 'dead';
    const dx = (this.pos.x - site.x) / TILE_PX;
    const dy = (this.pos.y - site.y) / TILE_PX;
    const reach = BE.reachTiles + HALF;
    if (body.layer !== site.layer || dx * dx + dy * dy > reach * reach) return 'outOfReach';
    if (st.state === 'entzuendung' || st.state === 'entzuendet') return 'lit';
    if (st.state !== 'bereit') return 'notReady';
    if (this.deps.bosses.awake() !== null) return 'bossAwake';
    this.beginIgnition(sim, i, site, tick);
    return null;
  }

  private beginIgnition(sim: Simulation, i: number, site: BeaconSite, tick: number): void {
    const st = this.states[i] as BeaconState;
    st.state = 'entzuendung';
    st.ignitionTick = tick;
    sim.events.push('beaconIgnitionStarted', { beacon: st.nummer, biome: (this.defs[i] as BeaconDef).biom, x: site.x, y: site.y, tick: sim.eventTick });
  }

  /** The flame stands: unlocks, the ember core, the vision to come. */
  private light(sim: Simulation, i: number, tick: number): void {
    const st = this.states[i] as BeaconState;
    const d = this.defs[i] as BeaconDef;
    st.state = 'entzuendet';
    st.litTick = tick;
    st.visionShown = false;
    for (const u of d.freischaltungen) this.deps.unlocks.grant(sim, u, `leuchtfeuer:${d.nummer}`);
    const site = this.siteOf(sim, i);
    const given = this.deps.inventory.give(sim, d.glutkern, 1);
    if (given.rest > 0 && site !== null) this.deps.drops.spawn(sim, newStack(this.deps.inventory.bags.catalog.get(d.glutkern), given.rest), site.layer, site.x, site.y + (HALF + 1) * TILE_PX);
    sim.events.push('beaconLit', { beacon: d.nummer, biome: d.biom, x: site?.x ?? 0, y: site?.y ?? 0, tick: sim.eventTick });
  }

  private debug(sim: Simulation, cmd: CommandOfType<'beacon.debug'>, tick: number): BeaconRejectReason | null {
    const i = cmd.beacon - 1;
    const st = this.states[i];
    if (st === undefined) return 'unknownBeacon';
    const site = this.siteOf(sim, i);
    if (site === null) return 'noSite';
    switch (cmd.aktion) {
      case 'bereit':
        if (st.state !== 'erloschen') return 'lit';
        st.state = 'bereit';
        return null;
      case 'entzuenden':
        if (st.state === 'entzuendet') return 'lit';
        if (st.state !== 'entzuendung') this.beginIgnition(sim, i, site, tick);
        this.light(sim, i, tick);
        return null;
      case 'loeschen':
        if (st.state !== 'entzuendet') return 'notLit';
        st.state = 'bereit';
        st.litTick = NO_TICK;
        return null;
    }
  }

  private refuse(sim: Simulation, type: 'beacon.ignite' | 'beacon.visionSeen' | 'beacon.debug', tick: number, reason: BeaconRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  // -------------------------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------------------------

  private siteOf(sim: Simulation, i: number): BeaconSite | null {
    const known = this.sites[i];
    if (known !== null && known !== undefined) return known;
    this.resolve(sim);
    return this.sites[i] ?? null;
  }

  /** Reads the sites and regions once the world is there; the beacons' tiles are told to the collision grid. */
  private resolve(sim: Simulation): void {
    if (this.world !== null) return;
    const w = this.source(sim);
    if (w === null) return;
    this.world = w;
    for (let i = 0; i < this.defs.length; i++) {
      const s = w.site((this.defs[i] as BeaconDef).biom);
      this.sites[i] = s;
      if (s === null) continue;
      for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) this.deps.collision.invalidateTile(s.layer, s.tx + dx, s.ty + dy);
    }
  }

  private restore(data: unknown): void {
    const parsed = beaconsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`beacons snapshot invalid: ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    if (parsed.data.beacons.length !== this.defs.length) throw new TypeError(`beacons snapshot invalid: ${parsed.data.beacons.length} beacons, the content has ${this.defs.length}`);
    parsed.data.beacons.forEach((b, i) => {
      this.states[i] = { ...b };
    });
  }
}
