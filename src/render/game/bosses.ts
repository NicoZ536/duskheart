/**
 * The bosses in the game view (MASTERPROMPT §20.2, §19.4 "Boss-Flächenangriffe mit Bodenmarkierung", §4.6, §2.8; docs/SPIEL.md
 * §22, §30 "Render-Szenen-Teile"; strand F, M7-32 … M7-34). Read only from the system `bosses` (found once per simulation):
 *
 * - **Body** `<sprite>` (`boss_borkenvater`, multi-part, assets-src/sprites/bosse/) at the boss's place in its arena, the clip
 *   by its state: asleep `ruht`; waking `erwachen` (for its length after `awakenedTick`); an attack's own clip (the content's
 *   `clip`) – the positions before its `schlag`-like event spread over the telegraph, the event's position on the tick the
 *   blow lands, the rest at the clip's pace after it (the recovery is played from a remembered copy of the attack: the
 *   system clears it on the strike); between attacks the phase's idle (phase 1 `idle`, a weak-point phase `panzer`, else the
 *   clip named like the phase – `raserei`); defeated `tod`, whose last frame stays: the dead tree. A hit flashes it white.
 * - **Weak points** `<sprite>_knoten` (clip `glimmen`) on the knots while the phase takes damage only there (§4.6: the target
 *   stays readable in every clip).
 * - **Telegraphs** of area attacks on the ground in the warning colour (`kampf_punkt`, like the creatures' markers of
 *   `telegraphs.ts`): `linie` – a crack that runs out from the trunk along each line while its edges march as dashes;
 *   `ring` – both edges of the band dashed, the dithered fill thickening; `kreis` – ring and a growing inner ring at each
 *   circle; `kegel` – edges and arc. Then **roots burst** (`<sprite>_wurzel`, clip `aus`) along the struck area.
 * - **Arena effects**: the burning patches (`brand`, clip `gross`) while the arena burns; the leaf storm – leaves
 *   (`partikel_blatt`) circling the arena above everything (the sight itself closes through `GameSession.sampleSight`);
 *   the seal – roots standing out of the ground around the rim while the arena is sealed.
 *
 * Allocation-free per frame: sprites looked up once per atlas, clip positions computed from numbers, fixed rings.
 */
import type { BossAreaAttackDef, BossAttackDef, BossDef, BossPhaseDef } from '../../content/bosses/schema';
import { BALANCE } from '../../content/balance';
import { BossesSystem } from '../../game/bosses/system';
import type { BossRuntime } from '../../game/bosses/state';
import type { ArenaGeometry } from '../../game/bosses/arena';
import { fanAngle, circleCentre } from '../../game/bosses/formulas';
import type { GameSession } from '../../game/session';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { AnimationClip } from '../anim/animation';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { CircleCache, DOT_SPRITE, PUNKT } from './combatFeedback';

const TICK_HZ = BALANCE.time.tickHz;
/** Ticks a hit flashes the body white (§6.2 "2-Frame-Trefferblitz", at 60 Hz a little longer to be seen). */
const FLASH_TICKS = 4;
/** Ground marker: dash period and lit pixels, march speed [ticks per pixel] (as the creatures' markers). */
const DASH = { period: 8, lit: 5, ticksPerStep: 4 } as const;
/** Largest share of a band or disc the dithered fill covers (at the blow). */
const FILL_MAX = 0.22;
/** Emissive boost of the markers and the knots (readable by day, glowing at night). */
const MARKER_GLOW = 0.5;
const KNOT_GLOW = 0.6;
/** Distance of the root bursts along a struck line or ring [px], and how long they stand [ticks]. */
const BURST_SPACING_PX = 22;
const BURST_TICKS = Math.round(0.7 * TICK_HZ);
/** Burning patches: phase offset per patch [s] (neighbours do not flicker in step). */
const FLAME_PHASE = 0.37;
/** Leaves of the storm: how many, how fast they circle [rad/s], how high they fly [px]. */
const STORM_LEAVES = 42;
const STORM_SPEED = 1.6;
const STORM_HEIGHT_PX = 26;
/** Spacing of the sealing roots around the rim [px]. */
const SEAL_SPACING_PX = 26;
/** Clip position of the root burst that shows a root standing out of the ground (the seal). */
const SEAL_ROOT_POSITION = 3;
/** 4×4 Bayer thresholds (0…15)/16 of the fills. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
/** The clip names a boss sprite may use beyond the attack clips. */
export const BOSS_CLIPS = { asleep: 'ruht', waking: 'erwachen', idle: 'idle', weak: 'panzer', dead: 'tod', knot: 'glimmen', burst: 'aus' } as const;
/** Events of an attack clip that mark the blow (the first found; else the clip's middle). */
const STRIKE_EVENTS: readonly string[] = ['schlag', 'ruf', 'sturm', 'treffer'];
/** The burning patches' and the storm's sprites. */
const FLAME_SPRITE = 'brand';
const FLAME_CLIP = 'gross';
const LEAF_SPRITE = 'partikel_blatt';
const LEAF_CLIP = 'flug';

