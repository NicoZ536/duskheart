/**
 * Grundkörper der Spielfigur mit allen Clips (M3-05 Bewegung, M3-06 Aktionen; MASTERPROMPT §4.4/§4.5,
 * docs/ART.md §3/§4): 32×32-Zelle, Körper ≈ 16×24 (Kopf 11, Rumpf 10, Beine 3), Füße auf der
 * Ankerzeile 31. Er trägt nur graues Leinen-Unterkleid und Stiefel; Tunika und Hose kommen als Layer
 * (`ausruestung_leinentunika`, `ausruestung_leinenhose`), Werkzeug, Waffe und Licht an den Sockeln.
 *
 * Clips `<aktion>_<richtung>` (down/up/right/left, jede Richtung eigens; nicht spiegelbar wegen Scheitel
 * und Händigkeit): `idle` 4 · `walk` 6 · `run` 6 · `roll` 5 · `swim` 4 (Wasserlinie) · `sneak` 6 ·
 * `jump` 4 · `tool` 4 · `hit` 2 · `death` 6 · `sit` 2 · `sleep` 2 · `eat` 4 · `drink` 4 · `carry` 6 ·
 * `carry_idle` 4 Frames, dazu die Licht-Varianten `<aktion>_licht` (idle, walk, run, sneak, tool, sit,
 * eat, drink), in denen die Nebenhand ein Licht ruhig vor bzw. neben den Körper hält (Aktionstabellen in
 * `_spieler_aktionen.ts`). Events: `schritt`, `abrollen`, `zug`, `absprung`, `landung`, `treffer`,
 * `getroffen`, `aufprall`, `biss`, `schluck`.
 *
 * Sockel je Frame: `hand` (rechte Hand: Werkzeug/Waffe), `nebenhand` (linke Hand: Licht, §12.2), `kopf`
 * (Helm), `last` (Oberkante des Kopfes: Traglast); `wasserlinie` (ein Punkt für alle Frames): Zeile, an
 * der die Schwimm-Frames abgeschnitten sind (Eintauchmaske, M5-08).
 */
import { bildPixel } from '../../lib/figure';
import { spriteFromPixels } from '../../lib/sprite';
import { spielerBilder } from './_spieler_bilder';
import { LEGENDE_BASIS } from './_spieler_farben';
import { WASSERLINIE_Y } from './_spieler_sonder';
import { spielerSockel, SPIELER_META } from './_spieler_sprite';

const { bilder, clips } = spielerBilder();

export default spriteFromPixels(
  {
    ...SPIELER_META,
    id: 'spieler_basis',
    group: 'spieler',
    clips,
    sockets: { ...spielerSockel(bilder), wasserlinie: [[16, WASSERLINIE_Y]] },
  },
  bilder.map((b) => bildPixel(b, LEGENDE_BASIS)),
);
