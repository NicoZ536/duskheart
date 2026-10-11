/**
 * Samples of the vaults for the presentation (docs/SPIEL.md §19, §30 "C `src/render/game/vaults.ts` (Kisten, Hebel, Schalen,
 * Glocken, Türen, Fallen, verborgene Wände, Luftzug-Emitter)"; M7-11 … M7-14, strand C): the moving parts of the vaults that lie
 * in a rectangle of tiles on layer −1 – doors, levers, bowls, bells, cracked walls, crates and plates, the reset rune, the hint
 * steles, the key and shard pedestals and the traps – each with the state it shows now. Read-only: the vaults system is found
 * once, each vault's parts are listed once from its plan, and every frame writes whole numbers into a held record (no
 * allocation per frame; a puzzle's decoded state is recomputed only when its saved array changed, which the system replaces on
 * every move).
 */
import { CONTENT } from '../../content/index';
import type { PuzzleVariantDef, VaultTrapDef } from '../../content/dungeons/schema';
import type { VaultPlan } from '../../world/gen/vaults/types';
import type { Layer } from '../../world/model/coords';
import { kistenMap, puzzleCanonical, puzzleInit } from '../puzzles/index';
import type { Simulation } from '../sim';
import { trapBeatOffset, trapBeatTicks, trapRearmTicks, trapWarnTicks } from '../vaults/formulas';
import { TRAP_READY, TRAP_SPENT } from '../vaults/state';
import { VAULT_LAYER, VaultsSystem } from '../vaults/system';
import type { VaultState } from '../vaults/types';

/**
 * Kinds of a sampled part; the sprite is `gw_<name>` (`falle`: the trap's own sprite, `VaultTrapDef.sprite`):
 * - `tor_quer` / `tor_laengs`: a door across an east–west wall (its two tiles side by side) or a north–south wall (one above the
 *   other); `variant` its kind (`VAULT_DOOR_KINDS`), `state` 1 open.
 * - `hebel` (`state` 1 pulled down), `schale` (1 burning), `glocke` (no state – a strike is an event), `risswand` (0 whole,
 *   1 whole with a draft – a real one, 2 open), `kiste`, `platte` (1 pressed by a crate or the player), `ruecksetzer`,
 *   `hinweis` (`variant` its puzzle type, `VAULT_HINT_KINDS`; `state` 1 while its tune plays; `aux` the order digits),
 *   `sockel_schluessel`, `sockel_splitter` (1 empty).
 * - `falle`: `variant` the index into `VaultPartsSampler.trapDefs`, `aux` its direction (0 north … 3 west), `reach` its lane,
 *   `state` its phase (`TRAP_PHASE`), `ticks` the ticks in that phase (a blade: its place in the two-beat swing).
 */
export const VAULT_PART_KINDS = ['tor_quer', 'tor_laengs', 'hebel', 'schale', 'glocke', 'risswand', 'kiste', 'platte', 'ruecksetzer', 'hinweis', 'sockel_schluessel', 'sockel_splitter', 'falle'] as const;
export type VaultPartKind = (typeof VAULT_PART_KINDS)[number];
/** Index of each kind in `VAULT_PART_KINDS` (the sample's `kind` column). */
export const VAULT_PART = Object.fromEntries(VAULT_PART_KINDS.map((k, i) => [k, i])) as { readonly [K in VaultPartKind]: number };
/** A door's kind (`variant` of `tor_*`), the clip prefix of its sprite. */
export const VAULT_DOOR_KINDS = ['schloss', 'raetsel', 'verborgen'] as const;
/** A hint stele's puzzle (`variant` of `hinweis`), the clip of its sprite. */
export const VAULT_HINT_KINDS = ['hebel', 'schalen', 'glocken'] as const;
/** A trap's phase (`state` of `falle`). */
export const TRAP_PHASE = { ruhe: 0, warnung: 1, ausgeloest: 2, verbraucht: 3, takt: 4 } as const;
/** Bits per order digit of a hint stele (`aux`: digit i in bits 3i … 3i + 2, 0 = none). */
export const HINT_DIGIT_BITS = 3;

