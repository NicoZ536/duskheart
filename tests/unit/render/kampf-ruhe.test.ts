/**
 * M6-05f (MASTERPROMPT §30 "Keine Allokationen in Hot-Loops"; ADR-0142): the fight's presentation at rest forms no
 * fractional moment. `CombatView.shakeOffset` and `CombatView.draw` ask every part on whole ticks whether anything of it can
 * show at any moment of the frame (the moment lies in [tick − 1, tick], `GameSession.renderAlpha` ∈ [0, 1]) – screenshake,
 * particles, trails, glints, flashes, waves, water impulses, ground markers, projectiles in flight, stuck, bursting or in
 * bodies, damage numbers, the charged blow's glint. At rest the whole tick stands in for the moment: every part draws
 * nothing and resets its counters.
 *
 * Checked: the rest marks of each part follow its effects exactly (never at rest while something shows); a fight drawn
 * through `CombatView.draw` pushes the same sprites and world-UI entries and reports the same counters as its parts drawn at
 * the real moment, frame by frame, also across tick jumps; and a frame at rest allocates nothing (sampled heap profile of
 * `node:inspector`, like chunkmanager-schluessel.test.ts).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { CombatEventMap } from '../../../src/game/combat/events';
import type { CombatSystem } from '../../../src/game/combat/system';
import type { CreatureEventMap } from '../../../src/game/creatures/events';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { createCombatSample } from '../../../src/game/combat/sample';
import { CombatView, createCombatFrame } from '../../../src/render/game/combat';
import { CombatFeedback, SHAKE } from '../../../src/render/game/combatFeedback';
import { DamageNumbers } from '../../../src/render/game/damageNumbers';
import { ProjectileView } from '../../../src/render/game/projectiles';
import { TelegraphView } from '../../../src/render/game/telegraphs';
import { RenderScene } from '../../../src/render/scene';
import { DAMAGE_LIFETIME } from '../../../src/render/worldUi/worldUi';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const HZ = 60;
/** Frame moments within a tick (`renderAlpha`), the ends included. */
const ALPHAS = [0, 0.25, 0.5, 0.999, 1] as const;
/** Time per test [ms]: the fight is drawn frame by frame twice, the heap is sampled over thousands of frames. */
const TEST_TIMEOUT_MS = 60_000;

/** The player's entity in the fake simulation (hits on it shake the camera). */
const PLAYER = 1;

/** A simulation as the view reads it: tick, rate, the player's entity, no systems. */
function fakeSim(): Simulation & { tick: number } {
  return { tick: 0, clock: { tickHz: HZ }, systems: [], player: PLAYER } as unknown as Simulation & { tick: number };
}

/** A session whose events the test raises. */
function fakeSession(sim: Simulation): { sim: Simulation; onEvent: (name: string, h: (e: unknown) => void) => () => void; emit<K extends keyof (CombatEventMap & CreatureEventMap)>(name: K, e: (CombatEventMap & CreatureEventMap)[K]): void } {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  return {
    sim,
    onEvent(name, h) {
      const list = handlers.get(name) ?? [];
      list.push(h);
      handlers.set(name, list);
      return () => list.splice(list.indexOf(h), 1);
    },
    emit(name, e) {
      for (const h of handlers.get(name) ?? []) h(e);
    },
  };
}

/** Sprite and frame index of every atlas frame. */
const OWNER = new Map<SpriteFrameRef, string>();
for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => OWNER.set(f, `${s.id}#${i}`));

