/**
 * Grasboden des Grünhains (M1-22, M1-29, docs/ART.md §3): 16×16, vier Varianten als Frames, die die
 * Weltgenerierung gewichtet streut (3 : 3 : 3 : 1) und waagerecht spiegelt.
 * - 0 ruhig: zwei kleine dunkle Halmgruppen weit auseinander, sonst Grundton – die Ruhefläche.
 * - 1 Lichtbüschel oben: ein Büschel heller Halme (`gras.4`, wenige Spitzen `gras.5`, AO `gras.2` am
 *   Fuß) in der oberen Hälfte, unten zwei dunkle Halmpaare.
 * - 2 Lichtbüschel unten: ein zweites, anders geschnittenes Lichtbüschel in der unteren Hälfte, rechts
 *   eine dunkle Halmgruppe und ein Halmpaar.
 * - 3 Büschel (selten): dichtes dunkles Grasbüschel mit tiefem Kern `gras.1` und hellen Spitzen, dazu
 *   ein kleines Lichtbüschel und ein Halmpaar.
 * Gegen das 16-px-Raster: Motive verschiedener Größe und Helligkeit, je Variante in anderen Zeilen und
 * Spalten, dazwischen große Flächen Grundton. Die Kachelkarte spiegelt nur waagerecht, die Zeile eines
 * Motivs bleibt also fest – deshalb sitzen die beiden großen Lichtbüschel in zwei Varianten auf
 * verschiedenen Höhen, sonst reihten sie sich im Feld zu Zeilen im 16-px-Abstand.
 * Formsprache wie beim Übergang `boden_gras_kante` (Halme = Spitze über Stiel). Alle Motive liegen
 * vollständig in der Kachel (Rand ≥ 80 % Grundton), daher passen die Varianten in jeder Anordnung
 * nahtlos aneinander (tests/unit/assets/gruenhain-basis.test.ts).
 */
import { sprite } from '../../lib/sprite';

export default sprite({
  id: 'boden_gras',
  group: 'gruenhain_basis',
  size: [16, 16],
  anchor: [0, 0],
  hoehe: 'flach',
  legende: { g: 'gras.3', d: 'gras.2', D: 'gras.1', l: 'gras.4', L: 'gras.5' },
  frames: [
    `gggggggggggggggg
     gggglggggggggggg
     gglgdglggggggggg
     ggdgdgdggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     ggggggggggglgggg
     gggggggggggdglgg
     gggggggggggggdgg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg`,
    `gggggggggggggggg
     gggggggggggggggg
     gggggggggLgggggg
     ggggggglgllglggg
     ggggggglllllLlgg
     gggggglllllllllg
     gggggggdlldlldgg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gglggggggggggggg
     ggdglggggggglggg
     ggggdgggggggdglg
     ggggggggggggggdg
     gggggggggggggggg`,
    `gggggggggggggggg
     gggggggggggggggg
     gggggggggggglggg
     ggggggggggggdglg
     ggggggggggggggdg
     gggggggggggglggg
     gggggggggglgdglg
     ggggggggggdgdgdg
     gggggggggggggggg
     gggggglggggggggg
     ggLglglLgggggggg
     gglllllllggggggg
     glllllllllgggggg
     ggdldlldlggggggg
     gggggggggggggggg
     gggggggggggggggg`,
    `gggggggggggggggg
     gggggggggglggLgg
     glggggggglLllllg
     gdglggggggdlldgg
     gggdgggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     ggggglglgglggggg
     ggggldldlgdlgggg
     ggggdddddldddggg
     ggggddDddDddddgg
     gggggdddddddgggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg
     gggggggggggggggg`,
  ],
});
