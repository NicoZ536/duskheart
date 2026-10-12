/**
 * M7-112 Frame-Pfad der Spielerfigur im Kampf (MASTERPROMPT §30 „Keine Allokationen in Hot-Loops“; ADR-0142, ADR-0167,
 * ADR-0203, ADR-0222): `PlayerFigure.place` mit dem Schwert in der Hand und der brennenden Fackel in der Nebenhand – mitten
 * im Hieb, im schweren Schlag, in der Deckung, schräg gezielt (gedrehte Bilder), mit dem Glanzpunkt der Waffe
 * (`handPointOf`) und dem Lesen der Pose (`PlayerPoseReader.sample`) – formt im eingeschwungenen Zustand keine Zahl und kein
 * Objekt: < 2 B je Frame (Median von fünf Fenstern, Heap-Profil von `node:inspector` mit Stichproben alle 16 B, wie
 * kampf-ruhe.test.ts). Die Simulation steht (ein Frame zwischen zwei Ticks, wie die Szene `spiel-kampf` des Frame-Pfad-Bench),
 * die Darstellungszeit läuft weiter.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, type HeapCallFrame, type HeapProfile, type HeapProfileNode } from '../../../tools/bench/heap';
import { BALANCE } from '../../../src/content/balance';
import { equipmentRef } from '../../../src/game/items/slots';
import { GameSession } from '../../../src/game/session';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { PlayerFigure } from '../../../src/render/game/playerFigure';
import { RenderScene } from '../../../src/render/scene';

const ATLAS: AtlasData = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const pixels = new Uint8Array(4);
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
})();
const TICK_S = 1 / BALANCE.time.tickHz;

/** Frames per window; windows (the median counts); frames to re-warm after a collection; the background compiler's pause. */
const FRAMES = 400;
const WINDOWS = 5;
const REWARM_FRAMES = 1500;
const COMPILER_PAUSE_MS = 200;
const INSTALL_FRAMES = 200;
/** Mean distance of two heap samples [B]: almost every allocation is seen. */
const SAMPLING_INTERVAL = 16;
/** Limit [B per frame]: one number formed every frame (16 B) would exceed it eight times. */
const MAX_BYTES_PER_FRAME = 2;
const TEST_TIMEOUT_MS = 120_000;

/** Whether `f` is the figure's frame entry (`PlayerFigure.place`). */
const isPlace = (f: HeapCallFrame): boolean => f.functionName === 'place' && /playerFigure/.test(f.url);
/**
 * The game's samplers that `place` calls (`GameSession.samplePlayer`, `sampleCombat`, src/game/session.ts): their own
 * allocation is the simulation's side of the frame (M13-28), not the figure's.
 */
const isGameSampler = (f: HeapCallFrame): boolean => (f.functionName === 'samplePlayer' || f.functionName === 'sampleCombat') && /game\/session/.test(f.url);

/** Bytes sampled below `place` (not below the game's samplers), and the hot spots as `leaf ← caller`. */
function figureAllocation(profile: HeapProfile): { bytes: number; top: string } {
  const parent = new Map<number, HeapProfileNode>();
  const byId = new Map<number, HeapProfileNode>();
  const stack: HeapProfileNode[] = [profile.head];
  while (stack.length > 0) {
    const n = stack.pop() as HeapProfileNode;
    byId.set(n.id, n);
    for (const c of n.children) {
      parent.set(c.id, n);
      stack.push(c);
    }
  }
  const name = (f: HeapCallFrame): string => `${f.functionName || '(anonym)'}:${f.lineNumber + 1}`;
  let bytes = 0;
  const hot = new Map<string, number>();
  for (const sample of profile.samples) {
    const leaf = byId.get(sample.nodeId);
    let n = leaf;
    let game = false;
    while (n !== undefined && !isPlace(n.callFrame)) {
      if (isGameSampler(n.callFrame)) game = true;
      n = parent.get(n.id);
    }
    if (n === undefined || leaf === undefined || game) continue;
    bytes += sample.size;
    const up = parent.get(leaf.id);
    const key = `${name(leaf.callFrame)} ← ${up === undefined ? '-' : name(up.callFrame)}`;
    hot.set(key, (hot.get(key) ?? 0) + sample.size);
  }
  const top = [...hot.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
  return { bytes, top };
}

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => {
  inspector.disconnect();
});