/** What the boss view needs of the game view's frame. */
export interface BossFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s] and the simulation's time [ticks, with the render fraction]. */
  time: number;
  now: number;
  /** Height level of a tile. */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createBossFrame(): BossFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, now: 0, levelAt: () => 0 };
}

/** Counters of the last frame (debug info, tests). */
export interface BossViewStats {
  bodies: number;
  knots: number;
  markers: number;
  markerPixels: number;
  bursts: number;
  flames: number;
  leaves: number;
  sealRoots: number;
}

/** The sprites of one boss, looked up once per atlas. */
interface BossSprites {
  readonly body: AtlasSprite | null;
  readonly knot: AtlasSprite | null;
  readonly burst: AtlasSprite | null;
}

/** The attack the view remembers for its recovery frames and root bursts (the system clears it on the strike). */
interface Remembered {
  attack: BossAttackDef | null;
  start: number;
  end: number;
  angle: number;
  aimX: number;
  aimY: number;
}

/** Position of the blow in an attack clip (see module comment). */
export function strikePosition(clip: AnimationClip): number {
  const events = clip.events;
  if (events !== undefined)
    for (let n = 0; n < STRIKE_EVENTS.length; n++)
      for (let k = 0; k < events.length; k++) {
        const e = events[k] as { frame: number; name: string };
        if (e.name === STRIKE_EVENTS[n]) return e.frame;
      }
  return Math.floor(clip.frames.length / 2);
}

/**
 * Clip position of an attack clip at `now` [ticks] for a wind-up from `start` to `end` (the blow): before it the positions up
 * to the strike spread over the telegraph, from it on the clip's own pace.
 */
export function attackPosition(clip: AnimationClip, start: number, end: number, now: number): number {
  const strike = strikePosition(clip);
  if (now < end) {
    if (strike === 0) return 0;
    const share = (now - start) / Math.max(1, end - start);
    return Math.max(0, Math.min(strike - 1, Math.floor(share * strike)));
  }
  return Math.min(clip.frames.length - 1, strike + Math.floor(((now - end) / TICK_HZ) * clip.fps));
}

export class BossView {
  readonly stats: BossViewStats = { bodies: 0, knots: 0, markers: 0, markerPixels: 0, bursts: 0, flames: 0, leaves: 0, sealRoots: 0 };
  private system: BossesSystem | null = null;
  private systemSim: Simulation | null = null;
  private manifest: AtlasManifest | null = null;
  private readonly sprites = new Map<string, BossSprites>();
  private dot: AtlasSprite | null = null;
  private flame: AtlasSprite | null = null;
  private leaf: AtlasSprite | null = null;
  private readonly remembered: Remembered[] = [];
  private readonly lastHit: number[] = [];
  private readonly circles = new CircleCache();
  private readonly scratch = { x: 0, y: 0 };
  private subscribed: unknown = null;
  private unsubscribe: (() => void) | null = null;

