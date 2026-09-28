/**
 * Reading samples of crafting, the stations and the chests for the presentation (MASTERPROMPT §15.1, §16.7, §26;
 * M4-07, M4-08, M4-21, M4-32; docs/ARCHITEKTUR.md "Lesende Abtastungen der Sitzung", ADR-0010, ADR-0035). The UI
 * never reads the simulation: the crafting menu (C), the station screen, the chest screen and the HUD's recipe
 * tracker call `GameSession.sampleCrafting` / `sampleStation` / `sampleChest`, which fill records the caller owns
 * through this sampler.
 *
 * - **Crafting** (`CraftingSample`): the visible recipes (a kept set, `sichtbarStand` counts its changes), the
 *   recipes pinned to the HUD's tracker (`craft.pin`, oldest first; `angeheftetStand` counts their changes),
 *   whether crafting takes from chests in reach, the queue with the progress of its first piece and why it
 *   waits, the Handwerk level (quality stars of the next piece, §13.1) – and, for what the caller asks
 *   (`frageItems`, `frageStationen`: the ingredients and stations of the recipes it shows; `frageWasser`: it shows
 *   a recipe that needs water), the usable pieces in the bags and together with the chests in reach, the best
 *   station of each asked kind at hand and whether open water is within reach (the crafting system's own check).
 * - **Station** (`StationSample`): a placed station – its kind, whether the player stands within reach, and for
 *   a processing station its input, fuel and output slots (the immutable stacks of the simulation, copied by
 *   reference), the batch in progress, the glow of its fuel and why it stands still; `stand` counts changes.
 * - **Chest** (`ChestSample`): a placed container – its item, name and icon label, its slots (by reference), the
 *   item categories it takes, whether the player stands within reach; `stand` counts changes. Without a storage
 *   system (tests of other systems) no chest exists.
 *
 * Read-only: nothing here changes the simulation or builds the world (the water check reads the tiles at the feet of
 * a player, whose chunks the active zone keeps resident). The records are reused; the chests in reach are looked up once
 * per sample for all asked items (`CraftingSystem.countAvailable`), not once per item – into kept lists since M5-40.
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX } from '../../world/model/coords';
import type { CraftRejectReason } from '../crafting/events';
import { CRAFT_SKILL, CraftingSystem } from '../crafting/system';
import type { ItemStack } from '../items/stack';
import { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import { SkillsSystem } from '../skills/system';
import { distanceToChest } from '../storage/formulas';
import { StorageSystem } from '../storage/system';
import { distanceToFootprint, footprintPx } from '../stations/formulas';
import type { StationStopReason } from '../stations/state';
import { StationSystem } from '../stations/system';

/** One order of the crafting queue as the UI shows it. */
export interface CraftOrderSample {
  rezept: string;
  /** Pieces still to make, the one being worked on included. */
  anzahl: number;
  /** Progress of the piece being worked on [0–1]; 0 before it began. */
  fortschritt: number;
  /** Station the current piece is worked at, or `null` (in the hand, or not begun). */
  station: string | null;
}

/** A station at hand for recipes of one station kind: which one and its quality points. */
export interface StationAtHandSample {
  station: string;
  qualitaet: number;
  tempo: number;
}

