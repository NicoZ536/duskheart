/**
 * Die Instrumente in der Hand der Spielfigur (M7-77; MASTERPROMPT §11.4 „Musizieren“, docs/SPIEL.md §24 „Musizieren“) und die
 * Noten, die beim Spielen aufsteigen.
 *
 * - `ausruestung_floete`, `ausruestung_laute`: Hand-Layer (Schicht `waffe`, Anker = Haupthand, Sockel `hand`). Die Figur hält
 *   das Instrument wie eine Blockflöte (`_spieler_musik.ts`): die Haupthand am Mund, die Nebenhand vor dem Bauch. Je Bild des
 *   Clips `musizieren_<richtung>` liegt das Instrument zwischen beiden Händen, wie sie im Bild stehen – die Flöte als
 *   zwei Pixel breiter Holzstab mit Grifflöchern, über die untere Hand hinaus; die Laute mit dem Hals in der oberen Hand und
 *   dem bauchigen Korpus (Schallloch, im Profil schmal) an der unteren. Die Clips `musizieren_<richtung>` laufen Position für
 *   Position mit dem Körper (der Rig spielt sie auf dessen Clip-Zeit), die Halte-Clips je Richtung zeigen das erste Bild. Von
 *   hinten verdeckt der Körper das Instrument ganz (leere Bilder).
 * - Je Körperform (M7-113) dieselben Instrumente zwischen den Händen des Körpers der Form: `ausruestung_floete_schmal`,
 *   `ausruestung_laute_kraeftig` …
 * - `spieler_noten`: Achtelnote und Doppelnote, je hell und verblassend (src/render/game/playerFigure.ts lässt sie über dem
 *   Kopf aufsteigen, solange die Figur spielt).
 */
