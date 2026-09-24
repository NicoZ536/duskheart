/**
 * Angezogene Spielfigur, nur Idle (M1-22, seit M3-05 aus dem Figuren-Rig): Grundkörper, Leinentunika und
 * Leinenhose in einem Raster – dieselben Pixel, die der Renderer aus `spieler_basis` +
 * `ausruestung_leinentunika` + `ausruestung_leinenhose` zusammensetzt. Szenen ohne Ausrüstungs-Rig
 * (Welt-Vorschau, Titelbild, Debug-Szenen) zeigen damit die Figur im Startzustand.
 *
 * 32×32-Zelle, Körper 16×24 (Kopf 11, Rumpf 10, Beine 3), jede Richtung eigens gezeichnet (Scheitel zur
 * linken Kopfseite, `spiegelbar: false`). Idle-Atmung als Welle (Kopf sinkt vor, Rumpf folgt, Kopf hebt
 * sich, während der Rumpf noch unten ist), Ruhe- und Tiefpunkt je drei Bilder: 4 Frames, 8 Bilder je
 * Zyklus bei 8 fps = 1 s. Sockel je Frame: `hand` (rechte Hand, Waffe), `nebenhand` (linke Hand, Licht
 * §12.2), `kopf` (Helm), `last`.
 */
import { RICHTUNGEN, bildPixel, type Bild } from '../../lib/figure';
import { spriteFromPixels } from '../../lib/sprite';
import { spielerBilder, type SpielerClip } from './_spieler_bilder';
import { LEGENDE_ANGEZOGEN } from './_spieler_farben';
import { spielerSockel, SPIELER_META } from './_spieler_sprite';

const { bilder, clips } = spielerBilder();

const frames: Bild[] = [];
const idleClips: Record<string, SpielerClip> = {};
for (const r of RICHTUNGEN) {
  const clip = clips[`idle_${r}`];
  if (clip === undefined) throw new Error(`spieler_koerper: Clip idle_${r} fehlt`);
  const eigene = [...new Set(clip.frames)];
  const start = frames.length;
  for (const f of eigene) {
    const b = bilder[f];
    if (b === undefined) throw new Error(`spieler_koerper: Frame ${f} fehlt`);
    frames.push(b);
  }
  idleClips[`idle_${r}`] = { ...clip, frames: clip.frames.map((f) => start + eigene.indexOf(f)) };
}

export default spriteFromPixels(
  { ...SPIELER_META, id: 'spieler_koerper', group: 'figuren', clips: idleClips, sockets: spielerSockel(frames) },
  frames.map((b) => bildPixel(b, LEGENDE_ANGEZOGEN)),
);