/** A session with the player in a fight: god mode, the lit torch in the off hand, the sword in the hand. */
function fightSession(): GameSession {
  const session = new GameSession({ config: { seed: 20261012, worldSize: 'small', dayLengthMinutes: 12 } });
  session.command({ type: 'player.spawn' });
  session.step();
  session.command({ type: 'debug.god', on: true });
  for (const c of [
    { type: 'inventory.give', item: 'fackel', count: 1 },
    { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
    { type: 'light.toggle' },
    { type: 'inventory.give', item: 'bronzeschwert', count: 1 },
    { type: 'player.selectHotbar', index: 0 },
  ] as const)
    session.command(c as never);
  for (let i = 0; i < 10; i++) session.step();
  return session;
}

/**
 * The moments of the fight that are measured: [what, the body clip shown, button, aim offset in tiles, button held for
 * ticks, ticks after the press] – the guard is held through the moment.
 */
const MOMENTS = [
  ['Hieb nach rechts, Schmierbild', 'attack_schwert_licht', 'combat.attack', [2, 0], 3, 8],
  ['schräg gezielt (gedrehtes Bild)', 'attack_schwert_licht', 'combat.attack', [2, -2], 3, 6],
  ['schwerer Schlag, aufgeladen', 'heavy_schwert_licht', 'combat.attack', [0, 2], 60, 50],
  ['Deckung, schräg nach unten', 'block', 'combat.block', [-2, 1], 99, 20],
] as const;

describe('M7-112 Spielerfigur im Kampf: keine Allokation im Frame-Pfad', { timeout: TEST_TIMEOUT_MS }, () => {
  for (const [name, clip, button, aim, hold, after] of MOMENTS) {
    it(`${name}: place, handPointOf und sample < ${MAX_BYTES_PER_FRAME} B je Frame`, async () => {
      const session = fightSession();
      const figure = new PlayerFigure();
      const scene = new RenderScene();
      const at = { x: 0, y: 0 };
      session.samplePlayer(figure.lastSample as never);
      const p = figure.lastSample;
      at.x = p.x;
      at.y = p.y;
      session.command({ type: 'player.aim', x: Math.round(at.x + aim[0] * 16), y: Math.round(at.y + aim[1] * 16) } as never);
      session.command({ type: button, on: true } as never);
      for (let t = 0; t < after; t++) {
        if (t === hold) session.command({ type: button, on: false } as never);
        session.step();
      }
      // The frozen moment: presentation time runs on between two ticks.
      let time = 100;
      const frames = (n: number): void => {
        for (let i = 0; i < n; i++) {
          scene.beginFrame(i);
          figure.place(scene, ATLAS, session, time, 200.5, 300.25);
          time += TICK_S * 0.75;
        }
      };
      frames(3 * REWARM_FRAMES);
      expect(figure.lastCombat.present, 'Kampf-Probe').toBe(true);
      expect(figure.figure?.handHeld, 'Schwert in der Hand').toBe(true);
      expect(figure.clipAction, 'Kampfclip').toBe(clip);
      const perFrame: number[] = [];
      const tops: string[] = [];
      for (let w = 0; w < WINDOWS; w++) {
        await inspector.post('HeapProfiler.collectGarbage');
        frames(REWARM_FRAMES);
        await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
        frames(INSTALL_FRAMES);
        await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        frames(FRAMES);
        const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
        const alloc = figureAllocation(profile);
        perFrame.push(alloc.bytes / FRAMES);
        tops.push(alloc.top);
      }
      const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
      expect(median, `${name}: ${figure.clipAction} (Fenster ${perFrame.map((b) => b.toFixed(2)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
      figure.dispose();
    });
  }
});