/** Parts a sample holds at most: two vaults' worth (a vault has at most ≈ 60 moving parts). */
export const VAULT_PARTS_MAX = 256;

/** The moving parts of the vaults in a rectangle (held; `fill` rewrites it every frame). */
export interface VaultPartsSample {
  /** Entries written. */
  count: number;
  /** The tick the sample was taken at. */
  tick: number;
  readonly kind: Uint8Array;
  readonly variant: Uint8Array;
  readonly state: Uint8Array;
  readonly tx: Int32Array;
  readonly ty: Int32Array;
  readonly aux: Int32Array;
  readonly reach: Uint8Array;
  readonly ticks: Int32Array;
}

/** A fresh, empty sample. */
export function createVaultPartsSample(): VaultPartsSample {
  return {
    count: 0,
    tick: 0,
    kind: new Uint8Array(VAULT_PARTS_MAX),
    variant: new Uint8Array(VAULT_PARTS_MAX),
    state: new Uint8Array(VAULT_PARTS_MAX),
    tx: new Int32Array(VAULT_PARTS_MAX),
    ty: new Int32Array(VAULT_PARTS_MAX),
    aux: new Int32Array(VAULT_PARTS_MAX),
    reach: new Uint8Array(VAULT_PARTS_MAX),
    ticks: new Int32Array(VAULT_PARTS_MAX),
  };
}

/** The parts of one vault as its plan places them (listed once). */
interface VaultParts {
  readonly plan: VaultPlan;
  readonly n: number;
  readonly kind: Uint8Array;
  readonly variant: Uint8Array;
  readonly tx: Int32Array;
  readonly ty: Int32Array;
  readonly aux: Int32Array;
  readonly reach: Uint8Array;
  /** What the state is read from: a door, puzzle, key or trap id; for a crate or a plate the puzzle. */
  readonly ref: Int32Array;
  /** A puzzle part's ordinal among its role (lever i, crate i); a plate's map cell. */
  readonly ord: Int32Array;
  readonly variants: readonly PuzzleVariantDef[];
  /** Per puzzle: the saved array last decoded, and its canonical state. */
  readonly seen: (readonly number[] | null)[];
  readonly canonical: (readonly number[])[];
  /** Per `kisten` puzzle the absolute tile of its map's corner, and its map's width. */
  readonly originX: Int32Array;
  readonly originY: Int32Array;
  readonly kistenW: Int32Array;
  /**
   * Per part (traps only) its tick counts, worked out once: the warning, the rearm, the beat of a blade (0 else) and the blade's
   * place in its swing. The frame then does whole-number work only – no seconds turned into ticks, no fraction that a function
   * not yet optimised would box (§30).
   */
  readonly warnTicks: Int32Array;
  readonly rearmTicks: Int32Array;
  readonly beatTicks: Int32Array;
  readonly beatOffset: Int32Array;
}

/** Finds the vaults system of a simulation once and samples its parts. */
export class VaultSampler {
  private system: VaultsSystem | null | undefined = undefined;
  private readonly parts = new Map<number, VaultParts>();
  private plans: readonly VaultPlan[] | null = null;
  /** The trap records in content order (`variant` of a `falle` entry). */
  readonly trapDefs: readonly VaultTrapDef[] = CONTENT.collection('vaultTraps').values();
  private readonly trapIndex = new Map<string, number>(this.trapDefs.map((d, i) => [d.id, i]));

  /** The vaults system, or null. */
  vaults(sim: Simulation): VaultsSystem | null {
    if (this.system === undefined) {
      const s = sim.systems.find((x) => x instanceof VaultsSystem);
      this.system = s instanceof VaultsSystem ? s : null;
    }
    return this.system;
  }

