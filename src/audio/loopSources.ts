/**
 * Loops of the things that burn and work in the world (MASTERPROMPT §27 "räumliches Panning + Distanzdämpfung";
 * M4-29): processing stations running a batch, the hand station the crafting queue works at, placed lights burning
 * (camp fires, torches on stakes and walls, lamps, the fireplace), the hearth fire and blazes on the build grid.
 *
 * **Read from the simulation's state, not from events.** Events cannot tell a loop about everything that burns: a
 * saved game loads without events, the audio starts with the first input (events before it are gone), a station in a
 * frozen chunk catches up silently (§3.3 "Aufholen") and a fire started before the player came near never said so to
 * the listener. So `LoopDirector` scans the systems (read-only, like the renderer) every `LOOP_SCAN_SECONDS` – and on
 * the next frame after an event of `LOOP_SOURCE_EVENTS` – and sets one loop slot per sounding thing.
 *
 * **Only what can be heard, and not too much of it:** a source on another layer or beyond its preset's `reichweite`
 * gets no voice; of each preset the nearest `stimmen` sound (twenty wall torches: the eight nearest flutter; a burning
 * house: the four nearest tiles roar), and at most `MAX_WORLD_LOOPS` in all, so one-shots keep their voices
 * (`MAX_VOICES`, src/audio/sfxPlayer.ts). A slot keeps its voice while its thing keeps sounding – the SFX player only
 * moves it – and fades out when it stops or falls out of the choice.
 *
 * Slots: `station_<id>`, `handwerk` (the crafting queue at a hand station; at the placed station, or at the listener
 * for a camp fire), `licht_<id>`, `herd_<id>`, `brand_<layer>_<tx>_<ty>`.
 */
import { createAudioClock, type AudioClock } from './clock';
import type { SfxPreset } from '../content/sfx/schema';
import { CraftingSystem } from '../game/crafting/system';
import { FireSystem } from '../game/fire/system';
import { HearthSystem } from '../game/hearth/system';
import { lightKindSound } from '../game/light/events';
import { LightSystem } from '../game/light/system';
import type { SimEventMap, Simulation } from '../game/sim';
import { StationSystem } from '../game/stations/system';
import { TILE_PX } from '../world/model/coords';
import { FIRE_AUDIO, HEARTH_AUDIO } from './baseSounds';
import type { SfxCue } from './sfxPlayer';

/** Seconds between two scans of the simulation (an event of `LOOP_SOURCE_EVENTS` rescans on the next frame). */
export const LOOP_SCAN_SECONDS = 0.25;
/** Most world loops at once: a third of the SFX player's 32 voices, the rest stays free for one-shots. */
export const MAX_WORLD_LOOPS = 12;

/** Events after which a loop may start or stop: the next frame rescans instead of waiting for the next scan. */
export const LOOP_SOURCE_EVENTS = [
  'craftStarted',
  'craftCompleted',
  'craftCancelled',
  'stationBatchStarted',
  'stationStopped',
  'stationRemoved',
  'stationUpgraded',
  'lightPlaced',
  'lightRemoved',
  'lightIgnited',
  'lightExtinguished',
  'hearthIgnited',
  'hearthOut',
  'hearthRemoved',
  'fireStarted',
  'fireOut',
  'sleepStarted',
  'playerDied',
] as const satisfies ReadonlyArray<keyof SimEventMap>;

/** Loop slot of placed light `id`. */
export function lightLoop(id: number): string {
  return `licht_${id}`;
}

/** Loop slot of the processing station `id`. */
export function stationLoop(id: number): string {
  return `station_${id}`;
}

/** Loop slot of the hearth `id`. */
export function hearthLoop(id: number): string {
  return `herd_${id}`;
}

/** Loop slot of the burning tile (tx, ty) of `layer`. */
export function blazeLoop(layer: number, tx: number, ty: number): string {
  return `brand_${layer}_${tx}_${ty}`;
}

/** Loop slot of the crafting queue working at a hand station. */
export const CRAFT_LOOP = 'handwerk';

/** Where the loops go: the SFX player's loop slots, relative to its listener. */
export interface LoopSink {
  readonly listener: { readonly x: number; readonly y: number; readonly layer: number };
  setLoop(slot: string, cue: SfxCue | null): void;
}

type SourceKind = 'station' | 'handwerk' | 'licht' | 'herd' | 'brand';

/** A sounding thing found in a scan (pooled). */
interface Candidate {
  kind: SourceKind;
  /** Station, light or hearth id; the layer of a blaze. */
  id: number;
  /** Tile of a blaze. */
  tx: number;
  ty: number;
  sfx: string;
  /** World position [px]; `positioned` false: the listener's own loop. */
  x: number;
  y: number;
  layer: number;
  positioned: boolean;
  /** Squared distance to the listener [px²]; −1 for the listener's own. */
  d2: number;
}

