/**
 * The ambience director (M7-06; MASTERPROMPT §27 "Biom-Klangbetten (Vögel tags, Grillen nachts, Wind, positionale
 * Flüsse …), Wetterschichten, Donner mit entfernungsabhängiger Verzögerung"): turns the listener's surroundings
 * (src/audio/ambience/probe.ts) into the loops and calls of the bus `umgebung` (presets src/content/sfx/umgebung.ts).
 *
 * - **Beds** (`AMBIENCE_BEDS`, loops at the listener): by biome and day or night – Grünhain leaves by day, crickets by night
 *   (not in winter), the surf of the Salt Coast, the caves' drip and rumble on every cave layer; a biome without its own bed
 *   (the later regions, M8+) hears the wind. Indoors the beds are quieter and muffled (`INDOOR_MUFFLE`).
 * - **Calls**: one-shots of the bed's callers – birds, the owl, gulls, drips – at a random place `CALL_DISTANCE_TILES` around
 *   the listener, every few seconds (the bed's `intervall`); birds and gulls keep quiet in rain heavier than `CALLS_MAX_RAIN`.
 * - **Water**: the river's babble at the nearest river tiles (up to three positional loops), the waves at the nearest shore.
 * - **Weather**: rain (`regen` loop, from drizzle up), heavy rain (`starkregen`, the downpour of a thunderstorm), the wind
 *   (from `WIND_FROM` up – storms, blizzards, sandstorms); snow and ash fall silently. Indoors muffled.
 * - **Thunder**: a lightning `distance` metres away (1 tile = 1 m) is heard `distance / SPEED_OF_SOUND` seconds later – a
 *   crack and boom within `NEAR_THUNDER_M`, else the long roll, quieter with distance. In a thunderstorm the director draws
 *   far lightning on its own (`FAR_LIGHTNING_M`, every `FAR_LIGHTNING_INTERVAL` seconds) – the storm is heard all around, not
 *   only where the simulation strikes (the strikes near the player come as events, `lightning`).
 *
 * Presentation code: the draws come from its own seeded `Rng`. Loops are updated `UPDATE_SECONDS` apart with held cue
 * records (no allocation per frame).
 */
import { Rng } from '../../engine/rng';
import { TILE_PX } from '../../world/model/coords';
import type { SfxCue } from '../sfxPlayer';
import { MAX_RIVERS, type AmbienceState } from './probe';

/** One set of bed and callers. */
export interface AmbienceBed {
  /** Bed loops and their volume. */
  readonly betten: readonly { readonly id: string; readonly lautstaerke: number }[];
  /** Callers (one-shots around the listener). */
  readonly rufe: readonly string[];
  /** Pause between two calls [s]. */
  readonly intervall: readonly [number, number];
  /** Calls keep quiet in rain. */
  readonly rufeImRegenStill: boolean;
}

/** Beds of a biome by day and by night (night: dusk and night). */
export interface BiomeAmbience {
  readonly tag: AmbienceBed;
  readonly nacht: AmbienceBed;
  /** The night bed in winter (no crickets). */
  readonly winternacht?: AmbienceBed;
}

const WIND_BED: AmbienceBed = { betten: [{ id: 'sfx_umgebung_wind', lautstaerke: 0.5 }], rufe: [], intervall: [10, 20], rufeImRegenStill: true };

/** The beds of the biomes with their own (§27; the other biomes hear `WIND_BED` until their milestone brings theirs). */
export const AMBIENCE_BEDS: Readonly<Record<string, BiomeAmbience>> = {
  gruenhain: {
    tag: { betten: [{ id: 'sfx_umgebung_laub', lautstaerke: 1 }], rufe: ['sfx_umgebung_vogel_amsel', 'sfx_umgebung_vogel_meise', 'sfx_umgebung_vogel_fink'], intervall: [3, 9], rufeImRegenStill: true },
    nacht: { betten: [{ id: 'sfx_umgebung_grillen', lautstaerke: 1 }], rufe: ['sfx_umgebung_eule'], intervall: [14, 40], rufeImRegenStill: true },
    winternacht: { betten: [{ id: 'sfx_umgebung_wind', lautstaerke: 0.4 }], rufe: ['sfx_umgebung_eule'], intervall: [20, 50], rufeImRegenStill: true },
  },
  salzkueste: {
    tag: { betten: [{ id: 'sfx_umgebung_brandung', lautstaerke: 1 }], rufe: ['sfx_umgebung_moewe'], intervall: [5, 14], rufeImRegenStill: true },
    nacht: { betten: [{ id: 'sfx_umgebung_brandung', lautstaerke: 0.85 }], rufe: [], intervall: [10, 20], rufeImRegenStill: true },
  },
};