/** A scene that records what is pushed (sprite, frame, position, fade) and what the world UI shows. */
function recordingScene(): { scene: RenderScene; log: string[] } {
  const owner = OWNER;
  const log: string[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        log.push(`${owner.get(d.frame as SpriteFrameRef) ?? '?'} ${d.x} ${d.y} ${d.rotation} ${d.fade} ${d.layer}`);
        return log.length - 1;
      },
    },
    worldUi: {
      damage: (x: number, y: number, text: string, age: number, kind: string) => log.push(`zahl ${x} ${y} ${text} ${age} ${kind}`),
      label: () => undefined,
    },
    water: { impulse: (kind: string, x: number, y: number) => log.push(`welle ${kind} ${x} ${y}`) },
    light: { reset: () => ({}) },
    lights: { push: () => log.push('licht') },
    post: { distortion: { shockwave: () => log.push('welle') } },
  } as unknown as RenderScene;
  return { scene, log };
}

const HIT: CombatEventMap['hitLanded'] = {
  layer: 0,
  x: 120,
  y: 100,
  tick: 10,
  attacker: NULL_ENTITY,
  target: 7,
  targetTeam: 'tier',
  amount: 12,
  art: 'hieb',
  crit: true,
  wucht: 3,
  hitstopTicks: 3,
  knockback: 0,
  material: 'fleisch',
  backstab: false,
};

