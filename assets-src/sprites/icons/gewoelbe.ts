/**
 * Item-Icons der Gewölbe und der Forschung (M7-16, M7-18, M7-46, Strang C; src/content/items/{gewoelbe,forschung,stationen}.ts):
 *
 * - **Gewölbeschlüssel**: ein schwerer Bronzeschlüssel (`METALL_RAMPEN.bronze`) mit Ringgriff und Doppelbart, senkrecht.
 * - **Glutsplitter**: ein schräger Splitter aus dunklem Glas (`nacht.2`/`nacht.3`), in dem eine Glut wohnt – der Kern emissiv
 *   (`feuer.2*`–`feuer.5*`), damit er auch im dunklen Gewölbe als Lichtpunkt liegt.
 * - **Relikte**: der Kompass (Bronzegehäuse mit Öse, helles Zifferblatt, Nadel rot/grau), das Ratssiegel (Bronzescheibe mit
 *   eingravierter Rinne und Lumen-Perle `eis.3*`/`eis.4*` wie überall das Lumen) und das Zahnrad (acht Zähne, Nabe mit Loch).
 * - **Essenz des Wurzelhüters**: der Bernsteintropfen der Elite-Essenzen (schmuck_m7.ts) mit grünem Kern (`gras`).
 * - **Baupläne**: ein Bogen Pergament (`sand`) mit umgeschlagener Ecke und der Zeichnung in Tinte (`wasser.2`/`wasser.3`) –
 *   Kartentisch (Platte mit Kompassrund, Beine), Amulett (Kette und Anhänger), Ring (Zahnring).
 * - **Ratsamulett / Mechanikerring**: das Amulett mit Lumen-Perle an der Bronzekette; der Ring aus Bronzezähnen, schräg gesehen.
 * - **Ortskarten**: eine zickzack gefaltete Karte (helle und schattige Felder), ein roter Weg (`laub.1`) zum Zeichen des
 *   Ortstyps in Tinte: Torbogen (Gewölbe), Turm (Aussichtsturm), Stele (Schrein), Kreuz (Friedhof).
 *
 * Die Stationen (Forschungspult, Kartentisch) zeichnen ihre Icons neben dem Welt-Sprite (assets-src/sprites/stationen/).
 * Licht von oben, Kontur `nacht.1` (Konvention `_icon.ts`).
 */
import type { Sprite } from '../../lib/sprite';
import { icon } from './_icon';
import { METALL_RAMPEN, METALL_ZEICHEN } from './verarbeitung';

const BRONZE = { legende: METALL_RAMPEN.bronze, material: { metall: METALL_ZEICHEN } } as const;
/** Emissives Lumen wie `icon_lumen_scherbe` (lumen.ts). */
const LUMEN = { '@': 'eis.3*', '=': 'eis.4*' } as const;
/** Glut im Splitter. */
const GLUT = { '{': 'feuer.2*', '}': 'feuer.3*', '=': 'feuer.4*', '@': 'feuer.5*' } as const;

/** Pergamentbogen der Baupläne mit umgeschlagener Ecke unten rechts; die Zeichnung legt `bauplan` darüber. */
const BOGEN = [
  '................',
  '.kkkkkkkkkkkkk..',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kEEEEEEEEEEEDk.',
  '.kDEEEEEEEEkkkk.',
  '.kDDDDDDDDDkCk..',
  '.kkkkkkkkkkkk...',
  '................',
];

/** Einmal gefaltete Karte: links das helle Feld mit dem Weg, rechts das schattige mit dem Zeichen, dazwischen der Falz. */
const KARTE = [
  '................',
  '................',
  '.kkkkkkkkkkkkkk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kEEEEECDDDDDDk.',
  '.kDDDDDCCCCCCCk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................',
  '................',
];

/** Legt eine Zeichnung (gleich große Zeilen; `.` lässt den Grund stehen) über ein Grundraster. */
function ueber(grund: readonly string[], zeichnung: readonly string[]): string {
  return grund
    .map((z, y) => {
      const o = zeichnung[y] ?? '';
      return [...z].map((c, x) => (o.charAt(x) === '' || o.charAt(x) === '.' ? c : o.charAt(x))).join('');
    })
    .join('\n');
}

function bauplan(ziel: string, zeichnung: readonly string[]): Sprite {
  return icon(`bauplan_${ziel}`, ueber(BOGEN, zeichnung));
}

function ortskarte(ortstyp: string, zeichen: readonly string[]): Sprite {
  // Der rote Weg führt von links unten über den Falz zum Zeichen rechts oben (das Zeichen: Spalten 8–12, Zeilen 3–9).
  const weg = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......m.........',
    '.....l..........',
    '...lm...........',
    '..l.............',
    '..x.............',
  ];
  const z = zeichen.map((zeile) => `........${zeile}...`);
  return icon(`ortskarte_${ortstyp}`, ueber(ueber(KARTE, weg).split('\n'), ['................', '................', '................', ...z]), { legende: { x: 'laub.1' } });
}

