/**
 * The fight in the game view (M6-05, M6-15c, M6-38; MASTERPROMPT §6.2 "Kampf", §19.1, §19.4, §4.6; docs/SPIEL.md §13):
 * the presentation of the combat and creature events, read from the session – never written.
 *
 * - `hitLanded` → impact particles of the target's material sprayed away from the attacker (`combatFeedback.ts`), the
 *   damage number (`damageNumbers.ts`, setting `game.damageNumbers`), a glint and a flash on a crit, and a screenshake:
 *   hits the player takes shake by their impact class, the player's own blows only when heavy or critical.
 * - `blocked` → sparks from the guard; `parried` → glint, sparks, light, "Parade!".
 * - `attackStarted` of a melee blow → the swing's trail with the blow's reach and arc (the second blow of a combo sweeps
 *   back); a shot or throw leaves none (its projectile is the picture).
 * - `projectileFired`/`projectileStuck`/`projectileHit` → projectiles in flight and at rest (`projectiles.ts`), splashes in
 *   deep water, the bursts of thrown weapons (the fire flask's flames and flash).
 * - `creatureTelegraph` → the glint and the ground marker of area attacks (`telegraphs.ts`).
 * - `creatureDied` of shadow brood → its body falls apart in wisps and violet sparks.
 * - The player's aim (`GameSession.sampleCombat`): a reticle on the aim point while a bow or sling draws, a throw winds up
 *   or a ranged weapon aims – its arms close in as the tension builds; a glint on the weapon once the held blow is heavy.
 * - `shakeOffset` gives the camera its shake for the frame (whole pixels × the setting `accessibility.screenshake`).
 *
 * Positions of attackers and bodies are read from the player and creature systems (read only). Allocation-free per
 * frame; the event handlers run once per event.
 */
import { RANGED_WEAPON_CLASSES } from '../../content/balance/combat';
import type { WeaponClass } from '../../content/balance/tools';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { COMBAT_SYSTEM_ID, CombatSystem } from '../../game/combat/system';
import type { CombatEventMap } from '../../game/combat/events';
import type { CombatSample } from '../../game/combat/sample';
import type { CreatureEventMap } from '../../game/creatures/events';
import { CREATURES_SYSTEM_ID, CreatureSystem } from '../../game/creatures/system';
import { PlayerSystem } from '../../game/player/system';
import type { GameSession } from '../../game/session';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { paletteLight } from '../light/lightColors';
import type { RenderScene } from '../scene';
import { CombatFeedback, DISSOLVE_LIGHT, DOT_SPRITE, PUNKT } from './combatFeedback';
import { DamageNumbers } from './damageNumbers';
import { ProjectileView } from './projectiles';
import { TelegraphView } from './telegraphs';

/** Screenshake by impact class 1–5 [px, before the setting]: hits the player takes, and the player's heavy or critical blows. */
export const SHAKE_TAKEN_PX = [1, 1, 2, 2, 3] as const;
export const SHAKE_DEALT_PX = [0, 0, 1, 1, 2] as const;
/** Weapon classes that shoot or throw: their `attackStarted` sets no swing trail. */
const RANGED_CLASSES: ReadonlySet<WeaponClass> = new Set(RANGED_WEAPON_CLASSES);
/** Blasts farther from the player than this many radii shake no more [× radius]. */
const BLAST_SHAKE_REACH = 4;
/** The player's figure: height of the middle of its body and of its head above the feet [px]. */
const PLAYER_BODY_Z = 10;
const PLAYER_HEAD_Z = 26;
/** A creature's body middle and head as a share of its cell size (the sprites stand in their cell, docs/ART.md §15.2). */
const CREATURE_BODY_SHARE = 0.35;
const CREATURE_HEAD_SHARE = 0.8;
/** Sparks of a block and of a broken guard; of a parry. */
const BLOCK_SPARKS = 4;
const GUARD_BREAK_SPARKS = 8;
const PARRY_SPARKS = 6;
/** The flash of a parry and a crit: radius [px], strength, ticks. */
const HIT_FLASH = { radius: 40, intensity: 1.6, ticks: 8 } as const;
const PARRY_LIGHT = paletteLight('eis.4');
const CRIT_LIGHT = paletteLight('feuer.4');
/** The reticle: its arms' length and how far they sit from the centre, relaxed and at full tension [px]. */
const RETICLE = { arm: 2, far: 7, near: 3 } as const;
/** The reticle sorts this far below its point [px]: over every body around it. */
const RETICLE_DEPTH_PX = 4096;
/** The weapon's glint once a held blow is heavy: ahead of and above the figure's feet [px]. */
const CHARGED_GLINT = { forward: 8, up: 14 } as const;