describe('Kampf-Darstellung in Ruhe: die Ruhemarken der Teile (M6-05f)', () => {
  it('Screenshake: in Ruhe ist er zu jedem Moment des Frames 0 – und erst dann', () => {
    const f = new CombatFeedback();
    expect(f.shakeRestingAt(0)).toBe(true);
    f.shake(2, 50);
    let restFrom = -1;
    for (let tick = 45; tick < 50 + SHAKE.ticks + 4; tick++) {
      const anyShake = ALPHAS.some((a) => f.shakeLeft(tick - 1 + a) > 0);
      if (f.shakeRestingAt(tick)) {
        expect(anyShake, `Tick ${tick}`).toBe(false);
        if (restFrom < 0 && tick > 50) restFrom = tick;
      } else if (tick > 50) expect(restFrom, `Tick ${tick}: nach der Ruhe wieder unruhig`).toBe(-1);
    }
    // Spätestens zwei Ticks nach dem Abklingen ruht er (ganze Ticks statt Gleitkomma).
    expect(restFrom).toBeGreaterThan(50);
    expect(restFrom).toBeLessThanOrEqual(50 + SHAKE.ticks + 2);
  });

  it('Effekte: Stücke ruhen erst, wenn ein Frame sie abgelaufen sah; Spuren, Glints und Wellen nach ihrer Zeit; eine Welle im Wasser bis zum nächsten Frame', () => {
    const f = new CombatFeedback();
    const { scene, log } = recordingScene();
    expect(f.restingAt(0)).toBe(true);
    f.impact('fleisch', 100, 100, 10, 1, 0, 3, false, 10, 0, 1);
    expect(f.restingAt(11)).toBe(false);
    f.draw(scene, MANIFEST, 0, 11, HZ);
    expect(f.stats.particles).toBeGreaterThan(0);
    // Long after their life the pieces still count as alive until a frame let them expire.
    expect(f.restingAt(10 + HZ * 10)).toBe(false);
    f.draw(scene, MANIFEST, 0, 10 + HZ * 10, HZ);
    expect(f.stats.particles).toBe(0);
    expect(f.restingAt(10 + HZ * 10 + 1)).toBe(true);
    // A trail lives its ticks.
    f.smear(100, 100, 0, 0, 24, 90, 1, false, 200);
    expect(f.restingAt(201)).toBe(false);
    expect(f.restingAt(200 + HZ * 10)).toBe(true);
    // A splash waits for the next frame (the wave field takes it then).
    f.splash(100, 100, 0, true, 300);
    expect(f.restingAt(400)).toBe(false);
    log.length = 0;
    f.draw(scene, MANIFEST, 0, 400, HZ);
    expect(log.some((l) => l.startsWith('welle'))).toBe(true);
    // The splash's own pieces fly a while; once a frame saw them expire, the view rests.
    f.draw(scene, MANIFEST, 0, 300 + HZ * 10, HZ);
    expect(f.restingAt(300 + HZ * 10 + 1)).toBe(true);
    f.impact('holz', 0, 0, 0, 0, 0, 1, false, 500, 0, 1);
    f.clear();
    expect(f.restingAt(501)).toBe(true);
  });

  it('Geschosse: im Flug, steckend, als Aufprall und im Körper nie in Ruhe', () => {
    const v = new ProjectileView();
    const flying = { projectiles: { size: 1 } } as unknown as CombatSystem;
    const none = { projectiles: { size: 0 } } as unknown as CombatSystem;
    expect(v.restingAt(0, null)).toBe(true);
    expect(v.restingAt(0, none)).toBe(true);
    expect(v.restingAt(0, flying)).toBe(false);
    // An arrow stuck in the ground stays 20 s, then the view rests.
    v.fired({ layer: 0, x: 0, y: 0, tick: 99, entity: 5, owner: 1, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 100, vy: 0, tension: 1 });
    v.stuck({ layer: 0, x: 50, y: 0, tick: 100, entity: 5, item: 'pfeil_feuerstein', wo: 'boden', drop: false }, MANIFEST, new CombatFeedback());
    expect(v.restingAt(101, none)).toBe(false);
    expect(v.restingAt(100 + 20 * HZ, none)).toBe(false);
    expect(v.restingAt(100 + 20 * HZ + 2, none)).toBe(true);
    // An arrow in a body: until the body is gone (a frame finds it dead).
    let alive = true;
    const bodies = {
      store: { get: () => (alive ? { health: 10, layer: 0, level: 0, vx: 0, vy: 0 } : undefined) },
      positionOf: (_e: number, out: { x: number; y: number }) => {
        out.x = 60;
        out.y = 0;
        return alive;
      },
    } as unknown as Pick<CreatureSystem, 'store' | 'positionOf'>;
    v.fired({ layer: 0, x: 0, y: 0, tick: 199, entity: 6, owner: 1, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 100, vy: 0, tension: 1 });
    v.hit({ layer: 0, x: 60, y: 0, tick: 200, entity: 6, owner: 1, item: 'pfeil_feuerstein', target: 9, wirkung: null, radius: 0 });
    v.stuck({ layer: 0, x: 60, y: 0, tick: 200, entity: 6, item: 'pfeil_feuerstein', wo: 'ziel', drop: false }, MANIFEST, new CombatFeedback());
    const { scene } = recordingScene();
    v.draw(scene, MANIFEST, none, 0, 5000, 1, HZ, bodies);
    expect(v.stats.inBodies).toBe(1);
    expect(v.restingAt(5000, none)).toBe(false);
    alive = false;
    v.draw(scene, MANIFEST, none, 0, 5001, 1, HZ, bodies);
    expect(v.restingAt(5002, none)).toBe(true);
    // A creature's shot bursts where it stopped: its clip's time.
    expect(MANIFEST.sprites.geschoss_spucken?.clips.aufprall).toBeDefined();
    v.stuck({ layer: 0, x: 0, y: 0, tick: 6000, entity: 7, item: 'geschoss_spucken', wo: 'boden', drop: false }, MANIFEST, new CombatFeedback());
    expect(v.restingAt(6001, none)).toBe(false);
    expect(v.restingAt(6000 + 10 * HZ, none)).toBe(true);
    v.clear();
    expect(v.restingAt(6001, none)).toBe(true);
  });

  it('Bodenmarkierungen und Schadenszahlen: in Ruhe ohne lebenden Eintrag', () => {
    const t = new TelegraphView();
    expect(t.idle).toBe(true);
    const winding = { store: { get: () => ({ attackPhase: 'ausholen', attackTick: 10, attackEndTick: 40 }) } } as unknown as CreatureSystem;
    t.add({ layer: 0, x: 0, y: 0, tick: 10, entity: 3, creature: 'nachtmahr', angriff: 'stampfen', ticks: 30, poseTicks: 20, angle: 0, flaeche: { x: 0, y: 0, radius: 24 } }, 32, 0, new CombatFeedback());
    expect(t.idle).toBe(false);
    const { scene } = recordingScene();
    t.draw(scene, MANIFEST, winding, 0, 20);
    expect(t.idle).toBe(false);
    // Frames at the free slots never count the live one off (it was retired on its own only).
    for (let k = 0; k < 20; k++) t.draw(scene, MANIFEST, winding, 0, 21 + k);
    expect(t.idle).toBe(false);
    t.draw(scene, MANIFEST, winding, 0, 40 + 9);
    expect(t.idle).toBe(true);
    // A second one after it: the counter is exact again.
    t.add({ layer: 0, x: 0, y: 0, tick: 60, entity: 3, creature: 'nachtmahr', angriff: 'stampfen', ticks: 30, poseTicks: 20, angle: 0, flaeche: { x: 0, y: 0, radius: 24 } }, 32, 0, new CombatFeedback());
    expect(t.idle).toBe(false);
    t.draw(scene, MANIFEST, null, 0, 61);
    expect(t.idle).toBe(true);
    const n = new DamageNumbers();
    expect(n.restingAt(0, HZ)).toBe(true);
    n.add(0, 0, 0, 5, false, 100);
    const life = DAMAGE_LIFETIME * HZ;
    expect(n.restingAt(101, HZ)).toBe(false);
    expect(n.restingAt(100 + Math.ceil(life) + 1, HZ)).toBe(false);
    expect(n.restingAt(100 + Math.ceil(life) + 3, HZ)).toBe(true);
    // Never at rest while a number shows at some moment of the frame.
    for (let tick = 100; tick < 100 + life + 4; tick++) {
      if (!n.restingAt(tick, HZ)) continue;
      const ui = { damage: () => expect.fail(`Zahl in Tick ${tick} trotz Ruhe`) };
      for (const a of ALPHAS) n.draw(ui as never, 0, tick - 1 + a, HZ, true);
    }
  });
});

