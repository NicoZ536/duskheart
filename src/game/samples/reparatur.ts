/**
 * Reading sample of repair for the presentation (MASTERPROMPT §13.1 "Reparatur an Werkbank, Amboss oder Schleifstein
 * (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört."; M4-09; docs/ARCHITEKTUR.md "Lesende Abtastungen
 * der Sitzung", ADR-0010, ADR-0035). The UI never reads the simulation: the repair tab of the station screen calls
 * `GameSession.sampleRepair`, which fills a record the caller owns through this sampler.
 *
 * - **Worn pieces** (`RepairPieceSample`): every piece with durability below the full durability of its quality that
 *   the player carries or wears, in the order of `REPAIR_AREAS` (the hotbar with the hand first, then the equipment,
 *   the inventory, the backpack compartment, the belt, the backpack slot) – its slot, the stack (the simulation's
 *   immutable stack, by reference) and its full durability.
 * - **Here** (`hier`): whether the placed station asked for mends it – its `reparatur` names the piece's category and a
 *   tier at least the piece's (the rule `StationSystem.repairStationAtHand` applies to every station in reach).
 * - **What `repair.item` would do now** (`RepairSystem.quote`): the station in reach that mends it (the best stage) and
 *   the material costs, each with the usable pieces at hand – in the bags and, while crafting takes from chests, in the
 *   chests in reach (`CraftingSystem.available`, where the repair takes them from) –, or why it cannot be mended now
 *   (`grund`: no station in reach, not repairable …).
 * - `stand` counts every change of the records.
 *
 * Read-only: nothing here changes the simulation or builds the world. The records are reused (§30 "Keine Allokationen in
 * Hot-Loops", M5-40): the quote of each piece is written into kept records (`RepairSystem.quoteInto`), and what is at
 * hand is counted once per sample for every material of every quote (`CraftingSystem.countAvailable` into kept maps),
 * not once per material and piece, with the chests in reach looked up into kept lists. Once the records reached their
 * largest size a sample allocates nothing (tests/unit/ui/reparatur-sitzung.test.ts); the screen samples ≈ 10×/s.
 */
import { NULL_ENTITY } from '../../engine/ecs';
import { CraftingSystem } from '../crafting/system';
import { InventorySystem } from '../inventory/system';
import type { BagArea } from '../items/slots';
import type { ItemStack } from '../items/stack';
import { PlayerSystem } from '../player/system';
import type { RepairRejectReason } from '../repair/events';
import { fullDurability, type RepairCostRecord } from '../repair/formulas';
import { createRepairQuoteRecord, RepairSystem } from '../repair/system';
import type { Simulation } from '../sim';
import { StationSystem } from '../stations/system';

/** Bag areas searched for worn pieces, in the order the repair tab lists them (every area of `BAG_AREAS`). */
export const REPAIR_AREAS = ['schnellleiste', 'ausruestung', 'inventar', 'rucksackfach', 'guertel', 'rucksack'] as const satisfies readonly BagArea[];

/** One material cost of mending a piece, with what is at hand. */
export interface RepairCostSample {
  /** The ingredient: an item id or an ingredient group id. */
  key: string;
  /** Items that pay it (a group: its members). */
  items: readonly string[];
  /** Pieces the repair takes. */
  anzahl: number;
  /** Usable pieces of all `items` at hand (bags and, while crafting takes from chests, the chests in reach). */
  vorhanden: number;
}

/** A worn piece the player carries or wears. */
export interface RepairPieceSample {
  bereich: BagArea;
  index: number;
  /** The stack in the slot (the simulation's, by reference). */
  stack: ItemStack;
  /** Full durability of its quality [uses]. */
  voll: number;
  /** Whether the asked station mends it (its category and tier). */
  hier: boolean;
  /** The station in reach `repair.item` would mend it at now, or `null` (then `grund` says why). */
  station: string | null;
  /** Why `repair.item` would refuse it now, apart from missing materials; `null` when it can be quoted. */
  grund: RepairRejectReason | null;
  /** The material costs of the quote; only the first `kostenAnzahl` records are valid. */
  readonly kosten: RepairCostSample[];
  kostenAnzahl: number;
}

