/**
 * Eremitenhütte (M7-09; docs/SPIEL.md §18 "tafel"): eine niedrige Blockhütte unter einem bemoosten Strohdach mit einem Loch,
 * der kalte Steinschornstein rechts, die Tür steht einen Spalt offen, der Fensterladen ist zu. Davor die kalte Feuerstelle
 * (Aschebett, verkohlte Scheite, Steinring; flach, nicht blockierend). Hütte 2×2 (Zelle 32×50, Anker Zeile 47), Feuerstelle
 * 1×1 (16×16, Anker Zeile 14).
 */
import { ort } from './_ort';

const HUETTE = `......................aaaaa.....
                .....................a4KKK4a....
                .....................a44343a....
                .....................a44443a....
                .....................a43443a....
                ..aaaaaaaaaaaaaaaaaaaa44433aaa..
                .aCCCCCCCCCCCCCCCCCCCCCCCCCCCCa.
                aDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDa
                DDDhhhhaahhDDDDDDDDDDDDDDDDDDDDD
                DDDahhhhhhaDDhhCDCCDCDDCCCDDDDDC
                CCDaahhaahaCCahhCDDDDDCDDDCDDCCC
                CBBBBCBCBBBCBBCCCBBBBCCBCBBBBBBC
                CDDCDCDDCDDDCDDCDDCCDCCCDDCCCCDC
                DCDCDDCCDDCCCDDDDCCDDDDCDDDCCDCD
                CCDDDDCCDDDDCDDDDDCDCCCDDDDDCDDD
                BBCCBBCCBBBCBCBBBBBBCBBCCCBBBBBB
                CCDCDDDDCCCDDDCDCCCCDCCCCCDCCCCC
                DCDDCCDCCDDCDCCCDDCCDDCCDCCCCCDD
                CCCCDCCDCCCDCCDCCDCCCCCCCCCCDDDD
                BBCBBBBCaKKBBCBBBBBBBCBCCBCBBBCC
                CCCCDCCCKKKKDCDDCDCCDDDCDDCCCDCC
                CDDDCDDCaaKCDDCDDCCCCCCCCCCDCCDC
                CCCCDCDDCCCDCCDCCCDCCDCCDCCCCCCD
                CBBBCBBBCBBBBBBBCBBBCBBCBBBBBCCB
                DBBBDBDCBBBCBDCBDCBDDDBBDDBDDBDC
                BDCDBCCDCCDCBCBBDBDCBDCBBDBCDCCD
                BhBDCBDCBBCBDCBBBCBBCDBCDBBCCCBC
                BhhBCBBBBBBCBBBBBaahhBBBBBBBCBBB
                ChhhBBDBDDDDCDBDDhhhhhhCBBDCBBBD
                DDCCDBBBBBDDCDDDCahhahhhBDBBBCBD
                BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
                aBddBdBddBddBdddBdBddBdddBddBdBa
                dcaaaaaaaaaaaaaaaaaaaaaaaaaaaacc
                abbbbbbbbbbbbbbbbbbbbbbbbbbbbbba
                .aaaaaaabbbbbbaaaaaaaaaaaaaaaaa.
                adddddddaaaaaaddddabbbbbadddddda
                dccbccccaKKKbcccccacdacdaccccbcc
                abbbbbbbaKKKbcbbbbacdacdabbbbbba
                .aaaaaaaaKKKbcaaaaacdacdaaaaaaa.
                adddddddaKKKbcddddabbbbbadddddda
                dccbccccaKKKbccccccccccccccccbcc
                abbbbbbbaKKK4cbbbbbbbbbbbbbbbbba
                .aaaaaaaaKKKbcaaaaaaaaaaaaaaaaa.
                adddddddaKKKbcddddddddddddddddda
                dccbccccaKKKbccccccccccccccccbcc
                abbbbbbbaKKKbcbbbbbbbbbbbbbbbbba
                .aaaaaaaaKKKbcaaaaaaaaaaaaaaaaa.
                .........kkkkk..................
                ................................
                ................................`;

const FEUERSTELLE = `................
                     ......11........
                     ..11.1451.11....
                     .145113411451...
                     .134111111341...
                     .1111nnnnnn111..
                     1451aa111111451.
                     134n1Ka111ab341.
                     .11n11KaaK11n1..
                     ..1n11aKKa11n1..
                     .1451aK11Ka451..
                     .134a145111341..
                     ..1111341..11...
                     ......11........
                     ................
                     ................`;

export default [
  ort({ id: 'huette', size: [32, 50], anchor: [16, 47], hoehe: 'block', frames: [HUETTE], occluder: { kind: 'rect', x: 1, y: 9, w: 30, h: 38 }, material: { dach: 'BCDh' } }),
  ort({ id: 'feuerstelle', size: [16, 16], anchor: [8, 14], hoehe: 'flach', frames: [FEUERSTELLE], occluder: { kind: 'none' }, einzelpixel: 'helle Aschenflocken im Aschebett' }),
];
