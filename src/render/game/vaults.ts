/**
 * The moving parts of the vaults in the game view (docs/SPIEL.md §19, §30 "C `src/render/game/vaults.ts` (Kisten, Hebel,
 * Schalen, Glocken, Türen, Fallen, verborgene Wände, Luftzug-Emitter)"; M7-11 … M7-14, strand C). The rooms, their walls, decor,
 * chests and tablets are terrain and objects of layer −1 (the generator stamps them); what the vault's state changes is drawn
 * here from `GameSession.sampleVaultParts` (src/game/samples/gewoelbe.ts), y-sorted with the figures:
 *
 * - **Doors** `gw_tor_quer` (across an east–west wall, over its two tiles) and `gw_tor_laengs` (in a north–south wall): the clip
 *   of their kind, closed or `_offen` (a lock's bronze grille, a puzzle's rune slab sunk into the floor, a hidden wall's rubble).
 * - **Puzzle parts**: levers up or pulled, bowls cold or burning (sparks `gewoelbe_schale`), bells – struck for a moment when a
 *   `puzzleStep` rang them –, cracked walls (a real one breathes dust `gewoelbe_luftzug` through its crack: the hint by
 *   torchlight), crates on their map cells, plates pressed by a crate or the player, the reset rune, the hint stele with the
 *   order digits `gw_hinweis_zahl` under its picture (glowing while its tune plays).
 * - **Pedestals** of the keys and the ember shard, full or empty.
 * - **Traps** (danger language §4.6, docs/ART.md §7): the warning clip from the first warning tick, then the strike – spears
 *   up for `STAB_SECONDS`, a dart flying down the lane, the boulder rolling down it and resting at its end until it is set back,
 *   the pit open while it cools down; a collapsed floor is a world object (nothing here); a blade swings for good, as a pure
 *   function of the tick, over its groove `gw_falle_pendel_rille` – sideways across a north–south lane, towards and away from
 *   the camera across an east–west one.
 * The interaction's use target carries the outline. Allocates nothing per frame: sprites and clips are looked up once per atlas,
 * the sample is a held record, struck bells sit in a fixed ring.
 */
import { BALANCE } from '../../content/balance';
import type { VaultTrapDef } from '../../content/dungeons/schema';
import { HINT_DIGIT_BITS, HINT_DIGITS_MAX, TRAP_PHASE, VAULT_DOOR_KINDS, VAULT_HINT_KINDS, VAULT_PART, VAULT_PART_KINDS, createVaultPartsSample, type VaultPartsSample } from '../../game/samples/gewoelbe';
import type { GameSession } from '../../game/session';
import { DIR_DX, DIR_DY, trapBeatTicks, trapWarnTicks } from '../../game/vaults/formulas';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { AnimationClip } from '../anim/animation';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { particleEmitter } from '../particles/tables';
import type { RenderScene } from '../scene';