export default [
  icon(
    'gewoelbeschluessel',
    `................
     .....kkkkk......
     ....kTPPTXk.....
     ...kTXkkkXWk....
     ...kXk...kWk....
     ...kXk...kQk....
     ...kWXkkkWQk....
     ....kWWXWQk.....
     .....kkXWkk.....
     ......kXWk......
     ......kXWkkk....
     ......kXWTXk....
     ......kXWkkk....
     ......kXWTXk....
     ......kkkkkk....
     ................`,
    BRONZE,
  ),
  icon(
    'glutsplitter',
    `................
     ..........kk....
     .........kNk....
     ........kN~nk...
     .......kN{}nk...
     ......kN{=}nk...
     .....kN{=@}nk...
     ....kN{=@=}nk...
     ....kn}=@=}nk...
     ...kn{}==}nnk...
     ...kn{}}}nnk....
     ..knn{{nnnk.....
     ..knnnnnnk......
     ..kKnnnKk.......
     ...kkkkk........
     ................`,
    { legende: GLUT, einzelpixel: 'Glanzkante des Glases als einzelner heller Punkt an der Spitze' },
  ),
  icon(
    'relikt_kompass',
    `................
     ......kkkk......
     ......kTXk......
     ....kkkTXkkk....
     ...kXTPPPTXXk...
     ..kXEEEElEEEXk..
     ..kTEEEllEEEXk..
     ..kXEEEmlEEEWk..
     ..kXEEEkkEEEWk..
     ..kXEEE34EEEWk..
     ..kWEEE33EEEQk..
     ..kWDEEE3EEDQk..
     ...kQDDDDDDQk...
     ....kQQWWQQk....
     .....kkkkkk.....
     ................`,
    BRONZE,
  ),
  icon(
    'relikt_siegel',
    `................
     .....kkkkkk.....
     ...kkTPPPTXkk...
     ..kTPXXXXXXXWk..
     ..kPXWWWWWWXWk..
     .kTXWXXkkXXWXWk.
     .kTXWXk@=kXWXWk.
     .kXXWXk==kXWXQk.
     .kXXWXXkkXXWXQk.
     .kXXWXXXXXXWWQk.
     ..kWXWWWWWWWQk..
     ..kQWXXXXXXWQk..
     ...kkQQWWQQkk...
     .....kkkkkk.....
     ................
     ................`,
    { legende: { ...METALL_RAMPEN.bronze, ...LUMEN }, material: { metall: METALL_ZEICHEN } },
  ),
  icon(
    'relikt_zahnrad',
    `................
     ......kkkk......
     ...kk.kTXk.kk...
     ..kTXkkTXkkXWk..
     ..kXTPTTXXXXWk..
     ...kTXXkkXXWk...
     .kkTXXk..kXWWkk.
     .kTXXk....kWWQk.
     .kXXWk....kWQQk.
     .kkXWXk..kWWQkk.
     ...kXWWkkWWQk...
     ..kXWWWWWQQQQk..
     ..kWQkkWQkkQQk..
     ...kk.kWQk.kk...
     ......kkkk......
     ................`,
    BRONZE,
  ),
  icon(
    'essenz_wurzelhueter',
    `................
     ......kkkk......
     .....kCDDCk.....
     ....kCDEEDCk....
     ...kCDhiihDCk...
     ...kDhiJJihDk...
     ...kDhiJJihDk...
     ...kCDhiihDCk...
     ....kCDhhDCk....
     .....kCCCCk.....
     ......kBBk......
     .......kk.......
     ................
     ................
     ................
     ................`,
  ),
  bauplan('kartentisch', [
    '................',
    '................',
    '................',
    '...zzzzzzzzz....',
    '...z...yy..z....',
    '...z..y..y.z....',
    '...z...yy..z....',
    '...zzzzzzzzz....',
    '....z.....z.....',
    '....z.....z.....',
    '....z.....z.....',
  ]),
  bauplan('erbauer_amulett', [
    '................',
    '................',
    '...y.......y....',
    '....y.....y.....',
    '.....y...y......',
    '......y.y.......',
    '.....zzzzz......',
    '....z..y..z.....',
    '....z.yyy.z.....',
    '....z..y..z.....',
    '.....zzzzz......',
  ]),
  bauplan('erbauer_ring', [
    '................',
    '................',
    '................',
    '.....z.z.z......',
    '....zzzzzzz.....',
    '...zz.....zz....',
    '..zz.......zz...',
    '...zz.....zz....',
    '....zzzzzzz.....',
    '.....z.z.z......',
    '................',
  ]),
  icon(
    'erbauer_amulett',
    `................
     ..kk........kk..
     ..kXk......kXk..
     ...kXk....kXk...
     ....kXk..kXk....
     .....kXkkXk.....
     ......kTXk......
     .....kkTXkk.....
     ....kTPTXXWk....
     ...kTXk@=kXWk...
     ...kXk@==@kWk...
     ...kXk9@@9kQk...
     ...kWXk99kWQk...
     ....kWWXXWQk....
     .....kkkkkk.....
     ................`,
    { legende: { ...METALL_RAMPEN.bronze, ...LUMEN, '9': 'eis.2' }, material: { metall: METALL_ZEICHEN } },
  ),
  icon(
    'erbauer_ring',
    `................
     ................
     ......k.k.......
     ....kkTkPkkk....
     ...kTPTPTXXWk...
     ..kTXkkkkkkXWk..
     .kkXk......kWkk.
     .kTXk......kWQk.
     .kkXk......kWkk.
     ..kXWk....kWQk..
     ...kWWkkkkWQk...
     ...kQWQWQWQQk...
     ....kkQkQkQk....
     ......k.k.......
     ................
     ................`,
    BRONZE,
  ),
  // Torbogen über Stufen.
  ortskarte('gewoelbe', ['.kkk.', 'k...k', 'k.k.k', 'k.k.k', 'kkkkk', '.....']),
  // Turm mit Spitzdach und zwei Fenstern.
  ortskarte('aussichtsturm', ['..k..', '.kkk.', '.k.k.', '.kkk.', '.k.k.', 'kkkkk']),
  // Stele mit Sonne auf der Stufe.
  ortskarte('schrein', ['k.k.k', '.kkk.', '.kkk.', '.k.k.', '.kkk.', 'kkkkk']),
  // Grabkreuz auf dem Hügel.
  ortskarte('friedhof', ['..k..', '.kkk.', '..k..', '..k..', '.kkk.', 'kkkkk']),
];
