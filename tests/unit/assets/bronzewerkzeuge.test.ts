/**
 * M4-10 (Figuren-Teil): Hand-Layer der Bronzewerkzeuge `ausruestung_bronze<art>`. Sie erfüllen denselben
 * Vertrag wie die Steinwerkzeuge derselben Art (ausruestung-layer.test.ts, `werkzeugSprite`): gleiche Zelle,
 * gleicher Anker, gleiche Frames, gleiche Halte- und Schlag-Clips, gleiche Wirkpunkt-Sockel – das Figuren-Rig
 * (`src/render/anim/figure.ts`) und der Validator behandeln sie genauso. Anders ist nur das Bild: ein
 * Bronzekopf (Metallflag, Bronzetöne, keine Schnur) statt geschlagenen Steins.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN } from '../../../assets-src/lib/figure';
import { SCHLAG_AKTIONEN, WERKZEUG_FRAME } from '../../../assets-src/lib/figureWerkzeug';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import bronze from '../../../assets-src/sprites/ausruestung/bronzewerkzeuge';
import stein from '../../../assets-src/sprites/ausruestung/werkzeuge';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { socketOffset } from '../../../src/render/anim/figure';
import { itemFigureLayer, itemLayerSpriteId } from '../../../src/content/items/index';
import { BRONZEWERKZEUGE } from '../../../src/content/items/verarbeitung_bronzewerkzeuge';
import { checkSprite } from '../../../tools/assets/spriteChecks';

/** Werkzeugarten der Bronzewerkzeuge (die Spitzhacke folgt mit M7-34). */
const ARTEN = ['axt', 'schaufel', 'hacke', 'sichel', 'hammer', 'messer'] as const;
/** Farben des Bronzekopfs (Metallflag). */
const BRONZE_FARBEN = ['erde.1', 'holz.3', 'laub.4', 'sand.4'];
/** Farben der Garnwicklung an Sichel und Messer. */
const GARN_FARBEN = ['stein.5', 'stein.3'];
/** Farben der Schnurbindung der Steinwerkzeuge – an Bronze gibt es keine Schnur. */
const SCHNUR_FARBEN = ['sand.3', 'sand.1'];

function paar(art: string): { b: Sprite; s: Sprite } {
  const b = bronze.find((x) => x.id === `ausruestung_bronze${art}`);
  const s = stein.find((x) => x.id === `ausruestung_stein${art}`);
  if (b === undefined || s === undefined) throw new Error(`Paar ${art} fehlt`);
  return { b, s };
}

