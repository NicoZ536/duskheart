/**
 * M6-09b (MASTERPROMPT §19.2 "Schilde", §12.2 "Mit Schild … hängt sie am Gürtel (−40 % Radius)", §4.5 "Ausrüstung als
 * Layer (… Nebenhand)"; docs/ART.md; src/render/game/playerFigure.ts): a shield worn in the off hand is drawn in the game
 * view – `ausruestung_<schild>` on the body's socket `nebenhand`, in every pose and facing, in the rig's draw order. The
 * pose reads it from the equipment (the light then hangs on the belt and is not drawn); the fight's clips take their steady
 * off-hand variant, the guard raises the shield, and in clips that grip the weapon with both hands (two-hander, bow,
 * crossbow) the shield is not drawn; rolling and swimming the hands hold nothing.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createCombatSample, type CombatSample } from '../../../src/game/combat/sample';
import { equipmentRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import { createPlayerSample, GameSession, type PlayerSample } from '../../../src/game/session';
import { DIRECTIONS, clipFrameAt, type Direction } from '../../../src/render/anim/animation';
import { FIGURE_LAYER_ORDER, socketOffset } from '../../../src/render/anim/figure';
import { spriteFrame, type AtlasData, type AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { BLOCK_ACTION, COMBAT_ACTIONS } from '../../../src/render/game/combatClips';
import { buildPlayerFigure, createPlayerPose, LIGHT_CLIP_SUFFIX, PLAYER_BODY_SPRITE, PlayerFigure, PlayerPoseReader, START_CLOTHING } from '../../../src/render/game/playerFigure';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const OWNER = new Map<SpriteFrameRef, [string, number]>();
for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => OWNER.set(f, [s.id, i]));
const BODY = MANIFEST.sprites[PLAYER_BODY_SPRITE];
const BRONZE_SHIELD = 'ausruestung_bronzeschild';
const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;
/** Time per test [ms]: each loadout is a game session with its world (a few seconds on a loaded machine). */
const SESSION_TIMEOUT_MS = 60_000;
/** Sessions by loadout, built once per file (tests that change the equipment build their own). */
const SESSIONS = new Map<string, GameSession>();

/** The session of a loadout (`fresh`: one of its own, to change). */
function armed(weapon: string, shield: string | null, torch = false, fresh = false): GameSession {
  const key = `${weapon}|${shield ?? ''}|${torch ? 'fackel' : ''}`;
  const known = fresh ? undefined : SESSIONS.get(key);
  if (known !== undefined) return known;
  const session = build(weapon, shield, torch);
  if (!fresh) SESSIONS.set(key, session);
  return session;
}

/** A session whose player holds `weapon` (hotbar slot 0) and wears `shield` in the off hand; `torch` adds a torch to the hotbar. */
function build(weapon: string, shield: string | null, torch: boolean): GameSession {
  const session = new GameSession({ config: CONFIG });
  session.command({ type: 'player.spawn' });
  session.step();
  session.command({ type: 'inventory.give', item: weapon, count: 1 });
  session.command({ type: 'player.selectHotbar', index: 0 });
  if (shield !== null) {
    session.command({ type: 'inventory.give', item: shield, count: 1 });
    session.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 1 }, to: equipmentRef('nebenhand') });
  }
  if (torch) session.command({ type: 'inventory.give', item: 'fackel', count: 1 });
  session.step();
  session.step();
  return session;
}

interface Drawn {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

/** A pose of the figure: movement mode and its clock, the fight's sample, a body mode's progress. */
interface Pose {
  readonly name: string;
  readonly state?: PlayerSample['state'];
  readonly seconds?: number;
  readonly progress?: number;
  readonly combat?: Partial<CombatSample>;
}

/** What `figure` draws for `session`'s player standing at (100, 200) facing `facing` in `pose`. */
function draw(figure: PlayerFigure, session: GameSession, facing: Direction, pose: Pose, time = 1): Drawn[] {
  const combat: CombatSample = { ...createCombatSample(), present: true, ...pose.combat };
  const s = {
    sim: session.sim,
    onEvent: () => () => undefined,
    samplePlayer(out: PlayerSample): boolean {
      Object.assign(out, createPlayerSample(), { x: 100, y: 200, facing, state: pose.state ?? 'idle', stateSeconds: pose.seconds ?? 0, actionProgress: pose.progress ?? 0, health: 100, maxHealth: 100 });
      return true;
    },
    sampleCombat(out: CombatSample): boolean {
      Object.assign(out, combat);
      return true;
    },
  };
  const out: Drawn[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = OWNER.get(d.frame as SpriteFrameRef);
        out.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, x: d.x, y: d.y });
        return out.length - 1;
      },
    },
  } as unknown as RenderScene;
  expect(figure.place(scene, ATLAS, s, time, 100, 200)).toBe(true);
  return out;
}