/** Every cave layer. */
export const CAVE_BED: AmbienceBed = { betten: [{ id: 'sfx_umgebung_hoehle', lautstaerke: 1 }], rufe: ['sfx_umgebung_tropfen'], intervall: [2, 7], rufeImRegenStill: false };
/** A biome without its own bed. */
export const DEFAULT_BED: AmbienceBed = WIND_BED;

/** Distance of a call from the listener [tiles]. */
export const CALL_DISTANCE_TILES: readonly [number, number] = [8, 28];
/** Rain (precipitation) above which birds and gulls keep quiet. */
export const CALLS_MAX_RAIN = 0.3;
/** Muffling of beds and weather indoors (0 … 1, src/audio/spatial.ts) and the beds' level there. */
export const INDOOR_MUFFLE = 0.75;
export const INDOOR_BED_LEVEL = 0.6;
/** Precipitation of steady rain (the `regen` state): the rain loop is full from here. */
export const RAIN_FULL = 0.65;
/** Wind (0 … 1) from which the wind loop sounds, full at 1. */
export const WIND_FROM = 0.4;
/** Speed of sound [m/s]; one tile is one metre. */
export const SPEED_OF_SOUND = 343;
/** Lightning closer than this cracks and booms; farther it rolls [m]. */
export const NEAR_THUNDER_M = 400;
/** Distance of the far lightning drawn in a thunderstorm [m]. */
export const FAR_LIGHTNING_M: readonly [number, number] = [500, 3000];
/** Pause between two far lightnings [s]. */
export const FAR_LIGHTNING_INTERVAL: readonly [number, number] = [6, 20];
/** Thunder volume at 0 m and the distance at which it reaches `THUNDER_MIN_VOLUME` [m]. */
export const THUNDER_FADE_M = 4000;
export const THUNDER_MIN_VOLUME = 0.25;
/** Thunder sits this far towards the lightning (its direction in the stereo field) [tiles]. */
export const THUNDER_PLACE_TILES = 10;
/** Loops are updated this often [s]. */
export const UPDATE_SECONDS = 0.25;
/** Thunders on their way at most. */
const MAX_THUNDER = 8;

/** Where the director plays (the SFX player). */
export interface AmbienceSink {
  setLoop(slot: string, cue: SfxCue | null): void;
  play(cue: SfxCue): boolean;
}