function px(s: Sprite, f: number): Uint8Array {
  const fr = s.frames[f];
  if (fr === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  return fr.index;
}

describe('M4-10 Hand-Layer der Bronzewerkzeuge', () => {
  it('jedes Bronzewerkzeug mit Figuren-Layer hat sein ausruestung_<itemId>, nichts darüber hinaus', () => {
    const erwartet = BRONZEWERKZEUGE.filter((i) => itemFigureLayer(i) === 'waffe').map((i) => itemLayerSpriteId(i.id));
    expect(erwartet).toHaveLength(ARTEN.length);
    expect(bronze.map((s) => s.id).sort()).toEqual([...erwartet].sort());
    expect(ARTEN.map((a) => `ausruestung_bronze${a}`).sort()).toEqual([...erwartet].sort());
  });

  it('Vertrag wie das Steinwerkzeug derselben Art: Zelle, Anker, Frames, Clips, Sockel, Höhe, Occluder, Gruppe', () => {
    for (const art of ARTEN) {
      const { b, s } = paar(art);
      expect([b.w, b.h, ...b.anchor], art).toEqual([s.w, s.h, ...s.anchor]);
      expect(b.frames.length, art).toBe(s.frames.length);
      expect(b.clips, art).toEqual(s.clips);
      expect(b.sockets, art).toEqual(s.sockets);
      expect([b.hoehe, b.group, b.spiegelbar, b.schatten], art).toEqual([s.hoehe, s.group, s.spiegelbar, s.schatten]);
      expect(b.occluder, art).toEqual(s.occluder);
    }
  });

  it('Schlag-Clips so lang und schnell wie der Körper-Clip, Schlag mit vier Lagen und einem Smear-Frame', () => {
    for (const b of bronze) {
      for (const r of RICHTUNGEN) {
        expect(b.clips[r], `${b.id} ${r}`).toBeDefined();
        for (const aktion of SCHLAG_AKTIONEN) {
          const item = b.clips[`${aktion}_${r}`];
          const koerper = spieler.clips[`${aktion}_${r}`];
          expect(item?.frames.length, `${b.id} ${aktion}_${r}`).toBe(koerper?.frames.length);
          expect(item?.fps, `${b.id} ${aktion}_${r}`).toBe(koerper?.fps);
        }
      }
      const rechts = b.clips.tool_right?.frames ?? [];
      expect(new Set(rechts).size, b.id).toBe(4);
      const zusatz = [...px(b, rechts[3] ?? 0)].filter((v, p) => v !== TRANSPARENT && px(b, rechts[4] ?? 0)[p] === TRANSPARENT).length;
      expect(zusatz, `${b.id}: Bewegungsbogen`).toBeGreaterThan(6);
    }
  });

  it('Anker = Griffpixel: in jedem Frame deckend, aus Holz bzw. Garn', () => {
    for (const b of bronze) {
      const [ax, ay] = b.anchor;
      b.frames.forEach((fr, f) => {
        const v = fr.index[ay * b.w + ax] ?? TRANSPARENT;
        expect(v, `${b.id} F${f}`).not.toBe(TRANSPARENT);
        const ref = paletteRef(v);
        expect(ref.startsWith('holz.') || GARN_FARBEN.includes(ref), `${b.id} F${f} ${ref}`).toBe(true);
      });
    }
  });

  it('Wirkpunkt je Frame deckend, in der aufrechten Lage auf dem Bronzekopf', () => {
    for (const b of bronze) {
      const punkte = b.sockets.wirkpunkt ?? [];
      expect(punkte).toHaveLength(b.frames.length);
      punkte.forEach(([x, y], f) => expect(px(b, f)[y * b.w + x], `${b.id} F${f}`).not.toBe(TRANSPARENT));
      const [x, y] = punkte[WERKZEUG_FRAME.n] ?? [0, 0];
      expect((b.frames[WERKZEUG_FRAME.n]?.material[y * b.w + x] ?? 0) & MATERIAL_BITS.metall, b.id).toBe(MATERIAL_BITS.metall);
    }
  });

  it('Bronzekopf: Metallflag genau auf den Bronzetönen, keine Schnur, kein Stein außer der Garnwicklung', () => {
    for (const b of bronze) {
      const fr = b.frames[WERKZEUG_FRAME.n];
      if (fr === undefined) throw new Error(b.id);
      let metall = 0;
      fr.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const ref = paletteRef(v);
        const flag = (fr.material[p] ?? 0) & MATERIAL_BITS.metall;
        if (flag !== 0) {
          metall++;
          expect(BRONZE_FARBEN, `${b.id} ${ref}`).toContain(ref);
        }
        expect(SCHNUR_FARBEN, `${b.id}: Schnur`).not.toContain(ref);
        if (ref.startsWith('stein.')) expect(GARN_FARBEN, `${b.id} ${ref}`).toContain(ref);
      });
      expect(metall, b.id).toBeGreaterThanOrEqual(5);
    }
  });

  it(`≤ ${MAX_SPRITE_COLORS} reine Palettenfarben, kein Einzelpixel-Befund, nichts leuchtet`, () => {
    for (const b of bronze) {
      expect(b.farbFehler, b.id).toEqual([]);
      expect(spriteColorCount(b), b.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(b), b.id).toEqual({ errors: [], warnings: [] });
      expect(spriteHasEmissive(b), b.id).toBe(false);
    }
  });

  it('socketOffset setzt den Griff jedes Bronzewerkzeugs auf den Hand-Sockel jedes Körper-Frames', () => {
    const frameRef = { x: 0, y: 0, w: spieler.w, h: spieler.h, ax: spieler.anchor[0], ay: spieler.anchor[1] };
    const out = { x: 0, y: 0 };
    for (const b of bronze) {
      spieler.sockets.hand?.forEach((p, f) => {
        socketOffset(frameRef, p, false, out);
        expect([spieler.anchor[0] + out.x, spieler.anchor[1] + out.y], `${b.id} F${f}`).toEqual([p[0], p[1]]);
      });
    }
  });
});
