/**
 * Tileset Trockengraben (M4-36, docs/ART.md §3, docs/WORLD.md §7): ein mit der Schaufel ausgehobener
 * Graben in Erde, meist eine Kachel breit. Er liegt über jedem Boden außer Schnee und zeichnet seinen
 * Anschnitt deshalb selbst (`TERRAIN_REIHENFOLGE`, src/world/autotile.ts); außen bleibt der Nachbarboden.
 * Vertieft liest er sich über die 3/4-Sicht, nicht über gemalte Richtungsschatten:
 * - Nordkante: Man sieht die Nordwand des Grabens von vorn – oben die dunkle Humuskante `erde.1` unter der
 *   Narbe, darunter die Wandfront, oben hell `erde.3` (sie sieht den Himmel), dann `erde.2`; ihr Fuß läuft
 *   gebuchtet in die Sohle (stellenweise eine Reihe länger oder kürzer), Wurzelfäden (`holz.2`, Spitze
 *   `holz.1`) hängen aus der Narbe über die Front.
 * - Seiten: schmale Wände, nur die Kontur `erde.0`, stellenweise doppelt.
 * - Südkante: Die Sohle verschwindet unter der Lippe des Vorderbodens – Schattenkante `erde.0`,
 *   stellenweise doppelt.
 * - Sohle: liegt tiefer und bekommt weniger Himmel als der Pfad daneben (`erde.2`): Grundton `erde.1`,
 *   große ruhige Flächen, dazu ein Spatenstich (`erde.0` unter heller Stichkante `erde.2`),
 *   seltener eine abgebrochene Scholle (Kappe `erde.3`, Körper `erde.2`, Fuß `erde.0`) mit Kiesel (`stein`)
 *   und ganz selten ein angestochener Wurzelstrang (`holz`) – die Motive je Variante in einem anderen Viertel.
 * Kantenstücke: `GEOMETRIE_ANSCHNITT` – gerade Spatenkanten mit ausgebrochenen Schollen, kleine Ecken.
 */
import { blobTileset, type KantenGeometrie } from '../../lib/blob';
import { GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { d: 'erde.1', D: 'erde.0', e: 'erde.2', E: 'erde.3', s: 'stein.2', S: 'stein.3', r: 'holz.1', R: 'holz.2' } as const;

const VARIANTEN = varianten('graben', LEGENDE, [
  // 0 ruhig: glatt gestochene, leere Sohle – die häufigste Kachel trägt kein Motiv, damit langen Gräben kein
  // 16-px-Raster aus gleichen Dellen entsteht (docs/ART.md §3).
  `dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd`,
  // 1 ruhig: ein Spatenstich oben links – dunkle Kerbe unter heller Stichkante – und ein Krümel.
  `dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   ddddeeeddddddddd
   dddddDDDDddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddEEddd
   ddddddddddeeeddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd`,
  // 2 Scholle und Kiesel: eine abgebrochene Scholle unten links, ein Kiesel mit Schattenfuß oben rechts.
  `dddddddddddddddd
   dddddddddddddddd
   ddddddddddSSdddd
   dddddddddSSssddd
   dddddddddsssssdd
   ddddddddddDDDDdd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddEEEdddddddddd
   ddeeeEEddddddddd
   ddeeeeeddddddddd
   dddDDDDddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd`,
  // 3 selten: ein angestochener Wurzelstrang quert die Sohle, Oberseite holz.2, Unterseite holz.1; ein Krümel.
  `dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   ddRRRddddddddddd
   ddrrRRRRdddddddd
   ddddrrrRRRdddddd
   dddddddrrrRRdddd
   ddddddddddrrdddd
   dddddddddddddddd
   dddddddddddddddd
   dddddddddddddddd
   ddddddddddddeedd
   dddddddddddDDddd
   dddddddddddddddd`,
]);

/**
 * Anschnitt: Spatenkanten laufen gerade (Einzug 3) und brechen in Läufen von 3 px um eine Reihe aus
 * (docs/ART.md §2.5); Außenecken klein gerundet, Innenecken eher kantig (ein Spaten sticht gerade). Mit
 * Einzug 3 ist ein einfacher Graben 10 px breit: Wandfront, Sohle und Schattenkante haben Platz.
 */
const GEOMETRIE_ANSCHNITT: KantenGeometrie = {
  profile: {
    n: [
      [3, 3, 3, 3, 2, 2, 2, 3, 3, 3, 4, 4, 4, 3, 3, 3],
      [3, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 3, 3, 3, 3],
      [3, 3, 3, 3, 3, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 3],
    ],
    s: [
      [3, 3, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2, 2, 3, 3, 3],
      [3, 3, 3, 2, 2, 2, 3, 3, 3, 4, 4, 4, 3, 3, 3, 3],
    ],
    w: [
      [3, 3, 3, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 3, 3, 3],
      [3, 3, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 3, 3, 3],
    ],
    o: [
      [3, 3, 3, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 3, 3, 3],
      [3, 3, 3, 3, 3, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 3],
    ],
  },
  eckenRadien: [2, 3],
  innenFormen: [2.4, 3],
};

/** Stellen entlang der Nordkante (je Maske versetzt), an denen ein Wurzelfaden aus der Narbe über die Wandfront hängt. */
function wurzelfaden(maske: number, entlang: number): boolean {
  return entlang >= 4 && entlang <= 11 && (maske * 5 + entlang * 3) % 13 === 0;
}

/**
 * Wo die Wandfront kürzer ist (drei Pixel in Folge, je Maske verschoben): Der Fuß der Wand läuft so gebuchtet
 * statt als gerades Band in die Sohle (docs/ART.md §2.3 „Kein Banding“); die längeren Stellen setzt `breiter`.
 */
function kurzeFront(maske: number, entlang: number): boolean {
  const start = 6 + (maske % 3);
  return entlang >= start && entlang < start + 3;
}

export default blobTileset({
  id: 'tileset_graben',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_ANSCHNITT,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'erde.1',
  fuellung: 'motive',
  faerbung: bandFaerbung(
    {
      baender: { n: ['erde.1', 'erde.3', 'erde.2', 'erde.2'], s: ['erde.0'], w: ['erde.0'], o: ['erde.0'] },
      breiter: {
        n: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0],
        s: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0],
        w: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        o: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
      },
    },
    (p) => {
      if (!p.innen || p.seite !== 'n') return undefined;
      if (wurzelfaden(p.maske, p.entlang) && (p.tiefe === 1 || p.tiefe === 2)) return 'holz.2';
      if (wurzelfaden(p.maske, p.entlang) && p.tiefe === 3) return 'holz.1';
      if (p.tiefe === 3 && kurzeFront(p.maske, p.entlang)) return 'erde.1';
      return undefined;
    },
  ),
});
