/**
 * Reading samples of the base for the presentation (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)", §16.6 "Blaupausen",
 * §16.7 "Suche über alle Kisten der Basis"; M4-20, M4-24; docs/ARCHITEKTUR.md "Lesende Abtastungen der Sitzung",
 * ADR-0010, ADR-0035). The UI never reads the simulation: the hearth screen and the build mode call
 * `GameSession.sampleHearth` / `sampleBlueprintNeeds`, which fill records the caller owns through this sampler.
 *
 * - **Hearth** (`HearthSample`): a placed hearth – whether the player stands within its reach, whether it burns,
 *   the game minutes its fire lasts (the piece burning now and the whole store), the glow left of that piece, the
 *   fuel store (the simulation's immutable stacks, by reference) and its pieces, the radius of its base and the
 *   ember core of each niche; `stand` counts changes. While it burns (§16.5 "Solange es brennt: … Lagerübersicht
 *   aller Kisten") also the **overview** of its base: every chest within the base's radius, nearest first (the
 *   chests of `HearthSystem.overview`), with name, label and slots, and – for the items the caller searches
 *   (`suche`) – every stack of them in the base's chests (`StorageSystem.search`); `uebersichtStand` counts
 *   changes of both.
 * - **Blueprint needs** (`BlueprintNeedsSample`): per part the blueprints anchored in a rectangle around the
 *   player on its layer, the pieces at hand for them (the bags and the chests near the first one) and the pieces
 *   still missing (`blueprintNeeds`, the material source of the build grid); `stand` counts changes.
 *
 * Read-only: nothing here changes the simulation or builds the world. The hearth sample allocates only when the
 * overview's search changes (a new query or other chest contents); the blueprint needs build their list per call,
 * so the build mode samples them a few times a second, not every frame.
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { blueprintNeeds } from '../blueprints/needs';
import { blueprintMaterials } from '../blueprints/supply';
import type { BuildMaterialSource } from '../building/system';
import { BuildingSystem } from '../building/system';
import { burnLeft, coreCount, hearthCentre, hearthFuelTicks, radiusForCores, storedPieces } from '../hearth/formulas';
import { HearthSystem } from '../hearth/system';
import { InventorySystem } from '../inventory/system';
import type { ItemStack } from '../items/stack';
import { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import { distanceToChest } from '../storage/formulas';
import type { Chest } from '../storage/state';
import { StorageSystem } from '../storage/system';

/** Game minutes per game hour. */
const MINUTES_PER_HOUR = 60;
/** Steps of the glow of the piece in the fire (hundredths). */
const GLUT_STUFEN = 100;
const HEARTH_REACH_PX = BALANCE.hearth.reachTiles * TILE_PX;

/** A chest of a hearth's base as the overview shows it. */
export interface BaseChestSample {
  id: number;
  /** The container item (`kiste_holz`, `truhe`, `lagerregal`). */
  item: string;
  /** Name on the lid; empty = the item's name. */
  name: string;
  /** Item shown as the icon label, or `null`. */
  label: string | null;
  /** Its slots (the simulation's stacks, by reference). */
  readonly slots: (ItemStack | null)[];
  /** Filled slots. */
  belegt: number;
  /** Distance from the hearth's centre to the chest [tiles, rounded]. */
  entfernung: number;
}

/** A stack the search found in a chest of the base. */
export interface BaseFindSample {
  kiste: number;
  index: number;
  stack: ItemStack;
}