  /** Follows the session's hits (the white flash of a struck boss). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed === session) return;
    this.unsubscribe?.();
    this.subscribed = session;
    this.unsubscribe = session.onEvent('hitLanded', (e) => this.hit(e.target, e.tick));
  }

  private hit(target: number, tick: number): void {
    const s = this.system;
    if (s === null) return;
    for (let i = 0; i < s.defs.length; i++) {
      const b = s.state((s.defs[i] as BossDef).id);
      if (b.entity === target || b.weakPoints.includes(target)) this.lastHit[i] = tick;
    }
  }

  /** Draws the bosses of the frame's layer inside its pushed rectangle. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: BossFrame): void {
    const st = this.stats;
    st.bodies = 0;
    st.knots = 0;
    st.markers = 0;
    st.markerPixels = 0;
    st.bursts = 0;
    st.flames = 0;
    st.leaves = 0;
    st.sealRoots = 0;
    const s = this.systemOf(sim);
    if (s === null) return;
    this.bind(atlas.manifest);
    for (let i = 0; i < s.defs.length; i++) {
      const d = s.defs[i] as BossDef;
      const a = s.arena(sim, d.id);
      if (a === null || a.layer !== f.layer) continue;
      const margin = (a.radiusTiles + 4) * TILE_PX;
      if (a.bossX < f.left - margin || a.bossX > f.right + margin || a.bossY < f.top - margin || a.bossY > f.bottom + margin) continue;
      const b = s.state(d.id);
      const sp = this.spritesOf(d);
      const memo = this.memo(i);
      if (b.attackIndex >= 0) {
        const attack = (d.phasen[b.phase] as BossPhaseDef).angriffe[b.attackIndex];
        if (attack !== undefined) {
          memo.attack = attack;
          memo.start = b.attackStartTick;
          memo.end = b.attackEndTick;
          memo.angle = b.aimAngle;
          memo.aimX = b.aimX;
          memo.aimY = b.aimY;
        }
      }
      const base = f.levelAt(Math.floor(a.bossX / TILE_PX), Math.floor(a.bossY / TILE_PX)) * WAND_PX_JE_STUFE;
      if (sp.body !== null) this.body(scene, sp.body, d, b, memo, a, f, base, i);
      if (b.state !== 'erwacht') continue;
      const phase = d.phasen[b.phase] as BossPhaseDef;
      if (phase.verwundbar === 'schwachstellen' && sp.knot !== null) this.knots(scene, sp.knot, phase, a, f, base);
      if (memo.attack !== null && memo.attack.art === 'flaeche') {
        if (f.now < memo.end && b.attackIndex >= 0) this.marker(scene, memo.attack, memo, a, d, f, base);
        else if (sp.burst !== null && f.now >= memo.end && f.now < memo.end + BURST_TICKS) this.bursts(scene, sp.burst, memo.attack, memo, a, d, f, base);
      }
      if (b.sealed && sp.burst !== null) this.seal(scene, sp.burst, a, base);
      if (s.burning(i, sim.tick)) this.flames(scene, a, f);
      if (b.stormUntilTick > sim.tick) this.storm(scene, a, f, base);
    }
  }

  /** The body in the clip of its state. */
  private body(scene: RenderScene, s: AtlasSprite, d: BossDef, b: Readonly<BossRuntime>, memo: Remembered, a: ArenaGeometry, f: BossFrame, base: number, i: number): void {
    let clip: AnimationClip | undefined;
    let position = 0;
    const now = f.now;
    if (b.state === 'schlafend') {
      clip = s.clips[BOSS_CLIPS.asleep];
      if (clip !== undefined) position = -1;
    } else if (b.state === 'besiegt') {
      clip = s.clips[BOSS_CLIPS.dead];
      if (clip !== undefined) position = Math.min(clip.frames.length - 1, Math.floor(((now - b.defeatedTick) / TICK_HZ) * clip.fps));
    } else {
      const waking = s.clips[BOSS_CLIPS.waking];
      const wakingTicks = waking === undefined ? 0 : (waking.frames.length / waking.fps) * TICK_HZ;
      const attackClip = memo.attack === null ? undefined : s.clips[memo.attack.clip];
      if (waking !== undefined && now < b.awakenedTick + wakingTicks) {
        clip = waking;
        position = Math.floor(((now - b.awakenedTick) / TICK_HZ) * waking.fps);
      } else if (attackClip !== undefined && (b.attackIndex >= 0 || now < memo.end + (attackClip.frames.length - strikePosition(attackClip)) * (TICK_HZ / attackClip.fps))) {
        clip = attackClip;
        position = attackPosition(attackClip, memo.start, memo.end, now);
      } else {
        clip = s.clips[this.idleClip(d, b.phase, s)];
        if (clip !== undefined) position = -1;
      }
    }
    const frameIndex = clip === undefined ? 0 : position < 0 ? clipFrameAt(clip, f.time) : (clip.frames[Math.max(0, Math.min(clip.frames.length - 1, position))] ?? 0);
    const dsc = scene.sprite.reset();
    dsc.frame = (s.frames[frameIndex] ?? s.frames[0]) as SpriteFrameRef;
    dsc.x = a.bossX;
    dsc.y = a.bossY;
    dsc.heightBase = base;
    dsc.flash = b.state === 'erwacht' && now - (this.lastHit[i] ?? Number.NEGATIVE_INFINITY) < FLASH_TICKS;
    dsc.emissiveBoost = b.state === 'erwacht' ? 0.25 : 0;
    scene.sprites.push(dsc);
    this.stats.bodies++;
  }