/** Crafting for the UI, filled by `GameSession.sampleCrafting` (see the module comment). */
export interface CraftingSample {
  /** Whether a player exists (without one the rest keeps its last state). */
  vorhanden: boolean;
  /** Visible recipe ids (kept and updated in place). */
  readonly sichtbar: Set<string>;
  /** Counts every change of `sichtbar`. */
  sichtbarStand: number;
  /** Pinned recipe ids, oldest first (kept and updated in place; `craft.pin`). */
  readonly angeheftet: string[];
  /** Counts every change of `angeheftet`. */
  angeheftetStand: number;
  /** Whether crafting takes from chests in reach (`craft.useChests`). */
  kisten: boolean;
  /** The queue, first = being worked on; only the first `auftragAnzahl` records are valid. */
  readonly auftraege: CraftOrderSample[];
  auftragAnzahl: number;
  /** Why the first order does not advance right now, or `null`. */
  blockiert: CraftRejectReason | null;
  /** Level of the Handwerk skill [1–100]. */
  handwerkStufe: number;
  /** Items to count (the caller sets them; kept between frames). */
  frageItems: readonly string[];
  /** Station kinds to look for (the caller sets them). */
  frageStationen: readonly string[];
  /** Whether to check for water in reach (the caller sets it: it shows a recipe with `umgebung: 'wasser'`). */
  frageWasser: boolean;
  /** Whether open fresh water lies within reach of the player's feet (valid after a sample that asked for it). */
  amWasser: boolean;
  /** Usable pieces of each asked item in the bags. */
  readonly imBeutel: Map<string, number>;
  /** Usable pieces of each asked item in the bags and the chests in reach (what crafting can take). */
  readonly verfuegbar: Map<string, number>;
  /** The best station at hand for each asked station kind, or `null`. */
  readonly stationen: Map<string, StationAtHandSample | null>;
}

/** A fresh `CraftingSample`. */
export function createCraftingSample(): CraftingSample {
  return {
    vorhanden: false,
    sichtbar: new Set(),
    sichtbarStand: 0,
    angeheftet: [],
    angeheftetStand: 0,
    kisten: true,
    auftraege: [],
    auftragAnzahl: 0,
    blockiert: null,
    handwerkStufe: 1,
    frageItems: [],
    frageStationen: [],
    frageWasser: false,
    amWasser: false,
    imBeutel: new Map(),
    verfuegbar: new Map(),
    stationen: new Map(),
  };
}

/** A placed station for the UI, filled by `GameSession.sampleStation`. */
export interface StationSample {
  /** Whether the asked station exists (the rest keeps its last state otherwise). */
  vorhanden: boolean;
  id: number;
  /** Station id (its item; an upgrade changes it). */
  station: string;
  /** Whether the player stands within reach of it (`BALANCE.stations.reachTiles`). */
  inReichweite: boolean;
  /** Whether it has slots (processing station). */
  verarbeitung: boolean;
  /** Input slots (the simulation's stacks, by reference). */
  readonly eingang: (ItemStack | null)[];
  brennstoff: ItemStack | null;
  readonly ausgang: (ItemStack | null)[];
  /** Recipe of the batch in progress, or `null`. */
  rezept: string | null;
  /** Progress of the batch [0–1]. */
  fortschritt: number;
  /** Glow left of the burning fuel piece [0–1]. */
  glut: number;
  laeuft: boolean;
  halt: StationStopReason | null;
  /** Counts every change of the fields above. */
  stand: number;
}

/** A fresh `StationSample`. */
export function createStationSample(): StationSample {
  return { vorhanden: false, id: 0, station: '', inReichweite: false, verarbeitung: false, eingang: [], brennstoff: null, ausgang: [], rezept: null, fortschritt: 0, glut: 0, laeuft: false, halt: null, stand: 0 };
}

/** A placed chest for the UI, filled by `GameSession.sampleChest`. */
export interface ChestSample {
  /** Whether the asked chest exists (the rest keeps its last state otherwise). */
  vorhanden: boolean;
  id: number;
  /** The container item (`kiste_holz`, `truhe`, `lagerregal`). */
  item: string;
  /** Name on the lid; empty = the item's name. */
  name: string;
  /** Item shown as the icon label, or `null`. */
  label: string | null;
  /** Its slots (the simulation's stacks, by reference). */
  readonly slots: (ItemStack | null)[];
  /** Item categories it takes, or `null` for every category (§16.7 "Lagerregal … nur Rohstoffe"). */
  nur: readonly string[] | null;
  /** Whether the player stands within reach of it (`BALANCE.storage.reachTiles`). */
  inReichweite: boolean;
  /** Counts every change of the fields above. */
  stand: number;
}

