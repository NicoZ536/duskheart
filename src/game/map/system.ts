/**
 * The map at runtime (MASTERPROMPT §25 "Karte (M)"; docs/SPIEL.md §18 "Karte"; M7-49). System `map`, global (the reveal follows
 * the player wherever they are, nothing waits in frozen chunks), save participant `map`.
 *
 * - **Reveal:** per layer a bit mask of map cells (`BALANCE.map.cellTiles` = 4 × 4 tiles). Whenever the player enters another
 *   cell (or climbs to another height level) the cells within `revealRadius` of them are set: 20 tiles, on the surface
 *   `heightBonusTiles` more per level above 0 (§25 "auf Höhen mehr"). A look-out tower (`towerClimbed`, observed after the
 *   step) reveals its `radiusTiles` around the tower; the console's `map.reveal` a whole layer. Allocation-free per tick.
 * - **Own markers** (at most `maxMarkers`): symbol, name (≤ `markerNameMax` characters), tile, layer – `map.mark`,
 *   `map.unmark`, `map.rename` (`mapMarked`, `mapUnmarked`, `mapRenamed`).
 * - **Derived markers** are never saved: other systems add a `MapMarkerSource` (places, beacons, the grave, the bases;
 *   setup.ts) and `forEachMarker` visits them with the own markers of a layer.
 *
 * `version` rises with every change of the reveal or the markers; the map screen and the minimap redraw on it.
 */
import { BALANCE } from '../../content/balance';
import { LAYER_COUNT, TILE_PX, type Layer } from '../../world/model/coords';
import { worldDimensions } from '../../world/model/worldSize';
import type { GameCommandType } from '../commands';
import type { SaveParticipant } from '../participant';
import type { PlayerBody } from '../player/state';
import type { PlayerSystem } from '../player/system';
import type { StepEvents } from '../observe';
import type { CommandHandlers, SimEventMap, SimSystem, Simulation } from '../sim';
import type { MapRejectReason } from './events';
import { cellRevealed, cellsPerSide, decodeMask, encodeMask, markerName, maskBytes, revealAll, revealDisc, revealRadius } from './formulas';
import { emptyMapSnapshot, mapSnapshotSchema, type MapSnapshot } from './state';
import type { MapApi, MapMarker, MapMarkerSource, MapMarkerSymbol, MapMarkerVisitor } from './types';

/** Id of the system and its save participant. */
export const MAP_SYSTEM_ID = 'map';
/** Data version of the `map` participant. */
export const MAP_SAVE_VERSION = 1;

const M = BALANCE.map;

/** Index of a layer's mask (0 surface, 1 … 3 the caves). */
function slotOf(layer: Layer): number {
  return -layer;
}

/** Dependencies of the map (the systems registered before it). */
export interface MapDeps {
  readonly player: PlayerSystem;
}

export class MapSystem implements SimSystem, MapApi {
  readonly id = MAP_SYSTEM_ID;
  readonly timeScope = 'global' as const;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** Edge of the world [tiles] and cells per side of the raster. */
  readonly worldTiles: number;
  readonly side: number;
  readonly cellTiles = M.cellTiles;
  /** Rises with every change of a mask or of the own markers. */
  version = 0;
  /** Rises with every change of a layer's mask (index `-layer`). */
  readonly layerVersions = new Int32Array(LAYER_COUNT);
  private readonly masks: (Uint8Array | null)[] = new Array<Uint8Array | null>(LAYER_COUNT).fill(null);
  private readonly ownMarkers: MapMarker[] = [];
  private nextId = 0;
  private readonly sources: MapMarkerSource[] = [];
  /** Cell, layer and height level of the player's last reveal (NaN: none yet). */
  private lastCx = Number.NaN;
  private lastCy = Number.NaN;
  private lastLayer = Number.NaN;
  private lastLevel = Number.NaN;
  private readonly at = { x: 0, y: 0 };
  /** The simulation of the running `observeStep` (for the held tower callback). */
  private stepSim: Simulation | null = null;
  private readonly onTower = (e: SimEventMap['towerClimbed']): void => {
    if (this.stepSim !== null) this.revealCircle(this.stepSim, e.layer as Layer, e.x, e.y, e.radiusTiles);
  };

