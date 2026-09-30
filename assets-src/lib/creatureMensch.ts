/**
 * Bauplan Mensch (M6, docs/ART.md §15): humanoide Gegner (Strandräuber, die Gezeichneten) aus dem
 * Figuren-Rig der Spielfigur (`figure.ts`, Aktionstabellen in `sprites/figuren`): dieselben
 * handgezeichneten Teile und Posen, aber eine eigene Legende (Kleidung, Kopftuch statt Haar, Schärpe)
 * und eine Waffe, die im Frame fest an der Hand sitzt – in der Stapelfolge des Renderers (Waffe hinter dem
 * Körper, wenn die Waffenhand abgewandt ist: von hinten und im Profil nach links).
 *
 * Augen: Die Rig-Köpfe zeichnen offene Augen als Konturpixel zwischen Hautpixeln; diese werden erkannt
 * und in der Augenfarbe (emissiv) gemalt – geschlossene Augen (Tod) bleiben dunkel.
 *
 * Alle vier Richtungen sind eigene Frames (Waffenhand, Scheitel): nicht spiegelbar.
 */
import { createHash } from 'node:crypto';
import type { KreaturClipInfo, KreaturErgebnis } from './creature';
import { KREATUR_PRAEFIX } from './creature';
import { bereinigeRaster } from './creatureRender';
import { RICHTUNGEN, bildPixel, bildVerschoben, type Bild, type FigurLegende, type Richtung } from './figure';
import { TRANSPARENT, spriteFromPixels, type Sprite } from './sprite';

/** Eine Aktion des Menschen: Bilder je Richtung (in Aktionsreihenfolge) und Clip-Angaben. */
export interface MenschAktion {
  /** Clip-Name (`idle`, `move`, `attack_hieb`, `hit`, `death`). */
  readonly clip: string;
  readonly fps: number;
  readonly loop: boolean;
  /** Abspielfolge über die Bilder der Aktion. */
  readonly folge: readonly number[];
  readonly events: readonly { readonly frame: number; readonly name: string }[];
  readonly ausholen?: { readonly von: number; readonly bis: number };
  /** Bilder der Aktion je Richtung. */
  readonly bilder: (richtung: Richtung) => readonly Bild[];
  /** Waffen-Frame je Bild (Index im Waffen-Sprite) oder `null` = keine Waffe in diesem Bild. */
  readonly waffe: (richtung: Richtung, bild: number) => number | null;
}

export interface MenschArt {
  readonly id: string;
  readonly legende: FigurLegende;
  /** Konturzeichen (Augen sind Konturpixel zwischen Haut) und Hautzeichen. */
  readonly kontur: string;
  readonly haut: ReadonlySet<string>;
  /** Legendenzeichen, mit dem erkannte Augen gemalt werden (emissive Farbe). */
  readonly auge: string;
  readonly waffe: Sprite;
  readonly aktionen: readonly MenschAktion[];
  /** Zelle und Anker; `hub` hebt alle Bilder des Rigs um so viele px (1 px Luft unter den Füßen). */
  readonly zelle: number;
  readonly anker: readonly [number, number];
  readonly hub: number;
  /** Waagerechter Versatz je Richtung (px), damit weit ausholende Schläge in der Zelle bleiben. */
  readonly versatzX?: Partial<Record<Richtung, number>>;
}

/** Richtungen, in denen die Waffenhand hinter dem Körper liegt. */
const WAFFE_HINTEN: ReadonlySet<Richtung> = new Set(['up', 'left']);

/** Malt offene Augen: Konturpixel mit Haut links und rechts. */
function augenMalen(b: Bild, kontur: string, haut: ReadonlySet<string>, auge: string): Bild {
  const pixel = [...b.pixel];
  const an = (x: number, y: number): string => (x < 0 || y < 0 || x >= b.w || y >= b.h ? '.' : (b.pixel[y * b.w + x] ?? '.'));
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (an(x, y) !== kontur) continue;
      if (haut.has(an(x - 1, y)) && haut.has(an(x + 1, y))) pixel[y * b.w + x] = auge;
    }
  }
  return { ...b, pixel };
}

