/**
 * M6-Gate Runde 3 (waffe-rotation NO/NW: in den Schrägen nach oben setzte der Schmierbogen des Schwerts wieder an der Nase an
 * – dieselbe Mangelklasse, die ADR-0197 im reinen Profil behob; assets-src/sprites/waffen/_waffe.ts `SCHMIER_ZIEL`,
 * src/render/anim/figure.ts `AIM_CLIP_MARK`): Der Schmierbogen jeder Waffe hält mindestens zwei Pixel Luft zum Kopf, so wie
 * der Rig der Spielfigur ihn zeichnet – Bild des Hand-Layers je Drehung, um den Griff gedreht wie der Renderer (je Bildpixel
 * das nächste Texel, sprite_gbuffer.vert):
 * - in allen acht Richtungen des Bilds `waffe-rotation` (Blickrichtung `nearestFacing`, Drehung `handAngleFor`), für jeden
 *   Schlag (leicht, schwer, mit Licht) und jede Lage des Bogens der eigenen Blickrichtung (auch von hinten über dem Kopf);
 * - über die ganze Drehung der Hand (±`MAX_HAND_ANGLE`, in Schritten von 1°) für jeden Bogen auf der Seite des Gesichts (im
 *   Profil und von vorn, auch in den Bildern des Rundumhiebs), im Profil wie ADR-0197 sogar zum ganzen Körper.
 * Kopf: die Pixel des Körpers bis zur Halszeile, sechs Zeilen unter dem Kopfsockel (der Mitte des Kopfs). Luft = Abstand in
 * der 8er-Nachbarschaft (Chebyshev) − 1, gezählt bis zur Grenze. Nicht gezählt: die Rückenbilder des Rundumhiebs (`heavy_schwert`), in denen die ganze
 * Klinge über den Rücken streicht und ihr Bogen über dem Hinterkopf liegt – kein Gesicht, kein Ansatz an der Nase. Am
 * Spielatlas (Bilder je Frame) mit den Pixeln der Quellen (assets-src).
 */
import { describe, expect, it } from 'vitest';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { WAFFEN_FRAME } from '../../../assets-src/sprites/waffen/_waffe';
import fernkampf from '../../../assets-src/sprites/waffen/fernkampf';
import nahkampf from '../../../assets-src/sprites/waffen/nahkampf';
import { nearestFacing } from '../../../src/game/combat/formulas';
import { DIRECTIONS, type Direction } from '../../../src/render/anim/animation';
import { atlasFrameOf, defaultFigureState, type FigureState } from '../../../src/render/anim/figure';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { handAngleFor, MAX_HAND_ANGLE } from '../../../src/render/game/combatClips';
import { buildPlayerFigure, PLAYER_BODY_SPRITE, START_CLOTHING } from '../../../src/render/game/playerFigure';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
/** Sprite id and frame index of every atlas frame. */
const OWNER = new Map<SpriteFrameRef, readonly [string, number]>();
for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => OWNER.set(f, [s.id, i]));

/** Mindestens zwei Pixel Luft: Chebyshev-Abstand ≥ 3. */
const ABSTAND = 3;
/** The head reaches six rows below the head socket (the neck row). */
const KOPF_BIS = 6;
/** Every smear frame and the same lage without the arc (the arc = the pixels the smear frame has beyond it). */
const OHNE: Readonly<Partial<Record<number, number>>> = {
  [WAFFEN_FRAME.schmierRechts]: WAFFEN_FRAME.o,
  [WAFFEN_FRAME.schmierLinks]: WAFFEN_FRAME.w_,
  [WAFFEN_FRAME.schmierVorn]: WAFFEN_FRAME.s,
  [WAFFEN_FRAME.schmierHinten]: WAFFEN_FRAME.n,
  [WAFFEN_FRAME.schmierHintenFaust]: WAFFEN_FRAME.nFaust,
};
/** The smear frames of each facing's own blow (the back view: over the head). */
const EIGENE: Readonly<Record<Direction, readonly number[]>> = {
  right: [WAFFEN_FRAME.schmierRechts],
  left: [WAFFEN_FRAME.schmierLinks],
  down: [WAFFEN_FRAME.schmierVorn],
  up: [WAFFEN_FRAME.schmierHinten, WAFFEN_FRAME.schmierHintenFaust],
};
/** Smear frames on the side of the face (profile, front view); in profile the arc keeps clear of the whole body too. */
const GESICHT = new Set<number>([WAFFEN_FRAME.schmierRechts, WAFFEN_FRAME.schmierLinks, WAFFEN_FRAME.schmierVorn]);
const PROFIL = new Set<number>([WAFFEN_FRAME.schmierRechts, WAFFEN_FRAME.schmierLinks]);
/** The eight aims of `waffe-rotation` [rad], 45° apart from east. */
const ACHT = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
const GRAD = Math.PI / 180;

