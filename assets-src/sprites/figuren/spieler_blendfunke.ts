/**
 * Blendfunken am Kopf des geblendeten Spielers (M6-Gate, zustand-geblendet; ADR-0173 Blendfunken der Kreaturen, die
 * Darstellung in src/render/game/playerFigure.ts `PLAYER_DAZZLE`): die Funkenkreuze der Kreaturen (`kampf_zustand`, Clip
 * `blendung`, assets-src/sprites/kampf/zustaende.ts) mit einem tiefblauen Rand (`wasser.2`, nicht emissiv) um jedes Pixel.
 *
 * Die Kreaturfunken sind blassblau (`eis.2*`–`eis.4*`) und leuchten: über dem Kopf einer Kreatur stehen sie vor Laub,
 * Fels oder Nacht. Der Spieler steht oft auf hellem Sand – dort lagen die Funken mit ihrem Bloom-Hof als blasser Fleck auf
 * gleich hellem Grund (Luma ≈ 230 gegen ≈ 190). Der Rand trägt das Zeichen auf hellem Grund (Luma ≈ 75), nachts bleibt er
 * dunkel und das Kreuz leuchtet wie bei den Kreaturen. Form, Farben des Kerns und Takt bleiben die der Kreaturfunken: die
 * Bilder entstehen aus ihnen, ein Kreuz wird um einen Pixel Rand größer (5 × 5 → 7 × 7, Anker in der Mitte).
 */
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { paletteIndex } from '../../palette';
import zustaende from '../kampf/zustaende';

/** Clip der Blendfunken im Sprite der Kampfzeichen. */
const QUELLE_CLIP = 'blendung';
/** Farbe des Rands (tiefes Wasserblau: blau wie der Funke, dunkel genug für Sand und Schnee). */
const RAND = paletteIndex('wasser.2');
/** Breite des Rands [px]. */
const RAND_PX = 1;

const quelle: Sprite = zustaende;
const clip = quelle.clips[QUELLE_CLIP];
if (clip === undefined) throw new Error(`spieler_blendfunke: ${quelle.id} hat keinen Clip ${QUELLE_CLIP}`);
const w = quelle.w + 2 * RAND_PX;
const h = quelle.h + 2 * RAND_PX;

/** Ein Funkenbild mit Rand: die Pixel um `RAND_PX` versetzt, jedes leere Pixel neben einem Funkenpixel (4er-Nachbarschaft) wird Rand. */
function mitRand(f: number): { index: Uint8Array; emissive: Uint8Array; material: Uint8Array } {
  const src = quelle.frames[f];
  if (src === undefined) throw new Error(`spieler_blendfunke: Frame ${f} fehlt in ${quelle.id}`);
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

const sprite: Sprite = spriteFromPixels(
  {
    id: 'spieler_blendfunke',
    group: 'spieler',
    size: [w, h],
    anchor: [quelle.anchor[0] + RAND_PX, quelle.anchor[1] + RAND_PX],
    hoehe: quelle.hoehe,
    clips: { [QUELLE_CLIP]: { frames: clip.frames.map((_, i) => i), fps: clip.fps, loop: clip.loop, events: [] } },
    schatten: 'none',
    occluder: { kind: 'none' },
    spiegelbar: true,
    einzelpixel: 'Die Spitzen des schrägen Funkenkreuzes sind einzelne Pixel im Rand',
  },
  clip.frames.map(mitRand),
);

export default sprite;