/** The worn pieces of the player for the repair tab of a station, filled by `GameSession.sampleRepair`. */
export interface RepairSample {
  /** Whether the asked station and the player exist (the rest keeps its last state otherwise). */
  vorhanden: boolean;
  /** The asked station's id (its item). */
  station: string;
  /** Worn pieces; only the first `anzahl` records are valid. */
  readonly stuecke: RepairPieceSample[];
  anzahl: number;
  /** Counts every change of the fields above. */
  stand: number;
}

/** A fresh `RepairSample`. */
export function createRepairSample(): RepairSample {
  return { vorhanden: false, station: '', stuecke: [], anzahl: 0, stand: 0 };
}

function freshPiece(stack: ItemStack): RepairPieceSample {
  return { bereich: 'inventar', index: 0, stack, voll: 0, hier: false, station: null, grund: null, kosten: [], kostenAnzahl: 0 };
}

/** The sampler of one simulation (the systems are looked up once). */
export class ReparaturSampler {
  private readonly repair: RepairSystem;
  private readonly stations: StationSystem;
  private readonly inventory: InventorySystem;
  private readonly crafting: CraftingSystem;
  private readonly player: PlayerSystem;
  /** The slot being quoted (one kept address). */
  private readonly slot: { bereich: BagArea; index: number } = { bereich: 'inventar', index: 0 };
  /** The quote of the piece being sampled. */
  private readonly quoteRec = createRepairQuoteRecord();
  /** Every item that pays a material of this sample's quotes, each once; only the first `frageAnzahl` are valid. */
  private readonly frage: string[] = [];
  private frageAnzahl = 0;
  /** The asked items of this sample (the valid part of `frage`, rebuilt only when it changes). */
  private frageListe: readonly string[] = [];
  /** Usable pieces of each asked item in the bags, and together with the chests in reach (`countAvailable`). */
  private readonly imBeutel = new Map<string, number>();
  private readonly verfuegbar = new Map<string, number>();

  constructor(private readonly sim: Simulation) {
    const repair = sim.system('repair');
    const stations = sim.system('stations');
    const inventory = sim.system('inventory');
    const crafting = sim.system('crafting');
    const player = sim.system('player');
    if (
      !(repair instanceof RepairSystem) ||
      !(stations instanceof StationSystem) ||
      !(inventory instanceof InventorySystem) ||
      !(crafting instanceof CraftingSystem) ||
      !(player instanceof PlayerSystem)
    ) {
      throw new Error('ReparaturSampler: the simulation has no repair, station, inventory, crafting or player system');
    }
    this.repair = repair;
    this.stations = stations;
    this.inventory = inventory;
    this.crafting = crafting;
    this.player = player;
  }

  /** Fills `out` with the worn pieces of the player for placed station `id` (see `RepairSample`); returns `out.vorhanden`. */
  sampleRepair(id: number, out: RepairSample): boolean {
    const sim = this.sim;
    const placed = this.stations.station(id);
    const present = placed !== undefined && sim.player !== NULL_ENTITY && sim.ecs.alive(sim.player) && this.player.body(sim) !== undefined;
    if (placed === undefined || !present) {
      if (out.vorhanden || out.anzahl !== 0) out.stand++;
      out.vorhanden = false;
      out.anzahl = 0;
      return false;
    }
    let changed = !out.vorhanden || out.station !== placed.station;
    out.vorhanden = true;
    out.station = placed.station;
    const rule = this.stations.stations.get(placed.station).reparatur;
    const catalog = this.crafting.recipes.catalog;
    const bags = this.inventory.state;
    let n = 0;
    this.frageAnzahl = 0;
    for (const bereich of REPAIR_AREAS) {
      const area = bags[bereich];
      for (let index = 0; index < area.length; index++) {
        const stack = area[index] ?? null;
        if (stack === null || stack.haltbarkeit === undefined) continue;
        const def = catalog.get(stack.item);
        // Worn (`wornShare` > 0) in whole uses: no fraction per slot.
        const voll = fullDurability(def, stack);
        if (stack.haltbarkeit >= voll) continue;
        let rec = out.stuecke[n];
        if (rec === undefined) {
          rec = freshPiece(stack);
          out.stuecke.push(rec);
        }
        n++;
        const hier = rule !== undefined && rule.bisStufe >= def.stufe && (rule.kategorien as readonly string[]).includes(def.kategorie);
        if (rec.bereich !== bereich || rec.index !== index || rec.stack !== stack || rec.voll !== voll || rec.hier !== hier) changed = true;
        rec.bereich = bereich;
        rec.index = index;
        rec.stack = stack;
        rec.voll = voll;
        rec.hier = hier;
        if (this.quote(rec)) changed = true;
      }
    }
    if (n !== out.anzahl) changed = true;
    out.anzahl = n;
    if (this.frageAnzahl > 0 && this.countAtHand(out)) changed = true;
    if (changed) out.stand++;
    return true;
  }

