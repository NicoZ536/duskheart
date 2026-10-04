/**
 * Wolf (Grünhain, Gegner, Rudel; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, grauer Wolf mit dunklem
 * Sattel, cremefarbener Unterseite und Schnauze, buschiger Rute, Halskrause. Nachtjäger: Augen emissiv
 * `feuer.4*` (Augenleuchten). Angriffe: `biss` (kurzes Ducken, Kopf schnellt vor) und `sprung` (tiefes
 * Ducken 0,4 s, Abstoß 0,1 s, Satz nach vorn mit gestreckten Läufen).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, zyklusClip } from '../../lib/creatureAnim';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

// Von vorn und hinten kein Grabstein (M6-Gate): Brust und Hüfte seitlich breiter als der Kopf (das Profil bleibt), Keulen mit
// heller Hose, die Ansicht von vorn und hinten 1,7 statt 1,3 breit – von hinten Ohren, Nacken, dunkler Sattel, helle Keulen,
// die dunkle Rute zwischen getrennten Läufen; von vorn spitze Ohren über heller Schnauze und breiter Brust. Mehr Breite
// sprengt die Zelle im Todesclip (der Wolf liegt dann quer).
const plan = vierbeiner({
  rumpf: { f: -0.5, u: 9.5, r: [5.6, 3.8, 3.3] },
  brust: { f: 3.4, u: 10, r: [3.6, 4.8, 4.1] },
  huefte: { f: -4.2, u: 10, r: [3.2, 4.2, 3.1] },
  hals: { f: 5.8, u: 12.4, r: [2.6, 3.4, 3.4], nick: -40 },
  kopf: { f: 8, u: 13.4, r: [3.1, 2.6, 2.9], gelenk: [5.8, 12] },
  schnauze: { f: 3.1, u: -0.9, r: [2.4, 1.6, 1.4], nick: -6 },
  kiefer: { f: 2.5, u: -1.9, r: [2.0, 1.3, 0.8], gelenk: [0.6, -1.4], oeffnen: 38 },
  ohren: { form: 'spitz', f: -0.5, s: 1.9, u: 2.2, laenge: 3.8, breite: 3.4, neigung: 4, spreizung: 16, innen: 'ohrInnen' },
  augen: {
    f: 2.2,
    s: 1.45,
    u: 0.6,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [[0, 0, 'auge', 0]],
    zu: [
      [0, 0, 'lid', 0],
      [1, 0, 'lid', 0],
    ],
  },
  nase: { f: 5.5, u: -0.6, seite: [[0, 0, 'nase', 0]], vorn: [[0, 0, 'nase', 0]] },
  beine: { vornF: 4, hintenF: -4.6, spur: 3, gelenkU: 8.2, dicke: [2, 2], pfote: 0.8, hintenKnick: -1, keule: [2.4, 1.8, 2.8] },
  schwanz: { form: 'buschig', f: -7.4, u: 11, laenge: 6.4, dicke: 2.1, winkel: -55, kruemmung: 12 },
  verbreiterung: 1.7,
  hoeheBezug: 13,
  materialien: {
    fell: { stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4'], schwellen: [0.35, 0.52, 0.8] },
    sattel: { stufen: ['stein.1', 'stein.2', 'stein.3'], schwellen: [0.5, 0.95] },
    bauch: { stufen: ['stein.3', 'stein.4', 'stein.5'], schwellen: [0.35, 0.6] },
    ohrInnen: { stufen: ['stein.1'] },
    bein: { stufen: ['stein.1', 'stein.2'] },
    pfote: { stufen: ['stein.1'] },
    auge: { stufen: ['feuer.4*'] },
    lid: { stufen: ['nacht.1'] },
    nase: { stufen: ['nacht.1'] },
    rachen: { stufen: ['laub.0', 'laub.1'] },
  },
  zeichnung: (o) => {
    const [f, , u] = o.lokal;
    if (koerperTeil(o.teil) && o.normale[2] < -0.45) return 'bauch';
    if (o.teil === 'brust' && o.normale[1] < -0.55 && o.normale[2] < 0.1) return 'bauch';
    if ((o.teil === 'schnauze' || o.teil === 'kiefer') && o.normale[2] < 0.3) return 'bauch';
    if (o.teil === 'kopf' && u < -0.35 && f > 0) return 'bauch';
    if (o.teil === 'keule' && f < -0.25) return 'bauch';
    if (o.teil === 'schwanz' && o.normale[2] > -0.2) return 'sattel';
    // Dunkler Sattel über Rücken, Kruppe und Nacken (Wolfsfärbung, gibt der Silhouette Tiefe).
    if ((o.teil === 'rumpf' || o.teil === 'huefte') && o.normale[2] > 0.62) return 'sattel';
    if (o.teil === 'hals' && o.normale[2] > 0.75) return 'sattel';
    return null;
  },
});

/** Grundhaltung: ferne Läufe leicht versetzt, damit im Profil vier Beine lesbar sind. */
const RUHE = { vlF: 1.3, hlF: -1.3 };

