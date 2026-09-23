/**
 * Axt (MASTERPROMPT §5 „Materialstufen“, §13.2): eine Form, acht Materialstufen. Der Kopf ist mit der
 * Rampe `stein` gezeichnet (Schneide hell, zur Tülle hin dunkler, Unterkanten mit AO); `materialStufen`
 * färbt ihn über die Stufenzeilen zu Stein, Bronze, Eisen, Stahl, Sonnenstahl, Magmit, Lumenit und
 * Nachtstahl um. Stiel aus Holz mit Lederwicklung am Griff.
 */
import { materialStufen } from '../../lib/recolor';
import { sprite } from '../../lib/sprite';

const form = sprite({
  id: 'axt',
  group: 'werkzeug',
  size: [16, 16],
  anchor: [9, 15],
  hoehe: 'block',
  legende: {
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
  },
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
  sockets: { griff: [[9, 12]] },
});

export default materialStufen(form);
