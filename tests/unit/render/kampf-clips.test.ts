/**
 * M6-38, M6-38a, render part of M6-01 (MASTERPROMPT §19.1 "Waffen frei rotiert (Rotation im Low-Res-Puffer, pixelgenau)",
 * §4.5 "Angriff je Waffenklasse 4–6 … Smear-Frames"; docs/SPIEL.md §13): the player's figure shows the armoury's combat
 * clips chosen from `GameSession.sampleCombat` – per weapon class the light and the heavy attack, the bow's draw, the
 * throw, the block; the weapon plays its own clip of the same action; the smear frame (the strike event) stands on the tick
 * the blow lands; the weapon turns about its grip towards the aim by the difference to the facing's angle (clamped),
 * pushed as the sprite's rotation; a tool used as a weapon swings with the tool clip; in hitstop the clocks stand.
 */
import { describe, expect, it } from 'vitest';
import { WEAPON_CLASSES, type WeaponClass } from '../../../src/content/balance/tools';
import { degToRad } from '../../../src/game/combat/formulas';
import { createCombatSample, type CombatSample } from '../../../src/game/combat/sample';
import type { AttackPhase } from '../../../src/game/combat/state';
import { createPlayerSample, type PlayerSample } from '../../../src/game/session';
import { clipPositionAt, type AnimationClip } from '../../../src/render/anim/animation';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import {
  ATTACK_ACTION,
  BLOCK_ACTION,
  combatClipTime,
  combatPose,
  createCombatPose,
  handAngleFor,
  HEAVY_ACTION,
  MAX_HAND_ANGLE,
  STRIKE_EVENTS,
  strikePosition,
  TOOL_ACTION,
} from '../../../src/render/game/combatClips';
import { buildPlayerFigure, figureAction, PlayerFigure, START_CLOTHING } from '../../../src/render/game/playerFigure';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };

/** A weapon of every class that has a hand sprite (the fist and thrown weapons have none: the body alone). */
const WEAPON_OF: Readonly<Partial<Record<WeaponClass, string>>> = {
  schwert: 'bronzeschwert',
  axt: 'bronzekampfaxt',
  keule: 'holzkeule',
  speer: 'bronzespeer',
  dolch: 'bronzedolch',
  zweihand: 'bronzezweihaender',
  bogen: 'kurzbogen',
  armbrust: 'armbrust',
  schleuder: 'schleuder',
};
const MELEE: readonly WeaponClass[] = ['faust', 'schwert', 'axt', 'keule', 'speer', 'dolch', 'zweihand'];
const DRAWN: readonly WeaponClass[] = ['bogen', 'schleuder', 'wurf'];

function sample(patch: Partial<CombatSample>): CombatSample {
  return { ...createCombatSample(), present: true, ...patch };
}

/** The action check of a rig holding `item` (null: bare hands) – the same rule as `PlayerFigure`. */
function checkFor(item: string | null): (action: string) => boolean {
  const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, item === null ? {} : { hand: `ausruestung_${item}` });
  if (rig === null) throw new Error('Spielerfigur fehlt');
  return (a) => rig.available.has(a) && (!rig.handHeld || a === BLOCK_ACTION || rig.handActions.has(a));
}

function clipOf(action: string, dir: string): AnimationClip {
  const c = MANIFEST.sprites['spieler_basis']?.clips[`${action}_${dir}`];
  if (c === undefined) throw new Error(`spieler_basis: kein Clip ${action}_${dir}`);
  return c;
}

