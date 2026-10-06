/**
 * Der Uraltbaum des Naturwunders (M7-08; docs/SPIEL.md §18 "Naturwunder (Uraltbaum)"): eine Eiche, wie sie nur einmal in
 * einer Welt steht – 96×120, Stammfuß 30 px breit, kurz und mächtig unter der Krone, mit weit ausgestellten Wurzeln, eine breite, gelappte Krone aus vierzehn
 * Blattmassen, knorrige Äste, die durch Lücken scheinen. Gebaut mit dem Baum-Baukasten der Baumarten (`baumArt`, M2-20):
 * Frame 0 belaubt, Frame 1 kahl mit Schnee (Clips je Jahreszeit), Blätterdach-Flags für das Durchscheinen. Vom Ergebnis zählt
 * nur der Baum selbst; er heißt `ort_uraltbaum` und liegt im Kontaktbogen `orte`. Stellfläche 2×2, Anker = Mitte der
 * Vorderkante (x 48, Zeile 116).
 */
import type { GeneratorResult } from '../../lib/generator';
import { LAUBWECHSEL, baumArt, type BaumArt } from '../baeume/_baukasten';
import { ORTE_GRUPPE } from './_ort';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

const URALTBAUM: BaumArt = {
  art: 'uraltbaum',
  seed: 7707,
  w: 96,
  h: 120,
  fussX: 48,
  fussY: 116,
  stamm: { oben: 76, breiteFuss: 30, breiteOben: 20, wurzel: 10, wurzelZeilen: 9, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 4,
    massen: [
      { x: 48, y: 26, rx: 17, ry: 13 },
      { x: 28, y: 32, rx: 16, ry: 12 },
      { x: 68, y: 31, rx: 16, ry: 12 },
      { x: 15, y: 47, rx: 13, ry: 12 },
      { x: 81, y: 46, rx: 13, ry: 12 },
      { x: 36, y: 46, rx: 17, ry: 13 },
      { x: 60, y: 47, rx: 17, ry: 13 },
      { x: 48, y: 40, rx: 14, ry: 12 },
      { x: 22, y: 65, rx: 15, ry: 10 },
      { x: 74, y: 65, rx: 15, ry: 10 },
      { x: 48, y: 67, rx: 16, ry: 10 },
      { x: 8, y: 60, rx: 8, ry: 8 },
      { x: 88, y: 59, rx: 8, ry: 8 },
      { x: 36, y: 72, rx: 10, ry: 6 },
    ],
  },
  kroneUnten: 79,
  geruest: { punkte: 220, punktAbstand: 3, einfluss: 13, erreicht: 3, auftrieb: 0.04 },
  kahl: { schnee: ['eis.4', 'eis.2'] },
  jahreszeiten: LAUBWECHSEL,
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 8, rx: 5, ry: 4 }] },
};

const baum = baumArt(URALTBAUM);
const sprite = baum.sprites.find((s) => s.id === 'baum_uraltbaum');
if (sprite === undefined) throw new Error('Uraltbaum: Baum-Baukasten lieferte keinen Baum');

const ergebnis: GeneratorResult = { ...baum, sprites: [{ ...sprite, id: 'ort_uraltbaum', group: ORTE_GRUPPE }] };

export default ergebnis;
