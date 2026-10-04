/**
 * Overlays of the build mode (MASTERPROMPT §16.6 "Overlays: Räume/Typen, Temperatur, Licht, Behaglichkeit,
 * Stützen, Stromnetz", §16.3 "Der Baumodus zeigt die Stützreichweite als Overlay", §16.4 "Raumtypen … im Baumodus
 * angezeigt"; M4-26 – the power grid follows with the Lumen network in M11).
 *
 * Unlit fields and labels in world pixels (the frame's overlay list, drawn after post like the debug overlays), so
 * they read by day, by night and in caves:
 * - `raeume`: every room in view in the colour of its type (src/content/roomTypes.ts), an interior without type in
 *   the plain room colour, a closed room without roof (under 90 % roofed, §16.4) hatched in the warning colour; the
 *   room's name, type or "Kein Dach" and its size at its top left (one label of two lines, on one plate).
 * - `temperatur`: rooms in the step of their room temperature (§16.4 "Richtung 18 °C gedämpft") with the value in
 *   the room's top left tile, the open air faintly in the step of the temperature field with the value in every
 *   eighth tile – steps a player reads: Frost, kalt, kühl, angenehm (the comfort band of §11.2), warm, heiß
 *   (`ROOM_TEMPERATURE_STEPS`).
 * - `licht`: the gameplay light map's stage per tile (§12.1 dunkel, dämmrig, hell, gleißend – what fear and the
 *   Schattenbrut read).
 * - `behaglichkeit`: interiors in the colour of their comfort 0–20 (§16.4) with the value.
 * - `stuetzen`: every finished roof tile coloured by its distance to the next support relative to its material's
 *   reach (§16.3: green close, yellow half-way, orange at the limit) with the distance in its middle, and a mark on
 *   every support (walls, doors, gates, windows, pillars) – a roof tile right on its support shows the mark alone.
 *
 * Values (temperatures, distances) are value labels of their tile (`DebugOverlayList.value`: centred, outlined, no
 * plate – the tile's colour, the overlay's theme, stays visible; never moved); names (room, comfort) lie on a plate.
 * Everything lies on the overlay's information layer, under the build ghost (no label covers its frame; ADR-0170).
 * Reads the simulation (rooms, light map, structures, temperature field), never writes it. Room descriptions are
 * asked once per room every `ROOM_REFRESH_FRAMES`; label strings are cached.
 */
import { BALANCE } from '../../content/balance';
import { ROOM_TYPES } from '../../content/roomTypes';
import { BuildingSystem } from '../../game/building/system';
import { LightSystem } from '../../game/light/system';
import type { RoomRegion } from '../../game/rooms/detect';
import { RoomsSystem, type RoomInfo } from '../../game/rooms/system';
import type { Simulation } from '../../game/sim';
import { LIGHT_STAGES, lightStageIndex } from '../../world/lightmap/stages';
import type { Layer } from '../../world/model/coords';
import { BUILD_LAYER_INDEX, cellBlueprint, cellPart } from '../../world/structures/cells';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { OVERLAY_LAYER, type DebugOverlayList } from '../debugOverlay';
import { paletteRefHex } from '../palette/rows';
import { rgbaFromHex } from '../text/textBatch';
import { TILE_PX } from '../tilemap/chunk';
import { temperatureLabel } from '../world/overlays';

/** The overlays of the build mode (M4-26). */
export const BUILD_OVERLAYS = ['raeume', 'temperatur', 'licht', 'behaglichkeit', 'stuetzen'] as const;
/** One build overlay. */
export type BuildOverlay = (typeof BUILD_OVERLAYS)[number];

export function isBuildOverlay(name: string): name is BuildOverlay {
  return (BUILD_OVERLAYS as readonly string[]).includes(name);
}

/** Opacity of the fields (0–255): the buildings stay readable underneath. */
const FIELD_ALPHA = 0.4 * 255;
/** Opacity of the open-air temperature (fainter than the rooms, still readable over a night meadow). */
const AIR_ALPHA = 0.25 * 255;
/** Frames a room's description is reused before it is asked again. */
const ROOM_REFRESH_FRAMES = 30;
/** Label inset from the room's top left tile [px]. */
const LABEL_INSET = 2;
/** An open-air temperature label every this many tiles. */
const AIR_LABEL_STEP = 8;
/** Mark of a support: inset square [px]. */
const SUPPORT_INSET = 5;