  /** The idle clip of phase `phase`: phase 1 `idle`, a weak-point phase `panzer`, else the clip named like the phase. */
  private idleClip(d: BossDef, phase: number, s: AtlasSprite): string {
    if (phase === 0) return BOSS_CLIPS.idle;
    const p = d.phasen[phase] as BossPhaseDef;
    if (p.verwundbar === 'schwachstellen' && s.clips[BOSS_CLIPS.weak] !== undefined) return BOSS_CLIPS.weak;
    return s.clips[p.id] !== undefined ? p.id : BOSS_CLIPS.idle;
  }

  private knots(scene: RenderScene, s: AtlasSprite, phase: BossPhaseDef, a: ArenaGeometry, f: BossFrame, base: number): void {
    const clip = s.clips[BOSS_CLIPS.knot];
    const points = phase.schwachstellen ?? [];
    for (let k = 0; k < points.length; k++) {
      const p = points[k] as { dx: number; dy: number };
      const d = scene.sprite.reset();
      d.frame = (s.frames[clip === undefined ? 0 : clipFrameAt(clip, f.time + k * 0.21)] ?? s.frames[0]) as SpriteFrameRef;
      d.x = a.bossX + p.dx;
      d.y = a.bossY + p.dy;
      // Over the root it glows on (its own y would sort it under the trunk's front roots).
      d.depth = a.bossY + p.dy + TILE_PX;
      d.heightBase = base;
      d.emissiveBoost = KNOT_GLOW;
      scene.sprites.push(d);
      this.stats.knots++;
    }
  }