  /**
   * Fills `out` with the parts of every vault whose box meets the tile rectangle (left, top) … (right, bottom) on `layer`
   * (nothing off layer −1); (ptx, pty) is the player's tile (a plate under his feet is pressed). Returns `out`.
   */
  fill(sim: Simulation, layer: Layer, left: number, top: number, right: number, bottom: number, ptx: number, pty: number, out: VaultPartsSample): VaultPartsSample {
    out.count = 0;
    out.tick = sim.tick;
    const v = layer === VAULT_LAYER ? this.vaults(sim) : null;
    if (v === null) return out;
    if (this.plans === null) {
      const plans: VaultPlan[] = [];
      v.forEachVault((p) => plans.push(p));
      this.plans = plans;
    }
    const plans = this.plans;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i] as VaultPlan;
      const b = plan.box;
      if (b.x0 > right || b.y0 > bottom || b.x0 + b.w <= left || b.y0 + b.h <= top) continue;
      this.fillVault(v, this.partsOf(plan), sim.tick, left, top, right, bottom, ptx, pty, out);
    }
    return out;
  }

  private fillVault(v: VaultsSystem, p: VaultParts, tick: number, left: number, top: number, right: number, bottom: number, ptx: number, pty: number, out: VaultPartsSample): void {
    const s = v.state(p.plan.slot);
    for (let k = 0; k < p.n; k++) {
      if (out.count >= VAULT_PARTS_MAX) return;
      const kind = p.kind[k] as number;
      let tx = p.tx[k] as number;
      let ty = p.ty[k] as number;
      let state = 0;
      let ticks = 0;
      const ref = p.ref[k] as number;
      const ord = p.ord[k] as number;
      switch (kind) {
        case VAULT_PART.tor_quer:
        case VAULT_PART.tor_laengs:
          state = v.isDoorOpen(p.plan.slot, ref) ? 1 : 0;
          break;
        case VAULT_PART.hebel: {
          // Pulled: among the first `done` levers of the order.
          const c = this.puzzle(p, s, ref);
          const variant = p.variants[ref];
          if (variant !== undefined && variant.typ === 'hebel') state = stepOf(variant.folge, ord) < (c[0] ?? 0) ? 1 : 0;
          break;
        }
        case VAULT_PART.schale:
          state = ((this.puzzle(p, s, ref)[1] ?? 0) & (1 << ord)) !== 0 ? 1 : 0;
          break;
        case VAULT_PART.risswand: {
          const variant = p.variants[ref];
          if (((this.puzzle(p, s, ref)[0] ?? 0) & (1 << ord)) !== 0) state = 2;
          else if (variant !== undefined && variant.typ === 'verborgene_wand' && variant.echt.includes(ord)) state = 1;
          break;
        }
        case VAULT_PART.kiste: {
          const cell = this.puzzle(p, s, ref)[ord] ?? 0;
          const w = p.kistenW[ref] as number;
          if (w <= 0) continue;
          // Exact whole-number division (the remainder taken off first).
          const col = cell % w;
          tx = (p.originX[ref] as number) + col;
          ty = (p.originY[ref] as number) + (cell - col) / w;
          break;
        }
        case VAULT_PART.platte: {
          if (tx === ptx && ty === pty) state = 1;
          else if (this.puzzle(p, s, ref).includes(ord)) state = 1;
          break;
        }
        case VAULT_PART.hinweis:
          state = s !== undefined && s.hint.length === 2 && s.hint[0] === ref ? 1 : 0;
          break;
        case VAULT_PART.sockel_schluessel:
          state = v.keyTaken(p.plan.slot, ref) ? 1 : 0;
          break;
        case VAULT_PART.sockel_splitter:
          state = s?.shardTaken === true ? 1 : 0;
          break;
        case VAULT_PART.falle: {
          const beat = p.beatTicks[k] as number;
          if (beat > 0) {
            // A blade swings for good: its place in a two-beat swing, the strike when it passes the middle.
            state = TRAP_PHASE.takt;
            ticks = (tick + (p.beatOffset[k] as number)) % (2 * beat);
            break;
          }
          const armed = s?.trapArmedTick[ref] ?? TRAP_READY;
          const ready = s?.trapReadyTick[ref] ?? TRAP_READY;
          if (ready === TRAP_SPENT) {
            state = TRAP_PHASE.verbraucht;
          } else if (armed >= 0) {
            const warn = p.warnTicks[k] as number;
            state = TRAP_PHASE.warnung;
            ticks = tick - armed < warn ? tick - armed : warn;
          } else if (ready >= 0 && tick < ready) {
            state = TRAP_PHASE.ausgeloest;
            ticks = tick - (ready - (p.rearmTicks[k] as number));
          }
          break;
        }
        default:
          break;
      }
      // The parts reach a tile above their own (a door, a bell, a stele): the rectangle is the caller's, with its margin.
      if (tx < left || tx > right || ty < top || ty > bottom) continue;
      const i = out.count++;
      out.kind[i] = kind;
      out.variant[i] = p.variant[k] as number;
      out.state[i] = state;
      out.tx[i] = tx;
      out.ty[i] = ty;
      out.aux[i] = p.aux[k] as number;
      out.reach[i] = p.reach[k] as number;
      out.ticks[i] = ticks;
    }
  }

  /** The canonical state of puzzle `k` (recomputed only when the saved array changed). */
  private puzzle(p: VaultParts, s: Readonly<VaultState> | undefined, k: number): readonly number[] {
    const raw = s?.puzzles[k] ?? null;
    if (p.seen[k] !== raw) {
      const v = p.variants[k] as PuzzleVariantDef;
      p.seen[k] = raw;
      p.canonical[k] = raw === null ? puzzleInit(v) : puzzleCanonical(v, raw);
    }
    return p.canonical[k] as readonly number[];
  }

  /** The parts of a vault (listed once; the lookup apart from the listing, whose closures would allocate their context per call). */
  private partsOf(plan: VaultPlan): VaultParts {
    const cached = this.parts.get(plan.slot);
    return cached !== undefined && cached.plan === plan ? cached : this.listParts(plan);
  }

  private listParts(plan: VaultPlan): VaultParts {
    const variants = new Map(CONTENT.collection('puzzleTypes').values().flatMap((t) => t.varianten.map((v) => [v.id, v] as const)));
    const rows: { kind: number; variant: number; tx: number; ty: number; aux: number; reach: number; ref: number; ord: number }[] = [];
    const add = (kind: number, tx: number, ty: number, ref: number, extra: Partial<{ variant: number; aux: number; reach: number; ord: number }> = {}): void => {
      rows.push({ kind, tx, ty, ref, variant: extra.variant ?? 0, aux: extra.aux ?? 0, reach: extra.reach ?? 0, ord: extra.ord ?? 0 });
    };
    for (const d of plan.doors) add(d.vertical ? VAULT_PART.tor_laengs : VAULT_PART.tor_quer, d.tx, d.ty, d.id, { variant: VAULT_DOOR_KINDS.indexOf(d.kind) });
    const vs: PuzzleVariantDef[] = [];
    const originX = new Int32Array(plan.puzzles.length).fill(-1);
    const originY = new Int32Array(plan.puzzles.length).fill(-1);
    for (const pz of plan.puzzles) {
      const v = variants.get(pz.variant);
      if (v === undefined) throw new RangeError(`Vault ${plan.slot}: puzzle variant ${pz.variant} is not in the content`);
      vs.push(v);
      const ordinals = new Map<string, number>();
      for (const part of pz.parts) {
        const ord = ordinals.get(part.role) ?? 0;
        ordinals.set(part.role, ord + 1);
        switch (part.role) {
          case 'ursprung':
            originX[pz.id] = part.tx;
            originY[pz.id] = part.ty;
            break;
          case 'hebel':
          case 'schale':
          case 'glocke':
          case 'risswand':
          case 'ruecksetzer':
          case 'kiste':
            add(VAULT_PART[part.role], part.tx, part.ty, pz.id, { ord });
            break;
          case 'platte':
            add(VAULT_PART.platte, part.tx, part.ty, pz.id);
            break;
          case 'hinweis':
            add(VAULT_PART.hinweis, part.tx, part.ty, pz.id, { variant: hintKind(v), aux: hintDigits(v) });
            break;
        }
      }
    }
    // A plate's map cell (its crate reaches it in the puzzle's own cells).
    for (const r of rows) {
      if (r.kind !== VAULT_PART.platte) continue;
      const v = vs[r.ref];
      if (v === undefined || v.typ !== 'kisten') continue;
      r.ord = (r.ty - (originY[r.ref] as number)) * kistenMap(v).w + (r.tx - (originX[r.ref] as number));
    }
    plan.keys.forEach((k, i) => add(VAULT_PART.sockel_schluessel, k.tx, k.ty, i));
    if (plan.shard !== null) add(VAULT_PART.sockel_splitter, plan.shard.tx, plan.shard.ty, 0);
    for (const t of plan.traps) add(VAULT_PART.falle, t.tx, t.ty, t.id, { variant: this.trapIndex.get(t.type) ?? 0, aux: t.dir, reach: t.reach });
    const n = rows.length;
    const col = <T extends Uint8Array | Int32Array>(make: (n: number) => T, get: (r: (typeof rows)[number]) => number): T => {
      const a = make(n);
      rows.forEach((r, i) => (a[i] = get(r)));
      return a;
    };
    // Tick counts of the traps and the crate maps' widths, worked out here once (see `VaultParts.warnTicks`).
    const warnTicks = new Int32Array(n);
    const rearmTicks = new Int32Array(n);
    const beatTicks = new Int32Array(n);
    const beatOffset = new Int32Array(n);
    rows.forEach((r, i) => {
      if (r.kind !== VAULT_PART.falle) return;
      const def = this.trapDefs[r.variant];
      if (def === undefined) return;
      warnTicks[i] = trapWarnTicks(def);
      rearmTicks[i] = trapRearmTicks(def);
      if (def.ausloeser === 'takt') {
        const beat = trapBeatTicks(def);
        beatTicks[i] = beat;
        beatOffset[i] = trapBeatOffset(plan.slot, r.ref, beat);
      }
    });
    const kistenW = new Int32Array(plan.puzzles.length);
    vs.forEach((v, k) => {
      if (v.typ === 'kisten') kistenW[k] = kistenMap(v).w;
    });
    const parts: VaultParts = {
      plan,
      n,
      kind: col((m) => new Uint8Array(m), (r) => r.kind),
      variant: col((m) => new Uint8Array(m), (r) => r.variant),
      tx: col((m) => new Int32Array(m), (r) => r.tx),
      ty: col((m) => new Int32Array(m), (r) => r.ty),
      aux: col((m) => new Int32Array(m), (r) => r.aux),
      reach: col((m) => new Uint8Array(m), (r) => r.reach),
      ref: col((m) => new Int32Array(m), (r) => r.ref),
      ord: col((m) => new Int32Array(m), (r) => r.ord),
      variants: vs,
      seen: vs.map(() => null),
      canonical: vs.map((v) => puzzleInit(v)),
      originX,
      originY,
      kistenW,
      warnTicks,
      rearmTicks,
      beatTicks,
      beatOffset,
    };
    this.parts.set(plan.slot, parts);
    return parts;
  }
}

