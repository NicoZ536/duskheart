/**
 * The boss framework (MASTERPROMPT §20.2 "Jeder Boss: eigene Arena, Beschwörung oder Zugang, ≥ 3 Phasen, eigene Kampfmusik,
 * Intro-Titelkarte, Bosslebensbalken mit Phasenmarken, einzigartige Drops, Trophäe, Herzsplitter (+10 max. Leben). Kein
 * unfairer One-Shot auf Normal; jede Attacke lesbar; Wiedereinstieg nach Tod direkt vor der Arena."; docs/SPIEL.md §22;
 * strand F, system `bosses`, M7-32, M7-34).
 *
 * - **One instance per boss** of the content (`bosses`), in its arena (src/game/bosses/arena.ts: the slot `bossarena` of its
 *   biome, the marks of its layout). States `schlafend` → `erwacht` → `besiegt`.
 * - **Access**: `betreten` – the player steps into the inner ring (`BALANCE.bosses.innerRingInsetTiles` inside the edge);
 *   `beschwoerung` – `boss.summon` with the item, standing in the arena. Waking: the title card (3 s, invulnerable, no attack),
 *   the arena sealed (a ring of roots on the collision grid, `collisionOverlay`), the fear of a boss sighting (+10, §12.3).
 * - **Phases** by health share (`abLebensanteil`); a new phase cancels the running attack, gives a short invulnerable
 *   transition and `bossPhaseChanged`. In a phase `schwachstellen` the body shrugs off every hit and only the weak points take
 *   damage (their own bodies of the combat provider, at fixed offsets from the boss); resistances may change per phase.
 * - **Attacks as data**, chosen weighted among the ready ones (stream `bosses`, docs/SPIEL.md §28), each telegraphed ≥ 0,4 s
 *   (`bossTelegraph`, the renderer marks the ground): areas (`linie` fans, `kreis` at the locked aim, `kegel`, `ring` around the
 *   trunk) resolved through `CombatSystem.resolve` (not blockable – one rolls out of them, no crit); summons of owned
 *   creatures (`spawnOwned`, owner `boss:<id>`, at most `maxGleichzeitig`); arena effects – `blaettersturm` lowers the sight
 *   (`stormAt`), `arena_brennt` sets the arena's burning patches alight (their own fire: light, the flames' sprite and
 *   "Brennen" on the player standing in them – the arena holds nothing the fire simulation could burn). The pause between
 *   attacks and their cooldowns shrink with the phase's `tempo`; the telegraphs never.
 * - **Victory**: unique drops, trophy, heart shard and the rest at its place (`DropSystem.spawn`), servants crumble, the
 *   arena opens, `bossDefeated`. **Reset** on the player's death or flight (`bossReset`): full health, servants gone, arena open.
 * - Combat provider `boss` (team `feind`); collision overlay (the trunk while it lives, the seal while awake); light of the
 *   burning patches and the glowing knots; spawn blocker of the arena (`arenaAt`); respawn spot "before the arena"
 *   (`arenaSpot`, `DeathSystem.addArenaSpots`).
 *
 * Global (`timeScope`): a boss only acts while the player fights it; nothing of it lives in frozen chunks. Save participant
 * `bosses` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { BossAreaAttackDef, BossAttackDef, BossDef, BossPhaseDef } from '../../content/bosses/schema';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { BLOCK_OBJECT, infoLevel, type CollisionOverlay } from '../../world/collision/tiles';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { CombatSystem } from '../combat/system';
import { createCombatAttack, type CombatAttack } from '../combat/system';
import { DAMAGE_TYPES, type CombatTargetProvider, type CombatantView, type HitResult } from '../combat/targets';
import type { OwnedCreaturesApi } from '../creatures/owned';
import type { InventorySystem } from '../inventory/system';
import type { ItemCatalog } from '../items/catalog';
import { newStack } from '../items/stack';
import type { ExtraLightProvider } from '../light/system';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandOfType } from '../commands';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { worldArenaSource, type ArenaGeometry, type ArenaSource } from './arena';
import type { BossRejectReason, BossResetReason, BossTelegraphArea } from './events';
import { attackGapTicks, bossAttackDamage, bossAttackWucht, chooseAttack, cooldownTicks, inBossArea, lockAim, phaseFor, telegraphTicks } from './formulas';
import { bossesSnapshotSchema, copyBossRuntime, createBossRuntime, NO_TICK, type BossesSnapshot, type BossRuntime } from './state';
import type { BossesApi, BossSample } from './types';

/** Id of the boss system and its save participant. */
export const BOSSES_SYSTEM_ID = 'bosses';
/** Data version of the `bosses` participant. */
export const BOSSES_SAVE_VERSION = 1;
/** Random stream of the bosses' pattern choice and loot counts (docs/SPIEL.md §28). */
export const BOSSES_RNG_STREAM = 'bosses';
/** Id of the bosses' combat provider. */
export const BOSS_TARGETS_ID = 'boss';
/** The condition of a player standing in a burning patch (src/content/conditions.ts, like the fire simulation's). */
const BURNING_CONDITION = 'brennen';