  /** The ground marker of an area attack during its wind-up. */
  private marker(scene: RenderScene, attack: BossAreaAttackDef, m: Remembered, a: ArenaGeometry, d: BossDef, f: BossFrame, base: number): void {
    const dot = this.dot;
    if (dot === null) return;
    this.stats.markers++;
    const progress = Math.max(0, Math.min(1, (f.now - m.start) / Math.max(1, m.end - m.start)));
    const march = Math.floor(f.now / DASH.ticksPerStep);
    const n = attack.anzahl ?? 1;
    switch (attack.form) {
      case 'linie': {
        const half = (attack.breitePx ?? 0) / 2;
        const from = d.radiusPx;
        const to = d.radiusPx + attack.reichweitePx;
        for (let k = 0; k < n; k++) {
          const ang = fanAngle(m.angle, k, n, attack.winkelGrad ?? 0);
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          // The crack runs out from the trunk and reaches the end on the tick of the blow.
          const reach = from + (to - from) * Math.min(1, progress * 1.15);
          for (let t = from; t <= to; t += 1) {
            const x = a.bossX + c * t;
            const y = a.bossY + sn * t;
            if (t <= reach) this.pixel(scene, dot, x + Math.sin(t * 0.7) * 0.8 * -sn, y + Math.sin(t * 0.7) * 0.8 * c, base, PUNKT.warnHell);
            const step = Math.floor(t);
            if ((step + march) % DASH.period >= DASH.lit) continue;
            this.pixel(scene, dot, x - sn * half, y + c * half, base, PUNKT.warn);
            this.pixel(scene, dot, x + sn * half, y - c * half, base, PUNKT.warn);
          }
        }
        return;
      }
      case 'ring': {
        const outer = attack.reichweitePx;
        const inner = outer - (attack.breitePx ?? 0);
        this.dashedCircle(scene, dot, a.bossX, a.bossY, outer, march, base, PUNKT.warn);
        this.dashedCircle(scene, dot, a.bossX, a.bossY, inner, march, base, PUNKT.warn);
        this.fill(scene, dot, a.bossX, a.bossY, inner, outer, FILL_MAX * progress, base);
        return;
      }
      case 'kreis': {
        const r = (attack.breitePx ?? 0) / 2;
        for (let k = 0; k < n; k++) {
          circleCentre(m.aimX, m.aimY, k, n, attack.breitePx ?? 0, this.scratch);
          const cx = this.scratch.x;
          const cy = this.scratch.y;
          this.dashedCircle(scene, dot, cx, cy, r, march, base, PUNKT.warn);
          this.dashedCircle(scene, dot, cx, cy, r * progress, -1, base, PUNKT.warnHell);
          this.fill(scene, dot, cx, cy, 0, r, FILL_MAX * progress, base);
        }
        return;
      }
      case 'kegel': {
        const spread = ((attack.winkelGrad ?? 0) * Math.PI) / 180;
        const r = d.radiusPx + attack.reichweitePx;
        for (let side = -1; side <= 1; side += 2) {
          const ang = m.angle + (side * spread) / 2;
          for (let t = d.radiusPx; t <= r; t += 1) {
            if ((Math.floor(t) + march) % DASH.period >= DASH.lit) continue;
            this.pixel(scene, dot, a.bossX + Math.cos(ang) * t, a.bossY + Math.sin(ang) * t, base, PUNKT.warn);
          }
        }
        const ring = this.circles.of(r);
        for (let k = 0; k < ring.length; k++) {
          const p = ring[k] as { dx: number; dy: number; angle: number };
          let diff = p.angle - m.angle;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          if (Math.abs(diff) <= spread / 2) this.pixel(scene, dot, a.bossX + p.dx, a.bossY + p.dy, base, PUNKT.warnHell);
        }
        return;
      }
    }
  }

  /** Roots burst out of the struck area. */
  private bursts(scene: RenderScene, s: AtlasSprite, attack: BossAreaAttackDef, m: Remembered, a: ArenaGeometry, d: BossDef, f: BossFrame, base: number): void {
    const clip = s.clips[BOSS_CLIPS.burst];
    const age = f.now - m.end;
    const n = attack.anzahl ?? 1;
    switch (attack.form) {
      case 'linie': {
        for (let k = 0; k < n; k++) {
          const ang = fanAngle(m.angle, k, n, attack.winkelGrad ?? 0);
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          let j = 0;
          for (let t = d.radiusPx + BURST_SPACING_PX / 2; t <= d.radiusPx + attack.reichweitePx; t += BURST_SPACING_PX, j++) {
            // The roots break out one after another along the crack.
            this.root(scene, s, clip, a.bossX + c * t, a.bossY + sn * t, age - j * 1.5, base, j % 2 === 1);
          }
        }
        return;
      }
      case 'ring': {
        const r = attack.reichweitePx - (attack.breitePx ?? 0) / 2;
        const count = Math.max(6, Math.round((2 * Math.PI * r) / BURST_SPACING_PX));
        for (let k = 0; k < count; k++) {
          const ang = (2 * Math.PI * k) / count;
          this.root(scene, s, clip, a.bossX + Math.cos(ang) * r, a.bossY + Math.sin(ang) * r, age, base, k % 2 === 1);
        }
        return;
      }
      case 'kreis': {
        for (let k = 0; k < n; k++) {
          circleCentre(m.aimX, m.aimY, k, n, attack.breitePx ?? 0, this.scratch);
          const cx = this.scratch.x;
          const cy = this.scratch.y;
          const r = (attack.breitePx ?? 0) * 0.3;
          this.root(scene, s, clip, cx, cy + 2, age, base, false);
          for (let q = 0; q < 5; q++) {
            const ang = (2 * Math.PI * q) / 5 + 0.3;
            this.root(scene, s, clip, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, age - 1 - q, base, q % 2 === 1);
          }
        }
        return;
      }
      case 'kegel':
        return;
    }
  }

