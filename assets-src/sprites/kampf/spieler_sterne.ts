/**
 * Sterne über dem Kopf des betäubten Spielers (M7-69; ADR-0173 Sterne der Kreaturen; die Darstellung in
 * src/render/game/statusMarks.ts `HeadStars`): die Sterne der Kreaturen (`kampf_zustand`, Clips `stern` und `stern_fern`,
 * assets-src/sprites/kampf/zustaende.ts) mit einem Rand in der dunkelsten Stufe ihrer Rampe (`feuer.0`, nicht emissiv) um
 * jedes Pixel – wie die Blendfunken des Spielers (assets-src/sprites/figuren/spieler_blendfunke.ts).
 *
 * Die Kreatursterne sind hellgelb mit weißem Kern und leuchten: über dem Kopf einer Kreatur stehen sie vor Laub, Fels oder
 * Nacht. Der Spieler steht oft auf hellem Sand – dort verschwanden sie im Bild `zustand-betaeubt` als blasse Flecken auf
 * gleich hellem Grund (der hintere, matte Stern ganz). Der dunkle Rand trägt das Zeichen auf Sand und Schnee, auf Gras setzt
 * er die Sterne ab; nachts bleibt er dunkel und der Stern leuchtet wie bei den Kreaturen. Form, Farben des Kerns und Takt
 * bleiben die der Kreatursterne: die Bilder entstehen aus ihnen, ein Stern wird um einen Pixel Rand größer (5 × 5 → 7 × 7,
 * Anker in der Mitte).
 */
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { paletteIndex } from '../../palette';
import zustaende from './zustaende';

/** Clips der Sterne im Sprite der Kampfzeichen (vorn, hinten). */
const QUELLE_CLIPS = ['stern', 'stern_fern'] as const;
/** Farbe des Rands: die dunkelste Stufe der Rampe der Sterne (ART §2.4, Kontur aus der dunkelsten Rampenstufe). */
const RAND = paletteIndex('feuer.0');
/** Breite des Rands [px]. */
const RAND_PX = 1;

const quelle: Sprite = zustaende;
const w = quelle.w + 2 * RAND_PX;
const h = quelle.h + 2 * RAND_PX;

/** Ein Sternbild mit Rand: die Pixel um `RAND_PX` versetzt, jedes leere Pixel neben einem Sternpixel (4er-Nachbarschaft) wird Rand. */
function mitRand(f: number): { index: Uint8Array; emissive: Uint8Array; material: Uint8Array } {
  const src = quelle.frames[f];
  if (src === undefined) throw new Error(`spieler_sterne: Frame ${f} fehlt in ${quelle.id}`);
  const index = new Uint8Array(w * h);
  const emissive = new Uint8Array(w * h);
  const material = new Uint8Array(w * h);
  for (let y = 0; y < quelle.h; y++) {
    for (let x = 0; x < quelle.w; x++) {
      const p = y * quelle.w + x;
      const q = (y + RAND_PX) * w + x + RAND_PX;
      index[q] = src.index[p] ?? 0;
      emissive[q] = src.emissive[p] ?? 0;
      material[q] = src.material[p] ?? 0;
    }
  }
  const voll = index.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (voll[y * w + x] !== 0) continue;
      const nachbar = (x > 0 && voll[y * w + x - 1] !== 0) || (x < w - 1 && voll[y * w + x + 1] !== 0) || (y > 0 && voll[(y - 1) * w + x] !== 0) || (y < h - 1 && voll[(y + 1) * w + x] !== 0);
      if (nachbar) index[y * w + x] = RAND;
    }
  }
  return { index, emissive, material };
}

/** Die Quellbilder beider Clips hintereinander und die Clips auf ihre neuen Bildnummern. */
const bilder: number[] = [];
const clips: Record<string, { frames: number[]; fps: number; loop: boolean; events: [] }> = {};
for (const name of QUELLE_CLIPS) {
  const clip = quelle.clips[name];
  if (clip === undefined) throw new Error(`spieler_sterne: ${quelle.id} hat keinen Clip ${name}`);
  clips[name] = { frames: clip.frames.map((_, i) => bilder.length + i), fps: clip.fps, loop: clip.loop, events: [] };
  bilder.push(...clip.frames);
}

const sprite: Sprite = spriteFromPixels(
  {
    id: 'spieler_sterne',
    group: 'spieler',
    size: [w, h],
    anchor: [quelle.anchor[0] + RAND_PX, quelle.anchor[1] + RAND_PX],
    hoehe: quelle.hoehe,
    clips,
    schatten: 'none',
    occluder: { kind: 'none' },
    spiegelbar: true,
    einzelpixel: 'Die Spitzen der Sterne und ihr Funkelkern sind einzelne Pixel im Rand',
  },
  bilder.map(mitRand),
);

export default sprite;