  constructor(
    sim: Simulation,
    private readonly deps: MapDeps,
  ) {
    this.worldTiles = worldDimensions(sim.config.worldSize).tiles;
    this.side = cellsPerSide(this.worldTiles, this.cellTiles);
    this.commands = {
      'map.mark': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.mark(s, cmd.symbol, cmd.name, cmd.layer as Layer, cmd.tx, cmd.ty, tick)),
      'map.unmark': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.unmark(s, cmd.id, tick)),
      'map.rename': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.rename(s, cmd.id, cmd.name, tick)),
      'map.reveal': (_s, cmd) => this.revealLayers(cmd.layer as Layer | undefined),
    };
    this.save = {
      id: MAP_SYSTEM_ID,
      version: MAP_SAVE_VERSION,
      migrations: [{ from: 0, migrate: () => emptyMapSnapshot(this.cellTiles, this.side) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** Adds a source of derived markers (places, beacons, the grave, bases – setup.ts; quests in wave 2). */
  addMarkerSource(source: MapMarkerSource): void {
    this.sources.push(source);
  }

  // -------------------------------------------------------------------------------------------
  // MapApi
  // -------------------------------------------------------------------------------------------

  revealed(layer: Layer, tx: number, ty: number): boolean {
    return cellRevealed(this.masks[slotOf(layer)] ?? null, this.side, Math.floor(tx / this.cellTiles), Math.floor(ty / this.cellTiles));
  }

  revealCircle(_sim: Simulation, layer: Layer, tx: number, ty: number, radiusTiles: number): void {
    if (revealDisc(this.maskOf(layer), this.side, this.cellTiles, tx, ty, radiusTiles)) this.changed(layer);
  }

  /** The bit mask of `layer` (bit `cy · side + cx`), or null before anything was revealed there – read-only. */
  mask(layer: Layer): Uint8Array | null {
    return this.masks[slotOf(layer)] ?? null;
  }

  /** The player's body and position [px] into `out` (the map screen's arrow), or undefined without a player. */
  playerBody(sim: Simulation, out: { x: number; y: number }): Readonly<PlayerBody> | undefined {
    const body = this.deps.player.body(sim);
    return body !== undefined && this.deps.player.position(sim, out) ? body : undefined;
  }

  /** The own markers in the order they were set (read-only). */
  get markers(): readonly MapMarker[] {
    return this.ownMarkers;
  }

  /** Visits the own markers of `layer` (kind `eigen`, `ref` = the name) and every derived marker of the sources. */
  forEachMarker(sim: Simulation, layer: Layer, visit: MapMarkerVisitor): void {
    for (let i = 0; i < this.ownMarkers.length; i++) {
      const m = this.ownMarkers[i] as MapMarker;
      if (m.layer === layer) visit('eigen', MAP_MARKER_SPRITE[m.symbol], m.name, m.layer, m.tx, m.ty);
    }
    this.forEachDerivedMarker(sim, layer, visit);
  }

  /** Visits the derived markers of `layer` only (the sources'; the map screen lists the own markers with their ids). */
  forEachDerivedMarker(sim: Simulation, layer: Layer, visit: MapMarkerVisitor): void {
    for (let i = 0; i < this.sources.length; i++) (this.sources[i] as MapMarkerSource)(sim, layer, visit);
  }

  // -------------------------------------------------------------------------------------------
  // Tick and observer
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const body = this.deps.player.body(sim);
    if (body === undefined || !this.deps.player.position(sim, this.at)) return;
    const tx = Math.floor(this.at.x / TILE_PX);
    const ty = Math.floor(this.at.y / TILE_PX);
    const cx = Math.floor(tx / this.cellTiles);
    const cy = Math.floor(ty / this.cellTiles);
    if (cx === this.lastCx && cy === this.lastCy && body.layer === this.lastLayer && body.level === this.lastLevel) return;
    this.lastCx = cx;
    this.lastCy = cy;
    this.lastLayer = body.layer;
    this.lastLevel = body.level;
    this.revealCircle(sim, body.layer, tx, ty, revealRadius(body.layer, body.level));
  }

  observeStep(sim: Simulation, events: StepEvents): void {
    this.stepSim = sim;
    events.forEachOfType('towerClimbed', this.onTower);
    this.stepSim = null;
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private mark(sim: Simulation, symbol: MapMarkerSymbol, rawName: string, layer: Layer, tx: number, ty: number, tick: number): MapRejectReason | null {
    if (this.ownMarkers.length >= M.maxMarkers) return 'tooManyMarkers';
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) return 'outOfWorld';
    const name = markerName(rawName);
    if (name.length === 0) return 'emptyName';
    const id = this.nextId++;
    this.ownMarkers.push({ id, symbol, name, layer, tx, ty });
    this.version++;
    sim.events.push('mapMarked', { id, symbol, layer, tx, ty, tick });
    return null;
  }

  private unmark(sim: Simulation, id: number, tick: number): MapRejectReason | null {
    const i = this.ownMarkers.findIndex((m) => m.id === id);
    if (i < 0) return 'unknownMarker';
    this.ownMarkers.splice(i, 1);
    this.version++;
    sim.events.push('mapUnmarked', { id, tick });
    return null;
  }

  private rename(sim: Simulation, id: number, rawName: string, tick: number): MapRejectReason | null {
    const i = this.ownMarkers.findIndex((m) => m.id === id);
    if (i < 0) return 'unknownMarker';
    const name = markerName(rawName);
    if (name.length === 0) return 'emptyName';
    this.ownMarkers[i] = { ...(this.ownMarkers[i] as MapMarker), name };
    this.version++;
    sim.events.push('mapRenamed', { id, tick });
    return null;
  }

  /** Debug: reveals the whole of `layer`, or of every layer. */
  private revealLayers(layer: Layer | undefined): void {
    for (let i = 0; i < LAYER_COUNT; i++) {
      const l = -i as Layer;
      if (layer !== undefined && l !== layer) continue;
      revealAll(this.maskOf(l), this.side);
      this.changed(l);
    }
  }

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: MapRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  private maskOf(layer: Layer): Uint8Array {
    const k = slotOf(layer);
    let m = this.masks[k];
    if (m === null || m === undefined) {
      m = new Uint8Array(maskBytes(this.side));
      this.masks[k] = m;
    }
    return m;
  }

  private changed(layer: Layer): void {
    const k = slotOf(layer);
    this.layerVersions[k] = (this.layerVersions[k] as number) + 1;
    this.version++;
  }

  private snapshot(): MapSnapshot {
    const layers: MapSnapshot['layers'] = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      const m = this.masks[i];
      if (m !== null && m !== undefined) layers.push({ layer: -i, cells: encodeMask(m) });
    }
    return { cellTiles: this.cellTiles, side: this.side, layers, markers: this.ownMarkers.map((m) => ({ ...m })), nextId: this.nextId };
  }

  private restore(data: unknown): void {
    const snap = mapSnapshotSchema.parse(data);
    if (snap.cellTiles !== this.cellTiles || snap.side !== this.side) {
      throw new Error(`map: saved raster ${snap.side}² cells of ${snap.cellTiles} tiles, this world has ${this.side}² of ${this.cellTiles}`);
    }
    if (snap.markers.length > M.maxMarkers) throw new Error(`map: ${snap.markers.length} own markers, at most ${M.maxMarkers}`);
    this.masks.fill(null);
    for (const l of snap.layers) this.masks[slotOf(l.layer as Layer)] = decodeMask(l.cells, maskBytes(this.side));
    this.ownMarkers.length = 0;
    for (const m of snap.markers) {
      if (m.id >= snap.nextId) throw new Error(`map: marker id ${m.id} is not below the next id ${snap.nextId}`);
      this.ownMarkers.push({ ...m, layer: m.layer as Layer });
    }
    this.nextId = snap.nextId;
    this.lastCx = Number.NaN;
    this.lastCy = Number.NaN;
    this.lastLayer = Number.NaN;
    this.lastLevel = Number.NaN;
    for (let i = 0; i < LAYER_COUNT; i++) this.layerVersions[i] = (this.layerVersions[i] as number) + 1;
    this.version++;
  }
}