export const wolf = kreatur({
  id: 'wolf',
  zelle: 32,
  anker: [16, 25],
  hoehe: 'kugel',
  massstab: 0.84,
  plan,
  // Von vorn und hinten stehen die Ohren aufrecht und etwas länger (im Profil liegen sie im Fell): sie tragen den Kopf über
  // der breiten Brust bzw. dem Nacken.
  jeRichtung: { down: { ohren: -12, ohrLang: 1.2, kopfHub: 1.6 }, up: { ohren: -10, ohrLang: 1.2 } },
  clips: [
    idleClip(RUHE, { ...RUHE, kopfNick: -4, schwanz: 4 }, { ...RUHE, hub: -1, kopfNick: -4, schwanz: 6 }, { ...RUHE, hub: -1, kopfNick: 2, schwanz: 2 }),
    zyklusClip('move', 6, 12, (ph) => gangPose({ art: 'galopp', schritt: 3.2, anheben: 2.2, koerperHub: 1.4, koerperNick: 7, kopfNick: 6, schwanz: 10 }, ph), [0, 3]),
    angriffClip({
      name: 'biss',
      fps: 10,
      // Gestemmter, breiter Stand (`spreiz`) und erhobene Rute: das Ausholen liest sich auch von vorn und hinten.
      aushol: [
        { hub: -1, vor: -1, nick: -3, kopfNick: 8, ohren: 20, maul: 0.3, hlF: 0.5, hrF: 0.5, spreiz: 0.8, schwanz: 15 },
        { hub: -2, vor: -2, nick: -5, kopfNick: 12, kopfHub: -0.5, ohren: 35, maul: 0.7, hlF: 1, hrF: 1, vlF: -0.5, vrF: -0.5, stauch: -0.06, spreiz: 1.6, schwanz: 30 },
      ],
      halten: 2,
      schlag: { vor: 1.2, kopfVor: 1.2, kopfNick: -10, maul: 1, ohren: 20, vlF: 1.5, vrF: 1.5 },
      schmierTeile: ['kopf'],
      treffer: { vor: 1.5, kopfVor: 1.5, kopfNick: -6, maul: 0.3, ohren: 10, vlF: 2, vrF: 2 },
      nach: [{ vor: 1, maul: 0, vlF: 1, vrF: 1 }, { vor: 0.3 }],
    }),
    angriffClip({
      name: 'sprung',
      fps: 10,
      // Geduckt mit tiefer Brust, gestemmten Läufen und erhobener Rute – im Profil der Lauerstand, von hinten die breite Hocke.
      aushol: [
        { hub: -1.5, vor: -1, nick: -6, kopfNick: 2, kopfHub: -0.8, ohren: 30, stauch: -0.08, hlF: 1.5, hrF: 1.5, spreiz: 1, schwanz: 15 },
        { hub: -3, vor: -2, nick: -10, kopfNick: 2, kopfHub: -1.5, ohren: 40, stauch: -0.16, hlF: 2.5, hrF: 2.5, vlF: -1, vrF: -1, spreiz: 1.8, schwanz: 30 },
      ],
      // 0,4 s geduckt, dann 0,1 s Abstoß (die Simulation trägt den Körper in diesen Ticks zum Ziel), Schlag nach 0,5 s.
      halten: 2,
      anlauf: [{ hub: -0.5, vor: 0.5, nick: 6, kopfNick: 2, ohren: 35, stauch: 0.06, hlF: -2, hrF: -2, vlF: 2, vrF: 2, vlU: 1.5, vrU: 1.5, schwanz: 5 }],
      // Der Satz hebt den Körper 2,4 px: von hinten bleiben die aufgestellten Ohren 1 px vom Zellrand.
      schlag: { hub: 2.4, vor: 1, nick: 12, maul: 0.8, beineSchlaff: 0.7, vlF: 3, vrF: 3, hlF: -3.5, hrF: -3.5, vlU: 3, vrU: 3, hlU: 3, hrU: 3, ohren: 30, schwanz: 15 },
      treffer: { hub: 2, vor: 2.5, nick: -10, maul: 1, beineSchlaff: 0.4, vlF: 3, vrF: 3, hlF: -2.5, hrF: -2.5, vlU: 1, vrU: 1, hlU: 2, hrU: 2, kopfNick: -8 },
      nach: [{ hub: -1, vor: 1.5, nick: -4, stauch: -0.06, maul: 0.2 }, { vor: 0.5 }],
    }),
    vierbeinerTreffer(),
    vierbeinerTod(),
  ],
});

export default wolf.sprite;
