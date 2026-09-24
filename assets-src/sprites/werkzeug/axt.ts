/**
 * Axt (MASTERPROMPT §5 „Materialstufen“, §13.2): eine Metallform, acht Materialstufen. Der Kopf ist mit
 * der Rampe `stein` gezeichnet (Schneide hell, zur Tülle hin dunkler, Unterkanten mit AO);
 * `materialStufen` färbt ihn über die Stufenzeilen zu Bronze, Eisen, Stahl, Sonnenstahl, Magmit,
 * Lumenit und Nachtstahl um. Stiel aus Holz mit Lederwicklung am Griff.
 *
 * T0 Stein hat eine eigene Form (M1-30, ADR-0017): ein geschlagener Steinkeil statt eines gegossenen
 * Kopfes – gerade, hohe Schneide mit einer ausgebrochenen Kerbe, Abschlaggrate als helle Schrägen
 * zwischen dunkleren Narben, AO an der Unterkante. Eine gedrehte Schnur (Sand, Drall als Schräge alle
 * 3 px) bindet ihn an den Stiel, der oben als Knauf übersteht; auch der Griff ist mit Schnur gewickelt.
 * Zellgröße, Anker und Griff-Sockel teilt sie mit der Metallform.
 */
import { materialStufen } from '../../lib/recolor';
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  a: 'stein.0',
  b: 'stein.1',
  c: 'stein.2',
  d: 'stein.3',
  e: 'stein.4',
  f: 'stein.5',
  O: 'holz.3',
  o: 'holz.2',
  W: 'erde.3',
  w: 'erde.1',
  // Schnur der Steinaxt.
  r: 'sand.3',
  R: 'sand.1',
} as const;

/** Griff-Sockel (Hand) auf der Lederwicklung. */
const GRIFF: [number, number] = [9, 12];

export const axtForm = sprite({
  id: 'axt',
  group: 'werkzeug',
  size: [16, 16],
  anchor: [9, 15],
  hoehe: 'block',
  legende: LEGENDE,
  frames: [
    `...k............
     ..kek...kkkk....
     .kfedk.kbdcbk...
     .kfeddkkbdcbbk..
     .kfeddcbbccbbk..
     .kfeddcbbcbaak..
     .kfeccbkabaak...
     .keecck.kOok....
     ..kdkk..kOok....
     ...k....kOok....
     ........kOok....
     ........kWwk....
     ........kwWk....
     ........kWwk....
     ........kwWk....
     .........kk.....`,
  ],
  sockets: { griff: [GRIFF] },
});

export const axtGeschlagen = sprite({
  id: 'axt_geschlagen',
  group: 'werkzeug',
  size: [16, 16],
  anchor: [9, 15],
  hoehe: 'block',
  legende: LEGENDE,
  frames: [
    `.........kk.....
     .kkk....kOok....
     kfeekk..kOok....
     kfdedckrrRrk....
     .kfdecbrRrrk....
     kfdcdebRrrRk....
     kfecbdarrRrk....
     kfdbaakkkOok....
     .kkkkk..kOok....
     ........kOok....
     ........kOok....
     ........krRk....
     ........kRrk....
     ........krRk....
     ........kRrk....
     .........kk.....`,
  ],
  sockets: { griff: [GRIFF] },
});

export default materialStufen(axtForm, undefined, { stein: axtGeschlagen });