/** What the fight's view needs of the game view's frame. */
export interface CombatFrame {
  layer: Layer;
  /** Interpolation of the frame between the last two ticks (`GameSession.renderAlpha`). */
  alpha: number;
  /** Damage numbers on (`game.damageNumbers`). */
  damageNumbers: boolean;
  /** The player's fight of the frame (the figure's sample) and where the figure stands, or null without a player. */
  combat: Readonly<CombatSample> | null;
  figureX: number;
  figureY: number;
  figureHeight: number;
  /** Height level of a tile (16 px per level in the G-buffer). */
  levelAt(tx: number, ty: number): number;
}

export function createCombatFrame(): CombatFrame {
  return { layer: 0, alpha: 1, damageNumbers: true, combat: null, figureX: 0, figureY: 0, figureHeight: 0, levelAt: () => 0 };
}

/** What the fight's view drew and heard (debug extension `worldView`, E2E). */
export interface CombatViewInfo {
  readonly particles: number;
  readonly smears: number;
  readonly smearPixels: number;
  readonly glints: number;
  readonly lightFlashes: number;
  readonly shockwaves: number;
  readonly splashes: number;
  readonly telegraphMarkers: number;
  readonly telegraphMarkerPixels: number;
  readonly telegraphs: number;
  readonly projectiles: number;
  readonly projectileShadows: number;
  readonly stuck: number;
  /** Bursts of creature shots where they stopped. */
  readonly shotImpacts: number;
  readonly damageNumbersShown: number;
  readonly damageNumbersAdded: number;
  readonly reticle: boolean;
  readonly shake: readonly [number, number];
  /** Amplitude of the frame's shake after the setting's scale [px] (the offset is it in a hashed direction, rounded). */
  readonly shakeAmplitude: number;
  /** Events seen since the view began. */
  readonly hits: number;
  readonly blocks: number;
  readonly parries: number;
  readonly bursts: number;
  /** The creature and attack of the last telegraph (`creatureTelegraph`), '' before any. */
  readonly lastTelegraph: string;
}

/** Systems of a simulation the view reads (looked up once per simulation). */
interface CombatSystems {
  readonly sim: Simulation;
  readonly combat: CombatSystem | null;
  readonly creatures: CreatureSystem | null;
  readonly player: PlayerSystem | null;
}