import { RICHTUNGEN, type Bild, type Richtung } from '../../lib/figure';
import { sprite, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { resolveColor } from '../../lib/sprite';
import { spielerBilderFuer } from './_spieler_bilder';
import { KOERPERFORMEN, type KoerperForm } from './_spieler_formen';

type Punkt = readonly [number, number];

/** Palettenindex einer Farbreferenz. */
function farbe(ref: string): number {
  const r = resolveColor(ref);
  if ('error' in r) throw new Error(`Instrumente: ${r.error}`);
  return r.index;
}

const HELL = farbe('holz.3');
const DUNKEL = farbe('holz.1');
const LOCH = farbe('holz.0');
const KORPUS = farbe('holz.2');
const KANTE = farbe('nacht.1');
const SAITE = farbe('sand.4');

/** Ein Bild des Instruments in Körperkoordinaten (Pixel → Palettenindex). */
type Zeichnung = Map<string, number>;

function setze(z: Zeichnung, x: number, y: number, v: number): void {
  z.set(`${x},${y}`, v);
}

/** Pixel der Linie von `a` nach `b` (Bresenham). */
function linie(a: Punkt, b: Punkt): Punkt[] {
  const out: Punkt[] = [];
  let [x, y] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Die Richtung der Hände von der oberen zur unteren Hand, auf einen Schritt (−1, 0, 1) je Achse gerundet. */
function schritt(a: Punkt, b: Punkt): Punkt {
  return [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
}

/**
 * Die Flöte: vom Mund (über der Haupthand) bis zwei Pixel über die Nebenhand hinaus, zwei Pixel breit – helle Seite zum
 * Licht (links oben), dunkle dahinter, Grifflöcher auf jedem zweiten Pixel zwischen den Händen.
 */
function floete(hand: Punkt, neben: Punkt): Zeichnung {
  const z: Zeichnung = new Map();
  const [sx, sy] = schritt(hand, neben);
  const ende: Punkt = [neben[0] + 2 * sx, neben[1] + 2 * sy];
  const start: Punkt = [hand[0], hand[1] - 1];
  const stab = linie(start, ende);
  // Die dunkle Seite liegt neben der Linie, quer zur Laufrichtung (von vorn rechts daneben, im Profil dahinter).
  const quer: Punkt = Math.abs(ende[1] - start[1]) >= Math.abs(ende[0] - start[0]) ? [1, 0] : [0, 1];
  stab.forEach(([x, y], i) => {
    setze(z, x + quer[0], y + quer[1], DUNKEL);
    setze(z, x, y, i > 1 && i < stab.length - 3 && i % 2 === 0 ? LOCH : HELL);
  });
  return z;
}

/**
 * Die Laute: der Hals von der Haupthand zur Nebenhand (Saite hell darauf), am unteren Ende der Korpus – von vorn 5 × 5 mit
 * Schallloch, im Profil 3 × 5 (die Decke steht quer zum Blick) –, mit Kante.
 */
function laute(hand: Punkt, neben: Punkt, profil: boolean): Zeichnung {
  const z: Zeichnung = new Map();
  const hals = linie([hand[0], hand[1] - 1], neben);
  hals.forEach(([x, y], i) => setze(z, x, y, i === 0 ? DUNKEL : i % 2 === 0 ? SAITE : KORPUS));
  const [cx, cy] = [neben[0], neben[1] + 1];
  const breite = profil ? 1 : 2;
  for (let dy = -2; dy <= 2; dy++) {
    const rand = Math.abs(dy) === 2 ? breite - 1 : breite;
    for (let dx = -rand; dx <= rand; dx++) setze(z, cx + dx, cy + dy, dx === -rand || dy === -2 ? HELL : KORPUS);
  }
  if (!profil) setze(z, cx, cy, LOCH);
  else setze(z, cx, cy, SAITE);
  // Kante: jedes freie Nachbarpixel eines Korpuspixels.
  const korpus = [...z.entries()].filter(([, v]) => v === KORPUS || v === HELL || v === LOCH);
  for (const [k] of korpus) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (!z.has(`${nx},${ny}`) && ny > cy - 3) setze(z, nx, ny, KANTE);
    }
  }
  return z;
}

/**
 * Die Bilder eines Instruments je Körper-Frame des Musizierens (relativ zur Haupthand) und seine Clips, zwischen den Händen
 * des Körpers der Form `form` (M7-113: in `schmal` stehen die Hände je 1 px enger, in `kraeftig` weiter – die Flöte der Form
 * `mittel` ragte dort über die untere Hand hinaus bzw. endete vor ihr); Id `<id>` in `mittel`, sonst `<id>_<form>`.
 */
function instrument(basisId: string, zeichne: (hand: Punkt, neben: Punkt, richtung: Richtung) => Zeichnung | null, form: KoerperForm = 'mittel'): Sprite {
  const id = form === 'mittel' ? basisId : `${basisId}_${form}`;
  const { bilder, clips } = spielerBilderFuer({ form });
  const jeBild = new Map<number, Map<string, number>>();
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  for (const r of RICHTUNGEN) {
    const clip = clips[`musizieren_${r}`];
    if (clip === undefined) throw new Error(`${id}: Clip musizieren_${r} fehlt`);
    for (const f of new Set(clip.frames)) {
      const b: Bild | undefined = bilder[f];
      const hand = b?.sockel.hand;
      const neben = b?.sockel.nebenhand;
      if (b === undefined || hand === undefined || neben === undefined) throw new Error(`${id}: Körper-Frame ${f} ohne Hände`);
      const z = zeichne(hand, neben, r);
      const rel = new Map<string, number>();
      for (const [k, v] of z ?? []) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        const dx = x - hand[0];
        const dy = y - hand[1];
        rel.set(`${dx},${dy}`, v);
        x0 = Math.min(x0, dx);
        y0 = Math.min(y0, dy);
        x1 = Math.max(x1, dx);
        y1 = Math.max(y1, dy);
      }
      jeBild.set(f, rel);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const eindeutig = new Map<string, number>();
  const frames: { index: Uint8Array }[] = [];
  const frameVon = new Map<number, number>();
  for (const [f, rel] of jeBild) {
    const index = new Uint8Array(w * h);
    for (const [k, v] of rel) {
      const [dx, dy] = k.split(',').map(Number) as [number, number];
      index[(dy - y0) * w + (dx - x0)] = v;
    }
    const key = index.join(',');
    let i = eindeutig.get(key);
    if (i === undefined) {
      i = frames.length;
      eindeutig.set(key, i);
      frames.push({ index });
    }
    frameVon.set(f, i);
  }
  const eigeneClips: Record<string, { frames: number[]; fps: number; loop: boolean }> = {};
  for (const r of RICHTUNGEN) {
    const clip = clips[`musizieren_${r}`];
    if (clip === undefined) continue;
    const fs = clip.frames.map((f) => frameVon.get(f) ?? 0);
    eigeneClips[`musizieren_${r}`] = { frames: fs, fps: clip.fps, loop: clip.loop };
    eigeneClips[r] = { frames: [fs[0] ?? 0], fps: clip.fps, loop: true };
  }
  return spriteFromPixels(
    {
      id,
      group: 'ausruestung',
      size: [w, h],
      anchor: [-x0, -y0],
      hoehe: 'zylinder',
      clips: eigeneClips,
      occluder: { kind: 'none' },
      spiegelbar: false,
      einzelpixel: 'Grifflöcher und Saitenglanz sind einzelne Pixel auf dem Holz (beabsichtigt, wie bei den Werkzeugen)',
    },
    frames,
  );
}

const zeichneFloete = (hand: Punkt, neben: Punkt, r: Richtung): Zeichnung | null => (r === 'up' ? null : floete(hand, neben));
const zeichneLaute = (hand: Punkt, neben: Punkt, r: Richtung): Zeichnung | null => (r === 'up' ? null : laute(hand, neben, r === 'right' || r === 'left'));
const FLOETE = instrument('ausruestung_floete', zeichneFloete);
const LAUTE = instrument('ausruestung_laute', zeichneLaute);
/** Die Instrumente in den Händen der Formen `schmal` und `kraeftig` (der Renderer nimmt sie mit `formLayerSpriteId`). */
const JE_FORM = KOERPERFORMEN.filter((f) => f !== 'mittel').flatMap((form) => [instrument('ausruestung_floete', zeichneFloete, form), instrument('ausruestung_laute', zeichneLaute, form)]);

/** Die Noten über dem Kopf: Achtelnote, Doppelnote, je hell (eis.4) und verblassend (eis.2), mit dunklem Saum. */
const NOTEN = sprite({
  id: 'spieler_noten',
  group: 'figuren',
  size: [6, 7],
  anchor: [3, 6],
  hoehe: 'flach',
  legende: { '.': null, k: 'nacht.2', w: 'eis.4', b: 'eis.2' },
  frames: [
    `..kk..
     ..kwk.
     ..kwwk
     ..kwkk
     kkkwk.
     kwwwk.
     .kkk..`,
    `.kkkkk
     .kwwwk
     .kwkwk
     .kwkwk
     kkwkwk
     kwwwwk
     kkkkkk`,
    `..kk..
     ..kbk.
     ..kbbk
     ..kbkk
     kkkbk.
     kbbbk.
     .kkk..`,
    `.kkkkk
     .kbbbk
     .kbkbk
     .kbkbk
     kkbkbk
     kbbbbk
     kkkkkk`,
  ],
  clips: { achtel: { frames: [0, 2], fps: 2, loop: false }, doppel: { frames: [1, 3], fps: 2, loop: false } },
  occluder: { kind: 'none' },
  schatten: 'none',
  spiegelbar: true,
});

export default [FLOETE, LAUTE, NOTEN, ...JE_FORM];