  private root(scene: RenderScene, s: AtlasSprite, clip: AnimationClip | undefined, x: number, y: number, ageTicks: number, base: number, mirror: boolean): void {
    if (ageTicks < 0) return;
    const pos = clip === undefined ? 0 : Math.floor((ageTicks / TICK_HZ) * clip.fps);
    if (clip !== undefined && pos >= clip.frames.length) return;
    const d = scene.sprite.reset();
    d.frame = (s.frames[clip === undefined ? 0 : (clip.frames[pos] ?? 0)] ?? s.frames[0]) as SpriteFrameRef;
    d.x = x;
    d.y = y;
    d.heightBase = base;
    d.mirror = mirror && s.symmetric;
    scene.sprites.push(d);
    this.stats.bursts++;
  }

  /** Roots standing out of the ground around the rim of a sealed arena. */
  private seal(scene: RenderScene, s: AtlasSprite, a: ArenaGeometry, base: number): void {
    const clip = s.clips[BOSS_CLIPS.burst];
    const frame = clip === undefined ? 0 : (clip.frames[Math.min(SEAL_ROOT_POSITION, clip.frames.length - 1)] ?? 0);
    const cx = (a.cx + 1 / 2) * TILE_PX;
    const cy = (a.cy + 1 / 2) * TILE_PX;
    const r = a.radiusTiles * TILE_PX;
    const count = Math.max(8, Math.round((2 * Math.PI * r) / SEAL_SPACING_PX));
    for (let k = 0; k < count; k++) {
      const ang = (2 * Math.PI * k) / count;
      const d = scene.sprite.reset();
      d.frame = (s.frames[frame] ?? s.frames[0]) as SpriteFrameRef;
      d.x = cx + Math.cos(ang) * r;
      d.y = cy + Math.sin(ang) * r;
      d.heightBase = base;
      d.mirror = k % 2 === 1 && s.symmetric;
      scene.sprites.push(d);
      this.stats.sealRoots++;
    }
  }

  /** The burning patches of the arena. */
  private flames(scene: RenderScene, a: ArenaGeometry, f: BossFrame): void {
    const s = this.flame;
    if (s === null) return;
    const clip = s.clips[FLAME_CLIP];
    for (let k = 0; k < a.burnTiles.length; k++) {
      const t = a.burnTiles[k] as { tx: number; ty: number };
      const d = scene.sprite.reset();
      d.frame = (s.frames[clip === undefined ? 0 : clipFrameAt(clip, f.time + k * FLAME_PHASE)] ?? s.frames[0]) as SpriteFrameRef;
      d.x = (t.tx + 1 / 2) * TILE_PX;
      d.y = (t.ty + 1) * TILE_PX - 2;
      d.heightBase = f.levelAt(t.tx, t.ty) * WAND_PX_JE_STUFE;
      d.mirror = k % 2 === 1 && s.symmetric;
      d.emissiveBoost = 0.3;
      scene.sprites.push(d);
      this.stats.flames++;
    }
  }