function color(ref: string, alpha = 255): number {
  return rgbaFromHex(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX), Math.round(alpha));
}

/** Colours of the room types in the order of src/content/roomTypes.ts (cycled), the plain room and the roofless one. */
const TYPE_REFS = ['eis.2', 'gras.5', 'holz.4', 'feuer.4', 'wasser.4', 'sand.3', 'verderb.4', 'laub.4', 'haut.3'] as const;
const TYPE_COLORS: ReadonlyMap<string, number> = new Map(ROOM_TYPES.map((t, i) => [t.id, color(TYPE_REFS[i % TYPE_REFS.length] as string, FIELD_ALPHA)]));
/** A room without type, a closed room without roof (§16.4 under 90 % roofed). */
export const ROOM_REFS = { plain: 'nacht.3', roofless: 'feuer.2' } as const;
export const ROOM_COLORS = {
  plain: color(ROOM_REFS.plain, FIELD_ALPHA),
  roofless: color(ROOM_REFS.roofless, FIELD_ALPHA),
  label: color('eis.4'),
} as const;
/** The colour of a room type's field (the legend of the UI uses the same palette references). */
export function roomTypeColorRef(typeId: string): string {
  const i = ROOM_TYPES.findIndex((t) => t.id === typeId);
  return TYPE_REFS[(i < 0 ? 0 : i) % TYPE_REFS.length] as string;
}
/** Light stages (§12.1) from dark to glaring. */
export const LIGHT_STAGE_REFS: Readonly<Record<(typeof LIGHT_STAGES)[number], string>> = { dunkel: 'nacht.0', daemmrig: 'verderb.2', hell: 'sand.3', gleissend: 'sand.4' };
const LIGHT_COLORS: readonly number[] = LIGHT_STAGES.map((s) => color(LIGHT_STAGE_REFS[s], FIELD_ALPHA));
/** The comfort band without clothing and what the castaway's own clothes lower its cold edge by (§11.2) [°C]. */
const COMFORT_BAND = BALANCE.survival.temperature;
const OWN_CLOTHING_C = COMFORT_BAND.ownClothing.tunicInsulationC + COMFORT_BAND.ownClothing.trousersInsulationC;
/**
 * Hot from this temperature [°C]: six degrees above the comfort band the body heats up without cooling (Erhitzt,
 * §11.2) – a room this warm needs airing, not more fire.
 */
const HOT_FROM_C = COMFORT_BAND.comfortHighC + 6;
/**
 * Steps of the temperature overlay, cold to hot, with their upper edge [°C] and palette colour: Frost below 0 °C
 * (water freezes), kalt until the own clothes keep the castaway comfortable (12 °C), kühl up to the comfort band
 * (18 °C), angenehm in it (to 26 °C), warm, heiß.
 */
export const ROOM_TEMPERATURE_STEPS = [
  { id: 'frost', bisC: 0, ref: 'eis.2' },
  { id: 'kalt', bisC: COMFORT_BAND.comfortLowC - OWN_CLOTHING_C, ref: 'wasser.2' },
  { id: 'kuehl', bisC: COMFORT_BAND.comfortLowC, ref: 'wasser.4' },
  { id: 'angenehm', bisC: COMFORT_BAND.comfortHighC, ref: 'gras.4' },
  { id: 'warm', bisC: HOT_FROM_C, ref: 'feuer.4' },
  { id: 'heiss', bisC: Number.POSITIVE_INFINITY, ref: 'feuer.2' },
] as const;
/** Step index of a temperature (below the upper edge of the step). */
export function roomTemperatureStep(c: number): number {
  for (let i = 0; i < ROOM_TEMPERATURE_STEPS.length; i++) if (c < (ROOM_TEMPERATURE_STEPS[i] as { bisC: number }).bisC) return i;
  return ROOM_TEMPERATURE_STEPS.length - 1;
}
const TEMPERATURE_COLORS: readonly number[] = ROOM_TEMPERATURE_STEPS.map((st) => color(st.ref, FIELD_ALPHA));
const AIR_COLORS: readonly number[] = ROOM_TEMPERATURE_STEPS.map((st) => color(st.ref, AIR_ALPHA));

/**
 * Comfort from none to full (§16.4 0–20) in five steps: bleak grey through cool blue to green and the gold of a cosy
 * room – hues apart from the wood, straw and sand the rooms are built of, so the field reads over them.
 */