/** The step at which part `i` is used in `folge` (its length when never). */
function stepOf(folge: readonly number[], i: number): number {
  for (let k = 0; k < folge.length; k++) if (folge[k] === i) return k;
  return folge.length;
}

/** The hint stele's picture of a puzzle type. */
function hintKind(v: PuzzleVariantDef): number {
  return v.typ === 'feuerschalen' ? 1 : v.typ === 'glocken' ? 2 : 0;
}

/**
 * The order digits under a hint stele's picture (levers and bowls: part i shows the step it is used at, 1 … 5; bells show none –
 * their hint is the tune): digit i in bits 3i … 3i + 2, the number of parts in bits 15 … 17.
 */
function hintDigits(v: PuzzleVariantDef): number {
  if (v.typ !== 'hebel' && v.typ !== 'feuerschalen') return 0;
  const n = v.typ === 'hebel' ? v.hebel : v.schalen;
  let packed = n << (HINT_DIGIT_BITS * HINT_DIGITS_MAX);
  for (let i = 0; i < n; i++) {
    const step = stepOf(v.folge, i);
    if (step < v.folge.length) packed |= (step + 1) << (HINT_DIGIT_BITS * i);
  }
  return packed;
}
/** Digits a stele shows at most (the parts of a row). */
export const HINT_DIGITS_MAX = 5;