  /** The leaves of the storm, circling the arena above everything. */
  private storm(scene: RenderScene, a: ArenaGeometry, f: BossFrame, base: number): void {
    const s = this.leaf;
    if (s === null) return;
    const clip = s.clips[LEAF_CLIP];
    const cx = (a.cx + 1 / 2) * TILE_PX;
    const cy = (a.cy + 1 / 2) * TILE_PX;
    const r = (a.radiusTiles + 1) * TILE_PX;
    for (let k = 0; k < STORM_LEAVES; k++) {
      // Each leaf on its own orbit: radius share, start angle and speed from its number (golden angle, no randomness).
      const share = 0.25 + 0.75 * ((k * 0.618034) % 1);
      const ang = k * 2.39996 + f.time * STORM_SPEED * (0.7 + 0.6 * ((k * 0.4142) % 1)) * (k % 3 === 0 ? -1 : 1);
      const d = scene.sprite.reset();
      d.frame = (s.frames[clip === undefined ? 0 : clipFrameAt(clip, f.time + k * 0.13)] ?? s.frames[0]) as SpriteFrameRef;
      d.x = cx + Math.cos(ang) * r * share;
      d.y = cy + Math.sin(ang) * r * share * 0.8;
      d.layer = 'canopy';
      d.heightBase = base + STORM_HEIGHT_PX * (0.5 + 0.5 * Math.sin(f.time * 2 + k));
      d.mirror = k % 2 === 0 && s.symmetric;
      scene.sprites.push(d);
      this.stats.leaves++;
    }
  }

  /** A dashed circle of radius `r` around (cx, cy) (`march` < 0: solid). */
  private dashedCircle(scene: RenderScene, dot: AtlasSprite, cx: number, cy: number, r: number, march: number, base: number, frame: number): void {
    const ring = this.circles.of(r);
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    for (let k = 0; k < ring.length; k++) {
      if (march >= 0 && (k + march) % DASH.period >= DASH.lit) continue;
      const p = ring[k] as { dx: number; dy: number };
      this.pixel(scene, dot, x0 + p.dx, y0 + p.dy, base, frame);
    }
  }

  /** The dithered fill of the band between radii `inner` and `outer` around (cx, cy), covering `share` of it. */
  private fill(scene: RenderScene, dot: AtlasSprite, cx: number, cy: number, inner: number, outer: number, share: number, base: number): void {
    if (share <= 0) return;
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    const ro = Math.floor(outer) - 1;
    const ri2 = inner > 0 ? (inner + 1) * (inner + 1) : -1;
    for (let dy = -ro; dy <= ro; dy++) {
      for (let dx = -ro; dx <= ro; dx++) {
        const q = dx * dx + dy * dy;
        if (q > ro * ro || q < ri2) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if ((BAYER4[((y & 3) << 2) | (x & 3)] as number) / 16 >= share) continue;
        this.pixel(scene, dot, x, y, base, PUNKT.warnFuell);
      }
    }
  }

  private pixel(scene: RenderScene, dot: AtlasSprite, x: number, y: number, heightBase: number, frame: number): void {
    const d = scene.sprite.reset();
    d.frame = dot.frames[frame] as SpriteFrameRef;
    d.x = Math.round(x);
    d.y = Math.round(y);
    d.layer = 'ground';
    d.heightBase = heightBase;
    d.emissiveBoost = MARKER_GLOW;
    scene.sprites.push(d);
    this.stats.markerPixels++;
  }

  private memo(i: number): Remembered {
    let m = this.remembered[i];
    if (m === undefined) {
      m = { attack: null, start: 0, end: Number.NEGATIVE_INFINITY, angle: 0, aimX: 0, aimY: 0 };
      this.remembered[i] = m;
    }
    return m;
  }

  private bind(m: AtlasManifest): void {
    if (this.manifest === m) return;
    this.manifest = m;
    this.sprites.clear();
    this.dot = m.sprites[DOT_SPRITE] ?? null;
    this.flame = m.sprites[FLAME_SPRITE] ?? null;
    this.leaf = m.sprites[LEAF_SPRITE] ?? null;
  }

  private spritesOf(d: BossDef): BossSprites {
    let s = this.sprites.get(d.id);
    if (s === undefined) {
      const m = this.manifest;
      s = { body: m?.sprites[d.sprite] ?? null, knot: m?.sprites[`${d.sprite}_knoten`] ?? null, burst: m?.sprites[`${d.sprite}_wurzel`] ?? null };
      this.sprites.set(d.id, s);
    }
    return s;
  }

  private systemOf(sim: Simulation): BossesSystem | null {
    if (this.systemSim !== sim) {
      const s = sim.systems.find((x) => x instanceof BossesSystem);
      this.system = s instanceof BossesSystem ? s : null;
      this.systemSim = sim;
      this.remembered.length = 0;
      this.lastHit.length = 0;
    }
    return this.system;
  }
}
