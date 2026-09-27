/**
 * Dächer T0–T1 (M4-12/M4-13, docs/SPIEL.md §8, MASTERPROMPT §16.2): `bau_dach_stroh`, `bau_dach_schindel`,
 * `bau_dach_glas` – je 16 Masken × Vorderseite, Firstreihe, Rückseite und Schnitt (Vertrag in `_bau.ts`).
 * Alle Pixel tragen das Materialflag `dach` (Kreis-Ausblendung um den Spieler, M4-27/M5-18).
 * - **Stroh:** Halmbündel in Lagen, die hellen Halmenden hängen gewellt über die dunkle Fuge der Lage
 *   darunter; First als gebundene Lehmwulst mit Holznägeln, dicke Traufe aus Halmenden.
 * - **Schindel:** Holzschindeln in `erde` (warmes Pflaumenbraun, hebt sich von Holzwänden ab), Lagen mit
 *   versetzten Stoßfugen, jede Unterkante heller als der Schatten der Lage darüber; Firstbrett und
 *   Stirnbretter aus Holz.
 * - **Glas:** Scheiben (`eis`, Glanzflag `nass`) mit schrägem Himmelsreflex zwischen Holzsprossen; die
 *   Rückseite ist dunkler (spiegelt weniger Himmel), First als Holzbalken.
 * Rückseiten haben engere, dunklere Lagen als Vorderseiten (Blick streift sie flacher).
 */
import { dachSprite } from './_bau';

const stroh = dachSprite({
  id: 'bau_dach_stroh',
  stil: { kontur: 'q', fuss: 'q' },
  muster: {
    sued: `BBCBBBCBBBBECBBB
           CCDCCDCCCDCCDCCC
           DCDDCDDCDDCDDCDD
           DDEDDCDEDDDEDDCD
           EDEEDEEDEEEDEEDE
           BEBBBBCCEBBBBCEB
           CCDCCDCCCDCCDCCD
           DCDDCDDCDDCDDCDD
           DDCDDDDCDDDCDDDC
           DEDDEDDDEDDDEDDE
           EEDEEEEDEEDEEEEE
           BBEBCBBBBEBCBBEB
           CDCCCDCCDCCCDCCC
           DDCDDDCDDCDDDCDD
           DEDDEDDDEDDEDDED
           EEEDEEEEEEDEEEED`,
    nord: `ABBAABBBABBAABBB
           BCBBCBBCBBCBBCBB
           CBCCBCCBCCBCCBCC
           CCDCCCDCCCCDCCDC
           ABBBABBBBABBBABB
           BCBBBCBBCBBBCBBC
           CCBCCCBCCCBCCCBC
           CDCCDCCCDCCDCCCD
           BABBBBABBBBABBBA
           BBCBBCBBBCBBCBBB
           CBCCBCCBCCBCCBCC
           CCDCCCCDCCCDCCCD
           ABBABBBABBABBBAB
           BCBBCBBBCBBCBBCB
           CCBCCBCCCBCCBCCB
           CDCCDCCDCCCDCCDC`,
    first: `ABBAABBBABBAABBB
            BCBBCBBCBBCBBCBB
            CBCCBCCBCCBCCBCC
            CCDCCCDCCCCDCCDC
            qqqqqqqqqqqqqqqq
            rrsrbrsrrrbrsrrr
            sststcsttsctstss
            rsrrbrrsrrbrrsrr
            qrqqqqrqqqqqrqqq
            BqBBBBqBBBqBBBqB
            CCDCCDCCCDCCDCCD
            DCDDCDDCDDCDDCDD
            DDCDDDDCDDDCDDDC
            DEDDEDDDEDDDEDDE
            EEDEEEEDEEDEEEEE
            EEEDEEEEEEDEEEED`,
    traufe: `DCDDCDDDCDDCDDDC
             BABBABBBABBABBBA`,
    ortgang: `qCB
              qDB
              qCB
              qCC
              qDB
              qCB
              qDB
              qCC
              qCB
              qDB
              qCB
              qCC
              qDB
              qCB
              qDB
              qCC`,
  },
});

