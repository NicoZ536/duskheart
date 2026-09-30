/**
 * Scherenkrebs (Salzküste, Gegner; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, hummerförmig – dunkelblauer
 * Panzer (`wasser`) mit gegliedertem Hinterleib und Schwanzfächer, zwei große Scheren mit orangen Spitzen
 * (`laub`), Fühler, Stielaugen `eis.4*` (nachts leuchtend). Angriffe: `kneifen` (Scheren öffnen, schnappen
 * vor) und `scherenschlag` (beide Scheren hoch erhoben – lange Ausholphase –, schmettern nieder).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { krebs } from '../../lib/creatureKrebs';

const plan = krebs({
  panzer: { f: 1, u: 4.4, r: [4.2, 3.2, 2.6], nick: 4 },
  hinterleib: { glieder: 4, laenge: 7, breite: 2.6, hoehe: 2, kruemmung: -32 },
  augen: {
    f: 3.4,
    s: 1.2,
    u: 1.4,
    stiel: 1.4,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [[0, 0, 'auge', 0], [0, -1, 'auge', 0]],
    zu: [[0, 0, 'lid', 0]],
  },
  beine: { paare: 3, f0: 1.6, abstand: 1.9, reichweite: 2.6, knie: 1.3 },
  scheren: { f: 3.4, s: 2.8, u: 0.8, arm: 4, hand: [3.6, 2.3, 2], finger: 3.4, spreizung: 55 },
  fuehler: { laenge: 7 },
  verbreiterung: 1.15,
  hoeheBezug: 8,
  materialien: {
    panzer: { stufen: ['wasser.1', 'wasser.2', 'wasser.3', 'wasser.4'], schwellen: [0.36, 0.52, 0.82] },
    schere: { stufen: ['wasser.1', 'wasser.2', 'wasser.3', 'laub.3'], schwellen: [0.36, 0.52, 0.86] },
    bein: { stufen: ['wasser.1', 'wasser.2'] },
    auge: { stufen: ['eis.4*'] },
    lid: { stufen: ['wasser.0'] },
    spitze: { stufen: ['laub.2', 'laub.3'], schwellen: [0.6] },
  },
  zeichnung: (o) => (o.teil === 'schere' && o.lokal[0] > 0.55 ? 'spitze' : null),
});

/**
 * Rest: both claws held up before the head, the pincers a little open – from the front the lobster reads by its two raised
 * claws (hanging, they looked like folded wings).
 */
const RUHE = { schereL: 10, schereR: 10, zangeL: 0.4, zangeR: 0.4 };

export const scherenkrebs = kreatur({
  id: 'scherenkrebs',
  zelle: 32,
  anker: [16, 23],
  hoehe: 'kugel',
  massstab: 1,
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, schereL: 16, zangeL: 0.7 }, { ...RUHE, hub: -0.4, schereL: 16, schereR: 14, zangeR: 0.7 }, { ...RUHE, hub: -0.4, schereR: 14, schwanz: 8 }),
    zyklusClip('move', 6, 12, (ph) => ({ gang: ph, gangHub: 1.2, hub: 0.3 * Math.cos(4 * Math.PI * ph), schereL: RUHE.schereL + 4 * Math.sin(2 * Math.PI * ph), schereR: RUHE.schereR - 4 * Math.sin(2 * Math.PI * ph), zangeL: RUHE.zangeL, zangeR: RUHE.zangeR }), [0, 3]),
    angriffClip({
      name: 'kneifen',
      fps: 10,
      aushol: [
        { schereR: 20, zangeR: 0.7, schereL: 8, hub: 0.3, vor: -0.4 },
        { schereR: 30, zangeR: 1, schereL: 12, zangeL: 0.4, hub: 0.6, vor: -1 },
      ],
      halten: 2,
      schlag: { schereR: -4, schereVor: 1.6, zangeR: 0.2, vor: 0.5, schereL: 4 },
      schmierTeile: ['schere'],
      treffer: { schereR: -8, schereVor: 1.8, zangeR: 0, vor: 0.6 },
      nach: [{ schereR: 8, schereL: 16, schereVor: 0.8, vor: 0.4 }, RUHE],
    }),
    angriffClip({
      name: 'scherenschlag',
      fps: 10,
      aushol: [
        { schereL: 30, schereR: 30, zangeL: 0.6, zangeR: 0.6, hub: 0.8, nick: 6 },
        { schereL: 58, schereR: 58, zangeL: 1, zangeR: 1, hub: 1.6, nick: 12, vor: -1 },
        { schereL: 70, schereR: 70, zangeL: 1, zangeR: 1, hub: 2, nick: 14, vor: -1.4, schwanz: 18 },
      ],
      halten: 3,
      schlag: { schereL: -22, schereR: -22, zangeL: 0.3, zangeR: 0.3, hub: -0.3, nick: -8, vor: 0.6, schereVor: 0.6 },
      schmierTeile: ['schere'],
      treffer: { schereL: -30, schereR: -30, zangeL: 0, zangeR: 0, hub: -0.5, nick: -10, vor: 0.7, schereVor: 0.7, stauch: -0.08 },
      nach: [{ schereL: -4, schereR: -4, nick: -3, vor: 0.6 }, RUHE],
    }),
    trefferClip({ augenZu: 1, hub: 0.8, vor: -1.2, schereL: 30, schereR: 30, zangeL: 1, zangeR: 1, schwanz: 25 }, { augenZu: 1, hub: -0.4, schereL: -8, schereR: -8, schwanz: 10 }),
    todClip(
      [
        { augenZu: 1, hub: 1, schereL: 35, schereR: 35, zangeL: 1, zangeR: 1, schwanz: 30 },
        { augenZu: 1, hub: 1.6, roll: 70, liegen: 0.2, beineEin: 0.4, schwanz: 20 },
        { augenZu: 1, roll: 150, liegen: 0.5, beineEin: 0.8, schwanz: 10 },
        { augenZu: 1, roll: 180, liegen: 0.9, beineEin: 1 },
        { augenZu: 1, roll: 180, liegen: 1, beineEin: 1, schereL: 20, schereR: 20 },
      ],
      3,
    ),
  ],
});

export default scherenkrebs.sprite;