const SWORD_POSES: readonly Pose[] = [
  { name: 'idle' },
  { name: 'gehen', state: 'walk', seconds: 0.2 },
  { name: 'laufen', state: 'sprint', seconds: 0.1 },
  { name: 'schleichen', state: 'sneak', seconds: 0.3 },
  { name: 'ausholen', combat: { phase: 'ausholen', phaseProgress: 0.6, klasse: 'schwert', fighting: true } },
  { name: 'schlag', combat: { phase: 'erholung', phaseProgress: 0, klasse: 'schwert', fighting: true } },
  { name: 'schwer', combat: { phase: 'erholung', phaseProgress: 0.2, heavy: true, klasse: 'schwert', fighting: true } },
  { name: 'block', combat: { phase: 'bereit', blocking: true, blockKind: 'block', blockSeconds: 0.3, fighting: true } },
];

describe('Schild im Spielbild (M6-09b)', { timeout: SESSION_TIMEOUT_MS }, () => {
  it('die Pose liest den Schild aus der Nebenhand – die Fackel hängt dann am Gürtel und ist nicht in der Hand', () => {
    const reader = new PlayerPoseReader();
    const pose = createPlayerPose();
    const withShield = armed('bronzeschwert', 'bronzeschild', true);
    reader.sample(withShield.sim, pose);
    expect(pose.shield).toBe('bronzeschild');
    expect(pose.hand).toBe('bronzeschwert');
    expect(pose.offhand).toBeNull();
    // The simulation's rule (§12.2): with a shield the torch of the hotbar hangs on the belt at −40 % radius.
    const light = withShield.sim.system('light') as LightSystem;
    expect(light.carried?.mode).toBe('guertel');
    expect(BALANCE.light.offhand.beltRadiusFactor).toBe(0.6);
    // A torch in the off hand instead: the light, no shield.
    const torch = new GameSession({ config: CONFIG });
    torch.command({ type: 'player.spawn' });
    torch.step();
    torch.command({ type: 'inventory.give', item: 'fackel', count: 1 });
    torch.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') });
    torch.step();
    reader.sample(torch.sim, pose);
    expect(pose.shield).toBeNull();
    expect(pose.offhand).toBe('fackel');
    // Nothing in the off hand.
    reader.sample(armed('bronzeschwert', null).sim, pose);
    expect(pose.shield).toBeNull();
    expect(pose.offhand).toBeNull();
  });

  it('der Bronzeschild sitzt in jeder Pose und Richtung auf dem Sockel „nebenhand“, in der Zeichenfolge der Richtung', () => {
    if (BODY === undefined) throw new Error('Spielerfigur fehlt');
    const session = armed('bronzeschwert', 'bronzeschild');
    for (const facing of DIRECTIONS) {
      const order = FIGURE_LAYER_ORDER[facing];
      const shieldBeforeBody = order.indexOf('nebenhand') < order.indexOf('body');
      for (const pose of SWORD_POSES) {
        const figure = new PlayerFigure();
        const drawn = draw(figure, session, facing, pose);
        const label = `${facing} ${pose.name} (${figure.clipAction})`;
        const shield = drawn.findIndex((d) => d.sprite === BRONZE_SHIELD);
        const body = drawn.findIndex((d) => d.sprite === PLAYER_BODY_SPRITE);
        expect(shield, label).toBeGreaterThanOrEqual(0);
        // Behind the body facing away and in the far-hand profile, in front facing the viewer and in the near-hand profile.
        expect(shield < body, label).toBe(shieldBeforeBody);
        // On the off hand's socket of the body frame drawn, in the shield's hold frame of the facing.
        const bodyFrame = drawn[body] as Drawn;
        const point = BODY.sockets.nebenhand?.[bodyFrame.frame];
        if (point === undefined || point === null) throw new Error(`${label}: kein Sockel nebenhand`);
        const at = socketOffset(spriteFrame(BODY, bodyFrame.frame), point, false, { x: 0, y: 0 });
        const s = drawn[shield] as Drawn;
        expect([s.x, s.y], label).toEqual([100 + at.x, 200 + at.y]);
        const hold = MANIFEST.sprites[BRONZE_SHIELD]?.clips[facing];
        expect(hold, label).toBeDefined();
        expect(s.frame, label).toBe(clipFrameAt(hold as NonNullable<typeof hold>, 1));
        figure.dispose();
      }
    }
  });

  it('im Kampf hält der Schildarm still (die ruhige Nebenhand-Variante), die Deckung hebt den Schild; gehen und stehen wie ohne Schild', () => {
    const session = armed('bronzeschwert', 'bronzeschild');
    const bare = armed('bronzeschwert', null);
    for (const facing of DIRECTIONS) {
      for (const pose of SWORD_POSES) {
        const figure = new PlayerFigure();
        draw(figure, session, facing, pose);
        const without = new PlayerFigure();
        draw(without, bare, facing, pose);
        const fight = pose.combat !== undefined && pose.combat.phase !== 'bereit';
        const expected = fight ? `${without.clipAction}${LIGHT_CLIP_SUFFIX}` : without.clipAction;
        expect(figure.clipAction, `${facing} ${pose.name}`).toBe(expected);
        if (pose.name === 'block') expect(figure.clipAction).toBe(BLOCK_ACTION);
      }
    }
  });

  it('greifen beide Hände die Waffe (Zweihänder, Bogen), wird der Schild nicht gezeichnet; rollend und schwimmend auch nicht', () => {
    const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: 'ausruestung_bronzeschwert', offhand: BRONZE_SHIELD });
    if (rig === null) throw new Error('Spielerfigur fehlt');
    // From the atlas: the combat clips without a steady off-hand variant (the guard aside) – two-hander, bow, crossbow.
    expect([...rig.bothHands].sort()).toEqual(['attack_armbrust', 'attack_bogen', 'attack_zweihand', 'heavy_zweihand']);
    for (const a of rig.bothHands) {
      expect(COMBAT_ACTIONS).toContain(a);
      expect(rig.available.has(`${a}${LIGHT_CLIP_SUFFIX}`), a).toBe(false);
    }
    const cases = [
      ['bronzezweihaender', 'holzschild', { phase: 'ausholen', phaseProgress: 0.5, klasse: 'zweihand', fighting: true }, 'attack_zweihand'],
      ['bronzezweihaender', 'holzschild', { phase: 'erholung', phaseProgress: 0.1, heavy: true, klasse: 'zweihand', fighting: true }, 'heavy_zweihand'],
      ['kurzbogen', 'holzschild', { phase: 'spannen', tension: 0.8, klasse: 'bogen', fighting: true }, 'attack_bogen'],
    ] as const;
    for (const [weapon, shield, combat, clip] of cases) {
      const session = armed(weapon, shield);
      for (const facing of DIRECTIONS) {
        const figure = new PlayerFigure();
        const fighting = draw(figure, session, facing, { name: clip, combat });
        expect(figure.clipAction, `${weapon} ${facing}`).toBe(clip);
        expect(fighting.some((d) => d.sprite === 'ausruestung_holzschild'), `${weapon} ${facing} ${clip}`).toBe(false);
        expect(fighting.some((d) => d.sprite === `ausruestung_${weapon}`), `${weapon} ${facing} ${clip}`).toBe(true);
        // At rest and in the guard the same loadout shows the shield.
        expect(draw(figure, session, facing, { name: 'idle' }).some((d) => d.sprite === 'ausruestung_holzschild'), `${weapon} ${facing} idle`).toBe(true);
        const guard = draw(figure, session, facing, { name: 'block', combat: { phase: 'bereit', blocking: true, blockKind: 'block', blockSeconds: 0.2, fighting: true } });
        expect(figure.clipAction, `${weapon} ${facing}`).toBe(BLOCK_ACTION);
        expect(guard.some((d) => d.sprite === 'ausruestung_holzschild'), `${weapon} ${facing} block`).toBe(true);
        figure.dispose();
      }
    }
    const session = armed('bronzeschwert', 'bronzeschild');
    for (const state of ['roll', 'swim'] as const) {
      const figure = new PlayerFigure();
      expect(draw(figure, session, 'down', { name: state, state, progress: 0.4, seconds: 0.4 }).some((d) => d.sprite === BRONZE_SHIELD), state).toBe(false);
    }
  });

  it('ein anderer Schild wechselt das Bild, ohne Schild bleibt die Nebenhand leer – ohne dass je Frame ein Sprite-Name gebildet wird', () => {
    const figure = new PlayerFigure();
    const session = armed('bronzeschwert', 'bronzeschild', false, true);
    expect(draw(figure, session, 'down', { name: 'idle' }).some((d) => d.sprite === BRONZE_SHIELD)).toBe(true);
    const built = figure.figure;
    // The same loadout keeps the same rig (item ids compared, the sprite's name formed only once).
    draw(figure, session, 'down', { name: 'idle' }, 2);
    expect(figure.figure).toBe(built);
    // The wooden one instead.
    session.command({ type: 'inventory.give', item: 'holzschild', count: 1 });
    session.step();
    session.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 1 }, to: equipmentRef('nebenhand') });
    session.step();
    const wood = draw(figure, session, 'down', { name: 'idle' }, 3);
    expect(wood.some((d) => d.sprite === 'ausruestung_holzschild')).toBe(true);
    expect(wood.some((d) => d.sprite === BRONZE_SHIELD)).toBe(false);
    expect(figure.figure).not.toBe(built);
    // Taken off: the hand is empty.
    session.command({ type: 'inventory.move', from: equipmentRef('nebenhand'), to: { bereich: 'inventar', index: 5 } });
    session.step();
    const none = draw(figure, session, 'down', { name: 'idle' }, 4);
    expect(none.some((d) => d.sprite.endsWith('schild'))).toBe(false);
    expect(figure.pose.shield).toBeNull();
  });
});
