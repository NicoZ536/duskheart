/**
 * Krabbe (Salzküste, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, rot-oranger Panzer (`laub`),
 * Augen auf Stielen, drei Laufbeinpaare und zwei Scheren. Läuft seitwärts: im Profil ist der Körper zum
 * Betrachter gedreht. Verteidigt sich mit `kneifen` (Scheren heben und öffnen, zuschnappen).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { krebs } from '../../lib/creatureKrebs';

const plan = krebs({
  panzer: { f: 0, u: 2.6, r: [2.2, 3, 1.6] },
  augen: { f: 1.6, s: 0.9, u: 1, stiel: 1.5, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'lid', 0]] },
  beine: { paare: 3, f0: 0.6, abstand: 1.1, reichweite: 1.5, knie: 1 },
  scheren: { f: 1.9, s: 2, u: 0.2, arm: 1.2, hand: [1.5, 1.2, 1.1], finger: 1.2 },
  gier: { right: 80 },
  hoeheBezug: 4.5,
  materialien: {
    panzer: { stufen: ['laub.1', 'laub.2', 'laub.3', 'laub.4'], schwellen: [0.36, 0.55, 0.84] },
    schere: { stufen: ['laub.2', 'laub.3', 'laub.4'], schwellen: [0.4, 0.66] },
    bein: { stufen: ['laub.1', 'laub.2'] },
    auge: { stufen: ['sand.4'] },
    lid: { stufen: ['laub.1'] },
  },
});

export const krabbe = kreatur({
  id: 'krabbe',
  zelle: 16,
  anker: [8, 10],
  hoehe: 'kugel',
  plan,
  clips: [
    idleClip({}, { schereL: 6, zangeL: 0.4 }, { hub: -0.4, schereL: 6, schereR: 4, zangeR: 0.4 }, { hub: -0.4, schereR: 4 }),
    zyklusClip('move', 4, 12, (ph) => ({ gang: ph, gangHub: 1, hub: 0.3 * Math.cos(4 * Math.PI * ph), seite: 0 }), [0, 2]),
    angriffClip({
      name: 'kneifen',
      fps: 10,
      aushol: [
        { schereL: 25, schereR: 25, zangeL: 0.7, zangeR: 0.7, hub: 0.3 },
        { schereL: 42, schereR: 42, zangeL: 1, zangeR: 1, hub: 0.6, vor: -0.5 },
      ],
      halten: 2,
      schlag: { schereL: -6, schereR: -6, schereVor: 1.2, zangeL: 0.2, zangeR: 0.2, vor: 0.8 },
      schmierTeile: ['schere'],
      treffer: { schereL: -10, schereR: -10, schereVor: 1.4, zangeL: 0, zangeR: 0, vor: 1 },
      nach: [{ schereL: 4, schereR: 4, vor: 0.3 }, {}],
    }),
    trefferClip({ augenZu: 1, hub: 0.6, vor: -0.8, schereL: 30, schereR: 30, zangeL: 1, zangeR: 1 }, { augenZu: 1, hub: -0.4, schereL: -6, schereR: -6 }),
    todClip(
      [
        { augenZu: 1, hub: 0.8, schereL: 35, schereR: 35, zangeL: 1, zangeR: 1 },
        { augenZu: 1, hub: 0.4, roll: 55, liegen: 0.35, beineEin: 0.6 },
        { augenZu: 1, roll: 150, liegen: 0.5, beineEin: 0.8 },
        { augenZu: 1, roll: 180, liegen: 0.9, beineEin: 1 },
        { augenZu: 1, roll: 180, liegen: 1, beineEin: 1, schereL: 20, schereR: 20 },
      ],
      3,
    ),
  ],
});

export default krabbe.sprite;
