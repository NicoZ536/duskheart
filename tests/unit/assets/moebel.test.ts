/**
 * M4-19 (Sprite-Teil): Möbel, Deko, Wandobjekte und Lichter T0–T1. Belegt am Pixel:
 * - jedes Möbel hat sein Objekt-Sprite `obj_<id>` im Kontaktbogen `moebel_t0_t1` und sein Icon `icon_<id>`
 *   (docs/SPIEL.md §8); die Zelle deckt die Stellfläche, der Anker sitzt mittig auf ihrer Vorderkante;
 * - 1 px Luft zum Zellrand (Interaktions-Outline, docs/ART.md §8), ≤ 12 Farben, keine Befunde des
 *   Paletten-Validators (Fremdfarben, verwaiste Einzelpixel);
 * - Wandobjekte werfen keinen Bodenschatten und haben keinen Occluder; Sitzmöbel und Betten tragen ihre
 *   Sockel (Sitzplätze je nach Breite, Kopf und Liegen);
 * - Lichter: Clip `idle` (vier Flammen-Frames, 10 fps) leuchtet, `aus` ist dunkel, der Lichtsockel sitzt im
 *   leuchtenden Kern; der Kamin hat die Feuer-Clips des Lagerfeuers mit voll > schwach > Glut;
 * - der gedeckte Tisch liegt deckungsgleich auf dem Holztisch; Farbvarianten tauschen nur Farben;
 * - Icons: 16×16, Motiv mit 1 px Luft, Kontur `nacht.1`, nichts leuchtet, jedes verschieden.
 */
import { describe, expect, it } from 'vitest';
import betten from '../../../assets-src/sprites/moebel/betten';
import deko from '../../../assets-src/sprites/moebel/deko';
import lager from '../../../assets-src/sprites/moebel/lager';
import lichter from '../../../assets-src/sprites/moebel/lichter';
import sitz from '../../../assets-src/sprites/moebel/sitzmoebel';
import tische from '../../../assets-src/sprites/moebel/tische';
import varianten from '../../../assets-src/sprites/moebel/varianten';
import wand from '../../../assets-src/sprites/moebel/wand';
import { MOEBEL_GRUPPE } from '../../../assets-src/sprites/moebel/_moebel';
import iconsMoebel from '../../../assets-src/sprites/icons/moebel';
import iconsDeko from '../../../assets-src/sprites/icons/moebel_deko';
import { ICON_ANKER, ICON_GROESSE, ICON_GRUPPE } from '../../../assets-src/sprites/icons/_icon';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteIndex, paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { FIRE_CLIPS } from '../../../src/content/lights';
import { MOEBEL, MOEBEL_BAUTEILE, MOEBEL_LICHTER } from '../../../src/content/items/moebel';
import { MOEBEL_DEKO, MOEBEL_DEKO_BAUTEILE } from '../../../src/content/items/moebel_deko';

const OBJEKTE: readonly Sprite[] = [betten, sitz, tische, lager, wand, lichter, deko].flat();
const ICONS: readonly Sprite[] = [...iconsMoebel, ...iconsDeko];
const ALLE: readonly Sprite[] = [...OBJEKTE, ...varianten, ...ICONS];
const TEILE = [...MOEBEL_BAUTEILE, ...MOEBEL_DEKO_BAUTEILE];
const IDS = [...MOEBEL, ...MOEBEL_DEKO].map((i) => i.id);
const TILE = 16;
const KONTUR = paletteIndex('nacht.1');

