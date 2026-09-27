/**
 * Wände T0–T1 (M4-12/M4-13, docs/SPIEL.md §8, MASTERPROMPT §16.2): `bau_wand_palisade`, `bau_wand_holz`,
 * `bau_wand_fachwerk`, `bau_wand_stein` – dünne Wände mit Autoverbindung (16 Masken × 2 Fassungen +
 * Schnitt, Vertrag in `_bau.ts`). Jedes Material hat eine eigene Silhouette und Formsprache, damit die
 * Stufe auf einen Blick lesbar ist:
 * - **Palisade** (Stroh/Palisade, T0): senkrechte Stämme mit angespitzten, hell angeschnittenen Köpfen,
 *   Erde am Fuß – gezackte Oberkante.
 * - **Holz** (T0): Blockhaus aus liegenden, behauenen Stämmen mit Lehm in den Fugen, an Ecken und Enden
 *   die runden Stammköpfe; flache Oberkante.
 * - **Fachwerk** (T1): dunkles Balkenwerk (Rähm, Ständer, Riegel, Strebe) mit hellem Lehmputz auf
 *   einem Steinsockel.
 * - **Stein** (T1): Bruchsteinmauer in ungleich hohen Lagen mit versetzten Stoßfugen, Eckquader an
 *   Ecken und Enden, Moos in einer Fuge; helle Abdecksteine.
 * Schattierung nach Himmelsöffnung: Oberseiten hell, Unterkanten und Fugen dunkel, Fuß mit Bodenkontakt
 * `nacht.1`; kein Richtungslicht.
 */
import { wandSprite, type Stil } from './_bau';

const HOLZ_STIL: Stil = { kontur: 'a' };

/** Palisade: eigene Zeichen für die angespitzten Köpfe (`^` Anschnitt hell, `/` Anschnitt, `|` Kontur). */
const PALISADE_STIL: Stil = {
  kontur: 'a',
  legende: { '^': 'holz.4', '/': 'holz.3', '|': 'holz.0' },
  ohneKontur: '^/|',
};

const palisade = wandSprite({
  id: 'bau_wand_palisade',
  stil: PALISADE_STIL,
  schnitt: true,
  muster: {
    // Köpfe: je Stamm ein Keil, verschieden hoch; die Stämme sind 4 px breit.
    kappeQuer: `................
                .||.........||..
                |^/|..||...|^/|.
                |^/|.|^/|.||^/|.
                |^/||^^/||^/^/|.
                bcdcbcddbcdcbcdc`,
    kappeLaengs: `.|^/|.
                  |^^//|
                  bcddcb
                  bcdccb
                  .|^/|.
                  |^^//|
                  bcddcb
                  bccdcb
                  .|^^|.
                  |^^//|
                  bcddcb
                  bcddcb
                  .|^/|.
                  |^///|
                  bccdcb
                  bcddcb`,
    knoten: `.|^/|.
             |^^//|
             |^^//|
             bcddcb
             bcdecb
             bcddcb`,
    front: [
      `bcdcbcddbcdcbcdc
       bcdcbcddbcdcbcdc
       bcdcbbddbcdcbcdc
       bccdbbdcbcdcbcdc
       bcddbcdcbcbcbcdc
       bcdcbcdcbcbcbcdc
       bcdcbcdcbcdcbcdd
       bcdcbcdcbcdcbccd
       bcddbcdcbcdcbcdc
       bcdcbcdcbcddbcdc
       bbdcbcdcbcdcbbdc
       bbdcbcdcbcdcbbdc
       bcdcbcdcbcdcbcdc
       qcdcbcdcqcdcbcdc
       qqcqqrrqqqcqqrrq
       qqqqqqqqqqqqqqqq`,
      `bcdcbcdcbcddbcdc
       bcdcbcdcbcddbcdc
       bcddbcdcbcdcbcdc
       bcddbcdcbcdcbbdc
       bcdcbcdcbcdcbbdc
       bcdcbcbcbcdcbcdc
       bcdcbcbcbcdcbcdc
       bcdcbcdcbcdcbcdc
       bbdcbcdcbccdbcdc
       bbdcbcddbcdcbcdc
       bcdcbcddbcdcbcdc
       bcdcbcdcbcdcbcdd
       bcdcbcdcbcdcbcdd
       bcdcqcdcbcdcqcdc
       qrrqqqcqqrrqqqcq
       qqqqqqqqqqqqqqqq`,
    ],
    pfosten: `bcddcb
              bcddcb
              bcdecb
              bcdecb
              bcddcb
              bbddcb
              bbddcb
              bcddcb
              bcddcb
              bcdecb
              bcddcb
              bcdccb
              bcdccb
              bcddcb
              qqcdqq
              qqqqqq`,
  },
});

