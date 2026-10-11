/**
 * Die zwölf Frisuren (M7-54; docs/SPIEL.md §26, §29 „Frisuren `frisur_<name>` (12)“), gezeichnet über dem Kopf der Figur
 * (`_frisuren.ts`: Raster mit `links`/`oben` Rand um den 16 × 11 großen Kopf; zählen nur Haarzeichen `0`–`4` und die Kontur
 * `K`, das abgepauste Gesicht bleibt, wie es ist). Ton `4` ist das Licht oben vorn, `0` die Tiefe am Gesicht und im Nacken.
 * Jede Frisur deckt mindestens die Haare des gezeichneten Kopfes; ihre Umrisse unterscheiden sich schon als Silhouette:
 * kurz mit Seitenscheitel, Pony mit Bob, zerzaust, Stacheln, Locken, Irokese, lang, Zopf, Pferdeschwanz, Dutt, zwei Zöpfe,
 * Strähne.
 */
import { kopfZeichnung, ueberlagert, umgefaerbteZeichnung, zeichnung, type FrisurDef, type Zeichnung } from './_frisuren';
import type { Richtung } from '../../lib/figure';

/** Kurz geschorene Seiten (Irokese): das Haar des Kopfes einen Ton dunkler. */
function stoppeln(richtung: Richtung): Zeichnung {
  const dunkler: Readonly<Record<string, string>> = { '4': '2', '3': '2', '2': '1', '1': '0', '0': '0' };
  return umgefaerbteZeichnung(kopfZeichnung(richtung), (c) => dunkler[c] ?? c);
}

/** Die Frisur bis M6 (der gezeichnete Kopf, `kopfZeichnung`); ihre Raster entstehen aus dem Kopf selbst. */
export const SCHEITEL = 'scheitel';