interface Gezeichnet {
  readonly id: string;
  readonly frame: number;
  readonly d: { readonly x: number; readonly y: number; readonly ax: number; readonly ay: number; readonly mirror: boolean; readonly rotation: number };
}

/** What the rig pushes for `f`: sprite id, frame index, place, anchor of the pushed frame, mirroring and turn. */
function emitted(rig: ReturnType<typeof buildPlayerFigure>, f: FigureState): Gezeichnet[] {
  const out: Gezeichnet[] = [];
  const list = {
    push(d: SpriteDesc) {
      const frame = d.frame as SpriteFrameRef;
      const [id, index] = OWNER.get(atlasFrameOf(frame)) ?? ['?', -1];
      out.push({ id, frame: index, d: { x: d.x, y: d.y, ax: frame.ax, ay: frame.ay, mirror: d.mirror, rotation: d.rotation } });
      return out.length - 1;
    },
  };
  rig?.rig.emit(list as never, new SpriteDesc(), f);
  return out;
}

/**
 * Screen pixels of `s`'s frame `frame` drawn as `g` (the renderer: about the anchor, mirrored before turning, each target
 * pixel samples the texel under its centre); `keep` filters the texels.
 */
function pixel(s: Sprite, frame: number, g: Gezeichnet['d'], keep: (i: number) => boolean): [number, number][] {
  const px = s.frames[frame]?.index;
  if (px === undefined) throw new Error(`${s.id} F${frame}`);
  const out: [number, number][] = [];
  const c = Math.cos(g.rotation);
  const sn = Math.sin(g.rotation);
  // Every texel lies within this many pixels of the anchor.
  const reach = Math.ceil(Math.hypot(Math.max(g.ax, s.w - g.ax), Math.max(g.ay, s.h - g.ay))) + 1;
  const [x0, y0] = [Math.floor(g.x + 0.5), Math.floor(g.y + 0.5)];
  for (let ty = -reach; ty <= reach; ty++) {
    for (let tx = -reach; tx <= reach; tx++) {
      const rx = tx + 0.5;
      const ry = ty + 0.5;
      let lx = c * rx + sn * ry;
      const ly = -sn * rx + c * ry;
      if (g.mirror) lx = -lx;
      const sx = Math.floor(lx + g.ax);
      const sy = Math.floor(ly + g.ay);
      if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) continue;
      const i = sy * s.w + sx;
      if ((px[i] ?? TRANSPARENT) !== TRANSPARENT && keep(i)) out.push([x0 + tx, y0 + ty]);
    }
  }
  return out;
}

/** Smallest Chebyshev distance between pixel set `a` and the pixels of `b` (keys `x · 4096 + y`), counted up to `ABSTAND`. */
function abstand(a: readonly (readonly [number, number])[], b: ReadonlySet<number>): number {
  let best = ABSTAND;
  for (const [ax, ay] of a) {
    for (let dy = 1 - best; dy < best; dy++) {
      for (let dx = 1 - best; dx < best; dx++) if (b.has((ax + dx) * 4096 + ay + dy)) best = Math.max(Math.abs(dx), Math.abs(dy));
    }
  }
  return best;
}

/** The body's pixels and those of its head (keys for `abstand`) by body frame: the body is not turned, the same each angle. */
const KOERPER = new Map<number, { readonly koerper: ReadonlySet<number>; readonly kopf: ReadonlySet<number> }>();
function koerperVon(body: Gezeichnet): { readonly koerper: ReadonlySet<number>; readonly kopf: ReadonlySet<number> } {
  const known = KOERPER.get(body.frame);
  if (known !== undefined) return known;
  const kopfY = spieler.sockets['kopf']?.[body.frame]?.[1];
  if (kopfY === undefined) throw new Error(`Kopfsockel F${body.frame}`);
  const key = ([x, y]: readonly [number, number]): number => x * 4096 + y;
  const sets = {
    koerper: new Set(pixel(spieler, body.frame, body.d, () => true).map(key)),
    kopf: new Set(pixel(spieler, body.frame, body.d, (i) => Math.floor(i / spieler.w) <= kopfY + KOPF_BIS).map(key)),
  };
  KOERPER.set(body.frame, sets);
  return sets;
}

interface Probe {
  readonly waffe: Sprite;
  readonly aktion: string;
  readonly richtung: Direction;
  readonly position: number;
  /** The smear frame of the weapon's clip `<aktion>_<richtung>` on this position. */
  readonly schmier: number;
  readonly rig: NonNullable<ReturnType<typeof buildPlayerFigure>>;
}