/** A fresh `ChestSample`. */
export function createChestSample(): ChestSample {
  return { vorhanden: false, id: 0, item: '', name: '', label: null, slots: [], nur: null, inReichweite: false, stand: 0 };
}

const STATION_REACH_PX = BALANCE.stations.reachTiles * TILE_PX;
const CHEST_REACH_PX = BALANCE.storage.reachTiles * TILE_PX;

/** Copies `from` into `to` (same length afterwards); returns whether anything changed. */
function copySlots(from: readonly (ItemStack | null)[], to: (ItemStack | null)[]): boolean {
  let changed = to.length !== from.length;
  to.length = from.length;
  for (let i = 0; i < from.length; i++) {
    const s = from[i] ?? null;
    if (to[i] !== s) {
      to[i] = s;
      changed = true;
    }
  }
  return changed;
}

/** The sampler of one simulation (the systems are looked up once). */
export class WerkstattSampler {
  private readonly craftingSystem: CraftingSystem;
  private readonly stations: StationSystem;
  private readonly player: PlayerSystem;
  private readonly skills: SkillsSystem | null;
  /** The storage system, looked up on the first chest sample (`undefined`: not yet). */
  private storage: StorageSystem | null | undefined = undefined;
  private readonly at = { x: 0, y: 0 };
  private readonly rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(private readonly sim: Simulation) {
    const crafting = sim.system('crafting');
    const stations = sim.system('stations');
    const player = sim.system('player');
    if (!(crafting instanceof CraftingSystem) || !(stations instanceof StationSystem) || !(player instanceof PlayerSystem)) {
      throw new Error('WerkstattSampler: the simulation has no crafting, station or player system');
    }
    this.craftingSystem = crafting;
    this.stations = stations;
    this.player = player;
    const skills = sim.system('skills');
    this.skills = skills instanceof SkillsSystem ? skills : null;
  }

