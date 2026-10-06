/**
 * Samples of the world events and the map for the presentation (docs/SPIEL.md §18, §30 "sampleWorldEvents", "sampleMap";
 * strand B, M7-38 … M7-40, M7-49): read-only views into the world events and map systems, found once and kept.
 *
 * - **World events:** every frame the HUD's event lines and the sky's preset are sampled into a held record (no allocation):
 *   every announced or running event – running ones first, then the announced, each in register order – with the whole game
 *   minutes to its start or end and the ticks of its run (the renderer eases the sky's preset in over the lead and out at the
 *   end from them).
 * - **Map:** `sampleMap` copies a layer's reveal mask into the caller's record when it changed and fills the terrain of the
 *   revealed cells (`MapTerrain`, at most `budget` cells per call – a tower's view or the console's reveal spread over frames);
 *   `sampleMapMarkers` lists the own markers (with their ids) and the derived ones of a layer into reused records. Both read
 *   the world only once it exists (the map never pulls the generation into the main thread).
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { Facing } from '../player/state';
import { maskBytes } from '../map/formulas';
import { MapSystem } from '../map/system';
import { MapTerrain } from '../map/terrain';
import type { MapMarker, MapMarkerKind, MapMarkerVisitor } from '../map/types';
import type { Simulation } from '../sim';
import { WorldEventsSystem } from '../worldevents/system';
import type { WorldEventPhase } from '../worldevents/types';

/** Most event lines a sample holds (four events run in M7; a big one excludes the others, the Finstermond runs beside). */
export const WORLD_EVENT_LINES = 4;

/** One announced or running world event. */
export interface WorldEventLine {
  /** Register id (`worldEvents`). */
  event: string;
  phase: Exclude<WorldEventPhase, 'ruhe'>;
  /** Whole game minutes to the start (announced) or to the end (running), rounded up; at least 1. */
  minutes: number;
  /** The run [ticks]: when it was announced, starts and ends. */
  announceTick: number;
  startTick: number;
  endTick: number;
  /** Sky/grading preset of the register (`ankuendigung.himmel`), '' without. */
  himmel: string;
}

/** The world events of the moment: only the first `count` lines are valid (the records are reused). */
export interface WorldEventSample {
  readonly lines: WorldEventLine[];
  count: number;
  /** Tick of the sample. */
  tick: number;
}

/** A fresh sample (no event). */
export function createWorldEventSample(): WorldEventSample {
  const lines: WorldEventLine[] = [];
  for (let i = 0; i < WORLD_EVENT_LINES; i++) lines.push({ event: '', phase: 'angekuendigt', minutes: 0, announceTick: 0, startTick: 0, endTick: 0, himmel: '' });
  return { lines, count: 0, tick: 0 };
}

/** A layer of the map as the map screen and the minimap draw it (`sampleMap`); the arrays are reused. */
export interface MapView {
  /** There is a map and a world (else nothing else is valid). */
  available: boolean;
  /** Layer of the view. */
  layer: Layer;
  /** World edge [tiles], cell edge [tiles], cells per side. */
  worldTiles: number;
  cellTiles: number;
  side: number;
  /** Revealed cells (bit `cy · side + cx`), a copy. */
  mask: Uint8Array;
  /** Terrain kind (`MAP_TERRAIN`) and height level per cell (`side × side`, valid where revealed and computed). */
  kind: Uint8Array;
  level: Uint8Array;
  /** Changes whenever the mask or the terrain changed (redraw). */
  version: number;
  /** Revealed cells whose terrain is not computed yet. */
  pending: number;
  /** The layer's reveal version the mask was copied at (−1: none yet). */
  maskVersion: number;
  /** The map's version (rises with every reveal and every change of the own markers: the markers are sampled anew). */
  mapVersion: number;
  /** The player: present, position [tiles, fractional], layer and facing [degrees, 0 = north, clockwise]. */
  player: boolean;
  playerX: number;
  playerY: number;
  playerLayer: Layer;
  facing: number;
}

/** Facing of the player in degrees (0 = north, clockwise; the map's arrow). */
const FACING_DEGREES: Readonly<Record<Facing, number>> = { up: 0, right: 90, down: 180, left: 270 };

/** An empty view (no map yet). */
export function createMapView(): MapView {
  const none = new Uint8Array(0);
  return { available: false, layer: 0, worldTiles: 0, cellTiles: 0, side: 0, mask: none, kind: none, level: none, version: 0, pending: 0, maskVersion: -1, mapVersion: -1, player: false, playerX: 0, playerY: 0, playerLayer: 0, facing: 0 };
}

/** One marker of a layer: own (`id` ≥ 0, `ref` = its name) or derived (`id` −1, `ref` = the content id that names it). */
export interface MapMarkerRecord {
  kind: MapMarkerKind;
  /** Map symbol (`karte_<…>`). */
  sprite: string;
  ref: string;
  id: number;
  tx: number;
  ty: number;
}

/** The markers of a layer: only the first `count` records are valid (they are reused). */
export interface MapMarkerList {
  readonly records: MapMarkerRecord[];
  count: number;
  /** The map's version when sampled (own markers changed when it moved). */
  version: number;
}

/** An empty marker list. */
export function createMapMarkerList(): MapMarkerList {
  return { records: [], count: 0, version: -1 };
}

/** Finds the world events and map systems of a simulation once. */
export class OrteSampler {
  private eventSystem: WorldEventsSystem | null | undefined = undefined;
  private eventSim: Simulation | null = null;
  private mapSystemValue: MapSystem | null | undefined = undefined;
  private mapSim: Simulation | null = null;
  private terrain: MapTerrain | null = null;
  private markerOut: MapMarkerList | null = null;
  private readonly at = { x: 0, y: 0 };
  /** The held visitor of `sampleMapMarkers` (no closure per call). */
  private readonly addMarker: MapMarkerVisitor = (kind, sprite, ref, _layer, tx, ty) => {
    const out = this.markerOut;
    if (out !== null) record(out, kind, sprite, ref, -1, tx, ty);
  };

