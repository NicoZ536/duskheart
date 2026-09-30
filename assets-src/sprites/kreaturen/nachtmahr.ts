/**
 * Nachtmahr (Schattenbrut, groß; MASTERPROMPT §12.3, §12.4, §20.1, docs/ART.md §15): 64×64, ein hagerer
 * Schattenhengst aus Tinten-Rauch mit langen Läufen, zurückgebogenen Hörnern, einer Mähne und einem Schweif
 * aus Rauchfahnen und glühenden Augen `eis.4*`; violett glimmende Risse (`verderb.3*`) auf Brust und Hals.
 * Kein Umriss, violetter Randsaum. Angriffe: `stampfen` (steigt hoch auf – lange Ausholphase –, schlägt
 * mit den Vorderhufen nieder) und `ansturm` (senkt Kopf und Hörner, scharrt, stürmt vor).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { KOERPER, punktIn, rahmen } from '../../lib/creatureBau';
import { rauchFahnen, SCHATTEN_SAUM, schattenMaterialien } from '../../lib/creatureSchatten';
import { gangPose, vierbeiner } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -1, u: 22, r: [9.4, 5.2, 5.6] },
  brust: { f: 5.6, u: 23, r: [5.6, 5.4, 6.6] },
  huefte: { f: -7.6, u: 23.2, r: [5.4, 5.2, 5.6] },
  hals: { f: 10.4, u: 29.6, r: [3.6, 3.4, 7.4], nick: -52 },
  kopf: { f: 15.4, u: 35.6, r: [4.6, 3.2, 3.2], gelenk: [11.6, 31], nick: -32 },
  schnauze: { f: 4.2, u: -2.4, r: [3.2, 2.4, 2.2], nick: -34 },
  kiefer: { f: 3.4, u: -3.8, r: [2.8, 2, 1.1], gelenk: [0.8, -2.4], oeffnen: 30 },
  ohren: { form: 'spitz', f: -2.6, s: 1.9, u: 2.4, laenge: 4, breite: 2.4, neigung: 22, spreizung: 14, innen: 'ohrInnen' },
  augen: {
    f: 1.6,
    s: 2.4,
    u: 0.9,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
      [2, -1, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
      [2, -1, 'auge', 0],
    ],
    zu: [
      [0, 0, 'lid', 0],
      [1, 0, 'lid', 0],
      [2, 0, 'lid', 0],
    ],
  },
  beine: { vornF: 6.6, hintenF: -8.2, spur: 3.2, gelenkU: 17, dicke: [3, 2], pfote: 1.6, hintenKnick: -1 },
  kontur: null,
  saum: SCHATTEN_SAUM,
  hoeheBezug: 30,
  materialien: schattenMaterialien('eis.4*'),
  zeichnung: (o) => {
    const [f, s, u] = o.lokal;
    // Glimmende Risse: schmale Zickzackbänder auf Brust und Hals.
    if (o.teil === 'brust' || o.teil === 'hals' || o.teil === 'kopf') {
      const riss = Math.abs(Math.sin(u * 9 + Math.sin(s * 7) * 1.2 + f * 3));
      if (riss < 0.09 && o.normale[1] < 0.2) return 'glut';
    }
    return null;
  },
  extra: (bau, { kopf, koerper, w, nur }) => {
    const zerfall = w['zerfall'] ?? 0;
    const phase = w['rauch'] ?? 0;
    if (nur === null || nur.has('kopf')) {
      bau.teil('horn', 'horn', 'horn');
      for (const seite of [-1, 1]) {
        const r = rahmen(KOERPER, punktIn(kopf, [-1.4, 1.6 * seite, 2.4]));
        bau.zug('horn', r, [
          [0, 0, 0],
          [-1.6, 0.8 * seite, 3.4],
          [-4.2, 1.4 * seite, 5.2],
          [-7.4, 1.6 * seite, 5.4],
          [-9.2, 1.4 * seite, 4.2],
        ], 2, 1);
      }
    }
    if (nur !== null) return;
    bau.teil('rauch', 'rauch', 'rauch');
    // Mähne entlang des Halses, Schweif, Rauch an den Hufen.
    rauchFahnen(bau, koerper, phase, { f: 10, s: 0, u: 9, streuung: [3, 1, 4], steigen: 7, dicke: 1.8 + zerfall, anzahl: 6 + Math.round(zerfall * 4), drift: 1.5 }, 907);
    rauchFahnen(bau, koerper, phase, { f: -13, s: 0, u: 1, streuung: [2, 1.5, 2.5], steigen: 9, dicke: 2.2 + zerfall, anzahl: 6, drift: 1.1 }, 911);
    rauchFahnen(bau, KOERPER, phase, { f: 0, s: 0, u: 1, streuung: [9, 3, 0.5], steigen: 4, dicke: 1.4 + zerfall, anzahl: 4 + Math.round(zerfall * 4), drift: 0.4 }, 919);
  },
});

const RUHE = { vlF: 1.6, hlF: -1.6, rauch: 0 };

export const nachtmahr = kreatur({
  id: 'nachtmahr',
  zelle: 64,
  anker: [32, 54],
  hoehe: 'kugel',
  massstab: 0.88,
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, kopfNick: -6, rauch: 0.25 }, { ...RUHE, hub: -1, kopfNick: -8, kopfHub: -0.8, rauch: 0.5 }, { ...RUHE, hub: -1, kopfNick: 6, rauch: 0.75 }),
    zyklusClip('move', 6, 12, (ph) => ({ ...gangPose({ art: 'galopp', schritt: 6, anheben: 4.4, koerperHub: 2.4, koerperNick: 6, kopfNick: 10 }, ph), rauch: ph }), [0, 3]),
    angriffClip({
      name: 'stampfen',
      fps: 10,
      aushol: [
        { nick: 14, hub: 2, vlU: 5, vrU: 4, vlF: 1, kopfNick: 12, ohren: 20, rauch: 0.1 },
        { nick: 26, hub: 4, vlU: 10, vrU: 8, vlF: 2, vrF: 1, kopfNick: 20, maul: 0.6, ohren: 30, hlF: 2, hrF: 2, rauch: 0.2 },
        { nick: 32, hub: 5, vlU: 12, vrU: 11, vlF: 1, vrF: 2.5, kopfNick: 26, maul: 1, ohren: 35, hlF: 2.5, hrF: 2.5, rauch: 0.3 },
      ],
      halten: 4,
      schlag: { nick: -4, hub: 0, vlU: 1, vrU: 1, vlF: 5, vrF: 5, kopfNick: -12, maul: 0.8, rauch: 0.4 },
      schmierTeile: ['bein', 'kopf'],
      treffer: { nick: -8, hub: -1.5, stauch: -0.06, vlF: 5.5, vrF: 5.5, kopfNick: -18, maul: 0.5, rauch: 0.45 },
      nach: [{ nick: -3, hub: -0.5, vlF: 3, vrF: 3, kopfNick: -6, rauch: 0.55 }, { ...RUHE, rauch: 0.65 }],
    }),
    angriffClip({
      name: 'ansturm',
      fps: 10,
      aushol: [
        { kopfNick: -18, kopfHub: -3, hub: -1, hrF: 2, hrU: 2, ohren: 25, rauch: 0.1 },
        { kopfNick: -28, kopfHub: -5, hub: -2, hrF: -2, hlF: 2, hlU: 2, ohren: 35, vor: -1, rauch: 0.2 },
        { kopfNick: -28, kopfHub: -5, hub: -2, hrF: 2, hrU: 2, hlF: -2, ohren: 35, vor: -1.5, rauch: 0.3 },
      ],
      halten: 3,
      anlauf: [0, 0.5].map((ph) => ({ ...gangPose({ art: 'galopp', schritt: 6, anheben: 4, koerperHub: 2, koerperNick: 5 }, ph), kopfNick: -28, kopfHub: -5, vor: 2, rauch: 0.4 + ph * 0.2 })),
      schlag: { ...gangPose({ art: 'galopp', schritt: 6, anheben: 4, koerperHub: 2, koerperNick: 5 }, 0.25), kopfNick: -24, kopfHub: -4, vor: 3, rauch: 0.7 },
      schmierTeile: [],
      treffer: { kopfNick: 14, kopfHub: 1, vor: 3.5, nick: 8, maul: 0.8, vlF: 3, vrF: 3, rauch: 0.8 },
      nach: [{ kopfNick: 4, vor: 1.5, nick: 2, rauch: 0.9 }, { ...RUHE }],
    }),
    trefferClip({ vor: -2.5, hub: 1, nick: 8, kopfNick: 22, augenZu: 1, ohren: 35, rauch: 0.2 }, { vor: -1, hub: -1.5, kopfNick: -8, ohren: 25, rauch: 0.4 }),
    todClip(
      [
        { vor: -2.5, hub: 1, nick: 10, kopfNick: 24, augenZu: 1, ohren: 35, rauch: 0.1 },
        { hub: -3, stauch: -0.1, kopfNick: -16, augenZu: 1, zerfall: 0.25, rauch: 0.25 },
        { hub: -6, stauch: -0.25, kopfNick: -26, augenZu: 1, zerfall: 0.5, beineSchlaff: 0.4, rauch: 0.4 },
        { hub: -9, stauch: -0.4, kopfNick: -30, augenZu: 1, zerfall: 0.75, beineSchlaff: 0.7, rauch: 0.55 },
        { hub: -12, stauch: -0.55, kopfNick: -34, augenZu: 1, zerfall: 0.95, beineSchlaff: 1, rauch: 0.7 },
        { hub: -13, stauch: -0.62, kopfNick: -34, augenZu: 1, zerfall: 1, beineSchlaff: 1, rauch: 0.85 },
      ],
      3,
    ),
  ],
});

export default nachtmahr.sprite;
