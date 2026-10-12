/**
 * Debug-Befehl `creature.condition` (M7-128; System `creature-debug`, src/game/creatures/debugSystem.ts; Konsole `condition <kreatur>
 * <zustand> [sekunden]`, src/debug/creatureCommands.ts): die nächste lebende Kreatur der Art legt den Zustand an wie ein
 * Treffer (Stapelregel), aber ohne Treffer – kein Schaden, kein Alarm, kein Aufblitzen; abgelehnt werden unbekannte Kreatur
 * oder unbekannter Zustand, kein Spieler, keine solche Kreatur in der Nähe. Ein Befehl wie jeder andere: validiert, im
 * nächsten Tick angewandt, aufgezeichnet – die Aufnahme spielt denselben Zustand nach (gleicher Hash). Das Bild
 * `kreatur-frost` legt seinen Frost damit (statt eines Schlags aus dem Nichts, ADR-0173).
 */
import { describe, expect, it } from 'vitest';
import { CommandRecorder } from '../../../src/engine/commands';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { gameCommandSchema, GAME_COMMAND_TYPES, type GameCommand } from '../../../src/game/commands';
import { MAX_DEBUG_CONDITION_SECONDS } from '../../../src/game/creatures/commands';
import { CREATURE_DEBUG_SYSTEM_ID } from '../../../src/game/creatures/debugSystem';
import { CREATURE_REJECT_REASONS } from '../../../src/game/creatures/events';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { runHeadless } from '../../../src/game/headless';
import { GameSession } from '../../../src/game/session';
import type { Simulation } from '../../../src/game/sim';
import { createDebugConsole } from '../../../src/debug/console';
import { registerCreatureCommands } from '../../../src/debug/creatureCommands';
import { createI18n } from '../../../src/i18n';
import { TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 20260930, worldSize: 'small', dayLengthMinutes: 12 } as const;
/** Ticks per second of the simulation. */
const TICK_HZ = 60;

interface Lebend {
  readonly entity: number;
  readonly creature: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly conditions: readonly { readonly id: string; readonly untilTick: number }[];
  readonly hurtTick: number;
  readonly target: number;
}

/** The living creatures of `sim` (id, x, health, conditions, last hurt, target), in store order. */
function lebende(sim: Simulation): Lebend[] {
  const c = sim.system('creatures') as CreatureSystem;
  const at = { x: 0, y: 0 };
  const out: Lebend[] = [];
  for (let i = 0; i < c.store.size; i++) {
    const s = c.store.valueAt(i);
    if (s.health <= 0 || !c.positionOf(c.store.entityAt(i), at)) continue;
    out.push({ entity: c.store.entityAt(i), creature: s.creature, x: at.x, y: at.y, health: s.health, conditions: s.conditions.map((k) => ({ id: k.id, untilTick: k.untilTick })), hurtTick: s.hurtTick, target: s.target });
  }
  return out;
}

/** A session (small world) with the player spawned and recorded; `run` sends commands and steps one tick. */
function sitzung() {
  const session = new GameSession({ config: CONFIG });
  const recorder = new CommandRecorder<GameCommand>({ seed: CONFIG.seed });
  session.sim.commands.setSink(recorder);
  const rejected: string[] = [];
  session.onEvent('commandRejected', (e) => rejected.push(e.reason));
  const run = (...cmds: unknown[]): string[] => {
    rejected.length = 0;
    for (const c of cmds) session.command(c);
    session.step();
    return [...rejected];
  };
  return { session, recorder, run };
}