  /** Fills `out` (see `CraftingSample`); returns `out.vorhanden`. */
  sampleCrafting(out: CraftingSample): boolean {
    const sim = this.sim;
    out.vorhanden = sim.player !== NULL_ENTITY && sim.ecs.alive(sim.player) && this.player.body(sim) !== undefined;
    const c = this.craftingSystem;
    // Visible recipes: the set only grows while playing; loading a save may replace it.
    let changed = false;
    let count = 0;
    for (const r of c.recipes.list) {
      const visible = c.isVisible(r.id);
      if (visible) count++;
      if (visible !== out.sichtbar.has(r.id)) changed = true;
    }
    if (changed || count !== out.sichtbar.size) {
      out.sichtbar.clear();
      for (const r of c.recipes.list) if (c.isVisible(r.id)) out.sichtbar.add(r.id);
      out.sichtbarStand++;
    }
    const pins = c.pinned;
    let pinsChanged = pins.length !== out.angeheftet.length;
    for (let i = 0; !pinsChanged && i < pins.length; i++) pinsChanged = pins[i] !== out.angeheftet[i];
    if (pinsChanged) {
      out.angeheftet.length = 0;
      out.angeheftet.push(...pins);
      out.angeheftetStand++;
    }
    out.kisten = c.usesChests;
    const orders = c.orders;
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o === undefined) continue;
      let rec = out.auftraege[i];
      if (rec === undefined) {
        rec = { rezept: '', anzahl: 0, fortschritt: 0, station: null };
        out.auftraege.push(rec);
      }
      rec.rezept = o.rezept;
      rec.anzahl = o.anzahl;
      rec.fortschritt = o.dauer === 0 ? 0 : o.fortschritt / o.dauer;
      rec.station = o.station ?? null;
    }
    out.auftragAnzahl = orders.length;
    out.blockiert = c.blocked;
    out.handwerkStufe = this.skills?.level(CRAFT_SKILL) ?? 1;
    if (!out.vorhanden) return false;
    c.countAvailable(sim, out.frageItems, out.imBeutel, out.verfuegbar);
    if (out.frageWasser) out.amWasser = c.waterInReach(sim);
    for (const station of out.frageStationen) {
      const s = c.stationAtHand(sim, station);
      const prev = out.stationen.get(station) ?? null;
      if (s === null) out.stationen.set(station, null);
      else if (prev === null) out.stationen.set(station, { station: s.station, qualitaet: s.qualitaet, tempo: s.tempo });
      else {
        prev.station = s.station;
        prev.qualitaet = s.qualitaet;
        prev.tempo = s.tempo;
      }
    }
    return true;
  }

  /** Fills `out` with the placed station `id` (see `StationSample`); returns `out.vorhanden`. */
  sampleStation(id: number, out: StationSample): boolean {
    const p = this.stations.station(id);
    if (p === undefined) {
      if (out.vorhanden) out.stand++;
      out.vorhanden = false;
      return false;
    }
    let changed = !out.vorhanden || out.id !== id || out.station !== p.station;
    out.vorhanden = true;
    out.id = id;
    out.station = p.station;
    const def = this.stations.stations.get(p.station);
    const size = p.groesse ?? def.groesse;
    const body = this.player.body(this.sim);
    const near = body !== undefined && body.layer === p.layer && this.player.position(this.sim, this.at) && distanceToFootprint(this.at.x, this.at.y, footprintPx(p, size.b, size.t, this.rect)) <= STATION_REACH_PX;
    if (near !== out.inReichweite) changed = true;
    out.inReichweite = near;
    const proc = p.proc;
    if (proc === null) {
      if (out.verarbeitung) changed = true;
      out.verarbeitung = false;
      out.eingang.length = 0;
      out.ausgang.length = 0;
      out.brennstoff = null;
      out.rezept = null;
      out.fortschritt = 0;
      out.glut = 0;
      out.laeuft = false;
      out.halt = null;
    } else {
      if (!out.verarbeitung) changed = true;
      out.verarbeitung = true;
      if (copySlots(proc.eingang, out.eingang)) changed = true;
      if (copySlots(proc.ausgang, out.ausgang)) changed = true;
      const fortschritt = proc.dauer === 0 ? 0 : proc.fortschritt / proc.dauer;
      const glut = proc.glutVoll === 0 ? 0 : proc.glut / proc.glutVoll;
      if (out.brennstoff !== proc.brennstoff || out.rezept !== proc.rezept || out.fortschritt !== fortschritt || out.glut !== glut || out.laeuft !== proc.laeuft || out.halt !== proc.halt) changed = true;
      out.brennstoff = proc.brennstoff;
      out.rezept = proc.rezept;
      out.fortschritt = fortschritt;
      out.glut = glut;
      out.laeuft = proc.laeuft;
      out.halt = proc.halt;
    }
    if (changed) out.stand++;
    return true;
  }

  /** Fills `out` with the chest `id` (see `ChestSample`); returns `out.vorhanden`. */
  sampleChest(id: number, out: ChestSample): boolean {
    if (this.storage === undefined) {
      const storage = this.sim.system('storage');
      this.storage = storage instanceof StorageSystem ? storage : null;
    }
    const c = this.storage?.chest(id);
    if (c === undefined || this.storage === null || this.storage === undefined) {
      if (out.vorhanden) out.stand++;
      out.vorhanden = false;
      return false;
    }
    let changed = !out.vorhanden || out.id !== id || out.item !== c.item || out.name !== c.name || out.label !== c.label;
    out.vorhanden = true;
    out.id = id;
    out.item = c.item;
    out.name = c.name;
    out.label = c.label;
    out.nur = this.storage.containerOf(c.item)?.only ?? null;
    if (copySlots(c.slots, out.slots)) changed = true;
    const body = this.player.body(this.sim);
    const near = body !== undefined && body.layer === c.layer && this.player.position(this.sim, this.at) && distanceToChest(c, this.at.x, this.at.y) <= CHEST_REACH_PX;
    if (near !== out.inReichweite) changed = true;
    out.inReichweite = near;
    if (changed) out.stand++;
    return true;
  }
}
