/**
 * M3-07: Ausrüstungs-Layer (MASTERPROMPT §4.5 „Ausrüstung als Layer … mit Hand-Sockeln pro Frame“).
 * - Körper-Layer (Tunika, Hose): gleiche Frames wie der Grundkörper, liegen nur auf dem Körper, der
 *   Zusammenbau ist sauber (≤ 12 Farben, keine Einzelpixel) und gleicht der angezogenen Idle-Figur
 *   `spieler_koerper`.
 * - Hand-Layer (T0-Werkzeuge, Steinspeer, Eimer, Fackel): Anker = Griffpixel, Halte-Clips je Richtung,
 *   Schlag-Clips so lang und so schnell wie der Körper-Clip, Wirkpunkt auf dem Werkzeugkopf.
 * - Sockel-Mapping: `socketOffset` des Renderers setzt den Griff jedes Items auf den Hand-Sockel jedes
 *   Körper-Frames; die Fackel folgt der Nebenhand durch alle Frames.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN } from '../../../assets-src/lib/figure';
import { SCHLAG_AKTIONEN } from '../../../assets-src/lib/figureWerkzeug';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteFromPixels, spriteHasEmissive, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import fackel from '../../../assets-src/sprites/ausruestung/fackel';
import kleidung from '../../../assets-src/sprites/ausruestung/kleidung';
import werkzeuge from '../../../assets-src/sprites/ausruestung/werkzeuge';
import { AKTIONEN, istSonder } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { framesDerAktion, spielerBilder } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import spielerKoerper from '../../../assets-src/sprites/figuren/spieler_koerper';
import { socketOffset } from '../../../src/render/anim/figure';
import { checkSprite } from '../../../tools/assets/spriteChecks';

/** Kanonische T0-Ids mit Hand-Layer (docs/SPIEL.md §6). */
const HAND_IDS = ['steinaxt', 'steinspitzhacke', 'steinschaufel', 'steinhacke', 'steinsichel', 'steinhammer', 'steinmesser', 'holzeimer', 'holzeimer_wasser', 'steinspeer'];

const [tunika, hose] = kleidung;

