/**
 * Taumeln ohne Zustand zeigt die Taumelpose (M7-70; MASTERPROMPT §4.6 Lesbarkeit, §19.4; ADR-0173 für Betäubte): ein
 * parierter Schlag (`parried`, die Kreatur taumelt `combat.parry.staggerSeconds`) und ein schwerer Treffer mit Taumeln
 * (`staggerSeconds` des Schlags) halten eine Kreatur wie eine Betäubung bis einschließlich `staggerUntilTick` – die
 * Darstellung zeigt dafür dieselbe Taumelpose: den Trefferclip vom auslösenden Schlag an (bei der Parade vom Tick der
 * Parade, die keinen Treffer setzt), dann sein eingesacktes letztes Bild, einen Pixel schwankend – ohne Sterne, genau so
 * lange, wie die Simulation die Kreatur hält. Ein Treffer ohne Taumeln zeigt nur den Trefferclip.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { Entity } from '../../../src/engine/ecs';
import { createCombatAttack, type CombatSystem } from '../../../src/game/combat/system';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { clipDuration, clipFrameAt, type AnimationClip } from '../../../src/render/anim/animation';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, CreatureSprites, hitstopOverlap, type CreatureFrame } from '../../../src/render/game/creatures';
import { STATUS_SPRITE, STUN } from '../../../src/render/game/statusMarks';
import type { RenderScene } from '../../../src/render/scene';
import { eventsOf } from '../game/kampf-testwelt';
import { kreaturWelt, meadow } from '../game/kreatur-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
/** The poses are read from the clips; nothing here needs the albedo. */
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const HZ = BALANCE.time.tickHz;
const TILE = 16;

const OWNER = (() => {
  const owner = new Map<unknown, { id: string; index: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, index) => owner.set(f, { id: s.id, index }));
  return owner;
})();

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
}

function draw(view: CreatureSprites, sim: Simulation, over: Partial<CreatureFrame> = {}): Pushed[] {
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = OWNER.get(d.frame);
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  view.draw(scene, ATLAS, sim, Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 0, time: 0 }, over));
  return pushed;
}

function clipOf(clip: string): AnimationClip {
  const c = MANIFEST.sprites['kreatur_wolf']?.clips[clip];
  if (c === undefined) throw new Error(`kreatur_wolf: kein Clip ${clip}`);
  return c;
}

/**
 * Follows the wolf `wolf` of `sim` frame by frame (three moments per tick) from now until two ticks after its stagger ended:
 * while `lastTick ≤ staggerUntilTick` it stands in the stagger pose – the hit clip from `from` (the hitstop of the blow
 * standing the clip), then its last frame – swaying at most a pixel, without stars, counted as staggered (not stunned);
 * afterwards none of that. Returns how many ticks it showed the pose.
 */
function followStagger(sim: Simulation, creatures: CreatureSystem, wolf: Entity, from: number, step: () => void): number {
  const view = new CreatureSprites();
  const s0 = creatures.store.get(wolf);
  if (s0 === undefined) throw new Error('der Wolf ist fort');
  const until = s0.staggerUntilTick;
  let ticks = 0;
  for (let k = 0; sim.tick - 1 <= until + 2; k++) {
    const s = creatures.store.get(wolf);
    if (s === undefined) throw new Error('der Wolf ist fort');
    // The pose faces the way the wolf faces (the dominant axis): its hit clip of that direction.
    const c = Math.cos(s.facing);
    const sn = Math.sin(s.facing);
    const dir = Math.abs(c) >= Math.abs(sn) ? 'right' : sn > 0 ? 'down' : 'up';
    const hit = clipOf(`hit_${dir}`);
    const sagged = hit.frames[hit.frames.length - 1] as number;
    const staggered = sim.tick - 1 <= until;
    for (const alpha of [0, 0.5, 0.999]) {
      const pushed = draw(view, sim, { alpha, time: k / HZ });
      const body = pushed.find((p) => p.sprite === 'kreatur_wolf');
      expect(pushed.some((p) => p.sprite === STATUS_SPRITE), `Tick ${sim.tick - 1}: Sterne`).toBe(false);
      expect(view.stats.stunned).toBe(0);
      expect(view.stats.staggered, `Tick ${sim.tick - 1}`).toBe(staggered ? 1 : 0);
      if (body === undefined) throw new Error('kein Wolf gezeichnet');
      if (!staggered) continue;
      const now = sim.tick - 1 + alpha;
      const since = now - from - hitstopOverlap(s.hitstopFromTick, s.hitstopTicks, from, now);
      const hitTicks = clipDuration(hit) * HZ;
      expect(body.frame, `Tick ${sim.tick - 1} + ${alpha}`).toBe(since >= hitTicks ? sagged : clipFrameAt(hit, since / HZ));
      const at = { x: 0, y: 0 };
      creatures.positionOf(wolf, at);
      expect(Math.abs(body.x - at.x)).toBeLessThanOrEqual(STUN.swayPx);
    }
    if (staggered) ticks++;
    step();
  }
  return ticks;
}