export const COMFORT_REFS = ['stein.2', 'wasser.3', 'wasser.5', 'gras.4', 'feuer.4'] as const;
const COMFORT_COLORS: readonly number[] = COMFORT_REFS.map((r) => color(r, FIELD_ALPHA));
/** Supports (§16.3): close, half-way, at the limit of the reach, not carried; the support mark. */
export const SUPPORT_REFS = { nah: 'gras.5', mittel: 'feuer.4', weit: 'feuer.2', frei: 'verderb.3', stuetze: 'eis.4' } as const;
const SUPPORT_COLORS = {
  nah: color(SUPPORT_REFS.nah, FIELD_ALPHA),
  mittel: color(SUPPORT_REFS.mittel, FIELD_ALPHA),
  weit: color(SUPPORT_REFS.weit, FIELD_ALPHA),
  frei: color(SUPPORT_REFS.frei, FIELD_ALPHA),
  stuetze: color(SUPPORT_REFS.stuetze),
} as const;
/** Share of the reach up to which a roof tile counts as close / half-way. */
const SUPPORT_NEAR = 1 / 3;
const SUPPORT_MID = 2 / 3;

/** Comfort step (0–4) of a comfort value out of `max`. */
export function comfortStep(comfort: number, max: number): number {
  const s = Math.floor((Math.max(0, Math.min(max, comfort)) / max) * COMFORT_REFS.length);
  return s >= COMFORT_REFS.length ? COMFORT_REFS.length - 1 : s;
}

/** Colour key of a roof tile's support distance (`dist` −1 = not carried). */
export function supportKey(dist: number, reach: number): keyof typeof SUPPORT_REFS {
  if (dist < 0) return 'frei';
  const share = reach <= 0 ? 1 : dist / reach;
  return share <= SUPPORT_NEAR ? 'nah' : share <= SUPPORT_MID ? 'mittel' : 'weit';
}

/** What the overlays need of the frame. */
export interface BuildOverlayFrame {
  layer: Layer;
  /** Visible rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Language of content names. */
  lang: 'de' | 'en';
  /** Translation of UI keys (room labels). */
  t(key: string, params?: Readonly<Record<string, string | number>>): string;
}

/** A fresh frame record. */
export function createBuildOverlayFrame(): BuildOverlayFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, lang: 'de', t: (key) => key };
}

/** What the overlay drew in the last frame. */
export interface BuildOverlayStats {
  tiles: number;
  rooms: number;
  labels: number;
}

interface OverlaySystems {
  readonly sim: Simulation;
  readonly building: BuildingSystem | null;
  readonly rooms: RoomsSystem | null;
  readonly light: LightSystem | null;
}

const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const ROOF = BUILD_LAYER_INDEX.dach;

/** Fills the overlay list with the build overlay of the frame (see module comment). */
export class BuildOverlays {
  readonly stats: BuildOverlayStats = { tiles: 0, rooms: 0, labels: 0 };
  private systems: OverlaySystems | null = null;
  private frame = 0;
  private readonly seen = new Set<RoomRegion>();
  /**
   * Labels of the rooms and the open air in view, drawn after every field (the list draws in order – a field of a
   * later tile would otherwise cover a label that runs past its first tile, M4-Gate: "Bedroom" half tinted).
   */
  private readonly labelRooms: RoomInfo[] = [];
  /** Open-air labels: tile x, tile y and °C per label. */
  private readonly airLabels: number[] = [];
  private readonly infos = new WeakMap<RoomRegion, { info: RoomInfo | null; frame: number }>();
  private readonly labels = new Map<string, string>();
  /** Two-line room labels by their first and second line (the lines are cached strings). */
  private readonly joined = new Map<string, Map<string, string>>();
  private labelLang = '';