const holz = wandSprite({
  id: 'bau_wand_holz',
  stil: HOLZ_STIL,
  schnitt: true,
  muster: {
    kappeQuer: `aaaaaaaaaaaaaaaa
                ccccdcccccccdccc
                dddddeedddddddee
                deeddddddeeddddd
                dddddddddddddddd
                cdddccdddcddddcc`,
    kappeLaengs: `acddca
                  acddca
                  acedda
                  acedda
                  acddca
                  acddda
                  acddda
                  acddca
                  acddca
                  aceeda
                  acddca
                  acddca
                  acddda
                  acdeda
                  acdeda
                  acddca`,
    knoten: `abbbba
             bdeedb
             bdccdb
             bdccdb
             bdeedb
             abbbba`,
    front: [
      `ccddcccccccddccc
       bbccbbbbbccbbbbb
       bbbbbbbbabbbbbbb
       qqrrqqqqqqqqrrqq
       ddddeeddddddddee
       ccccddcccccdddcc
       cccbbcccccccccbb
       bbbbbbbccbbbbbbb
       qaaqqrrqqqqaaqqq
       ddddddddeedddddd
       ccdddcccccccdddc
       bbbbccbbbbbbbbbb
       qqqrrqqqqqaaqqqq
       dddddeedddddddee
       ccccbbcccccccccc
       bbbbbbbbbbbbbbbb`,
      `ccccccddcccccccd
       bbbbbccbbbbbbccb
       bbabbbbbbbbbbbbb
       qqqqqrrqqqaaqqqq
       eeddddddddeedddd
       ddcccccdddcccccc
       ccccccccccbbcccc
       bbbccbbbbbbbbbbb
       qqqqqqqaaqqrrqqq
       ddeeddddddddddee
       ccccccdddcccccdd
       bbbbbbbbbbbccbbb
       qrrqqqqaaqqqqqqq
       ddddddddddeedddd
       ccbbcccccccccccc
       bbbbbbbbbbbbbbbb`,
    ],
    pfosten: `bdeedb
              bdccdb
              abddba
              qqrrqq
              ddddee
              cccddc
              cccccb
              bbbbbb
              qqqaqq
              bdeedb
              bdcddb
              abbbba
              qqrrqq
              ddeedd
              cccccc
              bbbbbb`,
  },
});

const fachwerk = wandSprite({
  id: 'bau_wand_fachwerk',
  stil: { kontur: 'a' },
  schnitt: true,
  muster: {
    kappeQuer: `aaaaaaaaaaaaaaaa
                bbcbbbbbbcbbbbbb
                cccccbcccccccbcc
                cbccccccccbccccc
                bbbbbcbbbbbbbbcb
                bbbbbbbbbbbbbbbb`,
    kappeLaengs: `abccba
                  abccba
                  abcbba
                  abccba
                  abccba
                  abbcba
                  abccba
                  abccba
                  abccba
                  abcbba
                  abccba
                  abccba
                  abbcba
                  abccba
                  abccba
                  abccba`,
    knoten: `abbbba
             bcccbb
             bcbccb
             bccbcb
             bbcccb
             abbbba`,
    front: [
      `bbbbbbbbbbbbbbbb
       cccbcccbbcccbccc
       bCCCCCCbbCCCCbbb
       bDDDDDDbbDDDbbCb
       bDEEDDDbbDDbbDDb
       bbbbbbbbbDbbDDDb
       bcccccbbbbbDEEDb
       bCCCCCCbbbbDDDDb
       bDDDDDDbbbCDDDDb
       bDDEEDDbbbDDDDDb
       bbbbbbbbbbbbbbbb
       cccbccccccbccccc
       4443444344443444
       3344333443334433
       2332233322332233
       2222222222222222`,
      `bbbbbbbbbbbbbbbb
       ccccbccccccccbcc
       bbbCCCCCCCCCCCCb
       bbbbDDDDDDDEEDDb
       bCbbbDDDDDDDDDDb
       bDCbbbDDDDDDDDDb
       bDDDbbbDDDDDDDDb
       bDDDDbbbCDDDDDDb
       bDDDDDbbbDDDEDDb
       bDEEDDDbbbDDDDDb
       bbbbbbbbbbbbbbbb
       ccccccbccccccbcc
       4434444434443444
       3343344433443334
       2232332223322332
       2222222222222222`,
    ],
    pfosten: `bbbbbb
              bccccb
              bcbccb
              bccccb
              bccbcb
              bccccb
              bccccb
              bcbccb
              bccccb
              bccccb
              bbbbbb
              cccbcc
              443444
              334433
              233223
              222222`,
  },
});

const stein = wandSprite({
  id: 'bau_wand_stein',
  stil: { kontur: '1' },
  schnitt: true,
  muster: {
    kappeQuer: `1111111111111111
                5566655552556665
                5555555552555555
                5555655552555565
                4555555552555555
                4555445552444555`,
    kappeLaengs: `155551
                  156551
                  155561
                  155551
                  122221
                  155551
                  155651
                  156551
                  155551
                  155551
                  122221
                  155551
                  156551
                  155551
                  155551
                  122221`,
    knoten: `111111
             156651
             155551
             155551
             145541
             111111`,
    front: [
      `5555255555552555
       4444244444442444
       4344234443442434
       2222222222222222
       5552555555255555
       4442444444244444
       4442444344244434
       3332334433233333
       2222222222222222
       5555555255555525
       4434444234444424
       2222222222222222
       5525555555552555
       4424444434442444
       3323333333332333
       2222222222222222`,
      `5552555555555255
       4442444444444244
       4432444443444234
       2222222222222222
       5555555525555555
       4444444424444444
       4444344424443444
       3333333323333333
       2222222222222222
       5552555555552555
       4432444444432444
       2222222222222222
       5555555255555555
       4444444244444434
       3333333233333333
       2222222222222222`,
    ],
    pfosten: `255552
              244442
              243442
              222222
              555552
              444442
              434442
              333332
              222222
              255555
              244444
              222222
              555552
              444442
              333332
              222222`,
  },
});

export default [palisade, holz, fachwerk, stein];