/** The systems a scan reads, found once per simulation. */
interface LoopSystems {
  readonly stations: StationSystem | null;
  readonly crafting: CraftingSystem | null;
  readonly light: LightSystem | null;
  readonly hearth: HearthSystem | null;
  readonly fire: FireSystem | null;
}

function systemsOf(sim: Simulation): LoopSystems {
  let stations: StationSystem | null = null;
  let crafting: CraftingSystem | null = null;
  let light: LightSystem | null = null;
  let hearth: HearthSystem | null = null;
  let fire: FireSystem | null = null;
  for (const s of sim.systems) {
    if (s instanceof StationSystem) stations = s;
    else if (s instanceof CraftingSystem) crafting = s;
    else if (s instanceof LightSystem) light = s;
    else if (s instanceof HearthSystem) hearth = s;
    else if (s instanceof FireSystem) fire = s;
  }
  return { stations, crafting, light, hearth, fire };
}

function byDistance(a: Candidate, b: Candidate): number {
  return a.d2 - b.d2;
}

/** Keeps the loop slots of the sounding things of the simulation (see module comment). */
export class LoopDirector {
  private readonly presets: ReadonlyMap<string, SfxPreset>;
  private readonly pool: Candidate[] = [];
  private readonly heard: Candidate[] = [];
  private readonly perPreset = new Map<string, number>();
  private readonly desired = new Map<string, SfxCue>();
  private readonly active = new Map<string, string>();
  private readonly listener = { x: 0, y: 0, layer: 0 };
  private used = 0;
  private lastScan = Number.NEGATIVE_INFINITY;
  private dirty = true;
  private sim: Simulation | null = null;
  private systems: LoopSystems = { stations: null, crafting: null, light: null, hearth: null, fire: null };
  /** The clock of `update` (tests call it with numbers). */
  private readonly clock = createAudioClock();
  /** The sink of the running `update` (the held callbacks below reach it; no iterator per scan). */
  private sink: LoopSink | null = null;
  private readonly applyDesired = (cue: SfxCue, slot: string): void => {
    (this.sink as LoopSink).setLoop(slot, cue);
    this.active.set(slot, cue.id);
  };
  private readonly dropUndesired = (_id: string, slot: string): void => {
    if (this.desired.has(slot)) return;
    (this.sink as LoopSink).setLoop(slot, null);
    this.active.delete(slot);
  };

  /** `maxLoops`: most world loops at once (default `MAX_WORLD_LOOPS`). */
  constructor(
    presets: readonly SfxPreset[],
    private readonly maxLoops: number = MAX_WORLD_LOOPS,
  ) {
    this.presets = new Map(presets.map((p) => [p.id, p]));
  }

  /** The loops sounding now: slot → preset id. */
  get loops(): ReadonlyMap<string, string> {
    return this.active;
  }

  /** Something may have started or stopped: the next `update` rescans. */
  invalidate(): void {
    this.dirty = true;
  }

  /** At `now` [s] on the audio clock: rescans when due and sets the sink's loop slots (tests; the frame calls `updateAt`). */
  update(sim: Simulation, sink: LoopSink, now: number): void {
    this.clock.now = now;
    this.updateAt(sim, sink, this.clock);
  }

  /** Once per frame at the frame's audio time (`clock.now` [s], a held record: no number boxed per frame). */
  updateAt(sim: Simulation, sink: LoopSink, clock: Readonly<AudioClock>): void {
    if (!this.dirty && clock.now - this.lastScan < LOOP_SCAN_SECONDS) return;
    this.dirty = false;
    this.lastScan = clock.now;
    this.listener.x = sink.listener.x;
    this.listener.y = sink.listener.y;
    this.listener.layer = sink.listener.layer;
    this.scan(sim);
    this.choose();
    // Held callbacks instead of `for … of` over the maps: a scan every quarter second allocates no iterators.
    this.sink = sink;
    this.desired.forEach(this.applyDesired);
    this.active.forEach(this.dropUndesired);
    this.sink = null;
  }

