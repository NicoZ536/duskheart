/**
 * Wandobjekte T0–T1 (M4-19; docs/SPIEL.md §8; MASTERPROMPT §16.1 „Wandobjekte (Fackeln, Regale, Bilder,
 * Trophäen)“): Wandregal, Kleiderhaken, Werkzeugwand, Landschaftsbild, Wandspiegel, Wandschild,
 * Trophäenbrett, Leinenvorhang, Wandfahne, Türkranz, Wandteppich, Blumenampel. Sie hängen an der 16-px-Front
 * der Wand ihres Tiles (Anker unten Mitte = unterster Pixel, `MOEBEL_WANDHOEHE_PX` über der Fußlinie), sind
 * höchstens 15 px hoch und werfen keinen Bodenschatten: Kontakt ist die Wand, nicht der Boden.
 */
import { moebel } from './_moebel';

/** Wandregal: Brett auf zwei Konsolen, darauf ein Tonkrug, zwei Töpfchen und ein Holzkästchen. */
const regal = moebel({
  item: 'regal_wand',
  size: [16, 12],
  anchor: [8, 11],
  hoehe: 'block',
  frames: [
    `................
     ...kk...........
     ..kssk....kkk...
     ..krsk...kssrk..
     .kkrrkk..krrrk..
     .kqrrqkkkkqqqkk.
     .kkqqkkdekkkkdkk
     kkkkkkkkkkkkkkkk
     keeeeeeeeeeeeeek
     kbbbbbbbbbbbbbbk
     .kkkbk....kbkkk.
     ...kkk....kkk...`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Kleiderhaken: Brett mit drei Holzzapfen, daran eine braune Wollkappe und ein Leinenbeutel. */
const haken = moebel({
  item: 'kleiderhaken',
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'block',
  frames: [
    `................
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .kbbbbbbbbbbbbk.
     .kkdkkkkdkkkkdk.
     ..kdk..kdk..kk..
     .kssrk.kDk......
     kssssrkkEDk.....
     ksrssrrkDDDk....
     ksrsssrkEDDk....
     kqrrssrkDDDDk...
     kqrrrrqkCDDDk...
     kqqrrqqkkCCCk...
     .kqqqqk..kkk....
     ..kkkk..........
     ................`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/**
 * Werkzeugbrett (Deko): ruhiges Brett (Oberkante hell, Unterkante dunkel) mit drei klar getrennten Dingen an
 * zwei Holzpflöcken – links eine Steinaxt, in der Mitte eine Rolle Faserseil, rechts ein Hammer. Die Werkzeuge
 * heben sich allein über den Tonwert vom Brett ab (dunkler Stiel, heller Stein), ohne eigene Kontur; unter
 * den Stielenden sitzt ein Schattenpixel, wo sie das Brett berühren.
 */
const werkzeugwand = moebel({
  item: 'werkzeugwand_deko',
  size: [16, 17],
  anchor: [8, 15],
  hoehe: 'block',
  frames: [
    `................
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .kddaddddddaddk.
     .kd455ddd5555dk.
     .kdb455dd3333dk.
     .kdb34dddddbddk.
     .kdbdddddddbddk.
     .kdbddDDDddbddk.
     .kdbdDcddDdbddk.
     .kdbdCcddCdbddk.
     .kdbddCCCddbddk.
     .kdcdddddddcddk.
     .kddddddddddddk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ................`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Landschaftsbild: Holzrahmen, darin Himmel, Sonne, zwei grüne Hügel und ein Weg. */
const bild = moebel({
  item: 'bild_landschaft',
  size: [16, 14],
  anchor: [8, 13],
  hoehe: 'flach',
  frames: [
    `................
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .ked99999999dek.
     .ked99999EE9dek.
     .ked99999EE9dek.
     .ked9iii99iidek.
     .kediiiiiiihdek.
     .kedhiiiihhhdek.
     .kedhhhDhhhgdek.
     .kedggDDDgggdek.
     .keddddddddddek.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Wandspiegel: ovaler Bronzerahmen (Metallflag) am Nagel, Glas mit schrägem Schimmer (Glanzflag). */
const spiegel = moebel({
  item: 'spiegel_wand',
  size: [16, 16],
  anchor: [8, 14],
  hoehe: 'flach',
  metall: true,
  glas: true,
  frames: [
    `................
     .....kkkkkk.....
     ...kkTTTTTTkk...
     ..kTTkkkkkkTTk..
     ..kTk:::;;:kTk..
     .kTk::::;;::kTk.
     .kTk:::;;:::kTk.
     .kTk::;;::::kTk.
     .kTk:;;::::;kTk.
     .kTk:;:::::;kTk.
     .kWk:::::::;kWk.
     ..kWk::::::kWk..
     ..kWWkkkkkkWWk..
     ...kkWWWWWWkk...
     .....kkkkkk.....
     ................`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Wandschild: Brett an zwei Faserseilen von einem Zapfen, darauf eine eingebrannte Herdflamme aus Holzkohle. */
const schild = moebel({
  item: 'wandschild',
  size: [16, 14],
  anchor: [8, 13],
  hoehe: 'flach',
  frames: [
    `................
     .......kk.......
     ......kddk......
     .....kCkkCk.....
     ....kCk..kCk....
     ...kCk....kCk...
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .kdddddnddddddk.
     .kddddnnnddcddk.
     .kdccdnnndddddk.
     .kdddnnnnnddddk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Trophäenbrett: Wappenschild aus Holz mit geschnitztem Rand und zwei Bronzehaken, an die Trophäen gehängt werden. */
const trophaee = moebel({
  item: 'trophaeenbrett',
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'block',
  metall: true,
  frames: [
    `................
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .kedddddddddcdk.
     .kedcdkkkkdddck.
     .keddkTTTTkdddk.
     .kedddkWWkddddk.
     .kedddkWkkddddk.
     .keddddkWkdddck.
     ..keddkWkkdddk..
     ..kedddkkdddck..
     ...keddddddck...
     ....kedddddk....
     .....kedddk.....
     ......kbbk......
     .......kk.......`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Leinenvorhang: Stange mit Ringen, links und rechts ein gebündelter Vorhang mit Falten, dazwischen der Durchblick aufs Fenster. */
const vorhang = moebel({
  item: 'vorhang_leinen',
  size: [16, 15],
  anchor: [8, 14],
  hoehe: 'flach',
  frames: [
    `kkkkkkkkkkkkkkkk
     kbccccccccccccbk
     kkkkkkkkkkkkkkkk
     kEEDEEk..kEEDEEk
     kEEDEDk..kDEDEEk
     kEEDEk....kEDEEk
     kEDDk......kDDEk
     .kCCk......kCCk.
     .kBBk......kBBk.
     .kDDk......kDDk.
     kEDDEk....kEDDEk
     kEEDEEDkkDEEDEEk
     kCDCCDCkkCDCCDCk
     kkCkkCkk.kkCkkCk
     ..k..k......k..k`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Wandfahne: Stange mit Knäufen, rotes Tuch (Varianten über `STOFF_VARIANTEN`) mit goldener Herdflamme und Schwalbenschwanz. */
const fahne = moebel({
  item: 'fahne_wand',
  size: [16, 15],
  anchor: [8, 14],
  hoehe: 'flach',
  frames: [
    `kk............kk
     kdkkkkkkkkkkkkdk
     kkbbbbbbbbbbbbkk
     .kkkkkkkkkkkkkk.
     ..kMMMMMMMMMMk..
     ..kmmmmoommmmk..
     ..kmmmoMMommlk..
     ..kmmoMvvMomlk..
     ..kmmmoMMommlk..
     ..kmmmmoommmlk..
     ..klmmmmmmmmlk..
     ..kllmmkkmmllk..
     ..kllmk..kmllk..
     ..kllk....kllk..
     ..kkk......kkk..`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Türkranz: Ring aus Zweigen und Laub, rote Beeren, unten eine Schleife aus rotem Garn; hängt an Tür oder Wand. */
const kranz = moebel({
  item: 'kranz_tuer',
  size: [16, 16],
  anchor: [8, 15],
  hoehe: 'kugel',
  frames: [
    `................
     ......kkkk......
     ....kkhijhkk....
     ...khibghihgk...
     ..khgmkkkkihgk..
     ..kibkk..kkbik..
     .khgk......khgk.
     .kjhk......kjik.
     .kigk......kgmk.
     .kmhk......khik.
     ..kibkk..kkbhk..
     ..khgikkkkmigk..
     ...kghimmhgbk...
     ....kkmMMmkk....
     ....kmk..kmk....
     ....kk....kk....`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/** Wandteppich: gewebter Behang an einer Stange, Rautenmuster in Blau auf Rot, unten Fransen. */
const wandteppich = moebel({
  item: 'wandteppich',
  size: [16, 15],
  anchor: [8, 14],
  hoehe: 'flach',
  frames: [
    `kk............kk
     kdkkkkkkkkkkkkdk
     kkbbbbbbbbbbbbkk
     .kMMMMMMMMMMMMk.
     .kmyymmmmmmyymk.
     .kmmymmyymmymmk.
     .kmmmmyzzymmmmk.
     .kmmmyzZZzymmmk.
     .kmmmmyzzymmmmk.
     .kmmymmyymmymmk.
     .kmyymmmmmmyymk.
     .kMMMMMMMMMMMMk.
     .kkkkkkkkkkkkkk.
     ..kDkDkDkDkDkDk.
     ..kDkDkDkDkDkDk.`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

/**
 * Blumenampel: Tontopf mit gelben Blüten und hängenden Blättern am Wandhaken. Die Aufhängung ist eine 1 px
 * dünne gedrehte Schnur aus Faserseil (hell/dunkel im Wechsel, ohne Kontur), die sich erst kurz über den
 * Blüten in zwei Stränge teilt und an den Topfrand geknotet ist – so liest sie als Schnur, nicht als Dreieck.
 */
const ampel = moebel({
  item: 'blumenampel',
  size: [16, 17],
  anchor: [8, 14],
  hoehe: 'kugel',
  wind: 'hij',
  frames: [
    `................
     .......kk.......
     ......kbbk......
     .......D........
     .......C........
     ......D.D.......
     .....C.kk.C.....
     ....DkkoMkkD....
     ...kjoMooMoik...
     ..kihkMMMMkhjk..
     ..kDkttttttkDk..
     ...kCssssssCk...
     ...khrssssrjk...
     ...kikrrrrkik...
     ...kk.kkkk.kk...
     ................
     ................`,
  ],
  occluder: { kind: 'none' },
  schatten: 'none',
});

export default [regal, haken, werkzeugwand, bild, spiegel, schild, trophaee, vorhang, fahne, kranz, wandteppich, ampel];