describe('Kampfclips: Wahl je Waffenklasse und Phase', () => {
  it('jede Klasse zeigt ihren leichten Angriff beim Ausholen und in der Erholung, die Waffe trägt denselben Clip', () => {
    for (const k of WEAPON_CLASSES) {
      const item = WEAPON_OF[k] ?? null;
      const can = checkFor(item);
      for (const phase of ['ausholen', 'erholung'] as const) {
        const pose = combatPose(sample({ klasse: k, phase, phaseProgress: 0.5 }), 'right', can, 0, createCombatPose());
        expect(pose.action, `${k} ${phase}`).toBe(ATTACK_ACTION[k]);
        expect(pose.stage).toBe(phase === 'ausholen' ? 'windup' : 'follow');
      }
      if (item !== null) {
        const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: `ausruestung_${item}` });
        expect(rig?.handActions.has(ATTACK_ACTION[k]), `${item} trägt ${ATTACK_ACTION[k]}`).toBe(true);
      }
    }
  });

  it('der schwere Angriff der Nahkampfklassen beim Aufladen und nach dem schweren Schlag', () => {
    for (const k of MELEE) {
      const can = checkFor(WEAPON_OF[k] ?? null);
      expect(combatPose(sample({ klasse: k, phase: 'aufladen' }), 'down', can, 0.5, createCombatPose()).action, k).toBe(HEAVY_ACTION[k]);
      expect(combatPose(sample({ klasse: k, phase: 'erholung', heavy: true }), 'down', can, 0, createCombatPose()).action, k).toBe(HEAVY_ACTION[k]);
      expect(combatPose(sample({ klasse: k, phase: 'erholung', heavy: false }), 'down', can, 0, createCombatPose()).action, k).toBe(ATTACK_ACTION[k]);
    }
  });

  it('Bogen, Schleuder und Wurf spannen mit ihrem Angriffsclip; die Armbrust lädt mit geneigter Waffe nach', () => {
    for (const k of DRAWN) {
      const pose = combatPose(sample({ klasse: k, phase: 'spannen', tension: 0.4 }), 'right', checkFor(WEAPON_OF[k] ?? null), 0, createCombatPose());
      expect(pose.action, k).toBe(ATTACK_ACTION[k]);
      expect(pose.stage).toBe('draw');
      expect(pose.progress).toBeCloseTo(0.4, 9);
    }
    const reload = combatPose(sample({ klasse: 'armbrust', phase: 'nachladen', phaseProgress: 0.5 }), 'right', checkFor('armbrust'), 0, createCombatPose());
    expect(reload.action).toBeNull();
    expect(reload.handAngle).toBeGreaterThan(0.5);
  });

  it('Block mit Waffe, Schild oder Faust; ein Werkzeug als Waffe schwingt mit dem Werkzeugclip', () => {
    expect(combatPose(sample({ blocking: true, blockKind: 'block' }), 'left', checkFor('bronzeschwert'), 0, createCombatPose()).action).toBe(BLOCK_ACTION);
    expect(combatPose(sample({ blocking: true, blockKind: 'block' }), 'left', checkFor(null), 0, createCombatPose()).action).toBe(BLOCK_ACTION);
    // Aiming a ranged weapon is no block clip: the movement clip, the weapon turned to the aim.
    const aimOnly = combatPose(sample({ klasse: 'bogen', blocking: true, blockKind: 'ziel', fighting: true, aimed: true, aimAngle: 0.3 }), 'right', checkFor('kurzbogen'), 0, createCombatPose());
    expect(aimOnly.action).toBeNull();
    expect(aimOnly.handAngle).toBeCloseTo(0.3, 9);
    const tool = combatPose(sample({ klasse: 'axt', phase: 'ausholen', item: 'steinaxt' }), 'right', checkFor('steinaxt'), 0, createCombatPose());
    expect(tool.action).toBe(TOOL_ACTION);
  });

  it('der Kampfclip steht nach Körpermodi und Tätigkeiten, vor einem frischen Treffer; mit Licht die `_licht`-Variante', () => {
    const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: 'ausruestung_bronzeschwert', offhand: 'ausruestung_fackel' });
    if (rig === null) throw new Error('Spielerfigur fehlt');
    expect(figureAction('idle', 'none', true, false, rig.byState, rig.available, ATTACK_ACTION.schwert)).toBe(ATTACK_ACTION.schwert);
    expect(figureAction('idle', 'none', true, true, rig.byState, rig.available, ATTACK_ACTION.schwert)).toBe(`${ATTACK_ACTION.schwert}_licht`);
    expect(figureAction('roll', 'none', false, false, rig.byState, rig.available, ATTACK_ACTION.schwert)).toBe(rig.byState.roll);
    expect(figureAction('idle', 'eat', false, false, rig.byState, rig.available, ATTACK_ACTION.schwert)).toBe('eat');
    expect(figureAction('idle', 'none', true, false, rig.byState, rig.available, null)).toBe('hit');
  });
});