  /** Forgets every slot (the sink stopped its loops). */
  reset(): void {
    this.active.clear();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------

  private scan(sim: Simulation): void {
    if (this.sim !== sim) {
      this.sim = sim;
      this.systems = systemsOf(sim);
    }
    this.used = 0;
    const { stations, crafting, light, hearth, fire } = this.systems;
    if (stations !== null) {
      const placed = stations.placed;
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i] as (typeof placed)[number];
        if (p.proc === null || !p.proc.laeuft) continue;
        const def = stations.stations.find(p.station);
        if (def === undefined) continue;
        const size = stations.footprintOf(p);
        this.offer('station', p.id, 0, 0, def.sounds.laeuft, (p.tx + size.b / 2) * TILE_PX, (p.ty + size.t / 2) * TILE_PX, p.layer, true);
      }
    }
    if (crafting !== null) this.offerCraft(crafting, stations);
    if (light !== null) {
      const lights = light.state.placed;
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i] as (typeof lights)[number];
        if (l.torch?.lit !== true && l.fire?.lit !== true) continue;
        const b = l.groesse?.b ?? 1;
        const t = l.groesse?.t ?? 1;
        this.offer('licht', l.id, 0, 0, lightKindSound(l.kind, 'brennen'), (l.tx + b / 2) * TILE_PX, (l.ty + t / 2) * TILE_PX, l.layer, true);
      }
    }
    if (hearth !== null) {
      const hearths = hearth.hearths;
      for (let i = 0; i < hearths.length; i++) {
        const h = hearths[i] as (typeof hearths)[number];
        if (h.lit) this.offer('herd', h.id, 0, 0, HEARTH_AUDIO.burning, (h.tx + h.w / 2) * TILE_PX, (h.ty + h.h / 2) * TILE_PX, h.layer, true);
      }
    }
    // Only a fire that burns: its cells are a map's values (an iterator each scan).
    if (fire !== null && fire.size > 0) {
      for (const c of fire.cells) this.offer('brand', c.layer, c.tx, c.ty, FIRE_AUDIO.burning, (c.tx + 1 / 2) * TILE_PX, (c.ty + 1 / 2) * TILE_PX, c.layer, true);
    }
  }

  /** The crafting queue at work at a hand station: at the placed station, else (a camp fire) at the listener. */
  private offerCraft(crafting: CraftingSystem, stations: StationSystem | null): void {
    const order = crafting.orders[0];
    if (order === undefined || crafting.blocked !== null) return;
    const stationId = order.station ?? crafting.recipes.find(order.rezept)?.station ?? null;
    if (stationId === null) return;
    const def = crafting.recipes.stations.find(stationId);
    if (def === undefined || def.art !== 'handwerk') return;
    const sfx = def.sounds.laeuft;
    const placed = order.platz === undefined ? undefined : stations?.station(order.platz);
    if (placed === undefined || stations === null) {
      this.offer('handwerk', 0, 0, 0, sfx, 0, 0, 0, false);
      return;
    }
    const size = stations.footprintOf(placed);
    this.offer('handwerk', 0, 0, 0, sfx, (placed.tx + size.b / 2) * TILE_PX, (placed.ty + size.t / 2) * TILE_PX, placed.layer, true);
  }

  /** Adds a source that can be heard from the listener (same layer, within its preset's range). */
  private offer(kind: SourceKind, id: number, tx: number, ty: number, sfx: string, x: number, y: number, layer: number, positioned: boolean): void {
    let d2 = -1;
    if (positioned) {
      const preset = this.presets.get(sfx);
      if (preset === undefined || layer !== this.listener.layer) return;
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      d2 = dx * dx + dy * dy;
      const range = preset.reichweite * TILE_PX;
      if (d2 > range * range) return;
    }
    let c = this.pool[this.used];
    if (c === undefined) {
      c = { kind, id, tx, ty, sfx, x, y, layer, positioned, d2 };
      this.pool.push(c);
    } else {
      c.kind = kind;
      c.id = id;
      c.tx = tx;
      c.ty = ty;
      c.sfx = sfx;
      c.x = x;
      c.y = y;
      c.layer = layer;
      c.positioned = positioned;
      c.d2 = d2;
    }
    this.used++;
  }

  /** The nearest `stimmen` of each preset, at most `maxLoops` in all → `desired`. */
  private choose(): void {
    // Insertion sort by distance (a handful of sources): `Array.prototype.sort` builds its work arrays on every scan.
    const heard = this.heard;
    heard.length = 0;
    for (let i = 0; i < this.used; i++) {
      const c = this.pool[i] as Candidate;
      let j = heard.length;
      heard.push(c);
      while (j > 0 && byDistance(heard[j - 1] as Candidate, c) > 0) {
        heard[j] = heard[j - 1] as Candidate;
        j--;
      }
      heard[j] = c;
    }
    // A map's `clear` builds a new table: only when it holds something.
    if (this.perPreset.size > 0) this.perPreset.clear();
    if (this.desired.size > 0) this.desired.clear();
    for (let i = 0; i < this.heard.length; i++) {
      const c = this.heard[i] as Candidate;
      if (this.desired.size >= this.maxLoops) break;
      const voices = this.presets.get(c.sfx)?.stimmen ?? 1;
      const n = this.perPreset.get(c.sfx) ?? 0;
      if (n >= voices) continue;
      this.perPreset.set(c.sfx, n + 1);
      this.desired.set(this.slotOf(c), c.positioned ? { id: c.sfx, x: c.x, y: c.y, layer: c.layer } : { id: c.sfx });
    }
  }

  private slotOf(c: Candidate): string {
    switch (c.kind) {
      case 'station':
        return stationLoop(c.id);
      case 'handwerk':
        return CRAFT_LOOP;
      case 'licht':
        return lightLoop(c.id);
      case 'herd':
        return hearthLoop(c.id);
      case 'brand':
        return blazeLoop(c.id, c.tx, c.ty);
    }
  }
}
