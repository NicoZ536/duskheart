/**
 * Reading sample of the chest search for the presentation (MASTERPROMPT §16.7 "Suche über alle Kisten der Basis";
 * M4-21; docs/ARCHITEKTUR.md "Lesende Abtastungen der Sitzung", ADR-0010, ADR-0035). The chest screen searches the
 * base from any chest – not only from a burning hearth – and calls `GameSession.sampleChestSearch`, which fills a
 * record the caller owns through this sampler.
 *
 * - **The base** of an open chest is the one `StorageSystem.baseChests` searches around the chest's centre tile: the
 *   hearth zone covering it (lit or not, `HearthSystem.zoneAt` – the resolver the storage system uses), else, without a
 *   hearth, every chest within `BALANCE.storage.searchRadiusTiles` of that tile (the base radius of a hearth without
 *   ember cores, §16.5 "Radius 12 Tiles"). `herd`, `radius` and `kistenGesamt` say which and how many chests it holds.
 * - **Finds** (`suche`: the items the caller searches for, kept between calls): every stack of them in the base's
 *   chests (`StorageSystem.search`), grouped per chest – with name, icon label, the offset and distance of its centre
 *   from the open chest [tiles] and the slots of the finds –, nearest first (ties by id); the open chest itself is
 *   marked (`offen`, distance 0).
 * - `stand` counts every change of the fields above.
 *
 * Read-only: nothing here changes the simulation or builds the world. The base is searched again only when the query
 * or the open chest changed, a stack in a chest on its layer changed (compared by reference with a kept copy, without
 * allocating) or a world second passed (a hearth built, lit or given ember cores moves the base) – so a frame that
 * samples an unchanged base allocates nothing.
 */
import { BALANCE } from '../../content/balance';
import { DEFAULT_STEP_HZ } from '../../engine/loop';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { HearthSystem } from '../hearth/system';
import type { ItemStack } from '../items/stack';
import type { Simulation } from '../sim';
import { chestCentre } from '../storage/formulas';
import type { Chest } from '../storage/state';
import { StorageSystem, type StorageFind } from '../storage/system';

/** One stack a search found in a chest. */
export interface ChestFindSample {
  /** Slot of the chest. */
  index: number;
  /** The stack (the simulation's, by reference). */
  stack: ItemStack;
}

/** A chest of the base holding finds. */
export interface SearchChestSample {
  id: number;
  /** The container item (`kiste_holz`, `truhe`, `lagerregal`). */
  item: string;
  /** Name on the lid; empty = the item's name. */
  name: string;
  /** Item shown as the icon label, or `null`. */
  label: string | null;
  /** Offset of its centre from the open chest's centre [tiles, rounded; +x east, +y south]. */
  dx: number;
  dy: number;
  /** Distance of its centre from the open chest's centre [tiles, rounded]. */
  entfernung: number;
  /** Whether it is the open chest. */
  offen: boolean;
  /** The finds in its slots, in slot order; only the first `fundAnzahl` records are valid. */
  readonly funde: ChestFindSample[];
  fundAnzahl: number;
  /** Pieces found in it. */
  stueck: number;
}

/** The search over the base of an open chest, filled by `GameSession.sampleChestSearch` (see the module comment). */
export interface ChestSearchSample {
  /** Whether the asked chest exists (the rest keeps its last state otherwise). */
  vorhanden: boolean;
  /** Items to search for (the caller sets them; kept between calls); `null` or empty = no search. */
  suche: ReadonlySet<string> | null;
  /** Whether a hearth zone is the base (else the chests within `radius` of the open chest). */
  herd: boolean;
  /** Radius of the base [tiles]. */
  radius: number;
  /** Chests of the base (the open one included). */
  kistenGesamt: number;
  /** Chests with finds, nearest first; only the first `kistenAnzahl` records are valid. */
  readonly kisten: SearchChestSample[];
  kistenAnzahl: number;
  /** Counts every change of the fields above. */
  stand: number;
}