export class CombatView {
  readonly feedback = new CombatFeedback();
  readonly telegraphs = new TelegraphView();
  readonly projectiles = new ProjectileView();
  readonly numbers = new DamageNumbers();
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void)[] = [];
  private sim: Simulation | null = null;
  private systems: CombatSystems | null = null;
  private manifest: AtlasManifest | null = null;
  private dot: AtlasSprite | null = null;
  private parryText: () => string = () => '';
  private readonly at = { x: 0, y: 0 };
  private readonly shakeOut = { x: 0, y: 0 };
  private shakeAmp = 0;
  /** The tick a held blow of the player becomes heavy, and whether its glint was set. */
  private chargedTick = -1;
  private chargedGlint = false;
  private reticle = false;
  private hits = 0;
  private blocks = 0;
  private parries = 0;
  private bursts = 0;
  private lastTelegraph = '';

  /**
   * Listens to the fight's events of `session` (again only when the session changes); `parry` gives the word a parry
   * shows ("Parade!", translated by the caller when a parry happens – nothing is looked up per frame).
   */
  follow(session: Pick<GameSession, 'onEvent'> & Partial<Pick<GameSession, 'sim'>>, parry: () => string): void {
    this.parryText = parry;
    if (this.subscribed === session) return;
    this.subscribe(session);
  }

  private subscribe(session: Pick<GameSession, 'onEvent'> & Partial<Pick<GameSession, 'sim'>>): void {
    this.dispose();
    this.subscribed = session;
    this.sim = session.sim ?? null;
    this.unsubscribe = [
      session.onEvent('hitLanded', (e) => this.hit(e)),
      session.onEvent('blocked', (e) => this.blocked(e)),
      session.onEvent('parried', (e) => this.parried(e)),
      session.onEvent('attackStarted', (e) => this.swing(e)),
      session.onEvent('attackWindup', (e) => this.windup(e)),
      session.onEvent('projectileFired', (e) => this.projectiles.fired(e)),
      session.onEvent('projectileStuck', (e) => this.projectiles.stuck(e, this.manifest, this.feedback)),
      session.onEvent('projectileHit', (e) => this.projectileHit(e)),
      session.onEvent('creatureTelegraph', (e) => this.telegraph(e)),
      session.onEvent('creatureDied', (e) => this.died(e)),
    ];
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.subscribed = null;
    this.sim = null;
    this.systems = null;
    this.feedback.clear();
    this.telegraphs.clear();
    this.projectiles.clear();
    this.numbers.clear();
    this.chargedTick = -1;
  }

  /**
   * The camera's shake for the frame [whole px] at the frame's moment of `sim` (`alpha` of the way from the last tick),
   * scaled by the setting `scale` (0–1; 0 = none).
   */
  shakeOffset(sim: Simulation, alpha: number, scale: number): Readonly<{ x: number; y: number }> {
    const now = sim.tick - 1 + alpha;
    this.shakeAmp = this.feedback.shakeLeft(now) * (scale > 0 ? (scale < 1 ? scale : 1) : 0);
    return this.feedback.shakeOffset(now, scale, this.shakeOut);
  }

  /** Draws the fight of `frame.layer` (effects, telegraphs, projectiles, numbers, the reticle). */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, frame: CombatFrame): void {
    const manifest = atlas.manifest;
    if (this.manifest !== manifest) {
      this.manifest = manifest;
      this.dot = manifest.sprites[DOT_SPRITE] ?? null;
    }
    const sys = this.systemsOf(sim);
    const tickHz = sim.clock.tickHz;
    const now = sim.tick - 1 + frame.alpha;
    const layer = frame.layer;
    this.playerMarks(scene, frame, now, layer);
    this.feedback.draw(scene, manifest, layer, now, tickHz);
    this.telegraphs.draw(scene, manifest, sys.creatures, layer, now);
    this.projectiles.draw(scene, manifest, sys.combat, layer, now, frame.alpha, tickHz);
    this.numbers.draw(scene.worldUi, layer, now, tickHz, frame.damageNumbers);
  }

  info(): CombatViewInfo {
    const f = this.feedback.stats;
    const t = this.telegraphs.stats;
    const p = this.projectiles.stats;
    return {
      particles: f.particles,
      smears: f.smears,
      smearPixels: f.smearPixels,
      glints: f.glints,
      lightFlashes: f.flashes,
      shockwaves: f.waves,
      splashes: f.splashes,
      telegraphMarkers: t.markers,
      telegraphMarkerPixels: t.markerPixels,
      telegraphs: t.glints,
      projectiles: p.flying,
      projectileShadows: p.shadows,
      stuck: p.stuck,
      shotImpacts: p.impacts,
      damageNumbersShown: this.numbers.stats.shown,
      damageNumbersAdded: this.numbers.stats.added,
      reticle: this.reticle,
      shake: [this.shakeOut.x, this.shakeOut.y],
      shakeAmplitude: this.shakeAmp,
      hits: this.hits,
      blocks: this.blocks,
      parries: this.parries,
      bursts: this.bursts,
      lastTelegraph: this.lastTelegraph,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  private hit(e: CombatEventMap['hitLanded']): void {
    this.hits++;
    const sys = this.current();
    const player = sys?.sim.player ?? NULL_ENTITY;
    const size = this.bodySize(e.target, player);
    const z = e.target === player ? PLAYER_BODY_Z : size * CREATURE_BODY_SHARE;
    const head = e.target === player ? PLAYER_HEAD_Z : size * CREATURE_HEAD_SHARE;
    let dx = 0;
    let dy = 0;
    if (this.positionOf(e.attacker, player)) {
      dx = e.x - this.at.x;
      dy = e.y - this.at.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
    }
    const base = this.groundOf(e.target, player);
    this.feedback.impact(e.material, e.x, e.y, z, dx, dy, e.wucht, e.crit, e.tick, e.layer, e.target, base);
    this.numbers.add(e.x, e.y - head, e.layer, e.amount, e.crit, e.tick);
    const w = Math.max(1, Math.min(SHAKE_TAKEN_PX.length, Math.round(e.wucht))) - 1;
    if (e.crit) {
      this.feedback.glint(e.x, e.y, z, e.layer, e.tick, base);
      this.feedback.light(e.x, e.y, e.layer, CRIT_LIGHT, HIT_FLASH.intensity, HIT_FLASH.radius, e.tick, HIT_FLASH.ticks);
    }
    if (e.target === player) this.feedback.shake(SHAKE_TAKEN_PX[w] as number, e.tick);
    else if (e.attacker === player) this.feedback.shake((SHAKE_DEALT_PX[w] as number) + (e.crit ? 1 : 0), e.tick);
  }

  private blocked(e: CombatEventMap['blocked']): void {
    this.blocks++;
    const player = this.current()?.sim.player ?? NULL_ENTITY;
    let dx = 0;
    let dy = 0;
    if (this.positionOf(e.attacker, player)) {
      dx = e.x - this.at.x;
      dy = e.y - this.at.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
    }
    const z = e.entity === player ? PLAYER_BODY_Z : this.bodySize(e.entity, player) * CREATURE_BODY_SHARE;
    this.feedback.sparks(e.x - dx * 4, e.y - dy * 4, z, dx, dy, e.guardBroken ? GUARD_BREAK_SPARKS : BLOCK_SPARKS, e.tick, e.layer, 0, this.groundOf(e.entity, player));
    if (e.entity === player) this.feedback.shake(e.guardBroken ? 2 : 1, e.tick);
  }

  private parried(e: CombatEventMap['parried']): void {
    this.parries++;
    const player = this.current()?.sim.player ?? NULL_ENTITY;
    const z = e.entity === player ? PLAYER_BODY_Z : this.bodySize(e.entity, player) * CREATURE_BODY_SHARE;
    const head = e.entity === player ? PLAYER_HEAD_Z : this.bodySize(e.entity, player) * CREATURE_HEAD_SHARE;
    const base = this.groundOf(e.entity, player);
    this.feedback.glint(e.x, e.y, z + 2, e.layer, e.tick, base);
    this.feedback.sparks(e.x, e.y, z, 0, 0, PARRY_SPARKS, e.tick, e.layer, 0, base);
    this.feedback.light(e.x, e.y, e.layer, PARRY_LIGHT, HIT_FLASH.intensity, HIT_FLASH.radius, e.tick, HIT_FLASH.ticks);
    const word = this.parryText();
    if (word !== '') this.numbers.label(e.x, e.y - head, e.layer, word, e.tick);
  }

  private swing(e: CombatEventMap['attackStarted']): void {
    if (RANGED_CLASSES.has(e.klasse)) return;
    // The second blow of a combo sweeps back the way the first came.
    const sense = e.kombo % 2 === 0 ? -1 : 1;
    this.feedback.smear(e.x, e.y, e.layer, e.angle, e.reichweite, e.bogen, sense, false, e.tick);
  }

  private windup(e: CombatEventMap['attackWindup']): void {
    if (!e.schwer) {
      this.chargedTick = -1;
      return;
    }
    this.chargedTick = e.tick + e.ticks;
    this.chargedGlint = false;
  }

  private projectileHit(e: CombatEventMap['projectileHit']): void {
    if (e.target !== NULL_ENTITY || e.wirkung === null) return;
    this.bursts++;
    const shake = this.feedback.burst(e.wirkung, e.x, e.y, e.radius, e.tick, e.layer);
    if (shake <= 0) return;
    const sys = this.current();
    if (sys === null || sys.player === null || !sys.player.position(sys.sim, this.at)) return;
    const dx = this.at.x - e.x;
    const dy = this.at.y - e.y;
    const reach = Math.max(16, e.radius) * BLAST_SHAKE_REACH;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < reach) this.feedback.shake(shake * (1 - d / reach) + 0.5, e.tick);
  }

  private telegraph(e: CreatureEventMap['creatureTelegraph']): void {
    this.lastTelegraph = `${e.creature}.${e.angriff}`;
    const s = this.current()?.creatures?.store.get(e.entity);
    const player = this.current()?.sim.player ?? NULL_ENTITY;
    this.telegraphs.add(e, this.bodySize(e.entity, player), s?.level ?? 0, this.feedback);
  }

  private died(e: CreatureEventMap['creatureDied']): void {
    const kind = this.current()?.creatures?.catalog.find(e.creature);
    if (kind === undefined || kind.def.material !== 'schatten') return;
    const size = kind.def.groesse;
    this.feedback.dissolve(e.x, e.y, size * CREATURE_BODY_SHARE, size, e.tick, e.layer, this.levelAt(e.x, e.y) * WAND_PX_JE_STUFE);
    this.feedback.light(e.x, e.y, e.layer, DISSOLVE_LIGHT, HIT_FLASH.intensity, size * 2, e.tick, HIT_FLASH.ticks * 2);
  }

  // -------------------------------------------------------------------------------------------
  // The player's marks: the reticle and the charged blow's glint
  // -------------------------------------------------------------------------------------------

  private playerMarks(scene: RenderScene, frame: CombatFrame, now: number, layer: Layer): void {
    this.reticle = false;
    const c = frame.combat;
    if (c === null || !c.present) return;
    if (c.phase === 'aufladen' && this.chargedTick >= 0 && now >= this.chargedTick && !this.chargedGlint) {
      this.chargedGlint = true;
      const a = c.aimAngle;
      this.feedback.glint(frame.figureX + Math.cos(a) * CHARGED_GLINT.forward, frame.figureY + Math.sin(a) * CHARGED_GLINT.forward * 0.5, CHARGED_GLINT.up, layer, this.chargedTick, frame.figureHeight);
    }
    const aiming = c.aimed && (c.phase === 'spannen' || c.blockKind === 'ziel');
    const dot = this.dot;
    if (!aiming || dot === null) return;
    this.reticle = true;
    const t = c.phase === 'spannen' ? c.tension : 0;
    const gap = Math.round(RETICLE.far - (RETICLE.far - RETICLE.near) * t);
    const cx = Math.round(c.aimX);
    const cy = Math.round(c.aimY);
    const frameIndex = t >= 1 ? PUNKT.schmier : PUNKT.schmierMitte;
    for (let k = 0; k < RETICLE.arm; k++) {
      const r = gap + k;
      this.reticleDot(scene, dot, cx + r, cy, frameIndex);
      this.reticleDot(scene, dot, cx - r, cy, frameIndex);
      this.reticleDot(scene, dot, cx, cy + r, frameIndex);
      this.reticleDot(scene, dot, cx, cy - r, frameIndex);
    }
  }

  private reticleDot(scene: RenderScene, dot: AtlasSprite, x: number, y: number, frame: number): void {
    const d = scene.sprite.reset();
    d.frame = dot.frames[frame] as SpriteFrameRef;
    d.x = x;
    d.y = y;
    // Over the bodies around it: the aim point is a mark on the picture, not a thing in the world.
    d.depth = y + RETICLE_DEPTH_PX;
    scene.sprites.push(d);
  }

  // -------------------------------------------------------------------------------------------
  // Reading the simulation
  // -------------------------------------------------------------------------------------------

  private current(): CombatSystems | null {
    const sim = this.sim;
    return sim === null ? null : this.systemsOf(sim);
  }

  private systemsOf(sim: Simulation): CombatSystems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const combat = sim.systems.find((x) => x.id === COMBAT_SYSTEM_ID);
      const creatures = sim.systems.find((x) => x.id === CREATURES_SYSTEM_ID);
      const player = sim.systems.find((x) => x.id === 'player');
      s = {
        sim,
        combat: combat instanceof CombatSystem ? combat : null,
        creatures: creatures instanceof CreatureSystem ? creatures : null,
        player: player instanceof PlayerSystem ? player : null,
      };
      this.systems = s;
    }
    return s;
  }

  /** Height level of the tile under world px (x, y) on the surface (the dead body is gone: its tile tells), 0 when unknown. */
  private levelAt(x: number, y: number): number {
    const sim = this.sim;
    if (sim === null) return 0;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);
    const chunk = sim.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? 0 : ((chunk.height[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number) ?? 0);
  }

  /** Where body `e` stands (the player, a creature) into `this.at`; false when it is neither. */
  private positionOf(e: Entity, player: Entity): boolean {
    const sys = this.current();
    if (sys === null || e === NULL_ENTITY) return false;
    if (e === player) return sys.player !== null && sys.player.position(sys.sim, this.at);
    return sys.creatures !== null && sys.creatures.positionOf(e, this.at);
  }

  /** Height of the ground body `e` stands on above level 0 [px] (its height level × 16), 0 when unknown. */
  private groundOf(e: Entity, player: Entity): number {
    const sys = this.current();
    if (sys === null) return 0;
    if (e === player) return (sys.player?.body(sys.sim)?.level ?? 0) * WAND_PX_JE_STUFE;
    return (sys.creatures?.store.get(e)?.level ?? 0) * WAND_PX_JE_STUFE;
  }

  /** The cell size of body `e` [px]: a creature's, else the player's figure. */
  private bodySize(e: Entity, player: Entity): number {
    if (e === player) return PLAYER_HEAD_Z;
    const sys = this.current();
    const s = sys?.creatures?.store.get(e);
    if (s === undefined || sys?.creatures === null || sys?.creatures === undefined) return PLAYER_HEAD_Z;
    return sys.creatures.catalog.find(s.creature)?.def.groesse ?? PLAYER_HEAD_Z;
  }
}