/** A placed hearth for the UI, filled by `GameSession.sampleHearth` (see the module comment). */
export interface HearthSample {
  /** Whether the asked hearth exists (the rest keeps its last state otherwise). */
  vorhanden: boolean;
  id: number;
  /** Whether the player stands within reach of it (`BALANCE.hearth.reachTiles`). */
  inReichweite: boolean;
  /** Whether it burns now – its base is protected, it is a respawn point (§16.5). */
  brennt: boolean;
  /** How long it burns on: the piece burning now and the whole store [game minutes, rounded up; 0 when out]. */
  restMinuten: number;
  /** What is left of the piece in the fire [0–1, in hundredths, rounded up] (0: none). */
  glut: number;
  /** The fuel store in the order it burns (the simulation's stacks, by reference). */
  readonly vorrat: ItemStack[];
  /** Pieces in the store. */
  stueck: number;
  /** Radius of its base [tiles] (§16.5: 12, with ember cores up to 40). */
  radius: number;
  /** The ember core in each niche, or `null`. */
  readonly kerne: (string | null)[];
  /** Counts every change of the fields above. */
  stand: number;
  /** Whether the overview is there (it burns and a storage system exists). */
  uebersicht: boolean;
  /** The chests of its base, nearest first; only the first `kistenAnzahl` records are valid. */
  readonly kisten: BaseChestSample[];
  kistenAnzahl: number;
  /** Items to search the base's chests for (the caller sets them; kept between frames); `null` = no search. */
  suche: ReadonlySet<string> | null;
  /** What the search found; only the first `trefferAnzahl` records are valid. */
  readonly treffer: BaseFindSample[];
  trefferAnzahl: number;
  /** Counts every change of the overview (chests, their contents, the finds). */
  uebersichtStand: number;
}

/** A fresh `HearthSample`. */
export function createHearthSample(): HearthSample {
  return {
    vorhanden: false,
    id: 0,
    inReichweite: false,
    brennt: false,
    restMinuten: 0,
    glut: 0,
    vorrat: [],
    stueck: 0,
    radius: 0,
    kerne: [],
    stand: 0,
    uebersicht: false,
    kisten: [],
    kistenAnzahl: 0,
    suche: null,
    treffer: [],
    trefferAnzahl: 0,
    uebersichtStand: 0,
  };
}

/** What the blueprints of one part in the area still need. */
export interface BlueprintNeedSample {
  /** The part (= its item). */
  part: string;
  /** Blueprints of it waiting. */
  blueprints: number;
  /** Pieces at hand for them (bags and the chests near the first). */
  atHand: number;
  /** Pieces still missing. */
  missing: number;
}

/** The blueprints around the player for the build mode, filled by `GameSession.sampleBlueprintNeeds`. */
export interface BlueprintNeedsSample {
  /** Per part in id order; only the first `anzahl` records are valid. */
  readonly teile: BlueprintNeedSample[];
  anzahl: number;
  /** Counts every change of the records. */
  stand: number;
}

/** A fresh `BlueprintNeedsSample`. */
export function createBlueprintNeedsSample(): BlueprintNeedsSample {
  return { teile: [], anzahl: 0, stand: 0 };
}

/** What the sampler reads of a hearth: layer and footprint. */
type HearthLike = Readonly<{ layer: Layer; tx: number; ty: number; w: number; h: number }>;

/** Copies `from` into `to` (same length afterwards); returns whether anything changed. */
function copyList<T>(from: readonly T[], to: T[]): boolean {
  let changed = to.length !== from.length;
  to.length = from.length;
  for (let i = 0; i < from.length; i++) {
    const v = from[i] as T;
    if (to[i] !== v) {
      to[i] = v;
      changed = true;
    }
  }
  return changed;
}

function filled(slots: readonly (ItemStack | null)[]): number {
  let n = 0;
  for (const s of slots) if (s !== null) n++;
  return n;
}

/** The sampler of one simulation (systems are looked up on first use). */
export class BasisSampler {
  private systems: { readonly hearth: HearthSystem; readonly storage: StorageSystem | null; readonly player: PlayerSystem; readonly building: BuildingSystem; readonly source: BuildMaterialSource | null } | null | undefined = undefined;
  private readonly at = { x: 0, y: 0 };
  private readonly centre = { x: 0, y: 0 };
  private ticksPerGameHour = 0;
  private readonly fuelTicks = (item: string): number => hearthFuelTicks(item, this.ticksPerGameHour);
  /** The overview's chests and their distances [px] while sorting them (reused). */
  private readonly order: Readonly<Chest>[] = [];
  private readonly distances: number[] = [];
  /** Per sample record: the query and overview state its finds were searched for. */
  private readonly searched = new WeakMap<HearthSample, { query: ReadonlySet<string> | null; stand: number }>();

  constructor(private readonly sim: Simulation) {}