/** A fresh `ChestSearchSample`. */
export function createChestSearchSample(): ChestSearchSample {
  return { vorhanden: false, suche: null, herd: false, radius: 0, kistenGesamt: 0, kisten: [], kistenAnzahl: 0, stand: 0 };
}

/** What a record was last searched for, and the stacks of the chests it saw then (compared by reference). */
interface Searched {
  chest: number;
  query: ReadonlySet<string> | null;
  second: number;
  readonly ids: number[];
  readonly slots: (ItemStack | null)[];
}

function freshChest(): SearchChestSample {
  return { id: 0, item: '', name: '', label: null, dx: 0, dy: 0, entfernung: 0, offen: false, funde: [], fundAnzahl: 0, stueck: 0 };
}

/** The sampler of one simulation (the systems are looked up on first use). */
export class KistenSucheSampler {
  private systems: { readonly storage: StorageSystem; readonly hearth: HearthSystem | null } | null | undefined = undefined;
  private readonly centre = { x: 0, y: 0 };
  private readonly other = { x: 0, y: 0 };
  /** Per sample record: what it was searched for last. */
  private readonly searched = new WeakMap<ChestSearchSample, Searched>();

  constructor(private readonly sim: Simulation) {}

  private lookup(): NonNullable<KistenSucheSampler['systems']> | null {
    if (this.systems === undefined) {
      const storage = this.sim.system('storage');
      const hearth = this.sim.system('hearth');
      this.systems = storage instanceof StorageSystem ? { storage, hearth: hearth instanceof HearthSystem ? hearth : null } : null;
    }
    return this.systems;
  }

  /** Fills `out` with the search over the base of chest `id` (see `ChestSearchSample`); returns `out.vorhanden`. */
  sampleChestSearch(id: number, out: ChestSearchSample): boolean {
    const sys = this.lookup();
    const open = sys?.storage.chest(id);
    if (sys === null || open === undefined) {
      if (out.vorhanden || out.kistenAnzahl !== 0) out.stand++;
      out.vorhanden = false;
      out.kistenAnzahl = 0;
      return false;
    }
    const query = out.suche !== null && out.suche.size > 0 ? out.suche : null;
    const second = Math.floor(this.sim.tick / DEFAULT_STEP_HZ);
    let last = this.searched.get(out);
    if (last === undefined) {
      last = { chest: -1, query: null, second: -1, ids: [], slots: [] };
      this.searched.set(out, last);
    }
    const contents = this.contentsChanged(sys.storage.chests, open.layer, last);
    if (out.vorhanden && last.chest === id && last.query === query && last.second === second && !contents) return true;
    last.chest = id;
    last.query = query;
    last.second = second;
    let changed = !out.vorhanden;
    out.vorhanden = true;
    chestCentre(open, this.centre);
    const tx = Math.floor(this.centre.x / TILE_PX);
    const ty = Math.floor(this.centre.y / TILE_PX);
    const zone = sys.hearth?.zoneAt(this.sim, open.layer, tx, ty) ?? null;
    const herd = zone !== null;
    const radius = zone === null ? BALANCE.storage.searchRadiusTiles : Math.round(zone.radiusPx / TILE_PX);
    const gesamt = sys.storage.baseChests(open.layer, tx, ty).length;
    if (out.herd !== herd || out.radius !== radius || out.kistenGesamt !== gesamt) changed = true;
    out.herd = herd;
    out.radius = radius;
    out.kistenGesamt = gesamt;
    if (this.fillFinds(sys.storage, open, tx, ty, query, out)) changed = true;
    if (changed) out.stand++;
    return true;
  }

