/**
 * Lightning strikes (MASTERPROMPT §10 "Blitze schlagen bevorzugt in hohe Objekte und Metall, können Bäume und Holzbauten
 * entzünden"; docs/SPIEL.md §18; M7-40). A strike at a point of the active zone seeks the best target within
 * `BALANCE.worldEvents.strikeSearchTiles`: metal (`metalObjects`) before tall things – a standing tree, a wall, pillar, gate
 * or fence of the build grid, a tall world object (`tallObjects`) –, the nearest of the best kind, the open ground when there
 * is nothing. A tree catches fire with `igniteTreeChance` (`igniteTreeChanceDry` during the forest fire), a wooden part with
 * `igniteWoodChance` – the fire system decides what burns (`FireSystem.ignite`, cause `blitz`); a player within
 * `playerHitTiles` is hurt (cause `blitz`). The world events system draws when and where (`hash(seed, 'blitz', region,
 * minute)`); allocation-free.
 */
import { BALANCE } from '../../content/balance';
import type { BuildLayer } from '../../content/buildParts';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { FireCause } from '../fire/events';
import type { ObjectHit } from '../gathering/system';
import { createObjectHit } from '../gathering/system';
import type { DamageCause } from '../survival/events';
import type { Simulation } from '../sim';
import type { LightningTarget } from './events';

const W = BALANCE.worldEvents;
const SURFACE: Layer = 0;
const METAL: ReadonlySet<string> = new Set(W.metalObjects);
const TALL: ReadonlySet<string> = new Set(W.tallObjects);
/** Build parts that stand up out of the grid and draw a bolt (the `struktur` layer). */
const TALL_PARTS: ReadonlySet<string> = new Set(['wand', 'saeule', 'tor', 'tuer', 'zaun', 'fenster']);
const STRUCTURE: BuildLayer = 'struktur';
const SCORE_METAL = 3;
const SCORE_TALL = 2;

/** What a strike reads and changes (the systems registered before the world events). */
export interface LightningDeps {
  readonly gathering: { standingTreeAt(layer: Layer, tx: number, ty: number, out: ObjectHit): boolean };
  readonly building: { partAt(layer: Layer, ebene: BuildLayer, tx: number, ty: number): { readonly kind: string } | undefined };
  readonly fire: { ignite(sim: Simulation, layer: Layer, tx: number, ty: number, cause: FireCause): boolean };
  readonly vitals: { damage(sim: Simulation, amount: number, cause: DamageCause): number };
  /** The world object id on surface tile (tx, ty) of a resident chunk, or null. */
  objectAt(sim: Simulation, tx: number, ty: number): string | null;
}

export class Lightning {
  private readonly hit = createObjectHit();
  private bestX = 0;
  private bestY = 0;
  private bestKind: LightningTarget = 'boden';

  constructor(private readonly deps: LightningDeps) {}

  /**
   * A bolt near surface tile (sx, sy): picks its target, sets it alight with draw `u` [0, 1) against the chance, hurts a
   * player (feet at `player` [px]) close by, and reports `lightningStruck`. `dry`: the forest fire runs.
   */
  strike(sim: Simulation, sx: number, sy: number, dry: boolean, u: number, player: { readonly x: number; readonly y: number }): void {
    this.target(sim, sx, sy);
    const tx = this.bestX;
    const ty = this.bestY;
    let lit = false;
    if (this.bestKind === 'baum') lit = u < (dry ? W.igniteTreeChanceDry : W.igniteTreeChance) && this.deps.fire.ignite(sim, SURFACE, tx, ty, 'blitz');
    else if (this.bestKind === 'bauteil') lit = u < W.igniteWoodChance && this.deps.fire.ignite(sim, SURFACE, tx, ty, 'blitz');
    const x = (tx + 0.5) * TILE_PX;
    const y = (ty + 0.5) * TILE_PX;
    const dx = player.x - x;
    const dy = player.y - y;
    const reach = W.playerHitTiles * TILE_PX;
    if (dx * dx + dy * dy <= reach * reach) this.deps.vitals.damage(sim, W.playerDamage, 'blitz');
    sim.events.push('lightningStruck', { layer: SURFACE, x, y, ziel: this.bestKind, entzuendet: lit, tick: sim.eventTick });
  }

  /** The target of a bolt at (sx, sy) into `bestX`, `bestY`, `bestKind`. */
  private target(sim: Simulation, sx: number, sy: number): void {
    const r = W.strikeSearchTiles;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    this.bestX = sx;
    this.bestY = sy;
    this.bestKind = 'boden';
    for (let ty = sy - r; ty <= sy + r; ty++) {
      for (let tx = sx - r; tx <= sx + r; tx++) {
        const d = (tx - sx) * (tx - sx) + (ty - sy) * (ty - sy);
        if (d > r * r) continue;
        let score = 0;
        let kind: LightningTarget = 'boden';
        const obj = this.deps.objectAt(sim, tx, ty);
        if (obj !== null && METAL.has(obj)) {
          score = SCORE_METAL;
          kind = 'metall';
        } else if (this.deps.gathering.standingTreeAt(SURFACE, tx, ty, this.hit)) {
          score = SCORE_TALL;
          kind = 'baum';
        } else if ((obj !== null && TALL.has(obj)) || TALL_PARTS.has(this.deps.building.partAt(SURFACE, STRUCTURE, tx, ty)?.kind ?? '')) {
          score = SCORE_TALL;
          kind = 'bauteil';
        }
        // The best kind, then the nearest; scanning row by row keeps ties in a fixed order.
        if (score > best || (score === best && score > 0 && d < bestD)) {
          best = score;
          bestD = d;
          this.bestX = tx;
          this.bestY = ty;
          this.bestKind = kind;
        }
      }
    }
  }
}