  /**
   * The quote of `rec`'s slot into `rec` (station, refusal, the costs without what is at hand – `countAtHand` counts that
   * for every piece at once); returns whether it changed. The items that pay the costs join the asked items.
   */
  private quote(rec: RepairPieceSample): boolean {
    const slot = this.slot;
    slot.bereich = rec.bereich;
    slot.index = rec.index;
    const q = this.quoteRec;
    const reason = this.repair.quoteInto(this.sim, slot, q);
    let changed = false;
    if (reason !== null) {
      if (rec.grund !== reason || rec.station !== null || rec.kostenAnzahl !== 0) changed = true;
      rec.grund = reason;
      rec.station = null;
      rec.kostenAnzahl = 0;
      return changed;
    }
    if (rec.grund !== null || rec.station !== q.station || rec.kostenAnzahl !== q.count) changed = true;
    rec.grund = null;
    rec.station = q.station;
    for (let i = 0; i < q.count; i++) {
      const c = q.costs[i] as RepairCostRecord;
      for (let j = 0; j < c.items.length; j++) this.ask(c.items[j] as string);
      let k = rec.kosten[i];
      if (k === undefined) {
        k = { key: c.key, items: c.items, anzahl: c.anzahl, vorhanden: 0 };
        rec.kosten.push(k);
        changed = true;
        continue;
      }
      if (k.key !== c.key || k.anzahl !== c.anzahl || !sameItems(k.items, c.items)) changed = true;
      k.key = c.key;
      k.items = c.items;
      k.anzahl = c.anzahl;
    }
    rec.kostenAnzahl = q.count;
    return changed;
  }

  /** Adds `item` to the asked items of this sample (once). */
  private ask(item: string): void {
    const frage = this.frage;
    for (let i = 0; i < this.frageAnzahl; i++) if (frage[i] === item) return;
    if (this.frageAnzahl < frage.length) frage[this.frageAnzahl] = item;
    else frage.push(item);
    this.frageAnzahl++;
  }

  /**
   * Counts every asked item at hand with one look at the chests (`CraftingSystem.countAvailable`) and writes each cost's
   * pieces at hand; returns whether one changed.
   */
  private countAtHand(out: RepairSample): boolean {
    const liste = this.frageListe;
    let same = liste.length === this.frageAnzahl;
    for (let i = 0; same && i < liste.length; i++) same = liste[i] === this.frage[i];
    if (!same) this.frageListe = this.frage.slice(0, this.frageAnzahl);
    this.crafting.countAvailable(this.sim, this.frageListe, this.imBeutel, this.verfuegbar);
    let changed = false;
    for (let p = 0; p < out.anzahl; p++) {
      const rec = out.stuecke[p] as RepairPieceSample;
      for (let i = 0; i < rec.kostenAnzahl; i++) {
        const k = rec.kosten[i] as RepairCostSample;
        let vorhanden = 0;
        for (let j = 0; j < k.items.length; j++) vorhanden += this.verfuegbar.get(k.items[j] as string) ?? 0;
        if (k.vorhanden !== vorhanden) changed = true;
        k.vorhanden = vorhanden;
      }
    }
    return changed;
  }
}

/** Whether two item lists name the same items in the same order. */
function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