function px(s: Sprite, f: number): Uint8Array {
  const fr = s.frames[f];
  if (fr === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  return fr.index;
}

/** Körper mit Körper-Layern in Renderer-Reihenfolge (Beine, dann Tunika) als Pixelpuffer. */
function angezogen(f: number): Uint8Array {
  const out = Uint8Array.from(px(spieler, f));
  for (const layer of [hose, tunika]) {
    if (layer === undefined) continue;
    px(layer, f).forEach((v, p) => {
      if (v !== TRANSPARENT) out[p] = v;
    });
  }
  return out;
}

describe('M3-07 Körper-Layer Leinentunika und Leinenhose', () => {
  it('gleiche Zelle, gleicher Anker, gleiche Frame-Anzahl wie der Grundkörper (Overlay-Layer des Rigs)', () => {
    expect(tunika?.id).toBe('ausruestung_leinentunika');
    expect(hose?.id).toBe('ausruestung_leinenhose');
    for (const l of [tunika, hose]) {
      expect([l?.w, l?.h, l?.anchor, l?.frames.length]).toEqual([spieler.w, spieler.h, spieler.anchor, spieler.frames.length]);
    }
  });

  it('Layer-Pixel liegen nur auf dem Körper; Stoff in Kleidungsfarbe, Kontur wie am Körper', () => {
    for (const l of [tunika, hose]) {
      if (l === undefined) continue;
      l.frames.forEach((fr, f) => {
        const koerper = px(spieler, f);
        fr.index.forEach((v, p) => {
          if (v === TRANSPARENT) return;
          const k = koerper[p] ?? TRANSPARENT;
          expect(k, `${l.id} F${f} (${p % l.w}, ${Math.floor(p / l.w)}) außerhalb des Körpers`).not.toBe(TRANSPARENT);
          const ref = paletteRef(v);
          if (ref === 'nacht.1') expect(paletteRef(k)).toBe('nacht.1');
          else expect(ref, l.id).toMatch(/^(wasser|erde)\./);
        });
      });
    }
  });

  it('die Tunika deckt in jedem stehenden Frame Rumpfstoff; die Hose zeigt sich in jeder Richtung (unter dem Saum nur 1–2 Zeilen)', () => {
    const stoff = (l: Sprite | undefined, f: number): boolean => l !== undefined && px(l, f).some((v) => v !== TRANSPARENT && paletteRef(v).startsWith('wasser.'));
    for (const r of RICHTUNGEN) {
      const frames = [...new Set([...(spieler.clips[`idle_${r}`]?.frames ?? []), ...(spieler.clips[`walk_${r}`]?.frames ?? [])])];
      for (const f of frames) expect(stoff(tunika, f), `idle/walk_${r} F${f}`).toBe(true);
      expect(frames.some((f) => stoff(hose, f)), r).toBe(true);
    }
  });

  it('Zusammenbau aller Frames: ≤ 12 Farben und kein Einzelpixel-Befund', () => {
    const komposit = spriteFromPixels(
      { id: 'spieler_angezogen', size: [spieler.w, spieler.h], anchor: [spieler.anchor[0], spieler.anchor[1]], hoehe: 'zylinder' },
      spieler.frames.map((_, f) => ({ index: angezogen(f) })),
    );
    expect(spriteColorCount(komposit)).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
    expect(checkSprite(komposit)).toEqual({ errors: [], warnings: [] });
  });

  it('der Zusammenbau im Idle ist pixelgleich mit spieler_koerper (Szenen ohne Rig)', () => {
    for (const r of RICHTUNGEN) {
      const basis = spieler.clips[`idle_${r}`]?.frames ?? [];
      const vorschau = spielerKoerper.clips[`idle_${r}`]?.frames ?? [];
      expect(vorschau.length).toBe(basis.length);
      basis.forEach((f, i) => expect(Array.from(px(spielerKoerper, vorschau[i] ?? 0)), `idle_${r} ${i}`).toEqual(Array.from(angezogen(f))));
    }
  });
});

describe('M3-07 Hand-Layer', () => {
  const items = new Map(werkzeuge.map((w) => [w.id, w]));

  it('alle T0-Werkzeuge, Steinspeer und Eimer aus docs/SPIEL.md §6 als ausruestung_<itemId>', () => {
    expect([...items.keys()].sort()).toEqual(HAND_IDS.map((id) => `ausruestung_${id}`).sort());
    expect(fackel.id).toBe('ausruestung_fackel');
  });

  it('Anker = Griffpixel: in jedem Frame deckend und aus Holz bzw. Schnur', () => {
    for (const w of [...werkzeuge, fackel]) {
      const [ax, ay] = w.anchor;
      w.frames.forEach((fr, f) => {
        const v = fr.index[ay * w.w + ax] ?? TRANSPARENT;
        expect(v, `${w.id} F${f}`).not.toBe(TRANSPARENT);
        expect(paletteRef(v), `${w.id} F${f}`).toMatch(/^(holz|sand)\./);
      });
    }
  });

  it('Halte-Clips für alle vier Richtungen; Schlag-Clips so lang und schnell wie der Körper-Clip', () => {
    for (const w of werkzeuge) {
      for (const r of RICHTUNGEN) {
        expect(w.clips[r], `${w.id} ${r}`).toBeDefined();
        for (const aktion of SCHLAG_AKTIONEN) {
          const item = w.clips[`${aktion}_${r}`];
          const koerper = spieler.clips[`${aktion}_${r}`];
          expect(item?.frames.length, `${w.id} ${aktion}_${r}`).toBe(koerper?.frames.length);
          expect(item?.fps, `${w.id} ${aktion}_${r}`).toBe(koerper?.fps);
          expect(item?.loop).toBe(false);
        }
      }
    }
  });

  it('Schlagwerkzeuge schwingen: der Schlag nutzt vier Lagen und einen Smear-Frame', () => {
    for (const w of werkzeuge.filter((x) => !x.id.includes('eimer'))) {
      const rechts = w.clips.tool_right?.frames ?? [];
      expect(new Set(rechts).size, w.id).toBe(4);
      const smear = rechts[3] ?? 0;
      const lage = rechts[4] ?? 0;
      const zusatz = [...px(w, smear)].filter((v, p) => v !== TRANSPARENT && px(w, lage)[p] === TRANSPARENT).length;
      expect(zusatz, `${w.id}: Bewegungsbogen`).toBeGreaterThan(6);
    }
  });

  it('Wirkpunkt je Frame auf dem Werkzeugkopf (deckend)', () => {
    for (const w of werkzeuge) {
      const punkte = w.sockets.wirkpunkt ?? [];
      expect(punkte).toHaveLength(w.frames.length);
      punkte.forEach(([x, y], f) => expect(px(w, f)[y * w.w + x], `${w.id} F${f}`).not.toBe(TRANSPARENT));
    }
  });

  it('Fackel: Flamme emissiv, Lichtsockel im Flammenkern, nur Feuer leuchtet', () => {
    expect(spriteHasEmissive(fackel)).toBe(true);
    const [lx, ly] = fackel.sockets.licht?.[0] ?? [0, 0];
    for (const fr of fackel.frames) {
      expect(fr.emissive[ly * fackel.w + lx]).toBe(1);
      fr.index.forEach((v, p) => {
        if (v !== TRANSPARENT) expect(fr.emissive[p], paletteRef(v)).toBe(paletteRef(v).startsWith('feuer.') ? 1 : 0);
      });
    }
    for (const r of RICHTUNGEN) expect(fackel.clips[r]?.frames).toHaveLength(4);
  });

  it(`≤ ${MAX_SPRITE_COLORS} Farben und kein Einzelpixel-Befund`, () => {
    for (const w of [...werkzeuge, fackel, ...kleidung]) {
      expect(spriteColorCount(w), w.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(w), w.id).toEqual({ errors: [], warnings: [] });
    }
  });
});

describe('M3-07 Sockel-Mapping', () => {
  /** Frame-Referenz des Renderers für eine volle Zelle (der Atlas beschneidet Frames nicht). */
  const frameRef = { x: 0, y: 0, w: spieler.w, h: spieler.h, ax: spieler.anchor[0], ay: spieler.anchor[1] };

  it('socketOffset setzt den Griff jedes Hand-Layers auf den Sockel jedes Körper-Frames', () => {
    const out = { x: 0, y: 0 };
    for (const w of [...werkzeuge, fackel]) {
      const sockel = w === fackel ? 'nebenhand' : 'hand';
      spieler.sockets[sockel]?.forEach((p, f) => {
        socketOffset(frameRef, p, false, out);
        // Item-Anker (Griff) landet bei Körperanker + Versatz = Sockelpixel in Zellkoordinaten.
        expect([spieler.anchor[0] + out.x, spieler.anchor[1] + out.y], `${w.id} F${f}`).toEqual([p[0], p[1]]);
      });
    }
  });

  it('die Fackel folgt der Nebenhand durch alle Frames: der Sockel sitzt auf der gezeichneten linken Hand', () => {
    const { bilder, start } = spielerBilder();
    let gezaehlt = 0;
    for (const a of AKTIONEN) {
      for (const r of RICHTUNGEN) {
        const erster = start[`${a.name}_${r}`] ?? 0;
        framesDerAktion(a, r).forEach((def, i) => {
          if (istSonder(def)) return;
          // Von vorn/hinten ist die linke Hand immer zu sehen, im Profil nach links ist sie die nahe Hand.
          if (r === 'right' || def.folge === 'armeHinten') return;
          const f = erster + i;
          const [x, y] = spieler.sockets.nebenhand?.[f] ?? [0, 0];
          const zeichen = bilder[f]?.pixel[y * spieler.w + x];
          expect(zeichen, `${a.name}_${r} F${i}`).toMatch(/^[mS]$/);
          gezaehlt++;
        });
      }
    }
    expect(gezaehlt).toBeGreaterThan(100);
  });

  it('die Nebenhand bewegt sich mit: im Gehen ohne Licht pendelt sie, mit Licht hält sie still', () => {
    const ys = (clip: string): number[] => (spieler.clips[clip]?.frames ?? []).map((f) => spieler.sockets.nebenhand?.[f]?.[1] ?? 0);
    expect(new Set(ys('walk_down')).size).toBeGreaterThan(1);
    const licht = ys('walk_licht_down');
    const rumpf = (spieler.clips.walk_licht_down?.frames ?? []).map((f) => spieler.sockets.kopf?.[f]?.[1] ?? 0);
    expect(Math.max(...licht) - Math.min(...licht)).toBeLessThanOrEqual(Math.max(...rumpf) - Math.min(...rumpf) + 1);
  });
});
