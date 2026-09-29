/**
 * Fenster T1 (M4-12/M4-13, docs/SPIEL.md §8): `bau_fenster_offen`, `bau_fenster_glas`, `bau_fenster_buntglas` –
 * Wandelemente mit eigener Holzzarge wie die Türen (passen in jede Wand), Frames und Clips nach dem Vertrag in
 * `_bau.ts`:
 * 0 in einer Ost-West-Wand, 1 in einer Nord-Süd-Wand, 2/3 dieselben mit erleuchtetem Raum dahinter, 4 die
 * auf 4 px gekappte Brüstung (Schnitt, Blick ins Haus).
 *
 * Unter der Fensteröffnung liegt eine Brüstung aus Stülpschalung, darüber der Sturz, dessen Oberseite in
 * der Kappenzeile der Nachbarwände weiterläuft. In einer Nord-Süd-Wand sieht man von oben nur Sturz und
 * Scheibenkante (bzw. die Öffnung) als Linie im Kappenband.
 * - **Öffnung:** Fensterloch mit aufgeklappten Läden links und rechts; dahinter das Dunkel des Raums
 *   (oben tiefer, unten die Fensterbank). Erleuchtet glüht die Öffnung warm (Feuerschein, emissiv).
 * - **Glas:** Kreuzsprossen, vier Scheiben mit schrägem Himmelsreflex (Glanzflag `nass`); erleuchtet
 *   leuchten die Scheiben warm, die Sprossen bleiben dunkel.
 * - **Buntglas** (§16.2 "Buntglas"): eine Raute aus blauem Glas in Kupferruten (dunkle Sprossen), in den
 *   Ecken rotes, goldenes und grünes Glas, glänzend (`nass`); erleuchtet leuchtet jede Scheibe in ihrer eigenen
 *   Farbe, die Mitte am hellsten. Das farbige Licht auf dem Boden des Raums zeichnet die Lichtstufe (M5-05): die
 *   Scheiben fallen 1 : 1 auf den Boden, deshalb trägt das größte Feld – die Raute – das Blau, dessen Licht auf
 *   warmen Dielen am schwersten zu lesen ist (M5-68; als Ecke gab es nur einen 2 × 2-px-Fleck).
 */
import { tausche, ueberlagere } from '../platzierbar/_bild';
import { AUFRECHT_ANKER, AUFRECHT_ZELLE, bauSprite, rasterFrame, schnittRaster, tabellenClips, type Stil } from './_bau';

/** Zusatzzeichen: Glut im erleuchteten Fenster (emissiv) und Scheiben. */
const FENSTER_LEGENDE = { '-': 'holz.1', '*': 'feuer.2*', '+': 'feuer.3*', '@': 'feuer.4*', '$': 'sand.4*' } as const;
const STIL: Stil = { kontur: 'a', legende: FENSTER_LEGENDE, material: { nass: '890#' } };

/**
 * Buntglas: rot, blau, grün, gold (glänzend) und dieselben Farben emissiv für den erleuchteten Raum – dieselben
 * Palettenfarben, damit das Sprite unter 12 Farben bleibt; die hellste Mitte `&` (das hellere Blau der Raute).
 */
const BUNT_LEGENDE = { ...FENSTER_LEGENDE, '<': 'feuer.2', '>': 'wasser.3', '^': 'gras.3', '=': 'sand.3', '{': 'feuer.2*', '}': 'wasser.3*', '|': 'gras.3*', '!': 'sand.3*', '&': 'wasser.4*' } as const;
const BUNT_STIL: Stil = { kontur: 'a', legende: BUNT_LEGENDE, material: { nass: '<>^=' } };

/** Brüstung, Zarge und Sturz in einer Ost-West-Wand; Öffnung (Zeilen 13–19, x 3–12) frei. */
const RAHMEN = `................
                ................
                ................
                ................
                ................
                aaaaaaaaaaaaaaaa
                ccdcccccccdccccc
                dddddeddddddeddd
                ddeddddddedddddd
                cddddddddddddddc
                cddddddddddddddc
                bbbbbbbbbbbbbbbb
                cbaaaaaaaaaaaabc
                cbba........abbc
                cbba........abbc
                cbba........abbc
                cbba........abbc
                cbba........abbc
                cbba........abbc
                cbba........abbc
                eeeeeeeeeeeeeeee
                bbbbbbbbbbbbbbbb
                ddddddddddddddcd
                ccccbcccccccbccc
                ddcddddddddddddd
                bcccccccbccccccc
                kkkkkkkkkkkkkkkk
                ................
                ................
                ................
                ................
                ................`;

