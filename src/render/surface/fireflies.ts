/**
 * Fireflies (MASTERPROMPT §6.2 "Nacht: … Glühwürmchen", M5-23): on spring and summer nights they drift over the
 * meadows of the Grünhain and the Nebelmoor, a few per world cell, each on its own slow loop, pulsing on and off.
 * Everything is a function of the world cell and the presentation time – the same cell shows the same fireflies
 * whenever the camera returns, and a frozen screenshot is deterministic. They glow (emissive sprite
 * `gluehwuermchen`, bloom gives the halo) but light nothing: they are not light sources of the simulation (§12.1).
 * The firefly creatures of the simulation (content `gluehwuermchen`, M6-20) are the same insects one can watch and chase:
 * the drifting ones keep `creatureClearPx` clear of every creature in view, so a creature is never drawn over by a second
 * glow of the ambience.
 */
import { CREATURES_SYSTEM_ID, CreatureSystem } from '../../game/creatures/system';
import type { Simulation } from '../../game/sim';
import { BIOMES } from '../../content/biomes';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { SURFACE_PARAMS } from './params';
import { cellHash } from './rules';

const P = SURFACE_PARAMS.fireflies;
const SPRITE = 'gluehwuermchen';
/** The firefly creature (content `creatures`) the drifting fireflies keep clear of. */
const CREATURE = 'gluehwuermchen';
const TAU = Math.PI * 2;
/** Salts of the per-firefly choices. */
const SALT = { cell: 71, count: 72, x: 73, y: 74, phase: 75, blink: 76, speed: 77 } as const;
/** Blink phases (share of the period): rising, bright, falling; the rest is dark. */
const RISE = 0.08;
const FALL = 0.08;

/** What the fireflies need of the view. */
export interface FireflyView {
  readonly layer: number;
  readonly time: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Glow frame of a firefly at blink phase `phase` (0…1 of its period): 0 bright, 1 mid, 2 glimmer, 3 dark. */
export function blinkFrame(phase: number): number {
  const p = phase - Math.floor(phase);
  const lit = P.litShare;
  if (p < RISE) return 1;
  if (p < lit - FALL) return 0;
  if (p < lit) return 1;
  if (p < lit + FALL) return 2;
  return 3;
}

export class Fireflies {
  /** Fireflies drawn in the last frame. */
  drawn = 0;
  /** Share of the fireflies drawn (settings: reduced weather particles). */
  share = 1;
  private sprite: AtlasSprite | null = null;
  private manifestOf: AtlasData['manifest'] | null = null;
  private readonly frames: number[] = [0, 0, 0, 0];
  private biomeOk: Uint8Array | null = null;
  /** Firefly creatures in view this frame [px] (held arrays), and the creature system of the simulation they are read from. */
  private readonly swarmX = new Float64Array(P.creatureMax);
  private readonly swarmY = new Float64Array(P.creatureMax);
  private swarms = 0;
  private creaturesOf: { readonly sim: Simulation; readonly system: CreatureSystem | null } | null = null;
  private readonly at = { x: 0, y: 0 };

  /** Whether fireflies fly now: surface, night, a firefly season, no rain. */
  static active(sim: Simulation, layer: number, rain: number): boolean {
    const cal = sim.world.calendar;
    return layer === 0 && cal.daylight < P.daylightBelow && P.seasons.includes(cal.season) && rain <= 0;
  }

  private resolve(atlas: AtlasData): boolean {
    if (this.manifestOf === atlas.manifest) return this.sprite !== null;
    this.manifestOf = atlas.manifest;
    this.sprite = atlas.manifest.sprites[SPRITE] === undefined ? null : atlasSprite(atlas.manifest, SPRITE);
    const s = this.sprite;
    if (s !== null) (['hell', 'mittel', 'glimm', 'dunkel'] as const).forEach((clip, i) => (this.frames[i] = spriteClip(s, clip).frames[0] ?? 0));
    if (this.biomeOk === null) {
      const ids = contentWorldIdTables().biomes.ids();
      this.biomeOk = new Uint8Array(ids.length + 1);
      ids.forEach((id, i) => {
        if (P.biomes.includes(id) && BIOMES.some((b) => b.id === id)) (this.biomeOk as Uint8Array)[i + 1] = 1;
      });
    }
    return s !== null;
  }