describe('Taumeln ohne Zustand: die Taumelpose der Kreatur (M7-70)', () => {
  it('ein parierter Biss: der Wolf taumelt vom Tick der Parade an im Trefferclip, dann eingesackt, ohne Sterne, bis einschließlich staggerUntilTick', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.hold('probe_schwert');
    const wolf = w.creature('wolf', 20, 12);
    // A wolf by day keeps its distance: a blow without damage provokes it (it turns on the attacker).
    w.combat.resolve(w.sim, w.sim.player, wolf, { ...createCombatAttack(), team: 'spieler', damage: 0, wucht: 0, staggerSeconds: 0, critChance: 0 });
    let telegraph: SimEventMap['creatureTelegraph'] | null = null;
    for (let i = 0; i < 600 && telegraph === null; i++) telegraph = eventsOf<SimEventMap['creatureTelegraph']>(w.run(1), 'creatureTelegraph').find((t) => t.entity === wolf) ?? null;
    if (telegraph === null) throw new Error('der Wolf holt nicht aus');
    const me = w.pos();
    const p = w.where(wolf);
    w.aimBy(p.x - me.x, p.y - me.y);
    // The block begins 4 ticks before the blow: within the parry window.
    w.run(telegraph.ticks - 4);
    let parried: SimEventMap['parried'] | undefined;
    for (let i = 0; i < 8 && parried === undefined; i++) parried = eventsOf<SimEventMap['parried']>(w.run(1, i === 0 ? [{ type: 'combat.block', on: true }] : []), 'parried')[0];
    if (parried === undefined) throw new Error('keine Parade');
    const s = w.state(wolf);
    // The parry staggers the wolf without hurting it: the stagger's start is its hitstop, not a hurt tick.
    expect(s.hurtTick).toBeLessThan(parried.tick);
    expect(s.hitstopFromTick).toBe(parried.tick);
    expect(s.staggerUntilTick - parried.tick).toBe(Math.round(BALANCE.combat.parry.staggerSeconds * HZ));
    expect(s.conditions).toEqual([]);
    // The picture of the parry's tick on: every tick up to and including `staggerUntilTick`.
    expect(w.sim.tick - 1).toBe(parried.tick);
    const ticks = followStagger(w.sim, w.creatures, wolf, parried.tick, () => w.run(1, [{ type: 'combat.block', on: false }]));
    expect(ticks).toBe(s.staggerUntilTick - parried.tick + 1);
  });

  it('ein schwerer Treffer mit Taumeln: Trefferclip vom Treffer an, dann eingesackt bis zum Ende des Taumelns; ohne Taumeln nur der Trefferclip', () => {
    const sim = createSimulation({ seed: 20261004, worldSize: 'small' });
    sim.step([{ type: 'setTime', hour: 12, minute: 0 } as never]);
    sim.step([{ type: 'player.spawn' } as never]);
    sim.step([{ type: 'debug.god', on: true } as never]);
    const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
    sim.step([{ type: 'creature.spawn', creature: 'wolf', count: 1, x: pos.get(sim.player, 'x') + 3 * TILE, y: pos.get(sim.player, 'y'), layer: 0 } as never]);
    const creatures = sim.system('creatures') as CreatureSystem;
    const wolf = creatures.store.entityAt(creatures.store.size - 1);
    const combat = sim.system('combat') as CombatSystem;
    const hold = (): void => {
      const s = creatures.store.get(wolf);
      if (s === undefined) throw new Error('der Wolf ist fort');
      s.facing = 0;
      s.vx = 0;
      s.vy = 0;
    };
    hold();
    // A heavy blow: no damage, 1,5 s of stagger – far longer than the hit clip.
    const struckAt = sim.tick;
    expect(combat.resolve(sim, sim.player, wolf, { ...createCombatAttack(), team: 'spieler', damage: 0, wucht: 3, staggerSeconds: 1.5, critChance: 0 })?.staggerTicks).toBe(90);
    const s = creatures.store.get(wolf);
    if (s === undefined) throw new Error('der Wolf ist fort');
    expect(s.hurtTick).toBe(struckAt);
    expect(s.staggerUntilTick).toBe(struckAt + 90);
    expect(clipDuration(clipOf('hit_right')) * HZ).toBeLessThan(90);
    // The tick of the blow completes: its picture is the first of the pose.
    sim.step();
    hold();
    const ticks = followStagger(sim, creatures, wolf, struckAt, () => {
      sim.step();
      hold();
    });
    expect(ticks).toBe(90 + 1);

    // A blow without stagger: the hit clip plays, then the wolf stands in its own pose again – no held sagged frame.
    const view = new CreatureSprites();
    const again = sim.tick;
    combat.resolve(sim, sim.player, wolf, { ...createCombatAttack(), team: 'spieler', damage: 0, wucht: 3, staggerSeconds: 0, critChance: 0 });
    const hit = clipOf('hit_right');
    while (sim.tick - again < Math.ceil(clipDuration(hit) * HZ) + 20) {
      sim.step();
      hold();
    }
    const body = draw(view, sim, { time: 2 }).find((p) => p.sprite === 'kreatur_wolf');
    expect(view.stats.staggered).toBe(0);
    expect(hit.frames).not.toContain(body?.frame);
  });
});