  /** The finds of `query` in the base around (tx, ty), grouped per chest and sorted; returns whether they changed. */
  private fillFinds(storage: StorageSystem, open: Readonly<Chest>, tx: number, ty: number, query: ReadonlySet<string> | null, out: ChestSearchSample): boolean {
    let changed = false;
    // Grouped per chest (the search lists a chest's slots together), then nearest first, ties by id.
    const groups: Array<{ readonly chest: Readonly<Chest>; readonly d: number; readonly finds: StorageFind[] }> = [];
    if (query !== null) {
      for (const f of storage.search(open.layer, tx, ty, (item) => query.has(item))) {
        let g = groups[groups.length - 1];
        if (g === undefined || g.chest.id !== f.chest) {
          const c = storage.chest(f.chest);
          if (c === undefined) continue;
          chestCentre(c, this.other);
          g = { chest: c, d: Math.hypot(this.other.x - this.centre.x, this.other.y - this.centre.y), finds: [] };
          groups.push(g);
        }
        g.finds.push(f);
      }
      groups.sort((a, b) => a.d - b.d || a.chest.id - b.chest.id);
    }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g === undefined) continue;
      let rec = out.kisten[i];
      if (rec === undefined) {
        rec = freshChest();
        out.kisten.push(rec);
      }
      if (this.fillChest(rec, g.chest, open)) changed = true;
      for (let k = 0; k < g.finds.length; k++) {
        const f = g.finds[k] as StorageFind;
        let find = rec.funde[k];
        if (find === undefined) {
          find = { index: f.index, stack: f.stack };
          rec.funde.push(find);
          changed = true;
        } else if (find.index !== f.index || find.stack !== f.stack) changed = true;
        find.index = f.index;
        find.stack = f.stack;
      }
      if (this.closeChest(rec, g.finds.length)) changed = true;
    }
    if (groups.length !== out.kistenAnzahl) changed = true;
    out.kistenAnzahl = groups.length;
    return changed;
  }

  /** Name, label and place of chest `c` into `rec`; returns whether they changed. */
  private fillChest(rec: SearchChestSample, c: Readonly<Chest>, open: Readonly<Chest>): boolean {
    chestCentre(c, this.other);
    const dx = Math.round((this.other.x - this.centre.x) / TILE_PX);
    const dy = Math.round((this.other.y - this.centre.y) / TILE_PX);
    const entfernung = Math.round(Math.hypot(this.other.x - this.centre.x, this.other.y - this.centre.y) / TILE_PX);
    const offen = c.id === open.id;
    const changed = rec.id !== c.id || rec.item !== c.item || rec.name !== c.name || rec.label !== c.label || rec.dx !== dx || rec.dy !== dy || rec.entfernung !== entfernung || rec.offen !== offen;
    rec.id = c.id;
    rec.item = c.item;
    rec.name = c.name;
    rec.label = c.label;
    rec.dx = dx;
    rec.dy = dy;
    rec.entfernung = entfernung;
    rec.offen = offen;
    return changed;
  }

  /** Ends the finds of `rec` after `k` of them (their count and pieces); returns whether they changed. */
  private closeChest(rec: SearchChestSample, k: number): boolean {
    let stueck = 0;
    for (let i = 0; i < k; i++) stueck += (rec.funde[i] as ChestFindSample).stack.count;
    const changed = rec.fundAnzahl !== k || rec.stueck !== stueck;
    rec.fundAnzahl = k;
    rec.stueck = stueck;
    return changed;
  }

  /** Whether any chest or stack on `layer` differs from what `last` saw (and remembers them); allocates nothing once grown. */
  private contentsChanged(chests: readonly Readonly<Chest>[], layer: Layer, last: Searched): boolean {
    let changed = false;
    let n = 0;
    let k = 0;
    for (const c of chests) {
      if (c.layer !== layer) continue;
      if (last.ids[n] !== c.id) {
        last.ids[n] = c.id;
        changed = true;
      }
      n++;
      for (const s of c.slots) {
        if (last.slots[k] !== s) {
          last.slots[k] = s;
          changed = true;
        }
        k++;
      }
    }
    if (last.ids.length !== n || last.slots.length !== k) changed = true;
    last.ids.length = n;
    last.slots.length = k;
    return changed;
  }
}
