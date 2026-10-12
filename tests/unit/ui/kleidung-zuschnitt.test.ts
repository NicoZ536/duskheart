/**
 * Kleidung im Atlas beschnitten (M7-125; MASTERPROMPT §5 „Atlanten“, §4.5 „Ausrüstung als Layer“): die Kleidungs-Layer des
 * Schiffbrüchigen (Tunika und Hose, je Körperform) liegen im Atlas nur mit dem Rechteck ihrer deckenden Pixel
 * (`zuschnitt`, wie die Rüstungs-Layer seit M7-110); ihr Anker im Rechteck (`ax`, `ay`) sagt, wo sie in der Zelle sitzen.
 * Die HUD-Symbolquelle (src/ui/hud/minimap/spriteBild.ts `zellIndizes`, der Schnitt von `AtlasBilder.indizes` für Minimap,
 * Kompass und Charaktervorschau) gibt jeden Frame als ganze Zelle zurück: aus dem Rechteck, das der Atlas-Generator
 * schneidet (tools/assets/atlas.ts `frameCrop`), entsteht Pixel für Pixel wieder der Frame der Quelle. Die Charaktervorschau
 * (src/ui/screens/charakter/vorschau.ts) setzt mit beschnittenen Kleidungs-Frames dasselbe Bild zusammen wie mit ganzen
 * Zellen – und die Kleidung liegt darin, wo sie auf dem Körper sitzt.
 */
import { describe, expect, it } from 'vitest';
import type { Sprite } from '../../../assets-src/lib/sprite';
import kleidung from '../../../assets-src/sprites/ausruestung/kleidung';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import spielerFormen from '../../../assets-src/sprites/figuren/spieler_formen';
import { frameCrop } from '../../../tools/assets/atlas';
import { zellIndizes, type RahmenRechteck, type SymbolQuelle } from '../../../src/ui/hud/minimap/spriteBild';
import { vorschauBild, type VorschauSprite } from '../../../src/ui/screens/charakter/vorschau';
import type { CharakterForm } from '../../../src/ui/screens/charakter/modell';

const RGBA = 4;
const OPAQUE = 255;

/** A frame as the atlas holds it: RGBA (red = palette index, alpha = covered) of its rectangle, and that rectangle with its anchor. */
interface AtlasFrame {
  readonly px: Uint8Array;
  readonly rect: RahmenRechteck;
}

/** The frame's cell as the atlas albedo (red = palette index 1 … 64, alpha 255 where covered). */
function zelle(index: Uint8Array): Uint8Array {
  const out = new Uint8Array(index.length * RGBA);
  for (let i = 0; i < index.length; i++) {
    const v = index[i] as number;
    if (v === 0) continue;
    out[i * RGBA] = v;
    out[i * RGBA + 3] = OPAQUE;
  }
  return out;
}

/**
 * Frame `f` of `s` as the atlas generator stores it: trimmed to the rectangle of its covered pixels (`frameCrop`, the anchor
 * minus the cut, tools/assets/atlas.ts) – or, untrimmed, the whole cell (without an anchor, as manifests before M7-130).
 */