const TICK_HZ = BALANCE.time.tickHz;
/** A part's foot below its tile's top edge [px]: on the tile's last pixel row, like the world's objects. */
const FOOT_PX = TILE_PX - 1;
/** Tiles beyond the view in which parts are still sampled: a door or a stele reaches two tiles up, a boulder rolls in. */
const VIEW_MARGIN_TILES = 3;
/** How long the spears stand after a spear trap struck [s]: long enough to see what hit, short of its cooldown (2.5 s). */
const STAB_SECONDS = 0.4;
/** Flight of a dart [px/s]: 30 tiles a second – the strike is instant (src/game/vaults/system.ts), the dart shows its lane. */
const DART_PX_PER_SECOND = 30 * TILE_PX;
/** The dart flies at the thrower's mouth height [px above the floor]. */
const DART_HEIGHT_PX = 9;
/** A boulder rolls down its lane at 16 tiles a second (its whole lane of ≤ 8 tiles in half a second, as it strikes). */
const ROLL_PX_PER_SECOND = 16 * TILE_PX;
/** How long a struck bell shows its glowing rune [s]: the tone's ring. */
const BELL_RING_SECONDS = 0.45;
/** Struck bells remembered at once (a puzzle has five bells at most; two puzzles in view). */
const BELL_RING_SLOTS = 8;
/** Emission of a warning trap's runes and eyes [0–1]: the danger reads in a dark vault (§4.6). */
const WARN_GLOW = 0.6;
/** Emission of a burning bowl and a playing stele. */
const FIRE_GLOW = 0.35;
/** Height of a bowl's flame above its foot [px] (assets-src/sprites/gewoelbe/teile.ts `gw_schale`: rim at row 8, anchor row 22). */
const BOWL_FLAME_PX = 14;
/** Height of the crack's dust above a cracked wall's foot [px] (its crack runs over rows 4 … 14 of 20, anchor row 19). */
const CRACK_DUST_PX = 8;
/** The order digits on a stele: their row above its foot [px] (the recessed panel, rows 14 … 18, anchor row 26) and spacing. */
const DIGIT_LIFT_PX = 10;
const DIGIT_STEP_PX = 4;
/** Swing of a blade across an east–west lane, towards and away from the camera [px of screen y at full swing]. */
const BLADE_DEPTH_SWING_PX = 14;
/** Stable numbers of the vaults' particle sources: "GW" in the high half, the tile in the low (unique within a view). */
const PARTICLE_ID_BASE = 0x47570000;
const PARTICLE_TILE_MASK = 0xff;
const PARTICLE_ROW_SHIFT = 8;
/** Frame of the blade hanging straight (`gw_falle_pendel`, clip `schwung`: five deflections, left to right). */
const BLADE_FRAMES = 5;
const BLADE_STRAIGHT = 2;

/** What the vault view reads of the session. */
export type VaultSession = Pick<GameSession, 'sampleVaultParts' | 'vaultTrapDefs' | 'onEvent'>;

/** Whether `session` offers the vault samples (a test session may not). */
export function isVaultSession(session: Partial<VaultSession>): session is VaultSession {
  return session.sampleVaultParts !== undefined && session.vaultTrapDefs !== undefined && session.onEvent !== undefined;
}

/** What the vault view needs of the game view's frame. */
export interface VaultFrame {
  layer: Layer;
  /** The pushed rectangle's tiles. */
  tileLeft: number;
  tileTop: number;
  tileRight: number;
  tileBottom: number;
  /** Presentation time [s] and the simulation's tick. */
  time: number;
  tick: number;
  /** The player's tile on `layer` (a plate under his feet is pressed); −1 none. */
  playerTx: number;
  playerTy: number;
  /** Tile of the interaction's use target on `layer` (−1 none). */
  focusTx: number;
  focusTy: number;
}

/** First value of the frame's fractional field: a double from the start (`DOUBLE_FIELD`, src/render/batch/spriteList.ts). */
const DOUBLE_FIELD = Number.NaN;

/** A fresh frame record. */
export function createVaultFrame(): VaultFrame {
  const f: VaultFrame = { layer: 0, tileLeft: 0, tileTop: 0, tileRight: 0, tileBottom: 0, time: DOUBLE_FIELD, tick: 0, playerTx: -1, playerTy: -1, focusTx: -1, focusTy: -1 };
  f.time = 0;
  return f;
}

/** A sprite and the first frame of each of its clips (by clip name). */
interface Bound {
  readonly sprite: AtlasSprite;
  readonly clips: Readonly<Record<string, AnimationClip>>;
}

/** Counts of the last frame (tests, debug overlay). */
export interface VaultViewStats {
  parts: number;
  traps: number;
  emitters: number;
}