  private lookup(): NonNullable<BasisSampler['systems']> | null {
    if (this.systems === undefined) {
      const hearth = this.sim.system('hearth');
      const storage = this.sim.system('storage');
      const player = this.sim.system('player');
      const building = this.sim.system('building');
      const inventory = this.sim.system('inventory');
      if (!(hearth instanceof HearthSystem) || !(player instanceof PlayerSystem) || !(building instanceof BuildingSystem) || !(inventory instanceof InventorySystem)) {
        this.systems = null;
      } else {
        const chests = storage instanceof StorageSystem ? storage : null;
        this.systems = { hearth, storage: chests, player, building, source: chests === null ? null : blueprintMaterials({ inventory, storage: chests }) };
      }
    }
    return this.systems;
  }

  /** Fills `out` with hearth `id` (see `HearthSample`); returns `out.vorhanden`. */
  sampleHearth(id: number, out: HearthSample): boolean {
    const sys = this.lookup();
    const h = sys?.hearth.hearth(id);
    if (sys === null || h === undefined) {
      if (out.vorhanden) {
        out.stand++;
        out.uebersichtStand++;
      }
      out.vorhanden = false;
      out.uebersicht = false;
      out.kistenAnzahl = 0;
      out.trefferAnzahl = 0;
      return false;
    }
    const sim = this.sim;
    const tph = sim.clock.ticksPerGameHour;
    this.ticksPerGameHour = tph;
    const brennt = sys.hearth.burning(sim, h);
    const leftTicks = brennt ? Math.max(0, burnLeft(h, this.fuelTicks) - Math.max(0, sim.tick - h.bis)) : 0;
    const restMinuten = Math.ceil((leftTicks * MINUTES_PER_HOUR) / tph);
    // In hundredths: the glow changes every tick, the screen needs no more than its bar shows.
    const glut = h.voll > 0 ? Math.ceil((h.rest / h.voll) * GLUT_STUFEN) / GLUT_STUFEN : 0;
    const radius = radiusForCores(coreCount(h.kerne));
    const body = sys.player.body(sim);
    const near = body !== undefined && body.layer === h.layer && sim.player !== NULL_ENTITY && sys.player.position(sim, this.at) && this.distance(h, this.at.x, this.at.y) <= HEARTH_REACH_PX;
    let changed = !out.vorhanden || out.id !== id;
    if (out.inReichweite !== near || out.brennt !== brennt || out.restMinuten !== restMinuten || out.glut !== glut || out.radius !== radius) changed = true;
    out.vorhanden = true;
    out.id = id;
    out.inReichweite = near;
    out.brennt = brennt;
    out.restMinuten = restMinuten;
    out.glut = glut;
    out.radius = radius;
    if (copyList(h.vorrat, out.vorrat)) changed = true;
    out.stueck = storedPieces(h.vorrat);
    if (copyList(h.kerne, out.kerne)) changed = true;
    if (changed) out.stand++;
    this.overview(sys.storage, h, brennt, radius, out);
    return true;
  }

  /** The overview of the base of `h` into `out` (only while it burns). */
  private overview(storage: StorageSystem | null, h: HearthLike, brennt: boolean, radius: number, out: HearthSample): void {
    const shown = brennt && storage !== null;
    let changed = out.uebersicht !== shown;
    out.uebersicht = shown;
    let n = 0;
    if (shown) {
      hearthCentre(h, this.centre);
      const r = radius * TILE_PX;
      // The chests within the radius, nearest first, ties by id (the order of `StorageSystem.near`): insertion sort
      // into the reused scratch lists.
      for (const c of storage.chests) {
        if (c.layer !== h.layer) continue;
        const d = distanceToChest(c, this.centre.x, this.centre.y);
        if (d > r) continue;
        let i = n++;
        while (i > 0) {
          const prevD = this.distances[i - 1] as number;
          const prev = this.order[i - 1] as Readonly<Chest>;
          if (prevD < d || (prevD === d && prev.id < c.id)) break;
          this.distances[i] = prevD;
          this.order[i] = prev;
          i--;
        }
        this.distances[i] = d;
        this.order[i] = c;
      }
      for (let i = 0; i < n; i++) if (this.fillChest(out, i, this.order[i] as Readonly<Chest>, this.distances[i] as number)) changed = true;
    }
    if (n !== out.kistenAnzahl) changed = true;
    out.kistenAnzahl = n;
    if (changed) out.uebersichtStand++;
    this.search(storage, h, out);
  }