  /** Pushes the fireflies of the cells in view (none unless `active`). */
  emit(scene: RenderScene, atlas: AtlasData, sim: Simulation, view: FireflyView, rain: number): void {
    this.drawn = 0;
    if (!Fireflies.active(sim, view.layer, rain) || !sim.world.materialized || !this.resolve(atlas)) return;
    const sprite = this.sprite as AtlasSprite;
    const biomeOk = this.biomeOk as Uint8Array;
    const cell = P.cellPx;
    const max = Math.floor(P.max * this.share);
    const cx0 = Math.floor(view.left / cell);
    const cx1 = Math.floor(view.right / cell);
    const cy0 = Math.floor(view.top / cell);
    const cy1 = Math.floor(view.bottom / cell);
    const t = view.time;
    const d = scene.sprite;
    this.collectSwarms(sim, view);
    const clear2 = P.creatureClearPx * P.creatureClearPx;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cellHash(cx, cy, SALT.cell) >= P.density) continue;
        const n = 1 + Math.floor(cellHash(cx, cy, SALT.count) * P.perCell);
        for (let k = 0; k < n; k++) {
          if (this.drawn >= max) return;
          const hx = cellHash(cx * 4 + k, cy, SALT.x);
          const hy = cellHash(cx * 4 + k, cy, SALT.y);
          const baseX = (cx + 0.15 + 0.7 * hx) * cell;
          const baseY = (cy + 0.15 + 0.7 * hy) * cell;
          if (!this.meadow(sim, baseX, baseY, biomeOk) || this.nearSwarm(baseX, baseY, clear2)) continue;
          const phase = cellHash(cx * 4 + k, cy, SALT.phase) * TAU;
          const speed = 0.7 + 0.6 * cellHash(cx * 4 + k, cy, SALT.speed);
          const w = (t / P.driftSeconds) * TAU * speed;
          const x = baseX + P.driftPx * Math.sin(w + phase);
          const y = baseY + P.driftPx * 0.6 * Math.sin(w * 1.37 + phase * 2);
          const h = P.heightPx + 3 * Math.sin(w * 0.8 + phase);
          const frame = blinkFrame(t / P.blinkSeconds + cellHash(cx * 4 + k, cy, SALT.blink));
          d.reset();
          d.frame = spriteFrame(sprite, this.frames[frame] ?? 0);
          d.x = x;
          d.y = y - h;
          d.depth = y;
          d.layer = 'objects';
          d.emissiveBoost = frame === 0 ? 1 : frame === 1 ? 0.5 : 0;
          scene.sprites.push(d);
          this.drawn++;
        }
      }
    }
  }

  /** Collects the firefly creatures on the view's layer within `creatureClearPx` of the view (at most `creatureMax`). */
  private collectSwarms(sim: Simulation, view: FireflyView): void {
    this.swarms = 0;
    let c = this.creaturesOf;
    if (c === null || c.sim !== sim) {
      const system = sim.systems.find((x) => x.id === CREATURES_SYSTEM_ID);
      c = { sim, system: system instanceof CreatureSystem ? system : null };
      this.creaturesOf = c;
    }
    const creatures = c.system;
    if (creatures === null) return;
    const store = creatures.store;
    const m = P.creatureClearPx;
    for (let i = 0; i < store.size && this.swarms < P.creatureMax; i++) {
      const s = store.valueAt(i);
      if (s.creature !== CREATURE || s.layer !== view.layer || s.health <= 0 || !creatures.positionOf(store.entityAt(i), this.at)) continue;
      const { x, y } = this.at;
      if (x < view.left - m || x > view.right + m || y < view.top - m || y > view.bottom + m) continue;
      this.swarmX[this.swarms] = x;
      this.swarmY[this.swarms] = y;
      this.swarms++;
    }
  }

  /** Whether world px (x, y) lies within √`clear2` of a firefly creature of this frame. */
  private nearSwarm(x: number, y: number, clear2: number): boolean {
    for (let i = 0; i < this.swarms; i++) {
      const dx = x - (this.swarmX[i] as number);
      const dy = y - (this.swarmY[i] as number);
      if (dx * dx + dy * dy < clear2) return true;
    }
    return false;
  }

  /** Whether world px (x, y) lies on dry land of a firefly biome. */
  private meadow(sim: Simulation, x: number, y: number, biomeOk: Uint8Array): boolean {
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const chunk = sim.world.chunks.get(0, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (chunk === undefined) return false;
    const i = (ty - chunk.cy * CHUNK_TILES) * CHUNK_TILES + (tx - chunk.cx * CHUNK_TILES);
    return biomeOk[chunk.biome[i] as number] === 1 && ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0;
  }
}
