/**
 * M6-01b: facing up in a fight the weapon stays readable (MASTERPROMPT §19.1, §2.8; src/render/game/playerFigure.ts
 * `weaponOverBody`, `PlayerRig`): the main hand is drawn over the back instead of behind it while the body shows a combat
 * clip facing up – at the very place, frame and rotation the plain rig gives it –; walking, tools and every other facing
 * keep the rig's order. Checked on the game atlas with the weapons of the `waffe-rotation` picture and the club.
 */
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, type Direction } from '../../../src/render/anim/animation';
import { defaultFigureState, FigureRig, FIGURE_LAYER_ORDER, HAND_SLOTS_MASK, type FigureState } from '../../../src/render/anim/figure';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { combatClipTime, COMBAT_ACTIONS, type CombatStage } from '../../../src/render/game/combatClips';
import { buildPlayerFigure, PlayerRig, START_CLOTHING, weaponOverBody, type PlayerFigureRig } from '../../../src/render/game/playerFigure';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const OWNER = new Map<SpriteFrameRef, string>();
for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f) => OWNER.set(f, s.id));

interface Drawn {
  readonly sprite: string;
  readonly x: number;
  readonly y: number;
  readonly frame: SpriteFrameRef | null;
  readonly rotation: number;
  readonly heightBase: number;
}

/** What `rig` pushes for state `f`, in order. */
function emitted(rig: FigureRig, f: FigureState): Drawn[] {
  const out: Drawn[] = [];
  const list = {
    push(d: SpriteDesc) {
      out.push({ sprite: OWNER.get(d.frame as SpriteFrameRef) ?? '?', x: d.x, y: d.y, frame: d.frame, rotation: d.rotation, heightBase: d.heightBase });
      return out.length - 1;
    },
  };
  rig.emit(list as never, new SpriteDesc(), f);
  return out;
}

function figure(item: string): PlayerFigureRig {
  const built = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: `ausruestung_${item}` });
  if (built === null) throw new Error('keine Spielerfigur im Atlas');
  return built;
}

/** The rig of the same loadout without the player's order (the plain `FigureRig`). */
function plain(built: PlayerFigureRig): FigureRig {
  const hand = MANIFEST.sprites[built.held[0] ?? ''];
  if (hand === undefined) throw new Error('keine Waffe');
  const layers = [...START_CLOTHING.map((c) => ({ slot: c.slot, sprite: MANIFEST.sprites[c.sprite] ?? built.body })), { slot: 'waffe' as const, sprite: hand }];
  return new FigureRig(built.body, [...built.available], layers);
}

/** A figure at (100, 200) facing `direction` in `action` at `stage`/`progress` (strike frame by default), aimed `angle`. */
function state(built: PlayerFigureRig, direction: Direction, action: string, stage: CombatStage = 'follow', progress = 0, angle = 0.3): FigureState {
  const f = defaultFigureState();
  f.x = 100;
  f.y = 200;
  f.direction = direction;
  f.action = action;
  const clip = built.rig.bodyClip(action, direction);
  f.time = clip === null ? 0 : combatClipTime(clip, stage, progress);
  f.itemTime = 0.4;
  f.handAngle = angle;
  return f;
}

const WEAPONS = [
  ['bronzespeer', 'attack_speer', 'follow', 0],
  ['kurzbogen', 'attack_bogen', 'draw', 1],
  ['holzkeule', 'attack_keule', 'follow', 1],
  ['bronzeschwert', 'attack_schwert', 'follow', 0],
] as const;

describe('Waffe beim Blick nach oben (M6-01b)', () => {
  it('nur nach oben im Kampf (Angriff, schwerer Angriff, Deckung, auch mit Licht) liegt die Waffe über dem Rücken', () => {
    for (const a of COMBAT_ACTIONS) {
      expect(weaponOverBody('up', a), a).toBe(true);
      expect(weaponOverBody('up', `${a}_licht`), a).toBe(true);
      for (const d of DIRECTIONS.filter((x) => x !== 'up')) expect(weaponOverBody(d, a), `${a} ${d}`).toBe(false);
    }
    for (const a of ['idle', 'walk', 'run', 'tool', 'tool_licht', 'hit', 'eat']) expect(weaponOverBody('up', a), a).toBe(false);
    // The rig's own order facing away puts the hand first, behind the body.
    expect(FIGURE_LAYER_ORDER.up.indexOf('waffe')).toBeLessThan(FIGURE_LAYER_ORDER.up.indexOf('body'));
  });

  it('Speer, Bogen, Keule und Schwert: nach oben zuletzt gezeichnet, an Ort, Bild und Drehung des Rigs', () => {
    for (const [item, action, stage, progress] of WEAPONS) {
      const built = figure(item);
      expect(built.rig, item).toBeInstanceOf(PlayerRig);
      const f = state(built, 'up', action, stage, progress);
      const mine = emitted(built.rig, f);
      const theirs = emitted(plain(built), { ...f });
      const hand = `ausruestung_${item}`;
      // Same sprites, the hand moved from first to last.
      expect(theirs[0]?.sprite, item).toBe(hand);
      expect(mine.at(-1)?.sprite, item).toBe(hand);
      expect(mine.map((d) => d.sprite), item).toEqual([...theirs.slice(1).map((d) => d.sprite), hand]);
      expect(mine.at(-1), item).toEqual(theirs[0]);
      expect(mine.slice(0, -1), item).toEqual(theirs.slice(1));
      // The state is left as it was (the hidden bits are the caller's).
      expect(f.hidden, item).toBe(0);
    }
  });

  it('gehen, Werkzeug und die anderen Richtungen behalten die Reihenfolge des Rigs; versteckte Hände bleiben versteckt', () => {
    const built = figure('bronzespeer');
    const theirs = plain(built);
    const walk = state(built, 'up', 'walk');
    expect(emitted(built.rig, walk)).toEqual(emitted(theirs, { ...walk }));
    expect(emitted(built.rig, walk)[0]?.sprite).toBe('ausruestung_bronzespeer');
    for (const d of ['down', 'right', 'left'] as const) {
      const f = state(built, d, 'attack_speer');
      expect(emitted(built.rig, f), d).toEqual(emitted(theirs, { ...f }));
    }
    const rolling = state(built, 'up', 'attack_speer');
    rolling.hidden = HAND_SLOTS_MASK;
    expect(emitted(built.rig, rolling).some((d) => d.sprite === 'ausruestung_bronzespeer')).toBe(false);
  });

  it('ohne Waffe in der Hand zeichnet die Figur wie der Rig', () => {
    const built = buildPlayerFigure(MANIFEST, START_CLOTHING);
    if (built === null) throw new Error('keine Spielerfigur');
    const f = state(built, 'up', 'block', 'block', 0.2);
    expect(emitted(built.rig, f).map((d) => d.sprite).sort()).toEqual(['spieler_basis', ...START_CLOTHING.map((c) => c.sprite)].sort());
  });
});