/** Every clip position of a blow (light, heavy, with light) where the weapon shows a smear frame. */
const PROBEN: readonly Probe[] = (() => {
  const out: Probe[] = [];
  for (const waffe of [...nahkampf, ...fernkampf]) {
    const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: waffe.id });
    if (rig === null) throw new Error(`keine Spielerfigur mit ${waffe.id}`);
    for (const aktion of rig.handActions) {
      if (!/^(attack|heavy)_/.test(aktion) || !rig.available.has(aktion)) continue;
      for (const richtung of DIRECTIONS) {
        const clip = waffe.clips[`${aktion}_${richtung}`];
        clip?.frames.forEach((schmier, position) => {
          if (OHNE[schmier] !== undefined) out.push({ waffe, aktion, richtung, position, schmier, rig });
        });
      }
    }
  }
  return out;
})();

/** Air (Chebyshev distance) of the arc to the head and to the whole body for probe `p` at hand angle `angle`. */
function luft(p: Probe, angle: number): { readonly kopf: number; readonly koerper: number; readonly bild: number } {
  const f = defaultFigureState();
  f.x = 100;
  f.y = 200;
  f.direction = p.richtung;
  f.action = p.aktion;
  const clip = p.rig.rig.bodyClip(p.aktion, p.richtung);
  if (clip === null) throw new Error(`${p.aktion}_${p.richtung}`);
  f.time = (p.position + 0.5) / clip.fps;
  f.handAngle = angle;
  const drawn = emitted(p.rig, f);
  const body = drawn.find((g) => g.id === PLAYER_BODY_SPRITE);
  const hand = drawn.find((g) => g.id === p.waffe.id);
  if (body === undefined || hand === undefined) throw new Error(`${p.waffe.id} ${p.aktion}_${p.richtung}@${p.position}: nichts gezeichnet`);
  const ohne = p.waffe.frames[OHNE[p.schmier] ?? -1]?.index;
  if (ohne === undefined) throw new Error(`${p.waffe.id} F${OHNE[p.schmier] ?? -1}`);
  // The body always stands at (100, 200) without a turn: its pixels depend on its frame only.
  const { koerper, kopf } = koerperVon(body);
  const bogen = pixel(p.waffe, hand.frame, hand.d, (i) => (ohne[i] ?? TRANSPARENT) === TRANSPARENT);
  return { kopf: abstand(bogen, kopf), koerper: abstand(bogen, koerper), bild: hand.frame };
}

describe('Schmierbogen mit Luft zum Kopf in jeder Drehung (M6-Gate Runde 3, waffe-rotation NO/NW)', () => {
  it('in den acht Richtungen von waffe-rotation: jeder Bogen der eigenen Blickrichtung hält zwei Pixel Luft zum Kopf', () => {
    const fehler: string[] = [];
    let geprueft = 0;
    for (const p of PROBEN) {
      if (!EIGENE[p.richtung].includes(p.schmier)) continue;
      for (const aim of ACHT) {
        if (nearestFacing(aim) !== p.richtung) continue;
        const l = luft(p, handAngleFor(aim, p.richtung));
        geprueft++;
        if (l.kopf < ABSTAND) fehler.push(`${p.waffe.id} ${p.aktion}_${p.richtung}@${p.position} Ziel ${Math.round(aim / GRAD)}°: Abstand ${l.kopf}`);
      }
    }
    expect(fehler).toEqual([]);
    // Every weapon with a smear in each of its blows: facing right and left the axis and both diagonals, up and down the axis.
    expect(geprueft).toBeGreaterThan(150);
  });

  it('über die ganze Drehung der Hand: der Bogen auf der Seite des Gesichts hält zwei Pixel Luft zum Kopf, im Profil zum Körper', () => {
    const fehler: string[] = [];
    let geprueft = 0;
    let gekuerzt = 0;
    const grenze = Math.floor(MAX_HAND_ANGLE / GRAD);
    for (const p of PROBEN) {
      if (!GESICHT.has(p.schmier)) continue;
      for (let grad = -grenze; grad <= grenze; grad++) {
        const l = luft(p, grad * GRAD);
        geprueft++;
        if (l.bild !== p.schmier) gekuerzt++;
        if (l.kopf < ABSTAND || (PROFIL.has(p.schmier) && l.koerper < ABSTAND)) fehler.push(`${p.waffe.id} ${p.aktion}_${p.richtung}@${p.position} ${grad}°: Kopf ${l.kopf}, Körper ${l.koerper}`);
      }
    }
    expect(fehler.slice(0, 20)).toEqual([]);
    expect(geprueft).toBeGreaterThan(9_000);
    // Turned towards the face the weapon shows its own frames (`AIM_CLIP_MARK`); the other way and unturned its smear frame.
    expect(gekuerzt).toBeGreaterThan(geprueft / 3);
  });
});