const schindel = dachSprite({
  id: 'bau_dach_schindel',
  stil: { kontur: 'p', fuss: 'p' },
  muster: {
    sued: `qqqqqqqqqqqqqqqq
           rrrqrrrrqrrrrqrr
           srsqssrsqssrsqss
           tstqttstqtsttqts
           qqqqqqqqqqqqqqqq
           qrrrrqrrrrqrrrrr
           qssrsqsrssqssrss
           qtsttqtstsqttsts
           qqqqqqqqqqqqqqqq
           rrqrrrrrqrrrrqrr
           rsqsrssrqssrsqss
           stqtsttsqtstsqtt
           qqqqqqqqqqqqqqqq
           rrrrqrrrrrqrrrrq
           ssrsqsrssrqsrssq
           tsttqttsttqtstsq`,
    nord: `pppppppppppppppp
           rrrrprrrrrprrrrr
           srsspssrsspsssrs
           pppppppppppppppp
           rrprrrrrprrrrprr
           sspsrssspsrsspss
           pppppppppppppppp
           rrrrrprrrrrprrrr
           srssspssrsspssrs
           pppppppppppppppp
           rprrrrrprrrrrprr
           spssrsspsssrspss
           pppppppppppppppp
           rrrrprrrrrrprrrr
           ssrspsssrsspssrs
           sssspsssssspssss`,
    first: `pppppppppppppppp
            rrrrprrrrrprrrrr
            srsspssrsspsssrs
            pppppppppppppppp
            rrprrrrrprrrrprr
            aaaaaaaaaaaaaaaa
            ccdcccccdcccccdc
            dddeddddddeddddd
            bbbbcbbbbbbcbbbb
            aaaaaaaaaaaaaaaa
            qqqqqqqqqqqqqqqq
            rrrqrrrrqrrrrqrr
            rrsqsrrsqssrsqsr
            srsqssrsqssrsqss
            tstqttstqtsttqts
            tttqtttsqttttqtt`,
    traufe: `cdccccdcccccdccc
             bbbbbbbbbbbbbbbb`,
    ortgang: `pcb
              pdb
              pcb
              pcb
              pdb
              pcb
              pcb
              pdb
              pcb
              pcb
              pdb
              pcb
              pcb
              pdb
              pcb
              pcb`,
  },
});

const glas = dachSprite({
  id: 'bau_dach_glas',
  stil: { kontur: 'a', fuss: 'a', material: { nass: '7890#' } },
  muster: {
    sued: `cbbbbbbbcbbbbbbb
           b8888900b8888990
           b8889008b8889008
           b8890088b8890088
           b8900888b8900888
           b9008888b9008888
           b0088888b0088888
           b7788888b7778888
           cbbbbbbbcbbbbbbb
           b8888990b8888900
           b8889008b8889008
           b8890088b8890088
           b8900888b8900888
           b9008888b9008888
           b0088888b0088888
           b7778888b7788888`,
    nord: `cbbbbbbbcbbbbbbb
           b7777887b7777788
           b7778877b7778877
           b7788777b7788777
           b7887777b7887777
           b8877777b8877777
           b7777777b7777777
           cbbbbbbbcbbbbbbb
           b7777887b7777887
           b7778877b7778877
           b7788777b7788777
           b7887777b7887777
           b8877777b8877777
           b7777777b7777777
           b7777777b7777777
           b7777777b7777777`,
    first: `cbbbbbbbcbbbbbbb
            b7777887b7777788
            b7778877b7778877
            b7788777b7788777
            b7887777b7887777
            aaaaaaaaaaaaaaaa
            ccdcccccdcccccdc
            dddeddddddeddddd
            bbbbcbbbbbbcbbbb
            aaaaaaaaaaaaaaaa
            b8889008b8889908
            b8890088b8890088
            b8900888b8900888
            b9008888b9008888
            b0088888b0088888
            b7788888b7778888`,
    traufe: `cdccccdcccccdccc
             bbbbbbbbbbbbbbbb`,
    ortgang: `acb
              adb
              acb
              acb
              adb
              acb
              acb
              adb
              acb
              acb
              adb
              acb
              acb
              adb
              acb
              acb`,
  },
});

export default [stroh, schindel, glas];