  private systemsOf(sim: Simulation): OverlaySystems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const find = (id: string): unknown => sim.systems.find((x) => x.id === id);
      const b = find('building');
      const r = find('rooms');
      const l = find('light');
      s = { sim, building: b instanceof BuildingSystem ? b : null, rooms: r instanceof RoomsSystem ? r : null, light: l instanceof LightSystem ? l : null };
      this.systems = s;
    }
    return s;
  }

  fill(list: DebugOverlayList, sim: Simulation, kind: BuildOverlay, f: BuildOverlayFrame): void {
    this.frame++;
    const st = this.stats;
    st.tiles = 0;
    st.rooms = 0;
    st.labels = 0;
    if (f.lang !== this.labelLang) {
      this.labels.clear();
      this.joined.clear();
      this.labelLang = f.lang;
    }
    const sys = this.systemsOf(sim);
    const tx0 = Math.floor(f.left / TILE_PX);
    const ty0 = Math.floor(f.top / TILE_PX);
    const tx1 = Math.floor((f.right - 1) / TILE_PX);
    const ty1 = Math.floor((f.bottom - 1) / TILE_PX);
    const layer = list.layer;
    list.layer = OVERLAY_LAYER.info;
    switch (kind) {
      case 'raeume':
      case 'temperatur':
      case 'behaglichkeit':
        if (sys.rooms !== null) this.rooms(list, sim, sys.rooms, kind, f, tx0, ty0, tx1, ty1);
        break;
      case 'licht':
        if (sys.light !== null) this.light(list, sim, sys.light, f.layer, tx0, ty0, tx1, ty1);
        break;
      case 'stuetzen':
        if (sys.building !== null) this.supports(list, sys.building, f.layer, tx0, ty0, tx1, ty1);
        break;
    }
    list.layer = layer;
  }

  /** The description of a room, asked again every `ROOM_REFRESH_FRAMES`. */
  private info(sim: Simulation, rooms: RoomsSystem, region: RoomRegion, tx: number, ty: number): RoomInfo | null {
    const known = this.infos.get(region);
    if (known !== undefined && this.frame - known.frame < ROOM_REFRESH_FRAMES) return known.info;
    const info = rooms.roomAt(sim, region.layer, tx, ty);
    this.infos.set(region, { info, frame: this.frame });
    return info;
  }

  private rooms(list: DebugOverlayList, sim: Simulation, rooms: RoomsSystem, kind: 'raeume' | 'temperatur' | 'behaglichkeit', f: BuildOverlayFrame, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const seen = this.seen;
    seen.clear();
    const labelRooms = this.labelRooms;
    labelRooms.length = 0;
    const airLabels = this.airLabels;
    airLabels.length = 0;
    const air = kind === 'temperatur' ? sim.world.temperature : null;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const region = rooms.map.regionAt(f.layer, tx, ty);
        if (region === null || !region.room) {
          if (air !== null) {
            const c = air.temperatureAt(f.layer, tx, ty);
            list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, AIR_COLORS[roomTemperatureStep(c)] as number);
            this.stats.tiles++;
            if (tx % AIR_LABEL_STEP === 0 && ty % AIR_LABEL_STEP === 0) airLabels.push(tx, ty, c);
          }
          continue;
        }
        const info = this.info(sim, rooms, region, tx, ty);
        if (info === null) continue;
        const c = this.roomColor(kind, info);
        if (c !== 0) {
          list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, c);
          this.stats.tiles++;
        }
        if (!seen.has(region)) {
          seen.add(region);
          this.stats.rooms++;
          labelRooms.push(info);
        }
      }
    }
    // Labels last, over every field.
    for (let i = 0; i < airLabels.length; i += 3) {
      list.value((airLabels[i] as number) * TILE_PX, (airLabels[i + 1] as number) * TILE_PX, TILE_PX, TILE_PX, temperatureLabel(airLabels[i + 2] as number), ROOM_COLORS.label);
      this.stats.labels++;
    }
    for (let i = 0; i < labelRooms.length; i++) this.roomLabel(list, kind, labelRooms[i] as RoomInfo, f);
  }

  /** Field colour of a room for the overlay (0 = none). */
  private roomColor(kind: 'raeume' | 'temperatur' | 'behaglichkeit', info: RoomInfo): number {
    const region = info.region;
    switch (kind) {
      case 'raeume':
        if (!region.interior) return ROOM_COLORS.roofless;
        return info.type === null ? ROOM_COLORS.plain : (TYPE_COLORS.get(info.type.id) ?? ROOM_COLORS.plain);
      case 'temperatur':
        return TEMPERATURE_COLORS[roomTemperatureStep(info.temperatureC)] as number;
      case 'behaglichkeit':
        return region.interior ? (COMFORT_COLORS[comfortStep(info.comfort.total, COMFORT_MAX)] as number) : 0;
    }
  }

  /**
   * Label of a room at its top left tile: name and size on one plate (two lines), the comfort on a plate, the room
   * temperature as the value of that tile.
   */
  private roomLabel(list: DebugOverlayList, kind: 'raeume' | 'temperatur' | 'behaglichkeit', info: RoomInfo, f: BuildOverlayFrame): void {
    const region = info.region;
    const x = region.x0 * TILE_PX;
    const y = region.y0 * TILE_PX;
    switch (kind) {
      case 'raeume': {
        const name = !region.interior ? this.text(f, 'ui.bau.overlay.raum.ohneDach') : info.type === null ? this.text(f, 'ui.bau.overlay.raum.innenraum') : info.type.name[f.lang];
        list.label(x + LABEL_INSET, y + LABEL_INSET, this.lines(name, this.text(f, 'ui.bau.overlay.raum.groesse', region.size)), ROOM_COLORS.label);
        break;
      }
      case 'temperatur':
        list.value(x, y, TILE_PX, TILE_PX, temperatureLabel(info.temperatureC), ROOM_COLORS.label);
        break;
      case 'behaglichkeit':
        if (!region.interior) return;
        list.label(x + LABEL_INSET, y + LABEL_INSET, this.text(f, 'ui.bau.overlay.behaglichkeit.wert', Math.round(info.comfort.total)), ROOM_COLORS.label);
        break;
    }
    this.stats.labels++;
  }

  /** The label of two lines `first` and `second` (cached per pair: the lines are cached strings, a lookup allocates nothing). */
  private lines(first: string, second: string): string {
    let byFirst = this.joined.get(first);
    if (byFirst === undefined) {
      byFirst = new Map();
      this.joined.set(first, byFirst);
    }
    let s = byFirst.get(second);
    if (s === undefined) {
      s = `${first}\n${second}`;
      byFirst.set(second, s);
    }
    return s;
  }

  /** A translated label with one number (cached per key and number). */
  private text(f: BuildOverlayFrame, key: string, n?: number): string {
    const k = n === undefined ? key : `${key}#${n}`;
    let s = this.labels.get(k);
    if (s === undefined) {
      s = n === undefined ? f.t(key) : f.t(key, { n });
      this.labels.set(k, s);
    }
    return s;
  }


  private light(list: DebugOverlayList, sim: Simulation, light: LightSystem, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number): void {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const stage = lightStageIndex(light.stageAt(sim, layer, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX));
        list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, LIGHT_COLORS[stage] as number);
        this.stats.tiles++;
      }
    }
  }

  private supports(list: DebugOverlayList, building: BuildingSystem, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const w = tx1 - tx0 + 1;
    const h = ty1 - ty0 + 1;
    const d = building.roofSupport(layer, tx0, ty0, w, h);
    const store = building.structures;
    const catalog = building.catalog;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const structure = store.cell(layer, STRUCTURE, tx, ty);
        if (structure !== 0 && !cellBlueprint(structure) && catalog.byRuntimeId(cellPart(structure))?.supports === true) {
          list.rect(tx * TILE_PX + SUPPORT_INSET, ty * TILE_PX + SUPPORT_INSET, TILE_PX - 2 * SUPPORT_INSET, TILE_PX - 2 * SUPPORT_INSET, SUPPORT_COLORS.stuetze);
          this.stats.tiles++;
        }
        const roof = store.cell(layer, ROOF, tx, ty);
        if (roof === 0) continue;
        const part = catalog.byRuntimeId(cellPart(roof));
        if (part === undefined) continue;
        const dist = cellBlueprint(roof) ? -1 : (d.dist[(ty - ty0) * w + (tx - tx0)] as number);
        list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, SUPPORT_COLORS[supportKey(dist, part.roofReach)]);
        this.stats.tiles++;
        // Right on its support the mark says it all; farther away the distance stands in the tile's middle.
        if (dist > 0) {
          list.value(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, DIGITS[Math.min(dist, DIGITS.length - 1)] as string, ROOM_COLORS.label);
          this.stats.labels++;
        }
      }
    }
  }
}

/** Highest comfort (§16.4 "Behaglichkeit 0–20"). */
const COMFORT_MAX = BALANCE.rooms.comfort.max;
/** Distance labels 0–9 (longer chains than the longest reach, 8, do not stand). */
const DIGITS: readonly string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
