/**
 * M6-05e Fokus des Spielbilds ohne Allokation (§30 „Keine Allokationen in Hot-Loops“): ohne Spieler liest die Szene
 * 'spiel' je Bild die Lage des gesteuerten Debug-Läufers (`GameSession.sampleFocus` → `MotionSystem.controlledPosition`).
 * Der Code des Bilds wird selten optimiert, und unoptimiert legte jeder Aufruf ≈ 42–63 B an: das Feld des Handles las
 * sich als Heap-Zahl, jede f32-Koordinate aus der Spalte ebenso. Jetzt füllt `sampleFocus` einen `FocusRecord`
 * (Position als `Float64Array`) über `MotionSystem.controlledPositionInto`: Handle und Koordinaten als 16-Bit-Hälften
 * (kleine Ganzzahlen), verbreitert mit `Float64Array.prototype.set`.
 *
 * Geprüft wird:
 * - der Satz ist ein `SessionFocus` (x/y lesen und schreiben `position`);
 * - dieselben Werte wie über einen einfachen Datensatz, bitgleich – laufend, nach `teleport` in eine Ebene, wenn die
 *   Zeile des Läufers wandert (ein anderer wird zerstört) und seine alte Zeile ein anderer belegt – auch einer, dessen
 *   Handle dieselbe untere Hälfte hat –, wenn die Spalten wachsen, nach dem Laden eines Stands (auch eines, in dem ein
 *   anderer Läufer gesteuert ist); ohne lebenden Läufer `false` und der Satz bleibt, ein neuer gesteuerter Läufer gilt
 *   sofort;
 * - mit Spieler wie bisher der Spieler, interpoliert;
 * - ein Aufruf legt nichts an (< 1 B je Aufruf, Stichproben-Heap-Profil von `node:inspector`): während der Läufer geht
 *   und nachdem er zerstört ist.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { FocusRecord, GameSession, type SessionFocus } from '../../../src/game/session';
import type { MotionSystem } from '../../../src/game/systems/motion';
import { entityIndex, type Entity } from '../../../src/engine/ecs';

const CONFIG = { seed: 3, worldSize: 'small' } as const;
/** Mittlerer Abstand zweier Heap-Stichproben [B]. */
const SAMPLING_INTERVAL = 32;
/** Grenze [B je Aufruf]. */
const MAX_BYTES_PER_CALL = 1;
/** Bilder je Messung (je ein Tick dazwischen). */
const FRAMES = 400;

function motionOf(session: GameSession): MotionSystem {
  return session.sim.system('motion') as unknown as MotionSystem;
}

type Snapshot = ReturnType<GameSession['sim']['snapshot']>;

/** A saved state (as the save writes it: plain data). */
function save(session: GameSession): Snapshot {
  return JSON.parse(JSON.stringify(session.sim.snapshot())) as Snapshot;
}

/** Loads a saved state into the session (every participant, in restore order). */
function load(session: GameSession, saved: Snapshot): void {
  for (const p of session.sim.participants()) p.deserialize(saved.participants[p.id]?.data);
}

/** Puts `e` on (x, y) [px] directly in the columns (outside a tick: what the frame then reads). */
function place(motion: MotionSystem, e: Entity, x: number, y: number): void {
  const row = motion.position.add(e);
  motion.position.columns.x[row] = x;
  motion.position.columns.y[row] = y;
}

/** Both forms of the focus, compared bit for bit (`true` when both have one). */
function sameFocus(session: GameSession, record: FocusRecord): boolean {
  const plain: SessionFocus = { x: Number.NaN, y: Number.NaN, layer: 0 };
  const a = session.sampleFocus(plain);
  record.position.fill(Number.NaN);
  record.layer = 0;
  const b = session.sampleFocus(record);
  expect(b).toBe(a);
  if (!a) return false;
  expect(Object.is(record.position[0], plain.x), `x ${String(record.position[0])} ≠ ${plain.x}`).toBe(true);
  expect(Object.is(record.position[1], plain.y), `y ${String(record.position[1])} ≠ ${plain.y}`).toBe(true);
  expect(record.layer).toBe(plain.layer);
  return true;
}

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

