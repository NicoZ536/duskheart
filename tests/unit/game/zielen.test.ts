/**
 * M6-01 Zielen (docs/SPIEL.md §10 "Zielen (M6-01)"; MASTERPROMPT §19.1 "Zielen mit der Maus (Figur blickt zum Cursor) bzw.
 * rechtem Stick; freie Bewegung, Sprites in 4 Richtungen"): `player.aim` is pixel-precise, the aim angle is `atan2` from
 * the feet to the aimed pixel, the facing follows it in four directions with hysteresis while the player fights, aims or
 * blocks – otherwise the movement as before; the right stick aims from the feet every frame it is deflected; the session's
 * sample exposes angle and phase for the weapon sprite.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CommandQueue } from '../../../src/engine/commands';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState, type GamepadLike } from '../../../src/engine/input/state';
import { FACING_ANGLE, aimAngle, degToRad, facingForAngle, nearestFacing, wrapAngle } from '../../../src/game/combat/formulas';
import { createCombatSample, sampleCombat } from '../../../src/game/combat/sample';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';
import { kampfWelt } from './kampf-testwelt';

const H = BALANCE.combat.aim.facingHysteresisDeg;

describe('Zielwinkel und Blickrichtung (Formeln)', () => {
  it('der Zielwinkel ist atan2 vom Fuß zum Zielpixel: Osten 0, Süden +π/2 (y nach unten), Westen π, Norden −π/2', () => {
    expect(aimAngle(10, 0)).toBe(0);
    expect(aimAngle(0, 10)).toBeCloseTo(Math.PI / 2, 12);
    expect(aimAngle(-10, 0)).toBeCloseTo(Math.PI, 12);
    expect(aimAngle(0, -10)).toBeCloseTo(-Math.PI / 2, 12);
    expect(aimAngle(3, 3)).toBeCloseTo(Math.PI / 4, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('Zielwinkel → Richtung: acht Winkel fallen in die vier 90°-Sektoren, die Diagonale genau dazwischen ist waagerecht', () => {
    const cases: Array<[deg: number, facing: ReturnType<typeof nearestFacing>]> = [
      [0, 'right'],
      [44, 'right'],
      [45, 'right'],
      [46, 'down'],
      [90, 'down'],
      [135, 'left'],
      [180, 'left'],
      [-135, 'left'],
      [-134, 'up'],
      [-90, 'up'],
      [-45, 'right'],
      [-46, 'up'],
    ];
    for (const [deg, facing] of cases) expect(nearestFacing(degToRad(deg)), `${deg}°`).toBe(facing);
  });

  it(`Hysterese ${H}°: die Blickrichtung bleibt, bis der Winkel ihren Sektor um mehr als ${H}° verlässt`, () => {
    // From "right" (0°): its sector ends at 45°, widened by H.
    expect(facingForAngle(degToRad(45 + H - 1), 'right')).toBe('right');
    expect(facingForAngle(degToRad(45 + H + 1), 'right')).toBe('down');
    expect(facingForAngle(degToRad(-(45 + H - 1)), 'right')).toBe('right');
    expect(facingForAngle(degToRad(-(45 + H + 1)), 'right')).toBe('up');
    // From "down" (90°) the same diagonal stays "down" – the flicker on a diagonal is gone.
    expect(facingForAngle(degToRad(45 - H + 1), 'down')).toBe('down');
    expect(facingForAngle(degToRad(45 - H - 1), 'down')).toBe('right');
    // Across the ±180° seam.
    expect(facingForAngle(degToRad(-170), 'left')).toBe('left');
    expect(facingForAngle(degToRad(170), 'left')).toBe('left');
    expect(facingForAngle(degToRad(180 - 45 - H - 1), 'left')).toBe('down');
    // Without hysteresis the diagonal decides at once.
    expect(facingForAngle(degToRad(46), 'right', 0)).toBe('down');
  });

  it('jede Richtung hat ihren Winkel, und der Winkel ergibt wieder die Richtung', () => {
    for (const f of ['right', 'down', 'left', 'up'] as const) expect(nearestFacing(FACING_ANGLE[f])).toBe(f);
  });
});

describe('player.aim pixelgenau', () => {
  it('nimmt nur ganze Weltpixel; ohne Punkt kein Ziel', () => {
    expect(parseGameCommand({ type: 'player.aim', x: 10, y: -3 })).toEqual({ type: 'player.aim', x: 10, y: -3 });
    expect(parseGameCommand({ type: 'player.aim' })).toEqual({ type: 'player.aim' });
    expect(() => parseGameCommand({ type: 'player.aim', x: 10.5, y: 3 })).toThrow(TypeError);
  });

  it('der Zielpunkt der Simulation ist das gesendete Pixel, nicht die Kachel', () => {
    const k = kampfWelt();
    const p = k.pos();
    k.aimBy(37, -5);
    const sample = createCombatSample();
    expect(sampleCombat(k.sim, k.combat, k.player, k.aimSource, sample)).toBe(true);
    expect(sample.aimed).toBe(true);
    expect(sample.aimX).toBe(Math.floor(p.x + 37));
    expect(sample.aimAngle).toBeCloseTo(Math.atan2(Math.floor(p.y - 5) - p.y, Math.floor(p.x + 37) - p.x), 12);
  });
});

describe('Blickrichtung folgt dem Ziel nur im Kampf', () => {
  it('ohne Kampf blickt die Figur in die Laufrichtung – das Ziel dahinter ändert nichts', () => {
    const k = kampfWelt();
    k.aimBy(-40, 0);
    k.run(5, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(k.body().facing).toBe('right');
  });

  it('beim Blocken blickt sie zum Ziel, auch rückwärts gehend; eine Sekunde nach dem Kampf wieder in die Laufrichtung', () => {
    const k = kampfWelt();
    k.aimBy(-40, 2);
    k.run(1, [{ type: 'combat.block', on: true }]);
    k.run(5, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(k.body().facing).toBe('left');
    // The aim swings up past the hysteresis: the facing follows.
    k.aimBy(-10, -40);
    k.run(1);
    expect(k.body().facing).toBe('up');
    k.run(1, [{ type: 'combat.block', on: false }]);
    k.run(Math.round(BALANCE.combat.aim.fightingSeconds * k.sim.clock.tickHz) + 2);
    expect(k.body().facing).toBe('right');
  });

  it('während eines Schlags folgt die Blickrichtung dem Ziel; eine Rolle behält ihre eigene Richtung', () => {
    const k = kampfWelt();
    k.aimBy(0, 40);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    k.run(1, [{ type: 'combat.attack', on: false }]);
    expect(k.body().facing).toBe('down');
    k.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(k.body().facing).toBe('right');
  });
});

describe('Rechter Stick zielt (Eingabe)', () => {
  /** A standard gamepad with the right stick at (rx, ry). */
  function pad(rx: number, ry: number): GamepadLike {
    return { id: 'pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, rx, ry], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  }

  function chain(position: { x: number; y: number } | null) {
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet());
    const translator = new InputCommandTranslator();
    translator.useProbe({ hand: () => null, position: (out) => (position === null ? false : ((out.x = position.x), (out.y = position.y), true)) });
    const queue = new CommandQueue<GameCommand>();
    const frame = (): GameCommand[] => {
      reader.update();
      translator.translate(reader, queue, 'player');
      state.endFrame();
      const out: GameCommand[] = [];
      queue.drainForTick(0, (c) => out.push(c));
      return out;
    };
    return { state, frame };
  }

  it('jedes Frame mit Ausschlag ein Zielpixel 3 Kacheln voraus; losgelassen einmal „kein Ziel“', () => {
    const { state, frame } = chain({ x: 100.5, y: 200.25 });
    const reach = BALANCE.combat.aim.stickReachPx;
    state.applyGamepad(pad(1, 0));
    const aimOf = (cmds: GameCommand[]) => cmds.filter((c) => c.type === 'player.aim');
    expect(aimOf(frame())).toEqual([{ type: 'player.aim', x: Math.floor(100.5 + reach), y: 200 }]);
    expect(aimOf(frame())).toEqual([{ type: 'player.aim', x: Math.floor(100.5 + reach), y: 200 }]);
    state.applyGamepad(pad(0, 0));
    expect(aimOf(frame())).toEqual([{ type: 'player.aim' }]);
    expect(aimOf(frame())).toEqual([]);
  });

  it('ohne Spieler (keine Position) sendet der Stick nichts', () => {
    const { state, frame } = chain(null);
    state.applyGamepad(pad(1, 0));
    expect(frame().filter((c) => c.type === 'player.aim')).toEqual([]);
  });
});
