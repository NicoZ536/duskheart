/**
 * Start-Kleidung als Körper-Layer (M3-07): Leinentunika mit Ledergürtel (Slot `koerper`) und Leinenhose
 * (Slot `beine`). Beide sind pixelgenaue Auszüge aus denselben Posen wie der Grundkörper
 * `spieler_basis` – gleiche Frame-Anzahl und -Reihenfolge, gleicher Anker; der Renderer zeichnet sie mit
 * dem Frame-Index des Körpers (`src/render/anim/figure.ts`, Overlay-Layer). Jeder Layer enthält nur
 * seine Stoffpixel und die Konturpixel an deren Rand, so bleibt die Silhouette an dieser Stelle die des
 * Körpers (gleiche Zylinder-Normalen) und der Layer deckt beim Überzeichnen nichts anderes ab.
 *
 * Farbe: Kleidung `wasser` (Kleidungsfarbe der Charaktererstellung, eigene Palettenzeile je Layer
 * möglich), Gürtel `erde`. Clips: nur `idle_*` und `walk_*` zur Ansicht im Kontaktbogen – der Rig
 * verwendet ausschließlich die Frame-Indizes des Körpers.
 */
import { RICHTUNGEN, bildPixel, type FigurLegende } from '../../lib/figure';
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { spielerBilder } from '../figuren/_spieler_bilder';
import { HOSE_ZEICHEN, KONTUR, LEGENDE_HOSE, LEGENDE_TUNIKA, TUNIKA_ZEICHEN } from '../figuren/_spieler_farben';
import { SPIELER_META } from '../figuren/_spieler_sprite';

const { bilder, clips } = spielerBilder();
const ansicht = Object.fromEntries(RICHTUNGEN.flatMap((r) => [`idle_${r}`, `walk_${r}`].map((n) => [n, clips[n]]).filter((e): e is [string, NonNullable<(typeof clips)[string]>] => e[1] !== undefined)));

function layer(id: string, zeichen: ReadonlySet<string>, legende: FigurLegende): Sprite {
  return spriteFromPixels(
    {
      ...SPIELER_META,
      id,
      group: 'ausruestung',
      clips: ansicht,
      einzelpixel: 'Layer-Auszug: einzeln stehende Stoff- und Konturpixel setzen Flächen des Körpers fort und sind im Zusammenbau Teil eines Clusters (geprüft in tests/unit/assets/ausruestung-layer.test.ts)',
    },
    bilder.map((b) => bildPixel(b, legende, { zeichen, kontur: KONTUR })),
  );
}

export default [layer('ausruestung_leinentunika', TUNIKA_ZEICHEN, LEGENDE_TUNIKA), layer('ausruestung_leinenhose', HOSE_ZEICHEN, LEGENDE_HOSE)];
