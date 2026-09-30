/**
 * Speier (Schattenbrut, Fernkampf; MASTERPROMPT §12.4, §20.1, docs/ART.md §15): 32×32, gebückter,
 * birnenförmiger Leib aus Tinten-Rauch auf zwei kurzen Beinen, vorn ein violett glühender Kehlsack
 * (`verderb.3*`/`verderb.4*`), Augen `eis.4*`. Angriff `spucken`: der Sack bläht sich und glüht auf, der Kopf
 * legt sich zurück (Ausholen), dann schnellt er vor und reißt den Schlund auf; das Geschoss ist
 * `geschoss_spucken`.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { speier as speierPlan } from '../../lib/creatureSchatten';

const plan = speierPlan({
  leib: { f: -0.8, u: 6.6, r: [4.4, 4, 4.2] },
  brust: { f: 1.4, u: 9.6, r: [3.2, 3.2, 3] },
  kopf: { f: 3.2, u: 12.6, r: [2.7, 2.6, 2.3] },
  sack: { f: 2.8, u: 7, r: [2.3, 2.6, 2.3] },
  beine: { f: -0.4, spur: 2.4, u: 3.6 },
  augen: {
    f: 2,
    s: 1.1,
    u: 0.7,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
  },
  augenMaterial: 'eis.4*',
  hoeheBezug: 14,
});

export const speier = kreatur({
  id: 'speier',
  zelle: 32,
  anker: [16, 28],
  hoehe: 'kugel',
  plan,
  clips: [
    idleClip({ rauch: 0, sack: 0.2 }, { rauch: 0.25, sack: 0.4, kopfNick: 4 }, { rauch: 0.5, sack: 0.5, hub: -0.6, kopfNick: 4 }, { rauch: 0.75, sack: 0.3, hub: -0.6 }),
    zyklusClip(
      'move',
      6,
      10,
      (ph) => ({ lF: 1.6 * Math.cos(2 * Math.PI * ph), rF: -1.6 * Math.cos(2 * Math.PI * ph), lU: Math.max(0, -Math.sin(2 * Math.PI * ph)) * 1.2, rU: Math.max(0, Math.sin(2 * Math.PI * ph)) * 1.2, hub: 0.6 * Math.abs(Math.cos(2 * Math.PI * ph)), roll: 4 * Math.sin(2 * Math.PI * ph), rauch: ph, sack: 0.25 }),
      [0, 3],
    ),
    angriffClip({
      name: 'spucken',
      fps: 10,
      aushol: [
        { sack: 0.6, kopfNick: 12, kopfVor: -0.6, hub: 0.5, rauch: 0.1 },
        { sack: 0.85, kopfNick: 24, kopfVor: -1.2, hub: 1, nick: -6, rauch: 0.2 },
        { sack: 1, kopfNick: 30, kopfVor: -1.5, hub: 1.2, nick: -8, maul: 0.3, rauch: 0.3 },
      ],
      halten: 2,
      schlag: { sack: 0.3, kopfNick: -18, kopfVor: 2, maul: 1, nick: 6, vor: 1, rauch: 0.4 },
      schmierTeile: ['kopf'],
      treffer: { sack: 0.1, kopfNick: -12, kopfVor: 2.2, maul: 0.8, nick: 8, vor: 1.2, rauch: 0.5 },
      nach: [{ sack: 0.1, kopfNick: -4, kopfVor: 0.8, maul: 0.3, rauch: 0.6 }, { sack: 0.2, rauch: 0.7 }],
    }),
    trefferClip({ vor: -1.2, hub: 0.8, kopfNick: 16, sack: 0.8, rauch: 0.2 }, { vor: -0.4, hub: -0.6, kopfNick: -6, sack: 0.3, rauch: 0.4 }),
    todClip(
      [
        { vor: -1.2, hub: 0.8, kopfNick: 16, sack: 1, rauch: 0.1 },
        { hub: -1, zerfall: 0.3, kopfNick: -10, sack: 0.6, rauch: 0.3 },
        { hub: -2, zerfall: 0.6, kopfNick: -20, sack: 0.3, rauch: 0.5 },
        { hub: -3, zerfall: 0.9, kopfNick: -25, rauch: 0.7 },
        { hub: -3.5, zerfall: 1, kopfNick: -25, rauch: 0.9 },
      ],
      2,
    ),
  ],
});

export default speier.sprite;