/** Nord-Süd-Wand: Sturz von oben als Kappenband, darin die Kante des Fensters. */
const SEITE = `.....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               .....acddca.....
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................
               ................`;

function oeffnung(innen: string): string {
  const zeilen = innen
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
  const leer = '................';
  return [...Array.from({ length: 13 }, () => leer), ...zeilen.map((z) => `....${z}....`), ...Array.from({ length: 32 - 13 - zeilen.length }, () => leer)].join('\n');
}

/** Öffnung: Dunkel des Raums, aufgeklappte Läden auf der Brüstung links und rechts. */
const OFFEN_INNEN = oeffnung(`KKKKKKKK
                              KKKKKKKK
                              KKKKKKKK
                              KKKKKKKK
                              kKKKKKKk
                              kkKKKKkk
                              kkkkkkkk`);

const LAEDEN = `................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                aa............aa
                da............ad
                -a............a-
                da............ad
                da............ad
                -a............a-
                da............ad
                da............ad
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................
                ................`;

const OFFEN_LICHT = oeffnung(`++++++++
                              +@@@@@@+
                              +@@$$@@+
                              +@@$$@@+
                              +@@@@@@+
                              *++++++*
                              ********`);

/** Glas: Kreuzsprosse, Himmelsreflex schräg. */
const GLAS_INNEN = oeffnung(`88090b88
                             8090b988
                             090bb888
                             bbbbbbbb
                             888b8809
                             888b8090
                             88bb0908`);

const GLAS_LICHT = oeffnung(`@@$$b@@@
                             @$$@b@@@
                             $$@@b@@+
                             bbbbbbbb
                             @@@b@@$+
                             @@+b@$$+
                             ++bb++++`);

/** Buntglas: blaue Raute in Kupferruten, rote, goldene und grüne Ecken. */
const BUNT_INNEN = oeffnung(`<<<bb===
                             <<b>>b==
                             <b>>>>b=
                             b>>>>>>b
                             ^b>>>>b<
                             ^^b>>b<<
                             ^^^bb<<<`);

const BUNT_LICHT = oeffnung(`{{{bb!!!
                             {{b}}b!!
                             {b}&&}b!
                             b}&&&&}b
                             |b}&&}b{
                             ||b}}b{{
                             |||bb{{{`);

/** Ersetzt im Sturzband der Nord-Süd-Wand die Zeilen 3–12 (Fensterbreite) durch `mitte`. */
function seitenFenster(mitte: string): string {
  return SEITE.split('\n')
    .map((z, y) => (y >= 3 && y <= 12 ? z.replace('acddca', mitte) : z))
    .join('\n');
}

/** Nord-Süd-Wand: Scheibenkante bzw. Öffnung als Linie im Sturzband, oben und unten der Sturz. */
const SEITE_GLAS = seitenFenster('ac99ca');
const SEITE_OFFEN = seitenFenster('acKKca');
const SEITE_BUNT = seitenFenster('ac<>ca');

function fenster(id: string, innen: string, licht: string, seite: string, seiteLicht: string, laeden: boolean, stil: Stil = STIL): ReturnType<typeof bauSprite> {
  const sued = (i: string): string => {
    const r = ueberlagere(RAHMEN, i);
    return laeden ? ueberlagere(r, LAEDEN) : r;
  };
  return bauSprite(
    {
      id,
      size: AUFRECHT_ZELLE,
      anchor: AUFRECHT_ANKER,
      hoehe: 'flach',
      clips: tabellenClips({ sued: [0], seite: [1], sued_licht: [2], seite_licht: [3], schnitt: [4] }),
      occluder: { kind: 'sprite' },
      schatten: 'silhouette',
    },
    [sued(innen), seite, sued(licht), seiteLicht, schnittRaster(sued(innen))].map((r) => rasterFrame(stil, r, AUFRECHT_ZELLE)),
  );
}

const offen = fenster('bau_fenster_offen', OFFEN_INNEN, OFFEN_LICHT, SEITE_OFFEN, tausche(SEITE_OFFEN, { K: '@' }), true);
const glas = fenster('bau_fenster_glas', GLAS_INNEN, GLAS_LICHT, SEITE_GLAS, tausche(SEITE_GLAS, { '9': '$' }), false);
const buntglas = fenster('bau_fenster_buntglas', BUNT_INNEN, BUNT_LICHT, SEITE_BUNT, tausche(SEITE_BUNT, { '<': '{', '>': '}' }), false, BUNT_STIL);

export default [offen, glas, buntglas];
