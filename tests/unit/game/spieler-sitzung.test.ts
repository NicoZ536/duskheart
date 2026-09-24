/**
 * M3-08 presentation wiring: the input chain steers the player (WASD/stick → `player.move`, Shift →
 * `player.sprint`, Ctrl → `player.sneak`, Space → `player.roll`), the session samples the player for
 * camera, sprite and HUD – interpolated between the last two ticks with the frame's alpha – and the
 * game view's figure picks the clip of the movement mode, falling back to idle while art is missing.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { PLAYER_MOVE_STATES } from '../../../src/content/balance/player';
import { CommandQueue } from '../../../src/engine/commands';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';
import { FACINGS } from '../../../src/game/player/state';
import { GameSession, createPlayerSample, createSessionStatus, type SessionFocus } from '../../../src/game/session';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { PLAYER_BODY_SPRITE, PLAYER_CLIP_CHAIN, PLAYER_DRESSED_SPRITE, PlayerFigure, START_CLOTHING, buildPlayerFigure, figureActions, playerAction } from '../../../src/render/game/playerFigure';
import { RenderScene } from '../../../src/render/scene';
import type { VitalsSystem } from '../../../src/game/survival/system';

const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;
const TICK = BALANCE.time.tickHz;

function chain() {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  const translator = new InputCommandTranslator();
  const queue = new CommandQueue<GameCommand>();
  const frame = (target: 'player' | 'mover' = 'player'): GameCommand[] => {
    reader.update();
    translator.translate(reader, queue, target);
    state.endFrame();
    const out: GameCommand[] = [];
    queue.drainForTick(0, (cmd) => out.push(cmd));
    return out;
  };
  return { state, reader, frame };
}

function gameAtlas(): AtlasData {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const manifest = manifestFromGenerated(mod);
  const pixels = new Uint8Array(4);
  return { manifest, albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
}

describe('Eingabe → Spieler-Commands', () => {
  it('WASD moves, Shift sprints, Ctrl sneaks – each sent when it changes; Space rolls towards the held direction', () => {
    const { state, frame } = chain();
    expect(frame()).toEqual([]);
    state.keyDown('KeyD');
    expect(frame()).toEqual([{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(frame()).toEqual([]);
    state.keyDown('ShiftLeft');
    expect(frame()).toEqual([{ type: 'player.sprint', on: true }]);
    expect(frame()).toEqual([]);
    state.keyUp('ShiftLeft');
    state.keyDown('ControlLeft');
    expect(frame()).toEqual([
      { type: 'player.sprint', on: false },
      { type: 'player.sneak', on: true },
    ]);
    state.keyDown('Space');
    expect(frame()).toEqual([{ type: 'player.roll', dx: 1, dy: 0 }]);
    // Held Space does not roll again.
    expect(frame()).toEqual([]);
    state.keyUp('Space');
    state.keyUp('KeyD');
    state.keyUp('ControlLeft');
    expect(frame()).toEqual([
      { type: 'player.move', dx: 0, dy: 0 },
      { type: 'player.sneak', on: false },
    ]);
  });

  it('the debug mover of M2 only moves; switching to the player re-sends the held state', () => {
    const { state, frame } = chain();
    state.keyDown('KeyS');
    state.keyDown('ShiftLeft');
    expect(frame('mover')).toEqual([{ type: 'move', dx: 0, dy: 1 }]);
    expect(frame('player')).toEqual([
      { type: 'player.move', dx: 0, dy: 1 },
      { type: 'player.sprint', on: true },
    ]);
  });

  it('menus stop the player and release sprint', () => {
    const { state, reader, frame } = chain();
    state.keyDown('KeyA');
    state.keyDown('ShiftLeft');
    expect(frame()).toHaveLength(2);
    reader.setContext('ui');
    expect(frame()).toEqual([
      { type: 'player.move', dx: 0, dy: 0 },
      { type: 'player.sprint', on: false },
    ]);
  });
});

describe('Sitzung: Spieler steuern und abtasten', () => {
  it('without a player the input steers the M2 debug mover; with a player the player', () => {
    const session = new GameSession({ config: CONFIG });
    session.input.keyDown('KeyD');
    session.beginFrame();
    const before: GameCommand[] = [];
    session.sim.commands.drainForTick(0, (c) => before.push(c));
    expect(before).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    session.command({ type: 'player.spawn' });
    session.step();
    session.beginFrame();
    const after: GameCommand[] = [];
    session.sim.commands.drainForTick(1, (c) => after.push(c));
    expect(after).toEqual([{ type: 'player.move', dx: 1, dy: 0 }]);
  });

  it('samples the player interpolated between the last two ticks; focus, status and debug state follow the player', () => {
    const session = new GameSession({ config: CONFIG });
    session.command({ type: 'player.spawn' });
    session.step();
    const spawned = session.debugState().player;
    if (spawned === null) throw new Error('no player');
    session.command({ type: 'player.move', dx: 1, dy: 0 });
    session.step();
    session.step();
    const p = createPlayerSample();
    const focus: SessionFocus = { x: 0, y: 0, layer: 0 };
    const now = session.debugState().player;
    if (now === null) throw new Error('no player');
    const step = BALANCE.player.movement.walkTilesPerSecond * 16 / TICK;
    session.setFrameAlpha(0);
    expect(session.samplePlayer(p)).toBe(true);
    expect(p.x).toBeCloseTo(now.x - step, 3);
    session.setFrameAlpha(1);
    session.samplePlayer(p);
    expect(p.x).toBe(now.x);
    session.setFrameAlpha(0.5);
    session.samplePlayer(p);
    expect(p.x).toBeCloseTo(now.x - step / 2, 3);
    expect(session.sampleFocus(focus)).toBe(true);
    expect(focus).toEqual({ x: p.x, y: p.y, layer: 0 });
    expect(p).toMatchObject({ state: 'walk', facing: 'right', layer: 0, swimming: false, invulnerable: false, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, temperatureStage: 'normal' });
    expect(p.stateSeconds).toBeCloseTo(1.5 / TICK, 9);
    expect(p.speed).toBeCloseTo(BALANCE.player.movement.walkTilesPerSecond * 16, 1);
    // Out-of-range alphas are clamped.
    session.setFrameAlpha(7);
    session.samplePlayer(p);
    expect(p.x).toBe(now.x);
    const status = session.sampleStatus(createSessionStatus());
    expect(status.controlled).toBe(now.entity);
    expect(session.debugState().controlled).toEqual({ entity: now.entity, x: now.x, y: now.y });
    expect(now).toMatchObject({ state: 'walk', stateSince: 1, level: 0, layer: 0 });
    expect(JSON.parse(JSON.stringify(session.debugState()))).toEqual(session.debugState());
  });

  it('reports the progress of a roll for its clip', () => {
    const session = new GameSession({ config: CONFIG });
    session.command({ type: 'player.spawn' });
    session.step();
    session.command({ type: 'player.roll', dx: 1, dy: 0 });
    for (let i = 0; i < 12; i++) session.step();
    const p = createPlayerSample();
    session.setFrameAlpha(0);
    session.samplePlayer(p);
    expect(p.state).toBe('roll');
    expect(p.actionProgress).toBeCloseTo(11 / (BALANCE.player.roll.durationSeconds * TICK), 9);
    expect(p.invulnerable).toBe(true);
  });
});

describe('Spielerfigur (Clips je Bewegungsart)', () => {
  it('shows each mode with the first clip of its chain the body has in all four directions (idle at the end)', () => {
    const atlas = gameAtlas();
    const built = buildPlayerFigure(atlas.manifest, START_CLOTHING);
    if (built === null) throw new Error('keine Spielerfigur im Atlas');
    const body = built.body;
    for (const state of PLAYER_MOVE_STATES) {
      expect(PLAYER_CLIP_CHAIN[state].at(-1)).toBe('idle');
      const expected = PLAYER_CLIP_CHAIN[state].find((a) => FACINGS.every((f) => body.clips[`${a}_${f}`] !== undefined));
      expect(built.byState[state], state).toBe(expected);
    }
    // With the M3-05 body the movement modes have their own clips; the dressed idle figure is the fallback.
    if (body.id === PLAYER_BODY_SPRITE) {
      expect([built.byState.walk, built.byState.sprint, built.byState.roll, built.byState.swim]).toEqual(['walk', 'run', 'roll', 'swim']);
      expect(built.clothing).toEqual(START_CLOTHING.map((c) => c.sprite).filter((id) => atlas.manifest.sprites[id] !== undefined));
    } else expect(body.id).toBe(PLAYER_DRESSED_SPRITE);
  });

  it('falls back along the chain; mirrors a missing left clip only for a symmetric figure', () => {
    const clip = (name: string) => ({ name, frames: [0], fps: 10, loop: true });
    const clips: Record<string, ReturnType<typeof clip>> = {};
    for (const f of FACINGS) clips[`idle_${f}`] = clip(`idle_${f}`);
    for (const f of ['down', 'up', 'right'] as const) {
      clips[`walk_${f}`] = clip(`walk_${f}`);
      clips[`run_${f}`] = clip(`run_${f}`);
    }
    const sprite = { id: 'probe', group: 'figuren', size: [32, 32], frames: [], clips, sockets: {}, heightHint: 'zylinder', emissive: false, symmetric: true } as unknown as AtlasSprite;
    const symmetric = new Set(figureActions(sprite, true));
    expect([...symmetric].sort()).toEqual(['idle', 'run', 'walk']);
    expect(playerAction('sprint', symmetric)).toBe('run');
    expect(playerAction('sneak', symmetric)).toBe('walk');
    expect(playerAction('roll', symmetric)).toBe('idle');
    // Without mirroring the missing left clips rule walk and run out.
    const asymmetric = new Set(figureActions(sprite, false));
    expect([...asymmetric]).toEqual(['idle']);
    expect(playerAction('sprint', asymmetric)).toBe('idle');
    const manifest = { width: 1, height: 1, sprites: { [PLAYER_DRESSED_SPRITE]: { ...sprite, id: PLAYER_DRESSED_SPRITE } }, paletteRows: [], sourceHash: 'probe' } as unknown as AtlasManifest;
    expect(buildPlayerFigure(manifest, START_CLOTHING)?.body.id).toBe(PLAYER_DRESSED_SPRITE);
    expect(buildPlayerFigure({ ...manifest, sprites: {} }, START_CLOTHING)).toBeNull();
  });

  it('draws the player with body and clothing, the clip of its mode, and flashes white after damage', () => {
    const atlas = gameAtlas();
    const session = new GameSession({ config: CONFIG });
    const figure = new PlayerFigure();
    const scene = new RenderScene();
    scene.beginFrame(0);
    expect(figure.place(scene, atlas, session, 0, 0, 0)).toBe(false);
    expect(scene.sprites.count).toBe(0);
    session.command({ type: 'player.spawn' });
    session.step();
    scene.beginFrame(1);
    expect(figure.place(scene, atlas, session, 1, 100, 200)).toBe(true);
    const parts = 1 + (figure.figure?.clothing.length ?? 0);
    expect(scene.sprites.count).toBe(parts);
    expect(figure.clipAction).toBe('idle');
    session.command({ type: 'player.move', dx: 0, dy: 1 });
    session.step();
    scene.beginFrame(2);
    figure.place(scene, atlas, session, 2, 100, 200);
    expect(figure.lastSample.state).toBe('walk');
    expect(figure.clipAction).toBe(figure.figure?.byState.walk);
    expect(figure.flashing).toBe(false);
    // A fall hurts: the next two frames flash, the third does not.
    (session.sim.system('vitals') as VitalsSystem).damage(session.sim, 10, 'sturz');
    session.step();
    scene.beginFrame(3);
    figure.place(scene, atlas, session, 3, 100, 200);
    expect(scene.sprites.count).toBe(parts);
    expect(figure.flashing).toBe(true);
    expect(figure.lastSample.health).toBe(90);
    figure.place(scene, atlas, session, 3 + 1 / TICK, 100, 200);
    expect(figure.flashing).toBe(true);
    figure.place(scene, atlas, session, 3 + 2 / TICK, 100, 200);
    expect(figure.flashing).toBe(false);
    // Without clothing only the body is drawn.
    figure.setClothing([]);
    scene.beginFrame(4);
    figure.place(scene, atlas, session, 4, 100, 200);
    expect(scene.sprites.count).toBe(1);
    figure.dispose();
  });
});