function obj(id: string): Sprite {
  const s = OBJEKTE.find((x) => x.id === `obj_${id}`);
  if (s === undefined) throw new Error(`obj_${id} fehlt`);
  return s;
}

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function deckend(s: Sprite, f: SpriteFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && (f.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

function leuchtend(f: SpriteFrame): number {
  let n = 0;
  f.index.forEach((v, p) => {
    if (v !== TRANSPARENT && (f.emissive[p] ?? 0) > 0) n++;
  });
  return n;
}

function clip(s: Sprite, name: string): readonly number[] {
  return s.clips[name]?.frames ?? [];
}

describe('M4-19 Objekt-Sprites', () => {
  it('jedes Möbel hat obj_<id> im Kontaktbogen moebel_t0_t1 und sein Icon icon_<id>', () => {
    expect(OBJEKTE.map((s) => s.id).sort()).toEqual(IDS.map((id) => `obj_${id}`).sort());
    for (const s of [...OBJEKTE, ...varianten]) expect(s.group, s.id).toBe(MOEBEL_GRUPPE);
    expect(ICONS.map((s) => s.id).sort()).toEqual(IDS.map((id) => `icon_${id}`).sort());
    const alle = ALLE.map((s) => s.id);
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('1 px Luft zum Zellrand, ≤ 12 Farben, keine Befunde des Paletten-Validators', () => {
    for (const s of ALLE) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      const r = checkSprite(s);
      expect([...r.errors, ...r.warnings], s.id).toEqual([]);
      s.frames.forEach((f, fi) => {
        for (let x = 0; x < s.w; x++) expect(deckend(s, f, x, 0) || deckend(s, f, x, s.h - 1), `${s.id} F${fi} x${x}`).toBe(false);
        for (let y = 0; y < s.h; y++) expect(deckend(s, f, 0, y) || deckend(s, f, s.w - 1, y), `${s.id} F${fi} y${y}`).toBe(false);
      });
    }
  });

  it('die Zelle deckt die Stellfläche, der Anker sitzt mittig auf ihrer Vorderkante', () => {
    for (const t of TEILE) {
      const s = obj(t.id);
      const b = t.groesse?.b ?? 1;
      expect(s.w, t.id).toBeGreaterThanOrEqual(b * TILE);
      expect(s.w, t.id).toBeLessThanOrEqual(b * TILE + 2);
      expect(Math.abs(s.anchor[0] - s.w / 2), t.id).toBeLessThanOrEqual(1);
      // Der Fußpunkt ist die unterste deckende Zeile (Wandobjekte: der untere Aufhängepunkt).
      const f = frame(s, 0);
      let unten = 0;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (deckend(s, f, x, y)) unten = y;
      expect(s.anchor[1], t.id).toBe(unten);
      // Die Tiefe: ein Objekt ragt mindestens so weit nach oben, wie seine Stellfläche tief ist.
      if (t.art === 'moebel' && t.blockiert !== false) expect(s.h, t.id).toBeGreaterThanOrEqual((t.groesse?.t ?? 1) * TILE);
    }
  });

  it('Wandobjekte: kein Bodenschatten, kein Occluder; stehende Möbel verdecken ihre Standfläche', () => {
    for (const t of TEILE) {
      const s = obj(t.id);
      if (t.art === 'wandmoebel') {
        expect(s.schatten, t.id).toBe('none');
        expect(s.occluder.kind, t.id).toBe('none');
      } else if (t.blockiert !== false) {
        expect(s.occluder.kind, t.id).not.toBe('none');
      }
    }
  });

  it('Sockel: Sitzplätze je Breite der Sitzmöbel, Kopf und Liegen der Betten', () => {
    for (const t of TEILE) {
      const s = obj(t.id);
      if (t.kategorie === 'sitz') {
        const plaetze = Object.keys(s.sockets).filter((k) => k.startsWith('sitzen'));
        expect(plaetze.length, t.id).toBe(t.groesse?.b ?? 1);
      }
      if (t.kategorie === 'bett') {
        const kopf = s.sockets.kopf?.[0];
        const liegen = s.sockets.liegen?.[0];
        expect(kopf !== undefined && liegen !== undefined && kopf[1] < liegen[1], t.id).toBe(true);
      }
    }
  });
});

describe('M4-19 Lichter', () => {
  it('Lampen: idle leuchtet in vier Flammen-Frames mit 10 fps, aus ist dunkel; Sockel im Kern', () => {
    for (const l of MOEBEL_LICHTER.filter((x) => x.verhalten === 'lampe')) {
      const s = obj(l.item);
      const idle = s.clips.idle;
      expect(idle?.fps, l.item).toBe(10);
      expect(new Set(clip(s, 'idle')).size, l.item).toBe(4);
      const bilder = new Set(clip(s, 'idle').map((i) => frame(s, i).index.join(',')));
      expect(bilder.size, l.item).toBe(4);
      for (const i of clip(s, 'idle')) {
        expect(leuchtend(frame(s, i)), `${l.item} F${i}`).toBeGreaterThan(0);
        const p = s.sockets.licht?.[i];
        expect(p, l.item).toBeDefined();
        const [x, y] = p ?? [0, 0];
        const f = frame(s, i);
        let nah = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((f.emissive[(y + dy) * s.w + x + dx] ?? 0) > 0) nah = true;
        expect(nah, `${l.item} F${i}: Lichtsockel am leuchtenden Kern`).toBe(true);
      }
      for (const i of clip(s, 'aus')) expect(leuchtend(frame(s, i)), `${l.item} aus`).toBe(0);
    }
  });

  it('nur Flammen, Glut und durchleuchtetes Glas leuchten', () => {
    for (const s of OBJEKTE) {
      s.frames.forEach((f, fi) =>
        f.index.forEach((v, p) => {
          if (v === TRANSPARENT || (f.emissive[p] ?? 0) === 0) return;
          const ref = paletteRef(v);
          expect(ref.startsWith('feuer.') || ref === 'sand.3' || ref === 'sand.4', `${s.id} F${fi} ${ref}`).toBe(true);
        }),
      );
      const licht = MOEBEL_LICHTER.some((l) => `obj_${l.item}` === s.id);
      expect(spriteHasEmissive(s), s.id).toBe(licht);
    }
  });

  it('Kamin: die Feuer-Clips des Lagerfeuers, voll > schwach > Glut, aus und Asche dunkel', () => {
    const s = obj('kamin_stein');
    expect(Object.keys(s.clips).sort()).toEqual([...FIRE_CLIPS].sort());
    const mittel = (name: string): number => clip(s, name).reduce((n, i) => n + leuchtend(frame(s, i)), 0) / clip(s, name).length;
    expect(mittel('aus')).toBe(0);
    expect(mittel('asche')).toBe(0);
    expect(mittel('glut')).toBeGreaterThan(0);
    expect(mittel('schwach')).toBeGreaterThan(mittel('glut'));
    expect(mittel('brennt')).toBeGreaterThan(mittel('schwach'));
    expect(s.clips.brennt?.fps).toBe(12);
    expect(s.sockets.licht).toHaveLength(s.frames.length);
  });
});

describe('M4-19 Tischdecke und Farbvarianten', () => {
  it('der gedeckte Tisch liegt deckungsgleich auf dem Holztisch: gleiche Zelle, gleicher Anker, gleiche Beine', () => {
    const tisch = obj('tisch_holz');
    const decke = obj('tischdecke');
    expect([decke.w, decke.h, ...decke.anchor]).toEqual([tisch.w, tisch.h, ...tisch.anchor]);
    const t = frame(tisch, 0);
    const d = frame(decke, 0);
    // Unterhalb des Tuchsaums (die Beine) ist alles wie beim Tisch.
    for (let y = 17; y < tisch.h; y++) for (let x = 0; x < tisch.w; x++) expect(d.index[y * tisch.w + x], `${x},${y}`).toBe(t.index[y * tisch.w + x]);
  });

  it('Farbvarianten tauschen nur Farben: gleiche Form, gleicher Anker wie das Grundsprite', () => {
    for (const v of varianten) {
      const basis = OBJEKTE.find((s) => v.id.startsWith(`${s.id}_`));
      expect(basis, v.id).toBeDefined();
      if (basis === undefined) continue;
      expect([v.w, v.h, ...v.anchor], v.id).toEqual([basis.w, basis.h, ...basis.anchor]);
      const a = frame(v, 0);
      const b = frame(basis, 0);
      let anders = 0;
      a.index.forEach((x, p) => {
        expect(x === TRANSPARENT, `${v.id} Form`).toBe((b.index[p] ?? TRANSPARENT) === TRANSPARENT);
        if (x !== b.index[p]) anders++;
      });
      expect(anders, v.id).toBeGreaterThan(0);
    }
  });

  it('die Wandfahne flattert: Tuch und Flamme sind Windpixel, Stange, Kontur und der Saum an der Stange nicht – auch in jeder Farbvariante', () => {
    const fahnen = [obj('fahne_wand'), ...varianten.filter((v) => v.id.startsWith('obj_fahne_wand_'))];
    expect(fahnen.length).toBe(5);
    for (const s of fahnen) {
      const f = frame(s, 0);
      const wind = (p: number): boolean => ((f.material[p] ?? 0) & MATERIAL_BITS.wind) !== 0;
      // Rows of the cell: the pole, its outline row and the hem (anchor row − 10) stay; the nine rows below them flutter.
      const zeile = (p: number): number => Math.floor(p / s.w);
      let tuch = 0;
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const stoff = v !== KONTUR && zeile(p) > s.anchor[1] - 10;
        expect(wind(p), `${s.id} Pixel ${p % s.w},${zeile(p)} (${paletteRef(v)})`).toBe(stoff);
        if (stoff) tuch++;
      });
      // The cloth below the hem: nine rows of up to 10 px, the swallowtail notched.
      expect(tuch, s.id).toBeGreaterThan(70);
    }
  });
});

describe('M4-19 Icons', () => {
  it('16×16, ein Frame, Anker des Welt-Drops, Motiv mit 1 px Luft, nichts leuchtet', () => {
    for (const s of ICONS) {
      expect([s.w, s.h], s.id).toEqual([ICON_GROESSE, ICON_GROESSE]);
      expect(s.frames).toHaveLength(1);
      expect(s.anchor, s.id).toEqual(ICON_ANKER);
      expect(s.group, s.id).toBe(ICON_GRUPPE);
      expect(spriteHasEmissive(s), s.id).toBe(false);
    }
  });

  it('Kontur nacht.1 rundum (≥ 65 % der Randpixel), jedes Icon verschieden', () => {
    for (const s of ICONS) {
      const f = frame(s, 0);
      let rand = 0;
      let kontur = 0;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          if (!deckend(s, f, x, y)) continue;
          if (deckend(s, f, x - 1, y) && deckend(s, f, x + 1, y) && deckend(s, f, x, y - 1) && deckend(s, f, x, y + 1)) continue;
          rand++;
          if (f.index[y * s.w + x] === KONTUR) kontur++;
        }
      }
      expect(kontur / rand, s.id).toBeGreaterThanOrEqual(0.65);
    }
    const bilder = ICONS.map((s) => frame(s, 0).index.join(','));
    expect(new Set(bilder).size).toBe(ICONS.length);
  });
});