describe('Kampfclips: Takt', () => {
  it('Ausholen läuft bis vor das Smear-Bild, die Erholung beginnt auf ihm und endet mit dem Clip', () => {
    for (const k of MELEE) {
      for (const dir of ['down', 'up', 'right'] as const) {
        const clip = clipOf(ATTACK_ACTION[k], dir);
        const strike = strikePosition(clip);
        expect(clip.events?.some((e) => e.frame === strike && STRIKE_EVENTS.includes(e.name)), `${k} ${dir}`).toBe(true);
        expect(clipPositionAt(clip, combatClipTime(clip, 'windup', 0))).toBe(0);
        expect(clipPositionAt(clip, combatClipTime(clip, 'windup', 0.999))).toBe(strike - 1);
        expect(clipPositionAt(clip, combatClipTime(clip, 'follow', 0))).toBe(strike);
        expect(clipPositionAt(clip, combatClipTime(clip, 'follow', 1))).toBe(clip.frames.length - 1);
        // Monotonic through the stages.
        let last = -1;
        for (let p = 0; p < 1; p += 0.05) {
          const pos = clipPositionAt(clip, combatClipTime(clip, 'windup', p));
          expect(pos).toBeGreaterThanOrEqual(last);
          last = pos;
        }
      }
    }
  });

  it('volle Spannung hält den Bogen auf dem Bild vor dem Lösen (`sehne`)', () => {
    const clip = clipOf(ATTACK_ACTION.bogen, 'right');
    const strike = strikePosition(clip);
    expect(clip.events?.find((e) => e.frame === strike)?.name).toBe('sehne');
    expect(clipPositionAt(clip, combatClipTime(clip, 'draw', 1))).toBe(strike - 1);
    expect(clipPositionAt(clip, combatClipTime(clip, 'follow', 0))).toBe(strike);
  });
});

describe('Kampfclips: Waffenrotation', () => {
  it('die Waffe dreht um den Rest zwischen Zielwinkel und Blickrichtung, begrenzt auf Viertel plus Hysterese', () => {
    expect(handAngleFor(0, 'right')).toBe(0);
    expect(handAngleFor(Math.PI / 4, 'right')).toBeCloseTo(Math.PI / 4, 12);
    expect(handAngleFor(-Math.PI / 4, 'right')).toBeCloseTo(-Math.PI / 4, 12);
    expect(handAngleFor(Math.PI * 0.75, 'left')).toBeCloseTo(-Math.PI / 4, 12);
    expect(handAngleFor(Math.PI / 2 + 0.2, 'down')).toBeCloseTo(0.2, 12);
    expect(handAngleFor(-Math.PI / 2 - 0.2, 'up')).toBeCloseTo(-0.2, 12);
    expect(handAngleFor(Math.PI / 2, 'right')).toBeCloseTo(MAX_HAND_ANGLE, 12);
    expect(MAX_HAND_ANGLE).toBeCloseTo(Math.PI / 4 + degToRad(12), 12);
    // Only while the facing follows the aim.
    expect(combatPose(sample({ fighting: false, aimed: true, aimAngle: 0.5 }), 'right', () => true, 0, createCombatPose()).handAngle).toBe(0);
    expect(combatPose(sample({ fighting: true, aimed: true, aimAngle: 0.5 }), 'right', () => true, 0, createCombatPose()).handAngle).toBeCloseTo(0.5, 12);
  });
});

/** A session for the figure: the player standing at (100, 100) facing `facing`, the fight of `combat`. */
function session(player: Partial<PlayerSample>, combat: () => CombatSample) {
  return {
    samplePlayer(out: PlayerSample): boolean {
      Object.assign(out, createPlayerSample(), { x: 100, y: 100, facing: 'right', health: 100, maxHealth: 100 }, player);
      return true;
    },
    sampleCombat(out: CombatSample): boolean {
      Object.assign(out, combat());
      return true;
    },
    onEvent: () => () => undefined,
  };
}

/** What a frame of `figure` pushed: sprite id, frame index, rotation. */
function frame(figure: PlayerFigure, s: ReturnType<typeof session>, time: number): { sprite: string; frame: number; rotation: number }[] {
  const owner = new Map<SpriteFrameRef, [string, number]>();
  for (const sp of Object.values(MANIFEST.sprites)) sp.frames.forEach((f, i) => owner.set(f, [sp.id, i]));
  const out: { sprite: string; frame: number; rotation: number }[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = d.frame === null ? undefined : owner.get(d.frame);
        out.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, rotation: d.rotation });
        return out.length - 1;
      },
    },
  } as unknown as RenderScene;
  expect(figure.place(scene, ATLAS, s, time, 100, 100)).toBe(true);
  return out;
}