function imAtlas(s: Sprite, f: number, beschnitten: boolean): AtlasFrame {
  const frame = s.frames[f];
  if (frame === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  const full = zelle(frame.index);
  if (!beschnitten) return { px: full, rect: { w: s.w, h: s.h } };
  const c = frameCrop({ albedo: full, normal: full }, s.w, s.h);
  const px = new Uint8Array(c.w * c.h * RGBA);
  for (let row = 0; row < c.h; row++) px.set(full.subarray(((c.y + row) * s.w + c.x) * RGBA, ((c.y + row) * s.w + c.x + c.w) * RGBA), row * c.w * RGBA);
  return { px, rect: { w: c.w, h: c.h, ax: s.anchor[0] - c.x, ay: s.anchor[1] - c.y } };
}

function mass(s: Sprite): { breite: number; hoehe: number; ankerX: number; ankerY: number } {
  return { breite: s.w, hoehe: s.h, ankerX: s.anchor[0], ankerY: s.anchor[1] };
}

const [tunika, hose] = kleidung as [Sprite, Sprite];
const KLEIDUNG_IDS = ['ausruestung_leinentunika', 'ausruestung_leinenhose'];

describe('Kleidungs-Layer beschnitten (M7-125)', () => {
  it('Tunika und Hose aller drei Körperformen tragen `zuschnitt`, ohne Sockel und Occluder (der Atlas schneidet nur solche)', () => {
    const layer = [...kleidung, ...spielerFormen].filter((s) => KLEIDUNG_IDS.some((id) => s.id === id || s.id.startsWith(`${id}_`)));
    expect(layer.map((s) => s.id).sort()).toEqual([
      'ausruestung_leinenhose',
      'ausruestung_leinenhose_kraeftig',
      'ausruestung_leinenhose_schmal',
      'ausruestung_leinentunika',
      'ausruestung_leinentunika_kraeftig',
      'ausruestung_leinentunika_schmal',
    ]);
    for (const s of layer) {
      expect(s.zuschnitt, s.id).toBe(true);
      expect(Object.keys(s.sockets), s.id).toEqual([]);
      expect(s.occluder.kind, s.id).toBe('none');
    }
    // The bodies keep their whole cells (their sockets are in cell coordinates).
    expect(spieler.zuschnitt).toBe(false);
  });
});

describe('Symbolquelle: ein beschnittener Frame als ganze Zelle (src/ui/hud/minimap/spriteBild.ts `zellIndizes`)', () => {
  it('ein Ausschnitt liegt um den Schnitt versetzt: Zell-Anker minus Rechteck-Anker; ein leerer Frame bleibt leer', () => {
    // A 4 × 3 cell with its anchor at (2, 2); the covered pixels (palette 7 and 9) at (1, 1) and (2, 1): the rectangle 2 × 1 at
    // (1, 1), its anchor (1, 1).
    const px = Uint8Array.from([7, 0, 0, OPAQUE, 9, 0, 0, OPAQUE]);
    const m = { breite: 4, hoehe: 3, ankerX: 2, ankerY: 2 };
    expect([...zellIndizes(px, { w: 2, h: 1, ax: 1, ay: 1 }, m)]).toEqual([0, 0, 0, 0, 0, 7, 9, 0, 0, 0, 0, 0]);
    // The generator's empty frame: 1 × 1 at the top left corner, transparent.
    expect([...zellIndizes(new Uint8Array(RGBA), { w: 1, h: 1, ax: 2, ay: 2 }, m)]).toEqual(new Array(12).fill(0));
    // A whole cell (anchor = cell anchor, or none): pixel for pixel; a covered pixel of index 0 never happens, alpha 0 is 0.
    const whole = Uint8Array.from({ length: 12 * RGBA }, (_, i) => (i % RGBA === 0 ? (i / RGBA) + 1 : i % RGBA === 3 ? OPAQUE : 0));
    expect([...zellIndizes(whole, { w: 4, h: 3, ax: 2, ay: 2 }, m)]).toEqual([...zellIndizes(whole, { w: 4, h: 3 }, m)]);
    expect([...zellIndizes(whole, { w: 4, h: 3 }, m)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('jeder Frame von Tunika und Hose: aus dem Rechteck des Generators entsteht wieder der Frame der Quelle', () => {
    for (const s of [tunika, hose]) {
      let schnitt = 0;
      // Compared pixel by pixel in a loop (a deep comparison of every frame's array costs seconds): the frames that differ.
      const anders: number[] = [];
      for (let f = 0; f < s.frames.length; f++) {
        const a = imAtlas(s, f, true);
        const z = zellIndizes(a.px, a.rect, mass(s));
        const q = (s.frames[f] as { index: Uint8Array }).index;
        let gleich = z.length === q.length;
        for (let i = 0; gleich && i < q.length; i++) gleich = z[i] === q[i];
        if (!gleich) anders.push(f);
        schnitt += s.w * s.h - a.rect.w * a.rect.h;
      }
      expect(anders, s.id).toEqual([]);
      expect(s.frames.length, s.id).toBe(spieler.frames.length);
      // The cut saves most of each cell: a tunic covers the trunk, trousers the legs.
      expect(schnitt / (s.frames.length * s.w * s.h), s.id).toBeGreaterThan(0.5);
    }
  });
});

describe('Charaktervorschau mit beschnittener Kleidung (src/ui/screens/charakter/vorschau.ts)', () => {
  /** The manifest records the preview reads: body, trousers, tunic (frames by count only, clips and sockets of the body). */
  const sprites: Readonly<Record<string, VorschauSprite>> = Object.fromEntries(
    [spieler, tunika, hose].map((s) => [s.id, { size: [s.w, s.h], anchor: s.anchor, frames: s.frames, clips: s.clips, sockets: s.sockets }]),
  );
  /** The source over the atlas frames: clothes trimmed or whole, the body whole – every frame back as its cell. */
  const quelle = (beschnitten: boolean): Pick<SymbolQuelle, 'indizes'> => ({
    indizes: (id, frame = 0) => {
      const s = [spieler, tunika, hose].find((x) => x.id === id);
      if (s === undefined) return null;
      const a = imAtlas(s, frame, beschnitten && s !== spieler);
      return zellIndizes(a.px, a.rect, mass(s));
    },
  });
  // The body's own hair (no hair layer), no palette rows: the preview shows the drawn indices.
  const form: CharakterForm = { name: 'Test', form: 'mittel', haut: 'haut_1', frisur: 'scheitel', haar: 'haar_1', oberteil: 'kleidung_1', hose: 'kleidung_2' };

  it('Idle und Gehen in allen vier Richtungen: dasselbe Bild wie mit ganzen Zellen, die Kleidung auf dem Körper', () => {
    let positionen = 0;
    for (const richtung of ['down', 'up', 'left', 'right']) {
      for (const aktion of ['idle', 'walk']) {
        const clip = spieler.clips[`${aktion}_${richtung}`];
        if (clip === undefined) throw new Error(`spieler_basis: Clip ${aktion}_${richtung} fehlt`);
        for (let position = 0; position < clip.frames.length; position++) {
          const ganz = vorschauBild(quelle(false), sprites, [], form, aktion, richtung, position);
          const beschnitten = vorschauBild(quelle(true), sprites, [], form, aktion, richtung, position);
          expect(ganz, `${aktion}_${richtung} ${position}`).not.toBeNull();
          expect(beschnitten, `${aktion}_${richtung} ${position}`).toEqual(ganz);
          // Every covered pixel of the tunic lies in the picture where the tunic's frame has it.
          const f = clip.frames[position] as number;
          const t = (tunika.frames[f] as { index: Uint8Array }).index;
          for (let i = 0; i < t.length; i++) if ((t[i] as number) !== 0) expect(beschnitten?.[i], `${aktion}_${richtung} ${position} px ${i}`).toBe(t[i]);
          positionen++;
        }
      }
    }
    expect(positionen).toBeGreaterThanOrEqual(8);
  });
});