const B = BALANCE.bosses;
const TICK_HZ = BALANCE.time.tickHz;
const TITLE_TICKS = Math.round(B.titleCardSeconds * TICK_HZ);
const PLAYER_RADIUS_PX = BALANCE.combat.body.playerRadiusPx;
/** Light ids of the bosses' lights in the source list (patches and knots), above the fire's and the hearths' ranges. */
const LIGHT_ID_BASE = 0x5000_0000;
/** Light id stride per boss (patches, then knots). */
const LIGHT_ID_STRIDE = 0x1_0000;
/** Light kind of a burning patch (the renderer's colour and the audio's crackle: the fire simulation's burning tile). */
export const BOSS_BURN_LIGHT_KIND = 'brand';
/** Light kind of a glowing weak point. */
export const BOSS_KNOT_LIGHT_KIND = 'boss_knoten';

/** What the bosses read from the player's life (bound after `addPlayerLifeSystems`). */
export interface BossLife {
  /** The world's enemy damage factor (the difficulty's preset or the world's override, §29; `WorldSettingsApi.factors`). */
  enemyDamage(): number;
  /** Whether the player's light is out (the death screen shows). */
  dead(): boolean;
  /** Fear rises by `amount` (§12.3 "Sichtung Elite/Boss +10"). */
  fright(sim: Simulation, amount: number): void;
  /** Applies a condition to the player (`brennen` in a burning patch). */
  condition(sim: Simulation, id: string): void;
}

/** Dependencies of the boss system. */
export interface BossesSystemDeps {
  readonly player: PlayerSystem;
  readonly collision: WorldCollision;
  readonly combat: Pick<CombatSystem, 'resolve' | 'addTargetProvider'>;
  readonly creatures: OwnedCreaturesApi;
  readonly drops: { spawn(sim: Simulation, stack: ReturnType<typeof newStack>, layer: Layer, x: number, y: number): unknown };
  readonly catalog: ItemCatalog;
  /** The bags a summoning item is taken from (`zugang.art` `beschwoerung`). */
  readonly inventory: Pick<InventorySystem, 'take'>;
  /** Where the arenas are (default: the generated world, `worldArenaSource`). */
  readonly arenas?: ArenaSource;
  /** The bosses (default: the content collection `bosses`). */
  readonly bosses?: readonly BossDef[];
}

/** A weak point's body: which boss, which point of the running phase. */
interface WeakPointRef {
  boss: number;
  point: number;
}

/** The trunks (while a boss lives) and the seal (while it is awake) as a collision overlay – methods, not closures (M6-16g). */
class BossOverlay implements CollisionOverlay {
  constructor(private readonly system: BossesSystem) {}

  overlayAt(layer: Layer, tx: number, ty: number): number {
    return this.system.blocksTile(layer, tx, ty) ? BLOCK_OBJECT : 0;
  }
}

export class BossesSystem implements SimSystem, BossesApi {
  readonly id = BOSSES_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The bosses' combat provider (`boss`, team `feind`). */
  readonly targets: CombatTargetProvider;
  readonly defs: readonly BossDef[];
  private readonly deps: BossesSystemDeps;
  private readonly arenaSource: ArenaSource;
  private readonly list: BossRuntime[];
  /** Arena per boss once found (null = not found yet or none). */
  private readonly arenas: (ArenaGeometry | null)[];
  /** Height level of each boss's tile (−1 unknown). */
  private readonly levels: number[];
  private readonly weakRefs = new Map<Entity, WeakPointRef>();
  private life: BossLife | null = null;
  private readonly pos = { x: 0, y: 0 };
  private readonly aim = { x: 0, y: 0 };
  private readonly scratch = { x: 0, y: 0 };
  private readonly attack: CombatAttack = createCombatAttack();
  /** The largest trunk radius of the bosses [px] (the tiles around it are told when the trunk comes or goes). */
  private readonly trunkReachPx: number;