/** Setzt die Waffe (Anker = Griff) auf den Sockel `hand`; `hinten`: nur auf leere Pixel. */
function waffeSetzen(index: Uint8Array, emissiv: Uint8Array, w: number, h: number, waffe: Sprite, frame: number, hand: readonly [number, number], hinten: boolean): void {
  const f = waffe.frames[frame];
  if (f === undefined) return;
  const x0 = hand[0] - waffe.anchor[0];
  const y0 = hand[1] - waffe.anchor[1];
  for (let y = 0; y < waffe.h; y++) {
    for (let x = 0; x < waffe.w; x++) {
      const v = f.index[y * waffe.w + x] ?? TRANSPARENT;
      if (v === TRANSPARENT) continue;
      const tx = x0 + x;
      const ty = y0 + y;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const i = ty * w + tx;
      if (hinten && (index[i] ?? 0) !== TRANSPARENT) continue;
      index[i] = v;
      emissiv[i] = f.emissive[y * waffe.w + x] ?? 0;
    }
  }
}

/** Baut das Sprite `kreatur_<id>` eines Menschen mit allen Aktionen in vier Richtungen. */
export function mensch(art: MenschArt): KreaturErgebnis {
  const frames: { index: Uint8Array; emissive: Uint8Array }[] = [];
  const nachSchluessel = new Map<string, number>();
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean; events: { frame: number; name: string }[] }> = {};
  const infos: KreaturClipInfo[] = [];
  const n = art.zelle * art.zelle;
  for (const richtung of RICHTUNGEN) {
    for (const a of art.aktionen) {
      const bilder = a.bilder(richtung).map((roh, i) => {
        const dx = art.versatzX?.[richtung] ?? 0;
        const b = art.hub === 0 && dx === 0 ? roh : bildVerschoben(roh, dx, -art.hub);
        const mitAugen = augenMalen(b, art.kontur, art.haut, art.auge);
        const px = bildPixel(mitAugen, art.legende);
        const index = Uint8Array.from(px.index);
        const emissiv = px.emissive === undefined ? new Uint8Array(n) : Uint8Array.from(px.emissive);
        const wf = a.waffe(richtung, i);
        const hand = b.sockel['hand'];
        if (wf !== null && hand !== undefined) waffeSetzen(index, emissiv, art.zelle, art.zelle, art.waffe, wf, hand, WAFFE_HINTEN.has(richtung));
        const schutz = Uint8Array.from(emissiv);
        bereinigeRaster(index, emissiv, schutz, art.zelle, art.zelle);
        const k = createHash('sha1').update(index).update(emissiv).digest('hex');
        const vorhanden = nachSchluessel.get(k);
        if (vorhanden !== undefined) return vorhanden;
        frames.push({ index, emissive: emissiv });
        nachSchluessel.set(k, frames.length - 1);
        return frames.length - 1;
      });
      const name = `${a.clip}_${richtung}`;
      const seq = a.folge.map((i) => {
        const f = bilder[i];
        if (f === undefined) throw new Error(`Mensch ${art.id}: ${name} nennt Bild ${i}, es gibt ${bilder.length}`);
        return f;
      });
      clips[name] = { frames: seq, fps: a.fps, loop: a.loop, events: a.events.map((e) => ({ ...e })) };
      infos.push({ clip: name, aktion: a.clip, richtung, frames: seq, fps: a.fps, loop: a.loop, ausholen: a.ausholen ?? null });
    }
  }
  const sprite = spriteFromPixels(
    {
      id: `${KREATUR_PRAEFIX}${art.id}`,
      size: [art.zelle, art.zelle],
      anchor: [art.anker[0], art.anker[1]],
      hoehe: 'zylinder',
      clips,
      occluder: { kind: 'none' },
      spiegelbar: false,
    },
    frames,
  );
  return { sprite, clips: infos, erzeuge: () => mensch(art) };
}