describe('Kampf-Darstellung in Ruhe: dasselbe Bild wie zum echten Moment (M6-05f)', { timeout: TEST_TIMEOUT_MS }, () => {
  it('ein Kampf Frame für Frame – Treffer, Schlagspur, Geschoss, Aufprall, Zahl, Markierung, Ruhe, Zeitsprung – gleich gezeichnet und gezählt', () => {
    const sim = fakeSim();
    const session = fakeSession(sim);
    const view = new CombatView();
    const ref = new CombatView();
    view.follow(session as never, () => 'Parade!');
    ref.follow(session as never, () => 'Parade!');
    const frame = createCombatFrame();
    // The reference reads the atlas of the views' first frame (a projectile coming to rest looks itself up there).
    ref.draw(recordingScene().scene, ATLAS, sim, frame);
    // The fight: events at their ticks; frames at several moments of each tick; quiet stretches and a jump.
    const events: Record<number, () => void> = {
      10: () => session.emit('hitLanded', HIT),
      12: () => session.emit('attackStarted', { layer: 0, x: 100, y: 100, tick: 12, entity: 1, klasse: 'schwert', schwer: false, kombo: 1, angle: 0.3, reichweite: 24, bogen: 90, item: 'bronzeschwert' }),
      14: () => session.emit('creatureTelegraph', { layer: 0, x: 200, y: 100, tick: 14, entity: 3, creature: 'nachtmahr', angriff: 'stampfen', ticks: 30, poseTicks: 20, angle: 0, flaeche: { x: 200, y: 100, radius: 20 } }),
      20: () => session.emit('projectileFired', { layer: 0, x: 100, y: 100, tick: 20, entity: 5, owner: 1, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 200, vy: 0, tension: 1 }),
      30: () => session.emit('projectileStuck', { layer: 0, x: 160, y: 100, tick: 30, entity: 5, item: 'pfeil_feuerstein', wo: 'boden', drop: false }),
      // A wolf bites the player: the camera shakes (impact class 4: 2 px, decaying over 12 ticks).
      40: () => session.emit('hitLanded', { ...HIT, tick: 40, attacker: 7, target: PLAYER, crit: false, wucht: 4, material: 'fleisch' }),
      2000: () => session.emit('parried', { layer: 0, x: 100, y: 100, tick: 2000, entity: 1, attacker: 2 }),
    };
    // 1100, 1101: the stuck arrow fades (its last fifth); 1300: gone; 1990…2019: a parry's glint, sparks, light and word.
    const ticks = [...Array.from({ length: 80 }, (_, i) => i), 400, 1100, 1101, 1300, 1301, 1302, ...Array.from({ length: 30 }, (_, i) => 1990 + i), 9000, 9001];
    let rested = 0;
    for (const tick of ticks) {
      sim.tick = tick;
      events[tick]?.();
      for (const alpha of ALPHAS) {
        frame.alpha = alpha;
        const a = recordingScene();
        const b = recordingScene();
        view.draw(a.scene, ATLAS, sim, frame);
        // The reference: every part at the frame's real moment (the view before M6-05f).
        const now = tick - 1 + alpha;
        ref.feedback.draw(b.scene, MANIFEST, 0, now, HZ);
        ref.telegraphs.draw(b.scene, MANIFEST, null, 0, now);
        ref.projectiles.draw(b.scene, MANIFEST, null, 0, now, alpha, HZ, null);
        ref.numbers.draw(b.scene.worldUi, 0, now, HZ, true);
        expect(a.log, `Tick ${tick} + ${alpha}`).toEqual(b.log);
        const { shake: _s, shakeAmplitude: _a, ...counters } = view.info();
        const { shake: _rs, shakeAmplitude: _ra, ...refCounters } = ref.info();
        expect(counters, `Tick ${tick} + ${alpha}`).toEqual(refCounters);
        if (a.log.length === 0) rested++;
        // The camera's shake: the same whole pixels as at the real moment.
        const shake = view.shakeOffset(sim, alpha, 1);
        const expected = ref.feedback.shakeOffset(now, 1, { x: 0, y: 0 });
        expect([shake.x, shake.y], `Schütteln Tick ${tick} + ${alpha}`).toEqual([expected.x, expected.y]);
        expect(view.info().shakeAmplitude).toBe(ref.feedback.shakeLeft(now));
      }
    }
    expect(rested).toBeGreaterThan(10);
  });
});