/** Die übrigen elf Frisuren. */
export const FRISUR_ZEICHNUNGEN: readonly FrisurDef[] = [
  {
    // Pony bis zu den Brauen, Bob bis zum Kinn; das Ohr verschwindet im Haar.
    id: 'pony',
    unterHelm: 'maske',
    down: {
      links: 2,
      oben: 3,
      raster: `
        ....................
        ....................
        ....................
        .......KKKKKK.......
        .....KK334433KK.....
        ....K2334433332K....
        ...K223333333322K...
        ..K12223333322221K..
        ..K12222222222221K..
        ..K11221122112211K..
        ..K10SSkSSSSkSS01K..
        ..K10SSkSSSSkSS01K..
        ..K10SSSSSSSSSS01K..
        ..K11mmSSSSSSmm11K..
        ...KK..........KK...`,
    },
    up: {
      links: 2,
      oben: 3,
      raster: `
        ....................
        ....................
        ....................
        .......KKKKKK.......
        .....KK334433KK.....
        ....K2333443332K....
        ...K223333333322K...
        ..K12223333322221K..
        ..K12222222222221K..
        ..K11222222222211K..
        ..K11122222222111K..
        ..K01112222221110K..
        ..K00111111111100K..
        ..K01111111111110K..
        ...KKKKKKKKKKKKKK...`,
    },
    right: {
      links: 2,
      oben: 3,
      raster: `
        ....................
        ....................
        ....................
        .......KKKKKK.......
        .....KK334433KK.....
        ....K2333443333K....
        ...K223333333332K...
        ..K1222222333222K...
        ..K11222222222221K..
        ..K1122222222111K...
        ..K011222mSSSkSSk...
        ..K0112200SSSkSSSk..
        ..K01120SSSSSSSSk...
        ...K1111SSSSSSmk....
        ...KKKKK............`,
    },
  },
  {
    // Lang und glatt mit Mittelscheitel: zwei Strähnen fallen vorn bis über die Schultern, hinten reicht das Haar bis zum Rücken.
    id: 'lang',
    unterHelm: 'maske',
    down: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2334114332K
        ....K223331133322K
        ...K12223311332221K
        ...K11222212222211K
        ...K11SS12SSS21S11K
        ...K10SSkSSSSkSS01K
        ...K10SSkSSSSkSS01K
        ...K10SSSSSSSSSS01K
        ...K10mmSSSSSSmm01K
        ...K11K........K11K
        ...K10K........K01K
        ...K11K........K11K
        ...K01K........K10K
        ....KK..........KK`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333113332K
        ....K223333113332K
        ...K12222333322221K
        ...K12222222222221K
        ...K11222222222211K
        ...K11122211222111K
        ...K11112211122111K
        ...K01111111111110K
        ...K01111211211110K
        ...K01112111121110K
        ...K00111111111100K
        ....K011111111110K
        ....K010111110110K
        .....KK0KKKKK0KK`,
    },
    right: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333443333K
        ....K223333333332K
        ...K1222223332222K
        ...K11222222222SSK
        ...K11222222221SSSK
        ...K011222mSSSkSSK
        ...K01122mmSSSkSSSK
        ...K0112SSSSSSSSSK
        ...K0111SSSSSSSmK
        ...K0111K
        ...K0110K
        ...K0111K
        ...K011K
        ....KKK`,
    },
  },
  {
    // Ein Zopf: von vorn über der linken Schulter, von hinten mitten über den Rücken, im Profil hinter dem Nacken.
    id: 'zopf',
    unterHelm: 'maske',
    down: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2334433332K
        ....K223333333322K
        ....K222333332222K
        ....K122221222211K
        ....K1SS12SSS21S1K
        ....K1SSkSSSSkSS1K
        ....K1SSkSSSSkSS1K
        ....KmSSSSSSSSSSm1K
        .....KmmSSSSSSmmK21K
        ................K32K
        ................K12K
        ................K23K
        ................K00K
        ................K32K
        .................KK`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333443332K
        ....K223333333322K
        ....K222233332222K
        ....K222222222222K
        ....K122222222221K
        ....K112221122211K
        ....K111221112111K
        ....KK1111221111KK
        .....KK11122111KK
        ........K3221K
        ........K1223K
        ........K3221K
        ........K1223K
        ........K0000K
        .........K22K
        ..........KK`,
    },
    right: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333443333K
        ....K223333333332K
        ....K222223332222K
        ....K1222222222SSK
        ....K122222221SSSK
        ....K11222mSSSkSSK
        ....K1122mmSSSkSSSK
        ...K2112SSSSSSSSSK
        ...K12K1mSSSSSSSmK
        ...K23K
        ...K12K
        ...K23K
        ...K00K
        ...K32K
        ....KK`,
    },
  },
  {
    // Pferdeschwanz: hoch am Hinterkopf gebunden, im Profil schwingt er nach hinten aus und fällt bis zwischen die Schultern;
    // von vorn schwingt die Spitze an der rechten Kopfseite hervor.
    id: 'pferdeschwanz',
    unterHelm: 'maske',
    down: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2334433332K
        ....K223333333322K
        ....K222333332222K
        ....K122221222211K
        ...KK1SS12SSS21S1K
        ..K21K
        ..K32K
        ..K21K
        ...K1K
        ....K`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333443332K
        ....K223333333322K
        ....K222200002222K
        ....K222103301222K
        ....K122123321221K
        ....K112123321211K
        ....K111123321111K
        ....KK1112332111KK
        .....KK11233211KK
        .........K2332K
        .........K1221K
        .........K2332K
        ..........K11K
        ...........KK`,
    },
    right: {
      links: 3,
      oben: 0,
      raster: `
        ........KKKKKK
        ......KK334433KK
        .....K2333443333K
        ...Kk223333333332k
        .KK00222223332222k
        K32101222222222SSk
        K3321122222221SSSk
        K231k11222mSSSkSSk
        K121k1122mmSSSkSSSk
        .K21k112SSSSSSSSSk
        .K12Kk1mSSSSSSSmk
        .K21K
        ..K1K
        ...K`,
    },
  },
  {
    // Dutt: oben am Hinterkopf zum Knoten gedreht – von vorn ein Höcker über dem Scheitel, von hinten der runde Knoten.
    id: 'dutt',
    unterHelm: 'verdeckt',
    down: {
      links: 3,
      oben: 3,
      raster: `
        .........KKKK
        ........K3443K
        ........K2332K
        ........k1111k`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk3KKKK3kk
        .....k23K3443K32k
        ....k22K233332K22k
        ....k22K122221K22k
        ....k222K1111K222k
        ....k1222KKKK2221k`,
    },
    right: {
      links: 2,
      oben: 1,
      raster: `
        ..KKK
        .K344K
        K23332K
        K12221K
        .K111K
        ..KKK`,
    },
  },
  {
    // Zwei Zöpfe hinter den Ohren: von vorn und hinten über beiden Schultern, im Profil der nahe Zopf vor der Schulter.
    id: 'zoepfe',
    unterHelm: 'maske',
    down: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk334433kk
        .....k2333113332k
        ....k223331133322k
        ....k222333332222k
        ....k122221222211k
        ....k1SS12SSS21S1k
        ....k1SSkSSSSkSS1k
        ....k1SSkSSSSkSS1k
        ...K12SSSSSSSSSS21K
        ....K21mSSSSSSm12K
        .....K21K....K12K
        ......K32K..K23K
        ......K12K..K21K
        ......K00K..K00K
        ......K23K..K32K
        .......KK....KK`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk333333kk
        .....k2333113332k
        ....k223331133322k
        ....k222231132222k
        ....k222221122222k
        ....k122221122221k
        ....k112221122211k
        ....k111221112111k
        ....kk1111111111kk
        .....K211mmmm112K
        .....K32K....K23K
        .....K12K....K21K
        .....K23K....K32K
        .....K00K....K00K
        .....K23K....K32K
        ......KK......KK`,
    },
    right: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk333333kk
        .....k2333333333k
        ....k223333333332k
        ....k222223332222k
        ....k1222222222SSk
        ....k122222221SSSk
        ....k11222mSSSkSSk
        ....k1122mmSSSkSSSk
        ....k112SSSSSSSSSk
        .....K21SSSSSSSmk
        .....K32K
        .....K12K
        .....K23K
        .....K00K
        .....K23K
        ......KK`,
    },
  },
  {
    // Irokese: ein hoher Kamm von der Stirn bis in den Nacken, die Seiten kurz geschoren (Stoppeln einen Ton dunkler).
    id: 'irokese',
    unterHelm: 'verdeckt',
    down: ueberlagert(
      stoppeln('down'),
      zeichnung({
        links: 3,
        oben: 4,
        raster: `
          .........KKKK
          ........K3443K
          ........K3443K
          ........K2332K
          ........K2332K
          .........2332
          .........1221
          ..........11`,
      }),
    ),
    up: ueberlagert(
      stoppeln('up'),
      zeichnung({
        links: 3,
        oben: 4,
        raster: `
          .........KKKK
          ........K3443K
          ........K2332K
          ........K2332K
          ........K2332K
          .........2332
          .........2332
          .........2222
          .........1221
          .........1221
          .........1111
          ..........11`,
      }),
    ),
    right: ueberlagert(
      stoppeln('right'),
      zeichnung({
        links: 3,
        oben: 3,
        raster: `
          ..........KKK
          ........KK344K
          ......KK2334432K
          .....K22333333K
          ....K1223
          ...K1222
          ..K1221
          ..K121
          ..K12
          ...K1`,
      }),
    ),
  },
  {
    // Stacheln: drei hohe Spitzen über der Stirn, zwei kleinere zu den Seiten.
    id: 'stacheln',
    unterHelm: 'verdeckt',
    down: {
      links: 3,
      oben: 3,
      raster: `
        .......K..K..K
        ......K3KK3KK3K
        ....K.K343343343K.K
        ....KK33443443443KK
        ....K23333333333332K
        ....K223333333332K
        ....k223333333322k
        ....k222333332222k
        ....k122221222211k`,
    },
    up: {
      links: 3,
      oben: 3,
      raster: `
        .......K..K..K
        ......K3KK3KK3K
        ....K.K343343343K.K
        ....KK33443443443KK
        ....K23333333333332K
        ....K223333333332K
        ....k223333333322k
        ....k222233332222k`,
    },
    right: {
      links: 3,
      oben: 3,
      raster: `
        ......K...K..K
        .....K3K.K3KK3K
        ....K343K3433433K
        ...K233443443443K
        ...K1233333333333K
        ....K22333333333K
        ....k223333333332k
        ....k222223332222k`,
    },
  },
  {
    // Locken: rund und voll, eine Handbreit über den Kopf hinaus, kleine helle Kringel auf dunklem Grund.
    id: 'locken',
    unterHelm: 'verdeckt',
    down: {
      links: 3,
      oben: 2,
      raster: `
        .......KK.KK.KK
        ......K34K34K34K
        .....K3443344334K
        ....K433443344334K
        ...K23322332233223K
        ..K3223322332233223K
        ..K1221122112211221K
        ..K21122112211221122K
        ...K21SS12SSS21SS12K
        ..K122SSkSSSSkSS221K
        ..K211SSkSSSSkSS112K
        ...K1mSSSSSSSSSSm1K
        ....KK..........KK`,
    },
    up: {
      links: 3,
      oben: 2,
      raster: `
        .......KK.KK.KK
        ......K34K34K34K
        .....K3443344334K
        ....K433443344334K
        ...K23322332233223K
        ..K3223322332233223K
        ..K1221122112211221K
        ..K21122112211221122K
        ..K12211221122112211K
        ..K21122112211221122K
        ...K122112211221122K
        ...KK2112211221122KK
        .....KK11mmmm11KK`,
    },
    right: {
      links: 3,
      oben: 2,
      raster: `
        .......KK.KK.KK
        ......K34K34K34K
        .....K3443344334K
        ....K433443344334K
        ...K233223322332SK
        ..K32233223322SSK
        ..K1221122112SSSk
        ..K2112211mSSSkSSk
        ..K1221mmSSSkSSSk
        ...K122SSSSSSSSSk
        ...K21mSSSSSSSmk
        ....KK`,
    },
  },
  {
    // Zerzaust: ein Schopf steht nach allen Seiten ab, Strähnen fallen ungleich in die Stirn.
    id: 'wuschel',
    unterHelm: 'verdeckt',
    down: {
      links: 3,
      oben: 2,
      raster: `
        .......K....KK
        ......K3K.KK33K
        .....K334K34433KK
        ....K23443443333KK
        ....K223333333332K
        ...KK223333333322kK
        ...Kk222333332222kK
        ...KK122221222211KK
        ....k1SS12SS221S1k
        ....k1SSkS1SSkSS1k`,
    },
    up: {
      links: 3,
      oben: 2,
      raster: `
        .......K....KK
        ......K3K.KK33K
        .....K334K34433KK
        ....K23443443333KK
        ....K223333333332K
        ...KK223333333322kK
        ...Kk222233332222kK
        ...KK222222222222KK
        ....k122222222221k
        ....k112221122211k
        ....k111221112111k
        ....kk1111111111kk
        .....kk11mmmm11kk
        ......KK1K..K1KK`,
    },
    right: {
      links: 3,
      oben: 2,
      raster: `
        ........K...KK
        .......K3K.K33K
        ......K334K3443KK
        ....KK2344344333KK
        ....KK223333333332K
        ...Kk222223332222k
        ...KKk1222222222SSk
        ....k1222222221SSk
        ....k11222mSSSkSSk
        ....k1122mmSSSkSSSk
        ....k112SSSSSSSSSk
        ...KK1mSSSSSSSmk`,
    },
  },
  {
    // Strähne: kurz am Hinterkopf, eine lange Strähne fällt schräg über die Stirn bis an die Braue.
    id: 'straehne',
    unterHelm: 'verdeckt',
    down: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk334433kk
        .....k2333443332K
        ....k223334433322K
        ....k222333443322K
        ....k122221234431K
        ....k1SS12SS23431K
        ....k1SSkSS23kSS1k
        ....k1SSkSSS1kSS1k`,
    },
    up: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk334433kk
        .....k2333443332k
        ....k223333443322k`,
    },
    right: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......kk333344KK
        .....k2333334443K
        ....k2233333344432K
        ....k22222333234431K
        ....k1222222222S131K
        ....k122222221SS11K`,
    },
    left: {
      links: 3,
      oben: 0,
      raster: `
        ........kkkkkk
        ......KK443333kk
        .....K3444333332k
        ...K23444333333322k
        ..K13443232222222k
        ..K131S22222222221k
        ...K11SS2122222221k`,
    },
  },
];