describe('creature.condition (M7-128)', () => {
  it('der Befehl gehört dem System creature-debug und steht hinter den Befehlen von M6; Schema und Gründe', () => {
    expect(GAME_COMMAND_TYPES).toContain('creature.condition');
    expect(GAME_COMMAND_TYPES.indexOf('creature.condition')).toBe(GAME_COMMAND_TYPES.indexOf('trap.take') + 1);
    const { session } = sitzung();
    const owner = session.sim.systems.find((s) => s.commands !== undefined && Object.hasOwn(s.commands, 'creature.condition'));
    expect(owner?.id).toBe(CREATURE_DEBUG_SYSTEM_ID);
    expect(CREATURE_REJECT_REASONS).toEqual(expect.arrayContaining(['unknownCondition', 'noCreature', 'unknownCreature', 'noPlayer']));
    const ok = { type: 'creature.condition', creature: 'reh', condition: 'verlangsamt', seconds: 20 };
    expect(gameCommandSchema.safeParse(ok).success).toBe(true);
    expect(gameCommandSchema.safeParse({ ...ok, seconds: 0 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ ...ok, seconds: MAX_DEBUG_CONDITION_SECONDS + 1 }).success).toBe(false);
    expect(gameCommandSchema.safeParse({ ...ok, entity: 3 }).success).toBe(false);
  });

  it('legt den Zustand auf die nächste Kreatur der Art – ohne Treffer: kein Schaden, kein Alarm, kein Aufblitzen', () => {
    const { session, run } = sitzung();
    run({ type: 'player.spawn' }, { type: 'debug.god', on: true });
    const p = session.debugState().player;
    if (p === null) throw new Error('kein Spieler');
    // Two deer, the near one two tiles east, the far one five tiles west; a badger three tiles south.
    run(
      { type: 'creature.spawn', creature: 'reh', count: 1, x: p.x + 2 * TILE_PX, y: p.y, layer: 0 },
      { type: 'creature.spawn', creature: 'reh', count: 1, x: p.x - 5 * TILE_PX, y: p.y, layer: 0 },
      { type: 'creature.spawn', creature: 'dachs', count: 1, x: p.x, y: p.y + 3 * TILE_PX, layer: 0 },
    );
    const vorher = lebende(session.sim).filter((c) => c.creature === 'reh' || c.creature === 'dachs');
    const at = session.debugState().player ?? p;
    const d2 = (c: Lebend): number => (c.x - at.x) ** 2 + (c.y - at.y) ** 2;
    const nah = vorher.filter((c) => c.creature === 'reh').sort((a, b) => d2(a) - d2(b))[0];
    if (nah === undefined) throw new Error('kein Reh');
    const tick = session.sim.tick;
    expect(run({ type: 'creature.condition', creature: 'reh', condition: 'verlangsamt', seconds: 20 })).toEqual([]);
    const nachher = lebende(session.sim);
    const rehe = nachher.filter((c) => c.creature === 'reh');
    const frost = rehe.filter((c) => c.conditions.some((k) => k.id === 'verlangsamt'));
    expect(frost).toHaveLength(1);
    // The deer nearest the player when the command came (the world's own deer, the far one and the badger stay as they were).
    expect((frost[0] as Lebend).entity).toBe(nah.entity);
    expect((frost[0] as Lebend).conditions.find((k) => k.id === 'verlangsamt')?.untilTick).toBe(tick + 20 * TICK_HZ);
    expect(nachher.filter((c) => c.creature === 'dachs').every((c) => c.conditions.length === 0)).toBe(true);
    // No hit: health whole, never hurt, no target.
    const getroffen = frost[0] as Lebend;
    expect(getroffen.health).toBe(nah.health);
    expect(getroffen.hurtTick).toBe(-1);
    // No target (NULL_ENTITY): nobody alarmed it.
    expect(getroffen.target).toBe(nah.target);
    expect(getroffen.target).toBe(NULL_ENTITY);
    // The stack rule as on a hit: a second, shorter application never shortens it (`erneuern`/`verlaengern`).
    run({ type: 'creature.condition', creature: 'reh', condition: 'verlangsamt', seconds: 1 });
    const again = lebende(session.sim).find((c) => c.conditions.some((k) => k.id === 'verlangsamt'));
    expect(again?.conditions.find((k) => k.id === 'verlangsamt')?.untilTick).toBeGreaterThanOrEqual(tick + 20 * TICK_HZ);
  });

  it('Ablehnungen: kein Spieler, unbekannte Kreatur, unbekannter Zustand, keine solche Kreatur in der Nähe', () => {
    const { run } = sitzung();
    expect(run({ type: 'creature.condition', creature: 'reh', condition: 'verlangsamt', seconds: 5 })).toEqual(['noPlayer']);
    run({ type: 'player.spawn' });
    expect(run({ type: 'creature.condition', creature: 'gibtsnicht', condition: 'verlangsamt', seconds: 5 })).toEqual(['unknownCreature']);
    expect(run({ type: 'creature.condition', creature: 'reh', condition: 'gibtsnicht', seconds: 5 })).toEqual(['unknownCondition']);
    // The Nightmare only comes of fear: none in a fresh world.
    expect(run({ type: 'creature.condition', creature: 'nachtmahr', condition: 'verlangsamt', seconds: 5 })).toEqual(['noCreature']);
  });

  it('replay-fähig: die Aufnahme spielt in einer frischen Welt denselben Zustand nach (gleicher Hash)', () => {
    const { session, recorder, run } = sitzung();
    run({ type: 'player.spawn' }, { type: 'debug.god', on: true });
    const p = session.debugState().player;
    if (p === null) throw new Error('kein Spieler');
    run({ type: 'creature.spawn', creature: 'dachs', count: 1, x: p.x + 2 * TILE_PX, y: p.y, layer: 0 });
    run({ type: 'creature.condition', creature: 'dachs', condition: 'verlangsamt', seconds: 30 });
    for (let i = 0; i < 30; i++) run();
    expect(recorder.entries.some((e) => e.cmd.type === 'creature.condition')).toBe(true);
    const replay = runHeadless({ seed: CONFIG.seed, config: { worldSize: CONFIG.worldSize, dayLengthMinutes: CONFIG.dayLengthMinutes }, ticks: session.sim.tick, commands: JSON.parse(JSON.stringify(recorder.toJSON())) });
    expect(replay.hash).toBe(session.sim.hashState());
  });

  it('Konsole: condition <kreatur> <zustand> [sekunden] – eigene Dauer ohne Angabe, ein Zustand ohne Dauer braucht Sekunden', () => {
    const i18n = createI18n('de', { strict: true });
    const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
    const con = createDebugConsole({ t });
    const { session, run } = sitzung();
    registerCreatureCommands(con, { t, lang: () => i18n.lang, session });
    run({ type: 'player.spawn' });
    expect(con.exec('condition reh verlangsamt 20')).toBe('Verlangsamt liegt auf der nächsten Kreatur „Reh“ (20 s).');
    expect(con.exec('help condition')).toContain('condition reh verlangsamt 20');
    const en = createI18n('en', { strict: true });
    const ten = (k: string, p?: Readonly<Record<string, string | number>>): string => en.t(k, p);
    const conEn = createDebugConsole({ t: ten });
    registerCreatureCommands(conEn, { t: ten, lang: () => en.lang, session });
    expect(conEn.exec('condition dachs verlangsamt 5')).toBe('Slowed lies on the nearest “Badger” (5 s).');
  });
});