  /** The map system, or null. */
  map(sim: Simulation): MapSystem | null {
    if (this.mapSim !== sim) {
      this.mapSim = sim;
      this.mapSystemValue = undefined;
      this.terrain = null;
    }
    if (this.mapSystemValue === undefined) {
      const s = sim.systems.find((x) => x instanceof MapSystem);
      this.mapSystemValue = s instanceof MapSystem ? s : null;
    }
    return this.mapSystemValue;
  }

  /**
   * Fills `out` with `layer` of the map: the reveal mask (copied when it changed) and the terrain of the revealed cells,
   * computing at most `budget` new cells. Unavailable without a map system or before the world exists.
   */
  sampleMap(sim: Simulation, layer: Layer, budget: number, out: MapView): MapView {
    const map = this.map(sim);
    if (map === null || !sim.world.materialized) {
      out.available = false;
      return out;
    }
    if (out.side !== map.side) {
      out.mask = new Uint8Array(maskBytes(map.side));
      out.maskVersion = -1;
    }
    out.available = true;
    out.mapVersion = map.version;
    out.worldTiles = map.worldTiles;
    out.cellTiles = map.cellTiles;
    out.side = map.side;
    const lv = map.layerVersions[-layer] as number;
    if (out.layer !== layer || out.maskVersion !== lv) {
      const src = map.mask(layer);
      if (src === null) out.mask.fill(0);
      else out.mask.set(src);
      out.layer = layer;
      out.maskVersion = lv;
      out.version++;
    }
    const body = map.playerBody(sim, this.at);
    out.player = body !== undefined;
    if (body !== undefined) {
      out.playerX = this.at.x / TILE_PX;
      out.playerY = this.at.y / TILE_PX;
      out.playerLayer = body.layer;
      out.facing = FACING_DEGREES[body.facing];
    }
    if (budget <= 0 && this.terrain === null) {
      // The minimap reads the mask only: no terrain before the map screen asks for it.
      out.pending = 0;
      return out;
    }
    const terrain = (this.terrain ??= new MapTerrain(sim.world.generated, map.side, map.cellTiles));
    if (budget <= 0) {
      out.kind = terrain.kind(layer);
      out.level = terrain.level(layer);
      return out;
    }
    const before = terrain.version;
    out.pending = terrain.fill(layer, out.mask, budget);
    out.kind = terrain.kind(layer);
    out.level = terrain.level(layer);
    if (terrain.version !== before) out.version++;
    return out;
  }

  /** Fills `out` with the own markers of `layer` (in the order they were set), then the derived ones. */
  sampleMapMarkers(sim: Simulation, layer: Layer, out: MapMarkerList): MapMarkerList {
    out.count = 0;
    const map = this.map(sim);
    if (map === null) return out;
    out.version = map.version;
    const own = map.markers;
    for (let i = 0; i < own.length; i++) {
      const m = own[i] as MapMarker;
      if (m.layer === layer) record(out, 'eigen', `karte_${m.symbol}`, m.name, m.id, m.tx, m.ty);
    }
    if (!sim.world.materialized) return out;
    this.markerOut = out;
    map.forEachDerivedMarker(sim, layer, this.addMarker);
    this.markerOut = null;
    return out;
  }

  /** The world events system, or null. */
  worldEvents(sim: Simulation): WorldEventsSystem | null {
    if (this.eventSim !== sim) {
      this.eventSim = sim;
      this.eventSystem = undefined;
    }
    if (this.eventSystem === undefined) {
      const s = sim.systems.find((x) => x instanceof WorldEventsSystem);
      this.eventSystem = s instanceof WorldEventsSystem ? s : null;
    }
    return this.eventSystem;
  }

  /** Fills `out` with the announced and running world events (none without the system). */
  sampleWorldEvents(sim: Simulation, out: WorldEventSample): WorldEventSample {
    out.count = 0;
    out.tick = sim.tick;
    const system = this.worldEvents(sim);
    if (system === null) return out;
    const perMinute = sim.clock.ticksPerGameMinute;
    // Running first, then announced.
    for (let pass = 0; pass < 2; pass++) {
      const want: WorldEventPhase = pass === 0 ? 'aktiv' : 'angekuendigt';
      for (let i = 0; i < system.count && out.count < out.lines.length; i++) {
        const s = system.stateAt(i);
        if (s.phase !== want) continue;
        const def = system.defAt(i);
        const line = out.lines[out.count++] as WorldEventLine;
        line.event = def.id;
        line.phase = want;
        line.announceTick = s.announceTick;
        line.startTick = s.startTick;
        line.endTick = s.endTick;
        line.minutes = Math.max(1, Math.ceil(((want === 'aktiv' ? s.endTick : s.startTick) - sim.tick) / perMinute));
        line.himmel = def.ankuendigung.himmel ?? '';
      }
    }
    return out;
  }
}

/** Appends a marker to `out` (reusing its records). */
function record(out: MapMarkerList, kind: MapMarkerKind, sprite: string, ref: string, id: number, tx: number, ty: number): void {
  let r = out.records[out.count];
  if (r === undefined) {
    r = { kind, sprite, ref, id, tx, ty };
    out.records.push(r);
  } else {
    r.kind = kind;
    r.sprite = sprite;
    r.ref = ref;
    r.id = id;
    r.tx = tx;
    r.ty = ty;
  }
  out.count++;
}