export class VaultView {
  private manifest: AtlasManifest | null = null;
  /** Sprites by part kind (`gw_<kind>`); traps by trap index. */
  private readonly parts: (Bound | null)[] = new Array<Bound | null>(VAULT_PART_KINDS.length).fill(null);
  private traps: (Bound | null)[] = [];
  private trapDefs: readonly VaultTrapDef[] = [];
  private digit: Bound | null = null;
  private dart: Bound | null = null;
  private dartUp: Bound | null = null;
  private groove: Bound | null = null;
  private readonly sample: VaultPartsSample = createVaultPartsSample();
  private presets: { draft: number; bowl: number } | null = null;
  /** Bells struck lately: tile and tick, a ring. */
  private readonly bellTx = new Int32Array(BELL_RING_SLOTS).fill(-1);
  private readonly bellTy = new Int32Array(BELL_RING_SLOTS).fill(-1);
  private readonly bellTick = new Int32Array(BELL_RING_SLOTS).fill(-1);
  private bellNext = 0;
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void) | null = null;
  readonly stats: VaultViewStats = { parts: 0, traps: 0, emitters: 0 };

  private bind(manifest: AtlasManifest, defs: readonly VaultTrapDef[]): void {
    this.manifest = manifest;
    const get = (id: string): Bound | null => {
      const s = manifest.sprites[id];
      return s === undefined ? null : { sprite: s, clips: s.clips };
    };
    VAULT_PART_KINDS.forEach((k, i) => (this.parts[i] = k === 'falle' ? null : get(`gw_${k}`)));
    this.trapDefs = defs;
    this.traps = defs.map((d) => get(d.sprite));
    this.digit = get('gw_hinweis_zahl');
    this.dart = get('gw_falle_pfeil');
    this.dartUp = get('gw_falle_pfeil_senkrecht');
    this.groove = get('gw_falle_pendel_rille');
  }

  /**
   * Follows the session's bells (a struck bell glows for a moment). The listener's closure lives in `subscribe`: the check that
   * runs every frame allocates nothing (§30).
   */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed !== session) this.subscribe(session);
  }

  private subscribe(session: Pick<GameSession, 'onEvent'>): void {
    this.unsubscribe?.();
    this.subscribed = session;
    this.unsubscribe = session.onEvent('puzzleStep', (e) => {
      if (e.typ === 'glocken') this.ring(e.tx, e.ty, e.tick);
    });
  }

  private ring(tx: number, ty: number, tick: number): void {
    const i = this.bellNext;
    this.bellTx[i] = tx;
    this.bellTy[i] = ty;
    this.bellTick[i] = tick;
    this.bellNext = (i + 1) % BELL_RING_SLOTS;
  }

  /** Whether the bell on (tx, ty) was struck within `BELL_RING_SECONDS` before `tick`. */
  private ringing(tx: number, ty: number, tick: number): boolean {
    const window = BELL_RING_SECONDS * TICK_HZ;
    for (let i = 0; i < BELL_RING_SLOTS; i++) {
      if (this.bellTx[i] === tx && this.bellTy[i] === ty && tick - (this.bellTick[i] as number) <= window && tick >= (this.bellTick[i] as number)) return true;
    }
    return false;
  }

  /** Draws the vault parts of the frame's layer inside its pushed rectangle. */
  draw(scene: RenderScene, atlas: AtlasData, session: VaultSession, f: VaultFrame): void {
    const st = this.stats;
    st.parts = 0;
    st.traps = 0;
    st.emitters = 0;
    const s = session.sampleVaultParts(this.sample, f.layer, f.tileLeft - VIEW_MARGIN_TILES, f.tileTop - VIEW_MARGIN_TILES, f.tileRight + VIEW_MARGIN_TILES, f.tileBottom + VIEW_MARGIN_TILES, f.playerTx, f.playerTy);
    if (s.count === 0) return;
    if (this.manifest !== atlas.manifest) this.bind(atlas.manifest, session.vaultTrapDefs());
    for (let i = 0; i < s.count; i++) {
      const kind = s.kind[i] as number;
      if (kind === VAULT_PART.falle) this.drawTrap(scene, s, i, f);
      else this.drawPart(scene, s, i, kind, f);
    }
  }

  private drawPart(scene: RenderScene, s: VaultPartsSample, i: number, kind: number, f: VaultFrame): void {
    const b = this.parts[kind];
    if (b === null || b === undefined) return;
    const tx = s.tx[i] as number;
    const ty = s.ty[i] as number;
    const state = s.state[i] as number;
    let x = tx * TILE_PX + TILE_PX / 2;
    let y = ty * TILE_PX + FOOT_PX;
    let clip: string | null = null;
    let ground = false;
    let glow = 0;
    let outline = f.focusTx === tx && f.focusTy === ty;
    switch (kind) {
      case VAULT_PART.tor_quer:
        // Over its two tiles side by side: the gate's middle on their shared edge.
        x = (tx + 1) * TILE_PX;
        clip = doorClip(s.variant[i] as number, state);
        outline = f.focusTy === ty && (f.focusTx === tx || f.focusTx === tx + 1);
        break;
      case VAULT_PART.tor_laengs:
        y = (ty + 1) * TILE_PX + FOOT_PX;
        clip = doorClip(s.variant[i] as number, state);
        outline = f.focusTx === tx && (f.focusTy === ty || f.focusTy === ty + 1);
        break;
      case VAULT_PART.hebel:
        clip = state === 1 ? 'unten' : 'oben';
        break;
      case VAULT_PART.schale:
        clip = state === 1 ? 'brennt' : 'kalt';
        if (state === 1) {
          glow = FIRE_GLOW;
          this.emit(scene, this.preset().bowl, x, y, BOWL_FLAME_PX, tx, ty);
        }
        break;
      case VAULT_PART.glocke:
        clip = this.ringing(tx, ty, f.tick) ? 'geschlagen' : 'still';
        break;
      case VAULT_PART.risswand:
        clip = state === 2 ? 'offen' : state === 1 ? 'luftzug' : 'ganz';
        if (state === 1) this.emit(scene, this.preset().draft, x, y, CRACK_DUST_PX, tx, ty);
        break;
      case VAULT_PART.platte:
        clip = state === 1 ? 'gedrueckt' : 'oben';
        ground = true;
        break;
      case VAULT_PART.ruecksetzer:
        ground = true;
        break;
      case VAULT_PART.hinweis: {
        const hint = VAULT_HINT_KINDS[s.variant[i] as number] ?? 'hebel';
        clip = hint === 'glocken' && state === 1 ? 'glocken_spielt' : hint;
        if (state === 1) glow = FIRE_GLOW;
        break;
      }
      case VAULT_PART.sockel_schluessel:
      case VAULT_PART.sockel_splitter:
        clip = state === 1 ? 'leer' : 'voll';
        break;
      default:
        break;
    }
    const d = scene.sprite.reset();
    d.frame = frameOf(b, clip, f.time + tx * 0.37 + ty * 0.21);
    d.x = x;
    d.y = y;
    if (ground) d.layer = 'ground';
    d.emissiveBoost = glow;
    d.outline = outline && !ground;
    scene.sprites.push(d);
    this.stats.parts++;
    // A closed hidden door breathes through its crack like a real cracked wall.
    if ((kind === VAULT_PART.tor_quer || kind === VAULT_PART.tor_laengs) && state === 0 && VAULT_DOOR_KINDS[s.variant[i] as number] === 'verborgen') {
      this.emit(scene, this.preset().draft, x, y, CRACK_DUST_PX, tx, ty);
    }
    if (kind === VAULT_PART.hinweis) this.digits(scene, s.aux[i] as number, x, y);
  }

  /** The order digits under a stele's picture (see `hintDigits`, src/game/samples/gewoelbe.ts). */
  private digits(scene: RenderScene, packed: number, x: number, y: number): void {
    const b = this.digit;
    if (b === null) return;
    const n = packed >> (HINT_DIGIT_BITS * HINT_DIGITS_MAX);
    const mask = (1 << HINT_DIGIT_BITS) - 1;
    for (let k = 0; k < n; k++) {
      const digit = (packed >> (HINT_DIGIT_BITS * k)) & mask;
      if (digit === 0) continue;
      const d = scene.sprite.reset();
      d.frame = (b.sprite.frames[digit - 1] ?? b.sprite.frames[0]) as SpriteFrameRef;
      // Centred row: offsets (k − (n − 1) / 2) × step are whole pixels for the step of 4.
      d.x = x + ((2 * k - (n - 1)) * DIGIT_STEP_PX) / 2;
      d.y = y - DIGIT_LIFT_PX;
      d.depth = y + 0.5;
      d.heightBase = DIGIT_LIFT_PX;
      scene.sprites.push(d);
    }
  }

  private drawTrap(scene: RenderScene, s: VaultPartsSample, i: number, f: VaultFrame): void {
    const index = s.variant[i] as number;
    const b = this.traps[index];
    const def = this.trapDefs[index];
    if (b === null || b === undefined || def === undefined) return;
    const phase = s.state[i] as number;
    if (phase === TRAP_PHASE.verbraucht) return;
    const tx = s.tx[i] as number;
    const ty = s.ty[i] as number;
    const dir = s.aux[i] as number;
    const ticks = s.ticks[i] as number;
    const x = tx * TILE_PX + TILE_PX / 2;
    const y = ty * TILE_PX + FOOT_PX;
    const warn = phase === TRAP_PHASE.warnung;
    this.stats.traps++;
    if (phase === TRAP_PHASE.takt) {
      this.blade(scene, b, def, dir, ticks, x, y);
      return;
    }
    let clip = warn ? 'warnung' : 'ruhe';
    let px = x;
    let py = y;
    let ground = def.ausloeser === 'platte';
    let mirror = false;
    switch (def.id) {
      case 'speerfalle':
        if (phase === TRAP_PHASE.ausgeloest && ticks < STAB_SECONDS * TICK_HZ) clip = 'stoss';
        ground = false;
        break;
      case 'pfeilwerfer': {
        clip = (warn ? DART_WARN_CLIPS : DART_REST_CLIPS)[dir] ?? 'o_ruhe';
        mirror = dir === 3;
        if (phase === TRAP_PHASE.ausgeloest) this.flyDart(scene, dir, s.reach[i] as number, ticks, x, y);
        break;
      }
      case 'rollstein':
        if (phase === TRAP_PHASE.ausgeloest) {
          const lane = Math.min(s.reach[i] as number, BALANCE.vaults.trapLaneMaxTiles) * TILE_PX;
          const along = Math.min(lane, (ticks * ROLL_PX_PER_SECOND) / TICK_HZ);
          px = x + (DIR_DX[dir] as number) * along;
          py = y + (DIR_DY[dir] as number) * along;
          clip = along < lane ? 'rollt' : 'ruhe';
        }
        break;
      case 'fallgrube':
        if (phase === TRAP_PHASE.ausgeloest) clip = 'offen';
        break;
      default:
        break;
    }
    const d = scene.sprite.reset();
    d.frame = frameOf(b, clip, f.time + tx * 0.29);
    d.x = px;
    d.y = py;
    d.mirror = mirror;
    if (ground) d.layer = 'ground';
    d.emissiveBoost = warn ? WARN_GLOW : 0;
    scene.sprites.push(d);
  }

  /** A dart on its way down the lane (until it passed the lane's last tile). */
  private flyDart(scene: RenderScene, dir: number, reach: number, ticks: number, x: number, y: number): void {
    const along = TILE_PX / 2 + (ticks * DART_PX_PER_SECOND) / TICK_HZ;
    if (along > (Math.min(reach, BALANCE.vaults.trapLaneMaxTiles) + 0.5) * TILE_PX) return;
    const vertical = dir === 0 || dir === 2;
    const b = vertical ? this.dartUp : this.dart;
    if (b === null) return;
    const d = scene.sprite.reset();
    d.frame = b.sprite.frames[0] as SpriteFrameRef;
    d.x = x + (DIR_DX[dir] as number) * along;
    // At mouth height: drawn that far up, sorted on the floor line it flies over.
    const floor = y + (DIR_DY[dir] as number) * along;
    d.y = floor - DART_HEIGHT_PX;
    d.depth = floor;
    d.heightBase = DART_HEIGHT_PX;
    d.mirror = dir === 3;
    // The vertical bolt points south; flying north it turns about its middle.
    if (dir === 0) d.rotation = Math.PI;
    scene.sprites.push(d);
  }

  /**
   * A blade on its beat: over a two-beat swing it passes the middle at every strike (`trapWarnTicks` into a beat) and turns at
   * the ends – sin(π (t − warn) / beat). Across a north–south lane it swings sideways through the sprite's five deflections;
   * across an east–west lane towards and away from the camera (hanging straight, moving in screen y).
   */
  private blade(scene: RenderScene, b: Bound, def: VaultTrapDef, dir: number, ticks: number, x: number, y: number): void {
    const beat = trapBeatTicks(def);
    const swing = Math.sin((Math.PI * (ticks - trapWarnTicks(def))) / beat);
    const sideways = dir === 0 || dir === 2;
    const g = this.groove;
    if (g !== null) {
      const e = scene.sprite.reset();
      const clip = g.clips[sideways ? 'quer' : 'laengs'];
      e.frame = (g.sprite.frames[clip === undefined ? 0 : (clip.frames[0] ?? 0)] ?? g.sprite.frames[0]) as SpriteFrameRef;
      e.x = x;
      e.y = y;
      e.layer = 'ground';
      scene.sprites.push(e);
    }
    const clip = b.clips['schwung'];
    const d = scene.sprite.reset();
    if (sideways) {
      const k = Math.max(0, Math.min(BLADE_FRAMES - 1, Math.round((swing + 1) * BLADE_STRAIGHT)));
      d.frame = (b.sprite.frames[clip === undefined ? k : (clip.frames[k] ?? 0)] ?? b.sprite.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = y;
    } else {
      d.frame = (b.sprite.frames[clip === undefined ? BLADE_STRAIGHT : (clip.frames[BLADE_STRAIGHT] ?? 0)] ?? b.sprite.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = y + Math.round(swing * BLADE_DEPTH_SWING_PX);
    }
    scene.sprites.push(d);
  }

  private preset(): { draft: number; bowl: number } {
    return (this.presets ??= { draft: particleEmitter('gewoelbe_luftzug'), bowl: particleEmitter('gewoelbe_schale') });
  }

  private emit(scene: RenderScene, preset: number, x: number, y: number, height: number, tx: number, ty: number): void {
    scene.particles.emitters.push(preset, x, y, height, 1, PARTICLE_ID_BASE + (((ty & PARTICLE_TILE_MASK) << PARTICLE_ROW_SHIFT) | (tx & PARTICLE_TILE_MASK)));
    this.stats.emitters++;
  }
}

/** The dart thrower's clips by direction (0 north … 3 west; west is east mirrored). */
const DART_REST_CLIPS: readonly string[] = ['n_ruhe', 'o_ruhe', 's_ruhe', 'o_ruhe'];
const DART_WARN_CLIPS: readonly string[] = ['n_warnung', 'o_warnung', 's_warnung', 'o_warnung'];

/** A door's clip: its kind, `_offen` when open. */
function doorClip(variant: number, state: number): string {
  const kind = VAULT_DOOR_KINDS[variant] ?? 'schloss';
  return state === 1 ? DOOR_OPEN[kind] : kind;
}
const DOOR_OPEN = { schloss: 'schloss_offen', raetsel: 'raetsel_offen', verborgen: 'verborgen_offen' } as const;

/** The frame of `clip` at `time` (its first frame when it does not loop), or the sprite's first frame. */
function frameOf(b: Bound, clip: string | null, time: number): SpriteFrameRef {
  const c = clip === null ? undefined : b.clips[clip];
  return (b.sprite.frames[c === undefined ? 0 : clipFrameAt(c, time)] ?? b.sprite.frames[0]) as SpriteFrameRef;
}