describe('Spielerfigur im Kampf', () => {
  it('die Figur zeigt das Smear-Bild im Tick des Schlags, die Waffe spielt ihren Clip und dreht zum Ziel', () => {
    // Without the simulation's pose readers the hands are empty: the fist's clip, the body alone.
    const figure = new PlayerFigure();
    let c = sample({ klasse: 'faust', phase: 'ausholen' as AttackPhase, phaseProgress: 0.5, fighting: true, aimed: true, aimAngle: 0.35 });
    const s = session({ facing: 'right' }, () => c);
    const windup = frame(figure, s, 1);
    const body = (list: typeof windup) => list.find((p) => p.sprite === 'spieler_basis');
    expect(figure.clipAction).toBe(ATTACK_ACTION.faust);
    const clip = clipOf(ATTACK_ACTION.faust, 'right');
    const strike = strikePosition(clip);
    expect(body(windup)?.frame).toBe(clip.frames[Math.floor(0.5 * strike)]);
    c = sample({ klasse: 'faust', phase: 'erholung' as AttackPhase, phaseProgress: 0, hitstop: true, fighting: true, aimed: true, aimAngle: 0.35 });
    const blow = frame(figure, s, 1.02);
    expect(body(blow)?.frame).toBe(clip.frames[strike]);
    expect(figure.combatPose.handAngle).toBeCloseTo(0.35, 9);
  });

  it('die Waffe in der Hand wird als Sprite gedreht (pixelgenau im G-Buffer), der Körper nie', () => {
    const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: 'ausruestung_bronzeschwert' });
    if (rig === null) throw new Error('Spielerfigur fehlt');
    const pushed: { sprite: string; rotation: number }[] = [];
    const owner = new Map<SpriteFrameRef, string>();
    for (const sp of Object.values(MANIFEST.sprites)) sp.frames.forEach((f) => owner.set(f, sp.id));
    const list = { push: (d: SpriteDesc) => pushed.push({ sprite: owner.get(d.frame as SpriteFrameRef) ?? '?', rotation: d.rotation }) };
    const clip = clipOf(ATTACK_ACTION.schwert, 'right');
    rig.rig.emit(list as never, new SpriteDesc(), { ...defaultState(), action: ATTACK_ACTION.schwert, direction: 'right', time: combatClipTime(clip, 'follow', 0), handAngle: 0.6 });
    expect(pushed.find((p) => p.sprite === 'ausruestung_bronzeschwert')?.rotation).toBeCloseTo(0.6, 6);
    for (const p of pushed.filter((q) => q.sprite !== 'ausruestung_bronzeschwert')) expect(p.rotation, p.sprite).toBe(0);
  });

  it('im Hitstop steht die Uhr der Bewegung: der Gehclip bleibt auf seinem Bild, danach läuft er weiter', () => {
    const figure = new PlayerFigure();
    let seconds = 0.2;
    let hitstop = false;
    const s = {
      ...session({ state: 'walk' }, () => sample({ hitstop })),
      samplePlayer(out: PlayerSample): boolean {
        Object.assign(out, createPlayerSample(), { x: 100, y: 100, facing: 'right', state: 'walk', stateSeconds: seconds, health: 100, maxHealth: 100 });
        return true;
      },
    };
    const body = (t: number) => frame(figure, s, t).find((p) => p.sprite === 'spieler_basis')?.frame;
    const before = body(1);
    hitstop = true;
    seconds = 0.45; // the frame's alpha creeping on within the frozen tick
    const frozen = body(1.1);
    expect(frozen).toBe(before);
    hitstop = false;
    seconds = 0.6;
    expect(body(1.2)).not.toBe(before);
  });
});

function defaultState() {
  return { x: 100, y: 100, direction: 'right' as const, action: 'idle', time: 0, itemTime: 0, paletteRow: 0, layer: 'objects' as const, heightBase: 0, outline: false, flash: false, hidden: 0, tint: 0, tintStrength: 0, handAngle: 0 };
}