/** The listener (world px, layer). */
export interface AmbienceListener {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

/** A mutable cue record (held per slot; the player reads it at once and keeps nothing). */
interface HeldCue {
  id: string;
  x?: number;
  y?: number;
  layer?: number;
  volume?: number;
  muffle?: number;
}

const BED_SLOTS = ['umgebung_bett_0', 'umgebung_bett_1'] as const;
const RIVER_SLOTS = ['umgebung_fluss_0', 'umgebung_fluss_1', 'umgebung_fluss_2'] as const;
const SEA_SLOT = 'umgebung_meer';
const RAIN_SLOT = 'wetter_regen';
const DOWNPOUR_SLOT = 'wetter_starkregen';
const WIND_SLOT = 'wetter_wind';

/** The bed set of a state. */
export function bedFor(state: Readonly<AmbienceState>): AmbienceBed {
  if (state.layer < 0) return CAVE_BED;
  const biome = AMBIENCE_BEDS[state.biome];
  if (biome === undefined) return DEFAULT_BED;
  if (!state.night) return biome.tag;
  return state.season === 'winter' && biome.winternacht !== undefined ? biome.winternacht : biome.nacht;
}

/** Thunder delay of a lightning `distanceM` metres away [s]. */
export function thunderDelay(distanceM: number): number {
  return distanceM / SPEED_OF_SOUND;
}

/** Thunder volume at `distanceM`. */
export function thunderVolume(distanceM: number): number {
  return Math.max(THUNDER_MIN_VOLUME, 1 - distanceM / THUNDER_FADE_M);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class AmbienceDirector {
  private readonly rng: Rng;
  private nextUpdate = 0;
  private nextCall = Number.NaN;
  private nextFar = Number.NaN;
  private wasActive = false;
  private readonly held = new Map<string, HeldCue>();
  private readonly callCue: HeldCue = { id: '', x: 0, y: 0, layer: 0, volume: 1 };
  // Thunder on its way: due time, distance, direction (unit vector) and the layer it is heard on.
  private readonly thunderDue = new Float64Array(MAX_THUNDER);
  private readonly thunderDist = new Float64Array(MAX_THUNDER);
  private readonly thunderDx = new Float64Array(MAX_THUNDER);
  private readonly thunderDy = new Float64Array(MAX_THUNDER);
  private thunderCount = 0;
  private readonly thunderCue: HeldCue = { id: '', x: 0, y: 0, layer: 0, volume: 1 };
  private bed: AmbienceBed | null = null;
  /** Far lightnings drawn so far (tests: distances and times of the storm). */
  readonly farLightning: { at: number; distance: number }[] = [];
  /** Keeps at most this many entries of `farLightning`. */
  private static readonly FAR_LOG = 32;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    for (const slot of [...BED_SLOTS, ...RIVER_SLOTS, SEA_SLOT, RAIN_SLOT, DOWNPOUR_SLOT, WIND_SLOT]) this.held.set(slot, { id: '' });
  }

  /** Once per frame at audio time `now` [s]. */
  update(state: Readonly<AmbienceState>, listener: AmbienceListener, now: number, sink: AmbienceSink): void {
    if (!state.active) {
      if (this.wasActive) this.silence(sink);
      this.wasActive = false;
      return;
    }
    this.wasActive = true;
    if (now >= this.nextUpdate) {
      this.nextUpdate = now + UPDATE_SECONDS;
      this.loops(state, sink);
    }
    this.calls(state, listener, now, sink);
    this.storm(state, now);
    this.thunder(listener, now, sink);
  }

  /**
   * A lightning struck at (x, y) [px] on `layer` (the simulation's event): its thunder is on its way. Lightning on another
   * layer is not heard (the caves' rock).
   */
  lightning(x: number, y: number, layer: number, listener: AmbienceListener, now: number): void {
    if (layer !== listener.layer) return;
    const dx = (x - listener.x) / TILE_PX;
    const dy = (y - listener.y) / TILE_PX;
    const d = Math.hypot(dx, dy);
    this.queueThunder(now, d, d > 0 ? dx / d : 0, d > 0 ? dy / d : 0);
  }

  /** Thunders on their way (tests). */
  get pendingThunder(): number {
    return this.thunderCount;
  }

  // -------------------------------------------------------------------------------------------

  private loop(sink: AmbienceSink, slot: string, id: string, volume: number, muffle: number, x?: number, y?: number, layer?: number): void {
    const cue = this.held.get(slot) as HeldCue;
    if (id === '' || volume <= 0) {
      if (cue.id !== '') sink.setLoop(slot, null);
      cue.id = '';
      return;
    }
    cue.id = id;
    cue.volume = volume;
    if (x === undefined) {
      delete cue.x;
      delete cue.y;
      delete cue.layer;
      cue.muffle = muffle;
    } else {
      cue.x = x;
      cue.y = y;
      cue.layer = layer;
      delete cue.muffle;
    }
    sink.setLoop(slot, cue);
  }

  private loops(state: Readonly<AmbienceState>, sink: AmbienceSink): void {
    const bed = bedFor(state);
    this.bed = bed;
    const muffle = state.indoors ? INDOOR_MUFFLE : 0;
    const bedLevel = state.indoors ? INDOOR_BED_LEVEL : 1;
    for (let i = 0; i < BED_SLOTS.length; i++) {
      const b = bed.betten[i];
      this.loop(sink, BED_SLOTS[i] as string, b?.id ?? '', (b?.lautstaerke ?? 0) * bedLevel, muffle);
    }
    for (let i = 0; i < MAX_RIVERS; i++) {
      if (i < state.rivers) this.loop(sink, RIVER_SLOTS[i] as string, 'sfx_umgebung_fluss', 1, 0, state.riverX[i], state.riverY[i], state.layer);
      else this.loop(sink, RIVER_SLOTS[i] as string, '', 0, 0);
    }
    if (state.sea) this.loop(sink, SEA_SLOT, 'sfx_umgebung_meer', 1, 0, state.seaX, state.seaY, state.layer);
    else this.loop(sink, SEA_SLOT, '', 0, 0);
    const rain = state.rain ? state.precipitation : 0;
    this.loop(sink, RAIN_SLOT, 'sfx_umgebung_regen', clamp01(rain / RAIN_FULL), muffle);
    this.loop(sink, DOWNPOUR_SLOT, 'sfx_umgebung_starkregen', clamp01((rain - RAIN_FULL) / (1 - RAIN_FULL)), muffle);
    // The wind bed of a biome without its own already blows; the weather's wind adds the gusts of a storm.
    this.loop(sink, WIND_SLOT, 'sfx_umgebung_wind', state.layer < 0 ? 0 : clamp01((state.wind - WIND_FROM) / (1 - WIND_FROM)), muffle);
  }

  private calls(state: Readonly<AmbienceState>, listener: AmbienceListener, now: number, sink: AmbienceSink): void {
    const bed = this.bed;
    if (bed === null) return;
    if (Number.isNaN(this.nextCall)) this.nextCall = now + this.rng.float(bed.intervall[0], bed.intervall[1]);
    if (now < this.nextCall) return;
    this.nextCall = now + this.rng.float(bed.intervall[0], bed.intervall[1]);
    if (bed.rufe.length === 0 || state.indoors) return;
    if (bed.rufeImRegenStill && state.rain && state.precipitation > CALLS_MAX_RAIN) return;
    const id = bed.rufe[this.rng.int(0, bed.rufe.length)] as string;
    const angle = this.rng.float(0, 2 * Math.PI);
    const dist = this.rng.float(CALL_DISTANCE_TILES[0], CALL_DISTANCE_TILES[1]) * TILE_PX;
    const cue = this.callCue;
    cue.id = id;
    cue.x = listener.x + Math.cos(angle) * dist;
    cue.y = listener.y + Math.sin(angle) * dist;
    cue.layer = listener.layer;
    sink.play(cue);
  }

  private storm(state: Readonly<AmbienceState>, now: number): void {
    if (!state.storm || state.layer < 0) {
      this.nextFar = Number.NaN;
      return;
    }
    if (Number.isNaN(this.nextFar)) this.nextFar = now + this.rng.float(FAR_LIGHTNING_INTERVAL[0], FAR_LIGHTNING_INTERVAL[1]);
    if (now < this.nextFar) return;
    this.nextFar = now + this.rng.float(FAR_LIGHTNING_INTERVAL[0], FAR_LIGHTNING_INTERVAL[1]);
    const d = this.rng.float(FAR_LIGHTNING_M[0], FAR_LIGHTNING_M[1]);
    const angle = this.rng.float(0, 2 * Math.PI);
    if (this.farLightning.length >= AmbienceDirector.FAR_LOG) this.farLightning.shift();
    this.farLightning.push({ at: now, distance: d });
    this.queueThunder(now, d, Math.cos(angle), Math.sin(angle));
  }

  private queueThunder(now: number, distanceM: number, ux: number, uy: number): void {
    if (this.thunderCount >= MAX_THUNDER) return;
    const i = this.thunderCount++;
    this.thunderDue[i] = now + thunderDelay(distanceM);
    this.thunderDist[i] = distanceM;
    this.thunderDx[i] = ux;
    this.thunderDy[i] = uy;
  }

  private thunder(listener: AmbienceListener, now: number, sink: AmbienceSink): void {
    for (let i = 0; i < this.thunderCount; ) {
      if ((this.thunderDue[i] as number) > now) {
        i++;
        continue;
      }
      const d = this.thunderDist[i] as number;
      const cue = this.thunderCue;
      cue.id = d < NEAR_THUNDER_M ? 'sfx_umgebung_donner_nah' : 'sfx_umgebung_donner_fern';
      const place = Math.min(d, THUNDER_PLACE_TILES) * TILE_PX;
      cue.x = listener.x + (this.thunderDx[i] as number) * place;
      cue.y = listener.y + (this.thunderDy[i] as number) * place;
      cue.layer = listener.layer;
      cue.volume = thunderVolume(d);
      sink.play(cue);
      // Remove by moving the last one in.
      const last = --this.thunderCount;
      this.thunderDue[i] = this.thunderDue[last] as number;
      this.thunderDist[i] = this.thunderDist[last] as number;
      this.thunderDx[i] = this.thunderDx[last] as number;
      this.thunderDy[i] = this.thunderDy[last] as number;
    }
  }

  private silence(sink: AmbienceSink): void {
    for (const [slot, cue] of this.held) {
      if (cue.id !== '') sink.setLoop(slot, null);
      cue.id = '';
    }
    this.bed = null;
    this.nextCall = Number.NaN;
    this.nextFar = Number.NaN;
    this.thunderCount = 0;
  }
}