describe('Fokus des Spielbilds in einem FocusRecord (M6-05e)', () => {
  it('der Satz ist ein SessionFocus: x und y lesen und schreiben position', () => {
    const r = new FocusRecord();
    const f: SessionFocus = r;
    f.x = 12.25;
    f.y = -3.5;
    f.layer = -2;
    expect([...r.position]).toEqual([12.25, -3.5]);
    r.position[0] = 7;
    expect(f.x).toBe(7);
    expect(f.y).toBe(-3.5);
    expect(r.layer).toBe(-2);
  });

  it('Debug-Läufer: bitgleich mit dem einfachen Datensatz – laufend, Ebene, wandernde Zeile, fremde Handles in ihr', () => {
    const session = new GameSession({ config: CONFIG });
    const motion = motionOf(session);
    const record = new FocusRecord();
    // Nobody steered yet: false, the record stays.
    record.position.set([1, 2]);
    expect(session.sampleFocus(record)).toBe(false);
    expect([...record.position]).toEqual([1, 2]);
    // Three movers before the steered one (it takes the last row).
    for (let i = 0; i < 3; i++) session.command({ type: 'spawnDebugMover', x: 6000 + i * 40, y: 8000 });
    session.command({ type: 'spawnDebugMover', x: 7240.3, y: 8472.7, controlled: true });
    session.step();
    const steered = motion.controlled;
    expect(motion.position.indexOf(steered)).toBe(3);
    session.command({ type: 'move', dx: 1, dy: 0.5 });
    for (let i = 0; i < 20; i++) {
      session.step();
      expect(sameFocus(session, record)).toBe(true);
    }
    expect(record.position[0]).toBeGreaterThan(7240.3);
    // A teleport onto another layer.
    session.command({ type: 'teleport', x: 5000.5, y: 5100.25, layer: -1 });
    session.step();
    expect(sameFocus(session, record)).toBe(true);
    expect(record.layer).toBe(-1);
    // The first mover is destroyed: the last row (the steered one) moves into its place, and a new mover takes the row
    // it left before the next frame.
    session.sim.ecs.destroy(motion.position.entityAt(0));
    expect(motion.position.indexOf(steered)).toBe(0);
    session.command({ type: 'spawnDebugMover', x: 6500.5, y: 6600.5, vx: 0, vy: 0 });
    session.step();
    expect(motion.position.entityAt(3)).not.toBe(steered);
    expect(sameFocus(session, record)).toBe(true);
    expect(record.position[0]).not.toBe(6500.5);
    // Once more with a new steered mover in the last row – the row it leaves goes to an entity whose handle has the
    // same lower half (index + 2^16).
    session.command({ type: 'spawnDebugMover', x: 7000.5, y: 7100.5, controlled: true });
    session.step();
    const second = motion.controlled;
    expect(motion.position.indexOf(second)).toBe(4);
    expect(sameFocus(session, record)).toBe(true);
    session.sim.ecs.destroy(motion.position.entityAt(0));
    expect(motion.position.indexOf(second)).toBe(0);
    let alias = session.sim.ecs.create();
    while (entityIndex(alias) !== entityIndex(second) + 2 ** 16) alias = session.sim.ecs.create();
    expect((alias & 0xffff) === (second & 0xffff) && alias !== second).toBe(true);
    place(motion, alias, 4321.5, 4321.5);
    expect(motion.position.indexOf(alias)).toBe(4);
    expect(sameFocus(session, record)).toBe(true);
    expect([...record.position]).toEqual([7000.5, 7100.5]);
  });

  it('Debug-Läufer: bitgleich auch wenn die Spalten wachsen, nach dem Laden, ohne lebenden Läufer und mit einem neuen', () => {
    const session = new GameSession({ config: CONFIG });
    const motion = motionOf(session);
    const record = new FocusRecord();
    for (let i = 0; i < 3; i++) session.command({ type: 'spawnDebugMover', x: 6000 + i * 40, y: 8000 });
    session.command({ type: 'spawnDebugMover', x: 7240.3, y: 8472.7, controlled: true });
    session.step();
    const steered = motion.controlled;
    session.command({ type: 'move', dx: 1, dy: 0.5 });
    // Two frames: the second reads the row the first found.
    for (let i = 0; i < 2; i++) {
      session.step();
      expect(sameFocus(session, record)).toBe(true);
    }
    // A saved state, then more steps and rows.
    const saved = save(session);
    const savedAt = [...record.position];
    // The columns grow (more rows than the initial capacity): new arrays.
    const columns = motion.position.columns.x;
    for (let i = 0; i < 300; i++) session.command({ type: 'spawnDebugMover', x: 4000 + i, y: 4000 + i, vx: 0, vy: 0 });
    session.step();
    expect(motion.position.columns.x).not.toBe(columns);
    for (let i = 0; i < 5; i++) {
      session.step();
      expect(sameFocus(session, record)).toBe(true);
    }
    expect(record.position[0]).not.toBe(savedAt[0]);
    // In the grown columns the steered mover becomes the last row again and moves into the first; its old row goes to
    // a new mover before the next frame.
    while (motion.position.entityAt(motion.position.size - 1) !== steered) session.sim.ecs.destroy(motion.position.entityAt(motion.position.size - 1));
    expect(sameFocus(session, record)).toBe(true);
    session.sim.ecs.destroy(motion.position.entityAt(0));
    expect(motion.position.indexOf(steered)).toBe(0);
    session.command({ type: 'spawnDebugMover', x: 6500.5, y: 6600.5, vx: 0, vy: 0 });
    session.step();
    expect(motion.position.entityAt(3)).not.toBe(steered);
    expect(sameFocus(session, record)).toBe(true);
    expect(record.position[0]).not.toBe(6500.5);
    // Loading the saved state: its position.
    load(session, saved);
    expect(sameFocus(session, record)).toBe(true);
    expect([...record.position]).toEqual(savedAt);
    // Another mover steered (the first one stays), then a state of this world in which the first one is steered again.
    session.command({ type: 'spawnDebugMover', x: 2000.75, y: 2100.25, controlled: true });
    session.step();
    const second = motion.controlled;
    expect(second).not.toBe(steered);
    expect(sameFocus(session, record)).toBe(true);
    expect([...record.position]).toEqual([2000.75, 2100.25]);
    const other = save(session);
    (other.participants.motion?.data as { controlled: number }).controlled = steered;
    load(session, other);
    expect(motion.controlled).toBe(steered);
    expect(sameFocus(session, record)).toBe(true);
    expect(record.position[0]).not.toBe(2000.75);
    // The steered mover destroyed: false, the record stays; a new steered one counts at once.
    session.sim.ecs.destroy(motion.controlled);
    record.position.set([3, 4]);
    expect(session.sampleFocus(record)).toBe(false);
    expect([...record.position]).toEqual([3, 4]);
    expect(sameFocus(session, record)).toBe(false);
    session.command({ type: 'spawnDebugMover', x: 3000.125, y: 3100.5, controlled: true });
    session.step();
    expect(sameFocus(session, record)).toBe(true);
    expect([...record.position]).toEqual([3000.125, 3100.5]);
  });

  it('mit Spieler: der Spieler, interpoliert mit dem Alpha des Bilds', () => {
    const session = new GameSession({ config: CONFIG });
    session.command({ type: 'spawnDebugMover', x: 7240, y: 8472, controlled: true });
    session.command({ type: 'player.spawn' });
    session.step();
    session.command({ type: 'player.move', dx: 1, dy: 0 });
    session.step();
    session.step();
    const record = new FocusRecord();
    for (const alpha of [0, 0.5, 1]) {
      session.setFrameAlpha(alpha);
      expect(sameFocus(session, record)).toBe(true);
    }
    const player = session.debugState().player;
    if (player === null) throw new Error('kein Spieler');
    expect(record.position[0]).toBe(player.x);
  });

  it('ein Aufruf legt nichts an (< 1 B je Aufruf), während der Läufer geht', async () => {
    const session = new GameSession({ config: CONFIG });
    for (let i = 0; i < 4; i++) session.command({ type: 'spawnDebugMover', x: 6000 + i * 40, y: 8000 });
    session.command({ type: 'spawnDebugMover', x: 7240, y: 8472, controlled: true });
    session.step();
    session.command({ type: 'move', dx: 1, dy: 0.5 });
    session.step();
    const record = new FocusRecord();
    const sink = new Float64Array(1);
    const sampleOnce = (): void => {
      if (session.sampleFocus(record)) sink[0] = record.layer;
    };
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        session.step();
        sampleOnce();
      }
    };
    frames(100);
    const before = record.position[0] as number;
    await inspector.post('HeapProfiler.collectGarbage');
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    frames(FRAMES);
    const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    // It walked: every frame read a new position.
    expect(record.position[0]).toBeGreaterThan(before);
    const inSample = (f: { functionName: string; url: string }): boolean => f.functionName === 'sampleOnce' && /fokus-satz\.test/.test(f.url);
    const alloc = pathAllocation(profile, inSample);
    expect(alloc.inPath / FRAMES, `Allokation unter sampleFocus: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_CALL);
    // The steered mover destroyed: no focus, and nothing allocated for that either.
    session.sim.ecs.destroy(motionOf(session).controlled);
    expect(session.sampleFocus(record)).toBe(false);
    frames(100);
    await inspector.post('HeapProfiler.collectGarbage');
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    frames(FRAMES);
    const none = pathAllocation(heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile), inSample);
    expect(none.inPath / FRAMES, `Allokation ohne Läufer: ${JSON.stringify(none.top)}`).toBeLessThan(MAX_BYTES_PER_CALL);
  }, 60_000);
});
