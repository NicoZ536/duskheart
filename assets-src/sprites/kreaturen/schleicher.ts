/**
 * Schleicher (Schattenbrut; MASTERPROMPT §12.4, §20.1, docs/ART.md §15): 32×32, flache, lange Raubkatze
 * aus Tinten-Rauch – kein Umriss, violetter Randsaum, glühende Augen `eis.4*`, Rauchfahnen über dem Rücken
 * und an der peitschenden Schwanzspitze. Angriffe: `klaue` (Pranke hebt sich, schlägt nieder) und
 * `sprung` (tiefes Ducken, Satz nach vorn).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { rauchFahnen, SCHATTEN_SAUM, schattenMaterialien } from '../../lib/creatureSchatten';
import { gangPose, vierbeiner } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -0.5, u: 7.2, r: [6.2, 3.6, 3.1] },
  brust: { f: 3.4, u: 7.6, r: [3.4, 3.8, 3.5] },
  huefte: { f: -4.6, u: 7.8, r: [3.2, 3.4, 3] },
  hals: { f: 6, u: 8.4, r: [2.3, 2.5, 2.4], nick: -25 },
  kopf: { f: 8.3, u: 9, r: [3, 3, 2.5], gelenk: [6, 8] },
  schnauze: { f: 2.2, u: -0.6, r: [1.8, 1.6, 1.1] },
  kiefer: { f: 1.9, u: -1.3, r: [1.7, 1.4, 0.6], gelenk: [0.4, -1], oeffnen: 40 },
  ohren: { form: 'spitz', f: -1, s: 1.7, u: 1.3, laenge: 3.2, breite: 2.4, neigung: 28, spreizung: 22, innen: 'ohrInnen' },
  augen: {
    f: 2,
    s: 1.35,
    u: 0.4,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    zu: [
      [0, 0, 'lid', 0],
      [1, 0, 'lid', 0],
    ],
  },
  beine: { vornF: 4, hintenF: -4.8, spur: 2.3, gelenkU: 6.4, dicke: [2, 2], pfote: 1, hintenKnick: -1 },
  schwanz: { form: 'duenn', f: -7.2, u: 8, laenge: 7, dicke: 2, winkel: 20, kruemmung: -35 },
  kontur: null,
  saum: SCHATTEN_SAUM,
  hoeheBezug: 10,
  materialien: schattenMaterialien('eis.4*'),
  extra: (bau, { koerper, w, nur }) => {
    if (nur !== null) return;
    bau.teil('rauch', 'rauch', 'rauch');
    rauchFahnen(bau, koerper, w['rauch'] ?? 0, { f: -1, s: 0, u: 2, streuung: [4, 1.5, 0.5], steigen: 6 + 4 * (w['zerfall'] ?? 0), dicke: 1.2 + (w['zerfall'] ?? 0), anzahl: 5 + Math.round((w['zerfall'] ?? 0) * 5), drift: 1.4 }, 701);
  },
});

const RUHE = { vlF: 1, hlF: -1, schwanz: 6 };

export const schleicher = kreatur({
  id: 'schleicher',
  zelle: 32,
  anker: [16, 24],
  hoehe: 'kugel',
  massstab: 0.9,
  plan,
  clips: [
    idleClip({ ...RUHE, rauch: 0 }, { ...RUHE, rauch: 0.25, kopfNick: -4, wedel: 10 }, { ...RUHE, rauch: 0.5, hub: -1, kopfNick: -4, wedel: 16 }, { ...RUHE, rauch: 0.75, hub: -1, wedel: 6 }),
    zyklusClip('move', 6, 12, (ph) => ({ ...gangPose({ art: 'galopp', schritt: 3, anheben: 2, koerperHub: 1, koerperNick: 6, kopfNick: 4, schwanz: 14 }, ph), hub: -1, rauch: ph }), [0, 3]),
    angriffClip({
      name: 'klaue',
      fps: 10,
      aushol: [
        { hub: -0.5, vor: -1, nick: 8, vrU: 3, vrF: 1, kopfNick: 6, ohren: 15, rauch: 0.1 },
        { hub: 0, vor: -1.5, nick: 14, vrU: 6, vrF: 1.5, kopfNick: 10, ohren: 25, maul: 0.5, rauch: 0.2 },
      ],
      halten: 2,
      schlag: { vor: 1.5, nick: -6, vrU: 0.5, vrF: 5, kopfNick: -6, maul: 0.8, rauch: 0.3 },
      schmierTeile: ['bein'],
      treffer: { vor: 2, nick: -8, vrU: 0, vrF: 5.5, kopfNick: -8, maul: 0.3, rauch: 0.35 },
      nach: [{ vor: 0.8, vrF: 2, rauch: 0.45 }, { rauch: 0.55 }],
    }),
    angriffClip({
      name: 'sprung',
      fps: 10,
      aushol: [
        { hub: -1.5, vor: -1, ohren: 30, stauch: -0.1, hlF: 1.5, hrF: 1.5, rauch: 0.1 },
        { hub: -2.5, vor: -2, ohren: 40, stauch: -0.18, hlF: 2.5, hrF: 2.5, vlF: -1, vrF: -1, wedel: 20, rauch: 0.2 },
      ],
      halten: 3,
      schlag: { hub: 4, vor: 1.5, nick: 10, maul: 1, beineSchlaff: 0.7, vlF: 3, vrF: 3, hlF: -3.5, hrF: -3.5, vlU: 3, vrU: 3, hlU: 3, hrU: 3, rauch: 0.3 },
      schmierTeile: ['rumpf', 'kopf'],
      treffer: { hub: 1.5, vor: 2.5, nick: -10, maul: 1, beineSchlaff: 0.4, vlF: 3, vrF: 3, hlF: -2.5, hrF: -2.5, vlU: 1, vrU: 1, hlU: 2, hrU: 2, rauch: 0.4 },
      nach: [{ hub: -1, vor: 1.5, nick: -4, stauch: -0.06, rauch: 0.5 }, { vor: 0.5, rauch: 0.6 }],
    }),
    trefferClip({ vor: -1.5, hub: 0.5, kopfNick: 18, augenZu: 1, ohren: 35, rauch: 0.2 }, { vor: -0.5, hub: -1, kopfNick: -6, ohren: 25, rauch: 0.4 }),
    todClip(
      [
        { vor: -1.5, hub: 0.5, kopfNick: 18, augenZu: 1, ohren: 35, rauch: 0.1 },
        { hub: -1.5, stauch: -0.15, kopfNick: -12, augenZu: 1, vor: 1.5, zerfall: 0.3, rauch: 0.3 },
        { hub: -2.5, stauch: -0.3, augenZu: 1, vor: 1.5, zerfall: 0.6, rauch: 0.5, beineSchlaff: 0.5 },
        { hub: -3.5, stauch: -0.45, augenZu: 1, vor: 1.5, zerfall: 0.9, rauch: 0.7, beineSchlaff: 0.8 },
        { hub: -4.5, stauch: -0.6, augenZu: 1, vor: 1.5, zerfall: 1, rauch: 0.9, beineSchlaff: 1 },
      ],
      2,
    ),
  ],
});

export default schleicher.sprite;