describe('Kampf-Darstellung in Ruhe: der aufgeladene Schlag (M6-05f)', () => {
  it('sein Glint wartet auf den echten Moment, auch wenn sonst alles ruht', () => {
    const sim = fakeSim();
    const session = fakeSession(sim);
    const view = new CombatView();
    view.follow(session as never, () => 'Parade!');
    const frame = createCombatFrame();
    frame.combat = { ...createCombatSample(), present: true, phase: 'aufladen', fighting: true, aimed: true, aimAngle: 0 };
    frame.figureX = 100;
    frame.figureY = 100;
    sim.tick = 100;
    session.emit('attackWindup', { entity: 1, klasse: 'schwert', schwer: true, ticks: 30, tick: 100 });
    // The heavy blow is ready at tick 130: the frame before it (moment 129.5) shows no glint, the next (130) does.
    for (const { tick, alpha, glints } of [
      { tick: 120, alpha: 0.5, glints: 0 },
      { tick: 130, alpha: 0.5, glints: 0 },
      { tick: 131, alpha: 0, glints: 1 },
    ]) {
      sim.tick = tick;
      frame.alpha = alpha;
      // Two frames in the same tick: the glint is neither set nor drawn before its moment.
      for (let k = 0; k < 2; k++) {
        view.draw(recordingScene().scene, ATLAS, sim, frame);
        expect(view.info().glints, `Tick ${tick} + ${alpha}, Frame ${k}`).toBe(glints);
      }
    }
  });
});

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

/** The simulation of the allocation test: tick and rate as the view reads them, no systems. */
class RestSim {
  tick = 0;
  readonly clock = { tickHz: HZ };
  readonly systems: never[] = [];
}