  /** Writes chest `c` into overview record `i`; returns whether the record changed. */
  private fillChest(out: HearthSample, i: number, c: Readonly<Chest>, d: number): boolean {
    let rec = out.kisten[i];
    if (rec === undefined) {
      rec = { id: 0, item: '', name: '', label: null, slots: [], belegt: 0, entfernung: 0 };
      out.kisten.push(rec);
    }
    const entfernung = Math.round(d / TILE_PX);
    let changed = rec.id !== c.id || rec.item !== c.item || rec.name !== c.name || rec.label !== c.label || rec.entfernung !== entfernung;
    rec.id = c.id;
    rec.item = c.item;
    rec.name = c.name;
    rec.label = c.label;
    rec.entfernung = entfernung;
    if (copyList(c.slots, rec.slots)) changed = true;
    rec.belegt = filled(c.slots);
    return changed;
  }

  /** The finds of `out.suche` in the base's chests (searched again only when the query or the overview changed). */
  private search(storage: StorageSystem | null, h: HearthLike, out: HearthSample): void {
    const query = out.uebersicht ? out.suche : null;
    const last = this.searched.get(out);
    if (last !== undefined && last.query === query && last.stand === out.uebersichtStand) return;
    let n = 0;
    if (query !== null && storage !== null && query.size > 0) {
      hearthCentre(h, this.centre);
      const tx = Math.floor(this.centre.x / TILE_PX);
      const ty = Math.floor(this.centre.y / TILE_PX);
      for (const f of storage.search(h.layer, tx, ty, (item) => query.has(item))) {
        let rec = out.treffer[n];
        if (rec === undefined) {
          rec = { kiste: 0, index: 0, stack: f.stack };
          out.treffer.push(rec);
        }
        rec.kiste = f.chest;
        rec.index = f.index;
        rec.stack = f.stack;
        n++;
      }
    }
    out.trefferAnzahl = n;
    out.uebersichtStand++;
    if (last === undefined) this.searched.set(out, { query, stand: out.uebersichtStand });
    else {
      last.query = query;
      last.stand = out.uebersichtStand;
    }
  }

  /** Fills `out` with the blueprints within `halfW` × `halfH` tiles of the player (see `BlueprintNeedsSample`); false without a player. */
  sampleBlueprintNeeds(halfW: number, halfH: number, out: BlueprintNeedsSample): boolean {
    const sys = this.lookup();
    const sim = this.sim;
    const body = sys?.player.body(sim);
    if (sys === null || sys.source === null || body === undefined || sim.player === NULL_ENTITY || !sys.player.position(sim, this.at)) {
      if (out.anzahl !== 0) out.stand++;
      out.anzahl = 0;
      return false;
    }
    const tx = Math.floor(this.at.x / TILE_PX);
    const ty = Math.floor(this.at.y / TILE_PX);
    const w = Math.max(0, Math.ceil(halfW));
    const h = Math.max(0, Math.ceil(halfH));
    const needs = blueprintNeeds(sim, sys.building, sys.source, body.layer, Math.max(0, tx - w), Math.max(0, ty - h), tx + w, ty + h);
    let changed = needs.length !== out.anzahl;
    for (let i = 0; i < needs.length; i++) {
      const need = needs[i];
      if (need === undefined) continue;
      let rec = out.teile[i];
      if (rec === undefined) {
        rec = { part: '', blueprints: 0, atHand: 0, missing: 0 };
        out.teile.push(rec);
      }
      if (rec.part !== need.part || rec.blueprints !== need.blueprints || rec.atHand !== need.atHand || rec.missing !== need.missing) changed = true;
      rec.part = need.part;
      rec.blueprints = need.blueprints;
      rec.atHand = need.atHand;
      rec.missing = need.missing;
    }
    out.anzahl = needs.length;
    if (changed) out.stand++;
    return true;
  }

  /** Distance from world px (x, y) to the footprint of `h` [px] (0 inside; the hearth system's reach rule). */
  private distance(h: HearthLike, x: number, y: number): number {
    const x0 = h.tx * TILE_PX;
    const y0 = h.ty * TILE_PX;
    const x1 = (h.tx + h.w) * TILE_PX;
    const y1 = (h.ty + h.h) * TILE_PX;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return Math.hypot(dx, dy);
  }
}
