/**
 * M6-Gate (visual:bow-north-south-undrawn; MASTERPROMPT §19.1 „mit der Maus zielen, Waffen frei gedreht“, §4.5 „Angriff
 * je Waffenklasse … je 4 Richtungen“; src/render/game/playerFigure.ts, assets-src/sprites/waffen/_waffe.ts
 * `BOGEN_LAGEN`): voll gespannt zeigt der Bogen in jeder Blickrichtung die gespannte Sehne mit Pfeil entlang des Ziels –
 * im Profil aufrecht, nach unten und oben quer zur Schussrichtung. Geprüft am Spielatlas über den Rig der Spielfigur, wie
 * das Bild `waffe-rotation` ihn zeichnet: Bild des Hand-Layers, Drehung zum Ziel, nach oben über dem Kopf (zuletzt
 * gezeichnet). Die Form der Bilder prüft tests/unit/assets/waffen.test.ts, den Sitz am Körper spieler-kampf.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { WAFFEN_FRAME } from '../../../assets-src/sprites/waffen/_waffe';
import { DIRECTIONS, clipFrameAt, type Direction } from '../../../src/render/anim/animation';
import { defaultFigureState, type FigureState } from '../../../src/render/anim/figure';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { combatClipTime } from '../../../src/render/game/combatClips';
import { buildPlayerFigure, START_CLOTHING, type PlayerFigureRig } from '../../../src/render/game/playerFigure';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
/** Sprite id and frame index of every atlas frame. */
const OWNER = new Map<SpriteFrameRef, readonly [string, number]>();
for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => OWNER.set(f, [s.id, i]));

/** The drawn bow of each facing (`_waffe.ts`): the drawn frame of the profile, turned across the aim facing down and up. */
const GESPANNT: Readonly<Record<Direction, number>> = {
  down: WAFFEN_FRAME.gespanntVorn,
  up: WAFFEN_FRAME.gespanntHinten,
  right: WAFFEN_FRAME.gespannt,
  left: WAFFEN_FRAME.gespanntGespiegelt,
};
/** Aim offset from the facing [rad] (the bow turns about its grip by it, ADR-0115). */
const ZIEL = 0.2;

interface Drawn {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

function figure(bow: string): PlayerFigureRig {
  const built = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: `ausruestung_${bow}` });
  if (built === null) throw new Error('keine Spielerfigur im Atlas');
  return built;
}

/** A figure at (100, 200) facing `direction`, the bow fully drawn (stage `draw`, tension 1) and aimed `ZIEL` off the facing. */
function drawn(built: PlayerFigureRig, direction: Direction): FigureState {
  const f = defaultFigureState();
  f.x = 100;
  f.y = 200;
  f.direction = direction;
  f.action = 'attack_bogen';
  const clip = built.rig.bodyClip('attack_bogen', direction);
  if (clip === null) throw new Error(`attack_bogen_${direction} fehlt`);
  f.time = combatClipTime(clip, 'draw', 1);
  f.itemTime = 0.4;
  f.handAngle = ZIEL;
  return f;
}

/** What the rig pushes for `f`, in order. */
function emitted(built: PlayerFigureRig, f: FigureState): Drawn[] {
  const out: Drawn[] = [];
  const list = {
    push(d: SpriteDesc) {
      const [sprite, frame] = OWNER.get(d.frame as SpriteFrameRef) ?? ['?', -1];
      out.push({ sprite, frame, x: d.x, y: d.y, rotation: d.rotation });
      return out.length - 1;
    },
  };
  built.rig.emit(list as never, new SpriteDesc(), f);
  return out;
}

describe('Bogen voll gespannt in allen vier Richtungen (M6-Gate)', () => {
  it('Kurz- und Kompositbogen: gespannte Sehne mit Pfeil in jeder Blickrichtung, zum Ziel gedreht, nach oben über dem Kopf', () => {
    for (const bow of ['kurzbogen', 'kompositbogen']) {
      const built = figure(bow);
      const hand = MANIFEST.sprites[`ausruestung_${bow}`];
      if (hand === undefined) throw new Error(bow);
      for (const d of DIRECTIONS) {
        const f = drawn(built, d);
        const list = emitted(built, f);
        const bogen = list.find((x) => x.sprite === hand.id);
        expect(bogen, `${bow} ${d}`).toBeDefined();
        expect(bogen?.frame, `${bow} ${d}: gespannt`).toBe(GESPANNT[d]);
        expect(bogen?.rotation, `${bow} ${d}: zum Ziel gedreht`).toBe(ZIEL);
        // The body shows its full-draw picture (the held position before the release).
        const clip = built.rig.bodyClip('attack_bogen', d);
        if (clip === null) throw new Error(d);
        expect(built.body.sockets['hand']?.[clipFrameAt(clip, f.time)], `${bow} ${d}: Hand-Sockel`).toBeDefined();
        if (d === 'up') {
          // Facing away the drawn bow lies over the head: drawn after body and clothes.
          expect(list.at(-1)?.sprite, `${bow} up: zuletzt`).toBe(hand.id);
        }
      }
    }
  });
});