/**
 * Frames at rest per window and windows measured, after a warm-up of one window: the median of the windows is the steady
 * state – a tier-up or a deoptimisation of the parts after the fight (V8 compiles in the background, at varying moments)
 * shows up as a few kilobytes once, in one window (the method of `sim:kreaturen-50`, ADR-0140).
 */
const REST_FRAMES = 2000;
const WINDOWS = 3;
/**
 * Re-warm of every window after its forced collection (M6-94, ADR-0066): the collection retires optimised code whose
 * embedded maps died – the fight's objects, and in the shared worker those of the files before (V8: „weak objects“) – and a
 * part called once per frame is optimised again only after 3 000 calls and its turn in the background compiler. Sampled
 * right after the collection, the first window held 2–36 B per frame of baseline code (`chargedGlint`, `draw` of the
 * telegraphs and projectiles, `quietAfterAt`), under load the second one too, and the median failed. So each window first
 * renders `REWARM_FRAMES` frames unsampled, gives the background compiler `COMPILER_PAUSE_MS` and renders `INSTALL_FRAMES`
 * more, in which V8 installs what it finished (an allocation of its own).
 */
const REWARM_FRAMES = 3 * REST_FRAMES;
const COMPILER_PAUSE_MS = 200;
const INSTALL_FRAMES = 100;
/** Mean distance of two heap samples [B]: almost every allocation is seen. */
const SAMPLING_INTERVAL = 16;
/** Limit [B per frame]: one number formed every frame (16 B) would exceed it eight times. */
const MAX_BYTES_PER_FRAME = 2;

describe('Kampf-Darstellung in Ruhe: keine Allokation (M6-05f)', { timeout: TEST_TIMEOUT_MS }, () => {
  it('shakeOffset und draw formen in Ruhe keine Zahl – auch nach einem Kampf', async () => {
    // A simulation of its own shape: its tick stays a small integer, whatever the other tests stored in theirs.
    const sim = new RestSim() as unknown as Simulation & { tick: number };
    const session = fakeSession(sim);
    const view = new CombatView();
    view.follow(session as never, () => 'Parade!');
    const scene = new RenderScene();
    const frame = createCombatFrame();
    frame.alpha = 0.37;
    // A fight long ago: the parts have had their effects and are quiet again.
    session.emit('hitLanded', HIT);
    for (let t = 10; t < 400; t++) {
      sim.tick = t;
      view.draw(scene, ATLAS, sim, frame);
    }
    scene.beginFrame(0);
    const frames = (n: number, from: number): number => {
      let shaken = 0;
      for (let i = 0; i < n; i++) {
        sim.tick = from + i;
        const shake = view.shakeOffset(sim, 0.37, 1);
        if (shake.x !== 0 || shake.y !== 0) shaken++;
        view.draw(scene, ATLAS, sim, frame);
      }
      return shaken;
    };
    expect(frames(REST_FRAMES, 1000)).toBe(0);
    const perFrame: number[] = [];
    const tops: string[] = [];
    // The ticks go on from window to window (small integers all along).
    let tick = 1000 + REST_FRAMES;
    for (let w = 1; w <= WINDOWS; w++) {
      await inspector.post('HeapProfiler.collectGarbage');
      expect(frames(REWARM_FRAMES, tick)).toBe(0);
      tick += REWARM_FRAMES;
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      expect(frames(INSTALL_FRAMES, tick)).toBe(0);
      tick += INSTALL_FRAMES;
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      const shaken = frames(REST_FRAMES, tick);
      tick += REST_FRAMES;
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      expect(shaken).toBe(0);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frames' && /kampf-ruhe\.test/.test(f.url));
      perFrame.push(alloc.inPath / REST_FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    expect(scene.sprites.count).toBe(0);
    const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `Allokation je Frame in Ruhe (Fenster ${perFrame.map((b) => b.toFixed(2)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