  constructor(deps: BossesSystemDeps) {
    this.deps = deps;
    this.arenaSource = deps.arenas ?? worldArenaSource();
    this.defs = deps.bosses ?? (CONTENT.collection('bosses').values() as readonly BossDef[]);
    this.list = this.defs.map((d) => createBossRuntime(d.id, d.leben));
    this.arenas = this.defs.map(() => null);
    this.levels = this.defs.map(() => -1);
    this.trunkReachPx = this.defs.reduce((m, d) => Math.max(m, d.radiusPx), 0);
    this.attack.team = 'feind';
    this.attack.critChance = 0;
    this.attack.blockable = false;
    this.attack.kind = 'nahkampf';
    this.attack.projectile = false;
    this.targets = {
      id: BOSS_TARGETS_ID,
      queryCircle: (_s, layer, x, y, r, out) => this.queryCircle(layer, x, y, r, out),
      view: (s, e, out) => this.view(s, e, out),
      aware: () => true,
      applyHit: (s, e, h) => this.applyHit(s, e, h),
    };
    deps.combat.addTargetProvider(this.targets);
    deps.collision.addOverlay(new BossOverlay(this));
    this.commands = {
      'boss.summon': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.summon(s, cmd.boss, tick)),
      'boss.debug': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debug(s, cmd, tick)),
    };
    this.save = {
      id: BOSSES_SYSTEM_ID,
      version: BOSSES_SAVE_VERSION,
      // Saves before M7 know no bosses: every boss asleep with full health.
      migrations: [{ from: 0, migrate: (): BossesSnapshot => ({ bosses: this.defs.map((d) => createBossRuntime(d.id, d.leben)) }) }],
      serialize: (): BossesSnapshot => ({ bosses: this.list.map(copyBossRuntime) }),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Wiring and queries
  // -------------------------------------------------------------------------------------------

  /** Binds the player's life: enemy damage, death, fear, conditions. */
  useLife(life: BossLife): void {
    this.life = life;
  }

  /** The runtime record of boss `id` (read only: HUD, renderer, tests). */
  state(id: string): Readonly<BossRuntime> {
    const i = this.indexOf(id);
    if (i < 0) throw new RangeError(`BossesSystem: unknown boss "${id}"`);
    return this.list[i] as BossRuntime;
  }

  /** The content record of boss `id`. */
  def(id: string): BossDef {
    const i = this.indexOf(id);
    if (i < 0) throw new RangeError(`BossesSystem: unknown boss "${id}"`);
    return this.defs[i] as BossDef;
  }

  /** The arena of boss `id` (found once the world is there), or null. */
  arena(sim: Simulation, id: string): ArenaGeometry | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.arenaOf(sim, i);
  }

  awake(): string | null {
    for (const b of this.list) if (b.state === 'erwacht') return b.boss;
    return null;
  }

  defeated(boss: string): boolean {
    const i = this.indexOf(boss);
    return i >= 0 && (this.list[i] as BossRuntime).state === 'besiegt';
  }

  arenaAt(layer: Layer, tx: number, ty: number): string | null {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.arenas[i];
      if (a === null || a === undefined || a.layer !== layer) continue;
      const dx = tx - a.cx;
      const dy = ty - a.cy;
      if (dx * dx + dy * dy <= a.radiusTiles * a.radiusTiles) return (this.list[i] as BossRuntime).boss;
    }
    return null;
  }

  /**
   * The respawn spot "before the arena" (docs/SPIEL.md §22 "Wiedereinstieg"): when (x, y) on `layer` – the place of death –
   * lies in the arena of a boss not yet defeated, the point just outside its edge on the side of the beacon site; else null.
   */
  arenaSpot(sim: Simulation, x: number, y: number, layer: Layer): { readonly x: number; readonly y: number; readonly layer: Layer } | null {
    for (let i = 0; i < this.list.length; i++) {
      if ((this.list[i] as BossRuntime).state === 'besiegt') continue;
      const a = this.arenaOf(sim, i);
      if (a === null || a.layer !== layer) continue;
      const dx = x / TILE_PX - (a.cx + 1 / 2);
      const dy = y / TILE_PX - (a.cy + 1 / 2);
      const r = a.radiusTiles + B.leaveMarginTiles;
      if (dx * dx + dy * dy > r * r) continue;
      const out = a.radiusTiles + B.respawnOffsetTiles;
      return { x: (a.cx + 1 / 2 + a.outX * out) * TILE_PX, y: (a.cy + 1 / 2 + a.outY * out) * TILE_PX, layer: a.layer };
    }
    return null;
  }

  /** The sight in a leaf storm at (x, y) on `layer` [share of the normal view, 1 = none] (`blaettersturm`). */
  stormAt(layer: Layer, x: number, y: number, tick: number): number {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i] as BossRuntime;
      const a = this.arenas[i];
      if (a === null || a === undefined || a.layer !== layer || b.stormUntilTick === NO_TICK || tick >= b.stormUntilTick) continue;
      const dx = x / TILE_PX - (a.cx + 1 / 2);
      const dy = y / TILE_PX - (a.cy + 1 / 2);
      const r = a.radiusTiles + B.leaveMarginTiles;
      if (dx * dx + dy * dy <= r * r) return B.leafStormSight;
    }
    return 1;
  }

  /** The sight of the player in a leaf storm [share of the normal view, 1 = none]: `stormAt` where the player stands. */
  playerStormSight(sim: Simulation): number {
    const body = this.deps.player.body(sim);
    if (body === undefined || !this.deps.player.position(sim, this.pos)) return 1;
    return this.stormAt(body.layer, this.pos.x, this.pos.y, sim.tick);
  }

  /** Whether the arena of boss index `i` burns at `tick`. */
  burning(i: number, tick: number): boolean {
    const b = this.list[i] as BossRuntime;
    return b.burnUntilTick !== NO_TICK && tick < b.burnUntilTick;
  }

  /** Fills `out` for the HUD's bar and title card (the awake boss, else `active` false); no allocation. */
  sample(out: BossSample): BossSample {
    out.active = false;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i] as BossRuntime;
      if (b.state !== 'erwacht') continue;
      const d = this.defs[i] as BossDef;
      out.active = true;
      out.boss = b.boss;
      out.health = b.health;
      out.maxHealth = d.leben;
      out.phase = b.phase;
      out.phaseMarks.length = 0;
      for (let p = 1; p < d.phasen.length; p++) out.phaseMarks.push((d.phasen[p] as BossPhaseDef).abLebensanteil);
      out.titleUntilTick = b.awakenedTick + TITLE_TICKS;
      return out;
    }
    return out;
  }

  /** Whether tile (tx, ty) of `layer` is blocked by a living boss's trunk or a sealed arena's rim. */
  blocksTile(layer: Layer, tx: number, ty: number): boolean {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.arenas[i];
      if (a === null || a === undefined || a.layer !== layer) continue;
      const b = this.list[i] as BossRuntime;
      if (b.state !== 'besiegt' && this.onTrunk(i, a, tx, ty)) return true;
      if (b.sealed && this.onSeal(a, tx, ty)) return true;
    }
    return false;
  }

  /** The burning patches and the glowing knots of awake bosses as lights of the source list. */
  lightProvider(): ExtraLightProvider {
    const P = B.burnLight;
    const K = B.knotLight;
    return (sim, emit) => {
      const tick = sim.tick;
      for (let i = 0; i < this.list.length; i++) {
        const b = this.list[i] as BossRuntime;
        const a = this.arenas[i];
        if (a === null || a === undefined || b.state !== 'erwacht') continue;
        const base = LIGHT_ID_BASE + i * LIGHT_ID_STRIDE;
        if (this.burning(i, tick)) {
          for (let k = 0; k < a.burnTiles.length; k++) {
            const t = a.burnTiles[k] as { tx: number; ty: number };
            emit(base + k, BOSS_BURN_LIGHT_KIND, P.farbe, a.layer, (t.tx + 1 / 2) * TILE_PX, (t.ty + 1 / 2) * TILE_PX, P.flameHeightPx, P.radiusTiles * TILE_PX, P.intensity, P.flicker, (b.burnUntilTick - tick) / TICK_HZ, P.radiusTiles);
          }
        }
        const phase = (this.defs[i] as BossDef).phasen[b.phase];
        const points = phase?.schwachstellen;
        if (points === undefined) continue;
        for (let k = 0; k < points.length; k++) {
          const p = points[k] as { dx: number; dy: number };
          emit(base + LIGHT_ID_STRIDE / 2 + k, BOSS_KNOT_LIGHT_KIND, K.farbe, a.layer, a.bossX + p.dx, a.bossY + p.dy, 0, K.radiusTiles * TILE_PX, K.intensity, K.flicker, 1, K.radiusTiles);
        }
      }
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const tick = sim.tick;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i] as BossRuntime;
      if (b.state === 'besiegt') continue;
      const a = this.arenaOf(sim, i);
      if (a === null) continue;
      if (b.state === 'schlafend') {
        if ((this.defs[i] as BossDef).zugang.art === 'betreten' && this.playerInRing(sim, a, a.radiusTiles - B.innerRingInsetTiles)) this.wake(sim, i, a, tick);
        continue;
      }
      if (this.life?.dead() === true) {
        this.reset(sim, i, a, 'tod');
        continue;
      }
      if (!this.playerInRing(sim, a, a.radiusTiles + B.leaveMarginTiles)) {
        this.reset(sim, i, a, 'verlassen');
        continue;
      }
      this.fight(sim, i, a, tick);
    }
  }

  /** World tick: a player standing in a burning patch catches fire (like the fire simulation's flames). */
  worldTick(sim: Simulation): void {
    const life = this.life;
    if (life === null) return;
    const tick = sim.tick;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.arenas[i];
      if (a === null || a === undefined || !this.burning(i, tick)) continue;
      const body = this.deps.player.body(sim);
      if (body === undefined || body.layer !== a.layer || !this.deps.player.position(sim, this.pos)) continue;
      const r2 = B.burnPatchRadiusPx * B.burnPatchRadiusPx;
      for (const t of a.burnTiles) {
        const dx = this.pos.x - (t.tx + 1 / 2) * TILE_PX;
        const dy = this.pos.y - (t.ty + 1 / 2) * TILE_PX;
        if (dx * dx + dy * dy > r2) continue;
        life.condition(sim, BURNING_CONDITION);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // The fight
  // -------------------------------------------------------------------------------------------

  private fight(sim: Simulation, i: number, a: ArenaGeometry, tick: number): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    if (b.stormUntilTick !== NO_TICK && tick >= b.stormUntilTick) b.stormUntilTick = NO_TICK;
    if (b.burnUntilTick !== NO_TICK && tick >= b.burnUntilTick) b.burnUntilTick = NO_TICK;
    if (tick < b.transitionUntilTick) return;
    const phase = d.phasen[b.phase] as BossPhaseDef;
    if (b.attackIndex >= 0) {
      if (tick < b.attackEndTick) return;
      const attack = phase.angriffe[b.attackIndex];
      if (attack !== undefined) this.strike(sim, i, a, attack, tick);
      b.attack = '';
      b.attackIndex = -1;
      b.attackStartTick = NO_TICK;
      b.attackEndTick = NO_TICK;
      b.nextAttackTick = tick + attackGapTicks(phase.tempo, sim.rng.stream(BOSSES_RNG_STREAM).next());
      return;
    }
    if (tick < b.nextAttackTick) return;
    const k = chooseAttack(phase.angriffe, (n) => b.readyAt[n] ?? 0, tick, sim.rng.stream(BOSSES_RNG_STREAM).next());
    if (k < 0) return;
    const attack = phase.angriffe[k] as BossAttackDef;
    if (!this.deps.player.position(sim, this.pos)) return;
    lockAim(attack, a.bossX, a.bossY, this.pos.x, this.pos.y, this.aim);
    const ticks = telegraphTicks(attack);
    b.attack = attack.id;
    b.attackIndex = k;
    b.attackStartTick = tick;
    b.attackEndTick = tick + ticks;
    b.aimX = this.aim.x;
    b.aimY = this.aim.y;
    b.aimAngle = Math.atan2(this.pos.y - a.bossY, this.pos.x - a.bossX);
    b.readyAt[k] = tick + ticks + cooldownTicks(attack, phase.tempo);
    const area: BossTelegraphArea = attack.art === 'flaeche' ? attack.form : attack.art;
    sim.events.push('bossTelegraph', { boss: b.boss, angriff: attack.id, ticks, flaeche: area, x: b.aimX, y: b.aimY, angle: b.aimAngle, tick: sim.eventTick });
  }

  /** The telegraphed attack lands. */
  private strike(sim: Simulation, i: number, a: ArenaGeometry, attack: BossAttackDef, tick: number): void {
    const b = this.list[i] as BossRuntime;
    sim.events.push('bossAttack', { boss: b.boss, angriff: attack.id, x: b.aimX, y: b.aimY, angle: b.aimAngle, tick: sim.eventTick });
    if (attack.art === 'flaeche') this.areaHit(sim, i, a, attack);
    else if (attack.art === 'beschwoerung') this.summonServants(sim, i, a, attack);
    else if (attack.effekt === 'blaettersturm') b.stormUntilTick = tick + Math.round(attack.sekunden * TICK_HZ);
    else b.burnUntilTick = tick + Math.round(attack.sekunden * TICK_HZ);
  }

  private areaHit(sim: Simulation, i: number, a: ArenaGeometry, attack: BossAreaAttackDef): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    const body = this.deps.player.body(sim);
    if (body === undefined || body.layer !== a.layer || !this.deps.player.position(sim, this.pos)) return;
    if (!inBossArea(attack, a.bossX, a.bossY, d.radiusPx, b.aimAngle, b.aimX, b.aimY, this.pos.x, this.pos.y, PLAYER_RADIUS_PX, this.scratch)) return;
    const at = this.attack;
    at.damage = bossAttackDamage(attack, this.life?.enemyDamage() ?? BALANCE.difficulty.presets.normal.enemyDamage);
    at.type = attack.schadensart;
    at.wucht = bossAttackWucht(attack);
    at.staggerSeconds = 0;
    at.condition = null;
    at.armorBreak = 0;
    at.armorBreakSeconds = 0;
    at.backstab = 1;
    at.fromX = a.bossX;
    at.fromY = a.bossY;
    this.deps.combat.resolve(sim, b.entity, sim.player, at);
  }

  private summonServants(sim: Simulation, i: number, a: ArenaGeometry, attack: Extract<BossAttackDef, { art: 'beschwoerung' }>): void {
    const b = this.list[i] as BossRuntime;
    const owner = `boss:${b.boss}` as const;
    const room = attack.maxGleichzeitig - this.deps.creatures.countOwned(owner);
    const n = Math.min(attack.anzahl, room);
    for (let k = 0; k < n; k++) {
      const angle = b.aimAngle + (2 * Math.PI * k) / Math.max(1, n);
      this.deps.creatures.spawnOwned(sim, {
        creature: attack.kreatur,
        layer: a.layer,
        x: a.bossX + Math.cos(angle) * B.summonRingPx,
        y: a.bossY + Math.sin(angle) * B.summonRingPx,
        owner,
        leashTiles: a.radiusTiles,
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // States
  // -------------------------------------------------------------------------------------------

  private wake(sim: Simulation, i: number, a: ArenaGeometry, tick: number): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    b.state = 'erwacht';
    b.phase = 0;
    b.health = d.leben;
    b.sealed = true;
    b.awakenedTick = tick;
    b.defeatedTick = NO_TICK;
    b.transitionUntilTick = tick + TITLE_TICKS;
    b.nextAttackTick = tick + TITLE_TICKS;
    this.clearAttack(b);
    b.readyAt = (d.phasen[0] as BossPhaseDef).angriffe.map(() => 0);
    b.stormUntilTick = NO_TICK;
    b.burnUntilTick = NO_TICK;
    this.createBodies(sim, i);
    this.invalidateArena(a, true);
    this.life?.fright(sim, B.sightingFear);
    sim.events.push('bossAwakened', { boss: b.boss, x: a.bossX, y: a.bossY, tick: sim.eventTick });
  }

  private reset(sim: Simulation, i: number, a: ArenaGeometry, grund: BossResetReason): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    this.deps.creatures.despawnOwned(sim, `boss:${b.boss}`);
    this.destroyBodies(sim, i);
    b.state = 'schlafend';
    b.phase = 0;
    b.health = d.leben;
    b.sealed = false;
    b.awakenedTick = NO_TICK;
    b.transitionUntilTick = NO_TICK;
    b.nextAttackTick = NO_TICK;
    this.clearAttack(b);
    b.readyAt = [];
    b.stormUntilTick = NO_TICK;
    b.burnUntilTick = NO_TICK;
    this.invalidateArena(a, true);
    sim.events.push('bossReset', { boss: b.boss, grund, tick: sim.eventTick });
  }

  private defeat(sim: Simulation, i: number, tick: number): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    const a = this.arenaOf(sim, i);
    this.deps.creatures.despawnOwned(sim, `boss:${b.boss}`);
    this.destroyBodies(sim, i);
    b.state = 'besiegt';
    b.health = 0;
    b.sealed = false;
    b.defeatedTick = tick;
    b.transitionUntilTick = NO_TICK;
    b.nextAttackTick = NO_TICK;
    this.clearAttack(b);
    b.stormUntilTick = NO_TICK;
    b.burnUntilTick = NO_TICK;
    if (a !== null) {
      this.invalidateArena(a, true);
      if (!b.lootGiven) this.dropLoot(sim, d, a);
    }
    b.lootGiven = true;
    sim.events.push('bossDefeated', { boss: b.boss, dauerTicks: Math.max(0, tick - b.awakenedTick), x: a?.bossX ?? 0, y: a?.bossY ?? 0, tick: sim.eventTick });
  }

  /** Unique drops, trophy, heart shard and the rest, spread around the boss's place (`DropSystem.spawn`). */
  private dropLoot(sim: Simulation, d: BossDef, a: ArenaGeometry): void {
    const rng = sim.rng.stream(BOSSES_RNG_STREAM);
    const stacks: { item: string; count: number }[] = [];
    for (const item of d.beute.einzigartig) stacks.push({ item, count: 1 });
    stacks.push({ item: d.beute.trophaee, count: 1 });
    stacks.push({ item: d.beute.herzsplitter, count: 1 });
    for (const w of d.beute.weitere) {
      const [min, max] = w.anzahl;
      stacks.push({ item: w.item, count: min + Math.floor(rng.next() * (max - min + 1)) });
    }
    const ring = d.radiusPx + TILE_PX;
    for (let k = 0; k < stacks.length; k++) {
      const s = stacks[k] as { item: string; count: number };
      // Spilled in a fan in front of the trunk (towards the way in): never under the dead tree's foot.
      const angle = Math.atan2(a.outY, a.outX) + ((k - (stacks.length - 1) / 2) * Math.PI) / Math.max(2, stacks.length);
      this.deps.drops.spawn(sim, newStack(this.deps.catalog.get(s.item), s.count), a.layer, a.bossX + Math.cos(angle) * ring, a.bossY + Math.sin(angle) * ring);
    }
  }

  private clearAttack(b: BossRuntime): void {
    b.attack = '';
    b.attackIndex = -1;
    b.attackStartTick = NO_TICK;
    b.attackEndTick = NO_TICK;
  }

  /** A new phase: the running attack ends, a short invulnerable transition, fresh cooldowns. */
  private enterPhase(sim: Simulation, i: number, phase: number, tick: number): void {
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    const p = d.phasen[phase] as BossPhaseDef;
    b.phase = phase;
    this.clearAttack(b);
    b.transitionUntilTick = tick + Math.round(p.uebergangSekunden * TICK_HZ);
    b.nextAttackTick = b.transitionUntilTick;
    b.readyAt = p.angriffe.map(() => 0);
    this.syncWeakPoints(sim, i);
    sim.events.push('bossPhaseChanged', { boss: b.boss, phase, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Bodies (combat provider)
  // -------------------------------------------------------------------------------------------

  private createBodies(sim: Simulation, i: number): void {
    const b = this.list[i] as BossRuntime;
    b.entity = sim.ecs.create();
    b.weakPoints = [];
    this.levels[i] = -1;
    this.syncWeakPoints(sim, i);
  }

  /** Weak point bodies for the running phase (created or destroyed to match its count). */
  private syncWeakPoints(sim: Simulation, i: number): void {
    const b = this.list[i] as BossRuntime;
    const points = (this.defs[i] as BossDef).phasen[b.phase]?.schwachstellen?.length ?? 0;
    while (b.weakPoints.length > points) {
      const e = b.weakPoints.pop() as Entity;
      this.weakRefs.delete(e);
      if (sim.ecs.alive(e)) sim.ecs.queueDestroy(e);
    }
    while (b.weakPoints.length < points) {
      const e = sim.ecs.create();
      b.weakPoints.push(e);
    }
    for (let k = 0; k < b.weakPoints.length; k++) this.weakRefs.set(b.weakPoints[k] as Entity, { boss: i, point: k });
  }

  private destroyBodies(sim: Simulation, i: number): void {
    const b = this.list[i] as BossRuntime;
    if (b.entity !== NULL_ENTITY && sim.ecs.alive(b.entity)) sim.ecs.queueDestroy(b.entity);
    b.entity = NULL_ENTITY;
    for (const e of b.weakPoints) {
      this.weakRefs.delete(e);
      if (sim.ecs.alive(e)) sim.ecs.queueDestroy(e);
    }
    b.weakPoints = [];
  }

  /** Boss index of a body entity (the boss's own), or −1. */
  private bossOfBody(e: Entity): number {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i] as BossRuntime;
      if (b.state === 'erwacht' && b.entity === e && e !== NULL_ENTITY) return i;
    }
    return -1;
  }

  private queryCircle(layer: number, x: number, y: number, r: number, out: Entity[]): void {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i] as BossRuntime;
      const a = this.arenas[i];
      if (b.state !== 'erwacht' || a === null || a === undefined || a.layer !== layer) continue;
      const d = this.defs[i] as BossDef;
      const dx = a.bossX - x;
      const dy = a.bossY - y;
      const reach = r + d.radiusPx;
      if (dx * dx + dy * dy <= reach * reach) out.push(b.entity);
      const points = d.phasen[b.phase]?.schwachstellen;
      if (points === undefined) continue;
      for (let k = 0; k < points.length && k < b.weakPoints.length; k++) {
        const p = points[k] as { dx: number; dy: number; radiusPx: number };
        const px = a.bossX + p.dx - x;
        const py = a.bossY + p.dy - y;
        const pr = r + p.radiusPx;
        if (px * px + py * py <= pr * pr) out.push(b.weakPoints[k] as Entity);
      }
    }
  }

  private view(sim: Simulation, e: Entity, out: CombatantView): boolean {
    let i = this.bossOfBody(e);
    let point = -1;
    if (i < 0) {
      const ref = this.weakRefs.get(e);
      if (ref === undefined) return false;
      i = ref.boss;
      point = ref.point;
    }
    const b = this.list[i] as BossRuntime;
    const a = this.arenas[i];
    if (b.state !== 'erwacht' || a === null || a === undefined) return false;
    const d = this.defs[i] as BossDef;
    const phase = d.phasen[b.phase] as BossPhaseDef;
    out.entity = e;
    out.team = 'feind';
    out.layer = a.layer;
    out.level = this.levelOf(i, a);
    out.facing = 0;
    out.health = b.health;
    out.maxHealth = d.leben;
    out.invulnerable = sim.eventTick < b.transitionUntilTick;
    out.blockSinceTick = -1;
    out.blockPower = 0;
    out.material = 'holz';
    // In a phase of weak points the bark turns every blow: the body takes nothing (a dull knock), the knots take the hits.
    const armoured = phase.verwundbar === 'schwachstellen' && point < 0;
    for (const t of DAMAGE_TYPES) out.resist[t] = armoured ? 1 : (phase.resistenzen?.[t] ?? d.resistenzen[t] ?? 0);
    if (point < 0) {
      out.x = a.bossX;
      out.y = a.bossY;
      out.radius = d.radiusPx;
      out.armor = d.ruestung;
    } else {
      const p = phase.schwachstellen?.[point];
      if (p === undefined) return false;
      out.x = a.bossX + p.dx;
      out.y = a.bossY + p.dy;
      out.radius = p.radiusPx;
      // The glowing knots are its open wounds: no bark over them.
      out.armor = 0;
    }
    return true;
  }

  private applyHit(sim: Simulation, e: Entity, h: HitResult): void {
    let i = this.bossOfBody(e);
    if (i < 0) i = this.weakRefs.get(e)?.boss ?? -1;
    if (i < 0) return;
    const b = this.list[i] as BossRuntime;
    if (b.state !== 'erwacht' || h.amount <= 0) return;
    const d = this.defs[i] as BossDef;
    const tick = sim.eventTick;
    b.health = Math.max(0, b.health - h.amount);
    if (b.health <= 0) {
      this.defeat(sim, i, tick);
      return;
    }
    const phase = phaseFor(d, b.health, d.leben);
    if (phase > b.phase) this.enterPhase(sim, i, phase, tick);
  }

  private levelOf(i: number, a: ArenaGeometry): number {
    let level = this.levels[i] as number;
    if (level < 0) {
      level = infoLevel(this.deps.collision.grid.tileInfo(a.layer, Math.floor(a.bossX / TILE_PX), Math.floor(a.bossY / TILE_PX)));
      this.levels[i] = level;
    }
    return level;
  }

  // -------------------------------------------------------------------------------------------
  // Arena
  // -------------------------------------------------------------------------------------------

  private arenaOf(sim: Simulation, i: number): ArenaGeometry | null {
    const known = this.arenas[i];
    if (known !== null && known !== undefined) return known;
    const a = this.arenaSource(sim, (this.defs[i] as BossDef).biom);
    if (a === null) return null;
    this.arenas[i] = a;
    // The trunk stands from now on: tiles a memo may hold as open take it.
    this.invalidateArena(a, false);
    return a;
  }

  private onTrunk(i: number, a: ArenaGeometry, tx: number, ty: number): boolean {
    const r = (this.defs[i] as BossDef).radiusPx;
    const dx = (tx + 1 / 2) * TILE_PX - a.bossX;
    const dy = (ty + 1 / 2) * TILE_PX - a.bossY;
    return dx * dx + dy * dy <= r * r;
  }

  private onSeal(a: ArenaGeometry, tx: number, ty: number): boolean {
    const dx = tx - a.cx;
    const dy = ty - a.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.abs(d - a.radiusTiles) <= B.sealHalfWidthTiles;
  }

  /** Tells the collision grid (and its listeners: the light map, the paths) that the trunk or the seal of `a` changed. */
  private invalidateArena(a: ArenaGeometry, seal: boolean): void {
    const r = Math.ceil(a.radiusTiles + B.sealHalfWidthTiles) + 1;
    for (let ty = a.cy - r; ty <= a.cy + r; ty++) {
      for (let tx = a.cx - r; tx <= a.cx + r; tx++) {
        const dx = (tx + 1 / 2) * TILE_PX - a.bossX;
        const dy = (ty + 1 / 2) * TILE_PX - a.bossY;
        const reach = (this.trunkReachPx + TILE_PX) * (this.trunkReachPx + TILE_PX);
        const nearTrunk = dx * dx + dy * dy <= reach;
        if (nearTrunk || (seal && this.onSeal(a, tx, ty))) this.deps.collision.invalidateTile(a.layer, tx, ty);
      }
    }
  }

  private playerInRing(sim: Simulation, a: ArenaGeometry, radiusTiles: number): boolean {
    const body = this.deps.player.body(sim);
    if (body === undefined || body.layer !== a.layer || !this.deps.player.position(sim, this.pos)) return false;
    if (this.life?.dead() === true) return false;
    const dx = this.pos.x / TILE_PX - (a.cx + 1 / 2);
    const dy = this.pos.y / TILE_PX - (a.cy + 1 / 2);
    return dx * dx + dy * dy <= radiusTiles * radiusTiles;
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: 'boss.summon' | 'boss.debug', tick: number, reason: BossRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  private summon(sim: Simulation, id: string, tick: number): BossRejectReason | null {
    const i = this.indexOf(id);
    if (i < 0) return 'unknownBoss';
    const d = this.defs[i] as BossDef;
    const b = this.list[i] as BossRuntime;
    if (d.zugang.art !== 'beschwoerung') return 'noSummoning';
    if (b.state === 'erwacht') return 'awake';
    if (b.state === 'besiegt') return 'defeated';
    const a = this.arenaOf(sim, i);
    if (a === null) return 'noArena';
    if (this.deps.player.body(sim) === undefined) return 'noPlayer';
    if (!this.playerInRing(sim, a, a.radiusTiles)) return 'notInArena';
    // The offering at the altar is used up (§20.2 "Beschwörung … mit Item").
    if (this.deps.inventory.take(sim, d.zugang.item, 1) === null) return 'missingItem';
    this.wake(sim, i, a, tick);
    return null;
  }

  private debug(sim: Simulation, cmd: CommandOfType<'boss.debug'>, tick: number): BossRejectReason | null {
    const i = this.indexOf(cmd.boss);
    if (i < 0) return 'unknownBoss';
    const b = this.list[i] as BossRuntime;
    const d = this.defs[i] as BossDef;
    const a = this.arenaOf(sim, i);
    if (a === null) return 'noArena';
    switch (cmd.aktion) {
      case 'wecken':
        if (b.state === 'erwacht') return 'awake';
        if (b.state === 'besiegt') return 'defeated';
        this.wake(sim, i, a, tick);
        return null;
      case 'phase': {
        if (b.state !== 'erwacht') return 'asleep';
        const p = cmd.phase ?? 0;
        if (p >= d.phasen.length || p <= b.phase) return 'noPhase';
        b.health = Math.min(b.health, (d.phasen[p] as BossPhaseDef).abLebensanteil * d.leben);
        this.enterPhase(sim, i, p, tick);
        return null;
      }
      case 'besiegen':
        if (b.state === 'besiegt') return 'defeated';
        if (b.state === 'schlafend') this.wake(sim, i, a, tick);
        this.defeat(sim, i, tick);
        return null;
      case 'zuruecksetzen':
        if (b.state !== 'erwacht') return 'asleep';
        this.reset(sim, i, a, 'debug');
        return null;
    }
  }

  private indexOf(id: string): number {
    for (let i = 0; i < this.defs.length; i++) if ((this.defs[i] as BossDef).id === id) return i;
    return -1;
  }

  private restore(data: unknown): void {
    const parsed = bossesSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`bosses snapshot invalid: ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    const byId = new Map(parsed.data.bosses.map((r) => [r.boss, r]));
    for (const r of parsed.data.bosses) if (this.indexOf(r.boss) < 0) throw new TypeError(`bosses snapshot invalid: unknown boss "${r.boss}"`);
    this.weakRefs.clear();
    for (let i = 0; i < this.defs.length; i++) {
      const d = this.defs[i] as BossDef;
      const r = byId.get(d.id);
      const b = r === undefined ? createBossRuntime(d.id, d.leben) : copyBossRuntime(r);
      if (b.phase >= d.phasen.length) throw new TypeError(`bosses snapshot invalid: ${d.id} in phase ${b.phase} of ${d.phasen.length}`);
      this.list[i] = b;
      this.levels[i] = -1;
      for (let k = 0; k < b.weakPoints.length; k++) this.weakRefs.set(b.weakPoints[k] as Entity, { boss: i, point: k });
    }
    // The seal and the trunks may differ from what the collision memo holds (a load into a running world).
    for (let i = 0; i < this.arenas.length; i++) {
      const a = this.arenas[i];
      if (a !== null && a !== undefined) this.invalidateArena(a, true);
    }
  }
}
