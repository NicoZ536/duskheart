/**
 * Zweigling (Diener des Borkenvaters; MASTERPROMPT §20.2 „beschworene Zweiglinge“, docs/SPIEL.md §22, M7-34, Strang F):
 * 32×32, ein Knäuel aus Zweigen und Borke auf zwei Wurzelbeinen – der Bauplan des Buschwesens (`busch`, wie der Dornling),
 * aber immer enthüllt und ganz in Holz: Massen und Bündel in `holz.0`–`holz.3` (Kontur `nacht.1` wie jede Kreatur), aus dem
 * Knäuel stechende Zweigstummel (`holz.1`), vorn ein Astloch mit glimmenden Augen (`feuer.4*`, er ist ein Nachtjäger der
 * Arena), im Maul und welkend der violette Hauch der Verderbnis (`verderb.2`).
 *
 * Clips nach docs/ART.md §15.3: `idle` 8@8, `move` 6@12 (trippelnd, Events `schritt` 0/3), `attack_kratzer` 9@10 (Ausholen
 * 0–3 = 0,4 s wie `ausholzeit` des Contents: das Knäuel bäumt sich, die Zweige sträuben sich, die Ranke holt aus · Schlag 4 ·
 * Treffer 5), `hit` 2@8, `death` 5@8 (zerfällt welkend, Event `aufprall` 3). Er lebt in keiner Spawntabelle; sein Sprite liegt
 * im Kontaktbogen des Bosses (`boss_borkenvater.png`).
 */
import { kreatur, type Bauplan } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { busch } from '../../lib/creatureBusch';

const MASSEN = [
  { f: 0, s: 0, u: 8, r: [4.4, 4.4, 4.2] },
  { f: -1.8, s: -2.9, u: 6.2, r: [3, 3, 2.8] },
  { f: -1.8, s: 2.9, u: 6.2, r: [3, 3, 2.8] },
  { f: 1.8, s: 0, u: 5.8, r: [3, 3.6, 2.8] },
] as const;

const basis = busch({
  massen: MASSEN,
  buendel: { anzahl: 18, radius: 1.4 },
  dornen: { anzahl: 20, laenge: 4.4 },
  beeren: 0,
  hoehle: { f: 4.3, u: 7.4, r: [1.4, 2.6, 1.8] },
  spalt: { f: 1.2, u: 11.8, r: [1.2, 2.4, 0.9] },
  augen: {
    s: 1.7,
    u: 0.5,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
  },
  beine: { f: [1.8, -1.8], spur: 3.6, laenge: 4 },
  ranke: { laenge: 7, u: 7 },
  seed: 5150,
  hoeheBezug: 12,
  materialien: {
    laub: { stufen: ['holz.0', 'holz.1', 'holz.2', 'holz.3'], schwellen: [0.34, 0.54, 0.8] },
    welk: { stufen: ['holz.0', 'verderb.2', 'holz.1'], schwellen: [0.42, 0.66] },
    dorn: { stufen: ['holz.0'] },
    beere: { stufen: ['holz.2'] },
    hoehle: { stufen: ['nacht.0'] },
    auge: { stufen: ['feuer.4*'] },
    maul: { stufen: ['verderb.2'] },
    rinde: { stufen: ['holz.1'] },
    ranke: { stufen: ['holz.1', 'holz.2'] },
  },
});

const plan: Bauplan = { ...basis, kontur: 'nacht.1' };

/** Immer enthüllt: das Knäuel steht auf seinen Wurzelbeinen. */
const OFFEN = { offen: 1, hub: 2 };

export const zweigling = kreatur({
  id: 'zweigling',
  zelle: 32,
  anker: [16, 26],
  hoehe: 'kugel',
  plan,
  jeRichtung: { up: { lugen: 1 } },
  clips: [
    idleClip(OFFEN, { ...OFFEN, wackeln: 4 }, { ...OFFEN, hub: 1.4, wackeln: 4, dornen: 0.3 }, { ...OFFEN, hub: 1.4, wackeln: -3 }),
    zyklusClip('move', 6, 12, (ph) => ({ ...OFFEN, gang: ph, schritt: 1.8, hub: 2 + 0.7 * Math.cos(4 * Math.PI * ph), wackeln: 6 * Math.sin(2 * Math.PI * ph) }), [0, 3]),
    angriffClip({
      name: 'kratzer',
      fps: 10,
      aushol: [
        { ...OFFEN, ranke: 0.3, rankeHub: 3, nick: -8, vor: -0.5, dornen: 0.5 },
        { ...OFFEN, ranke: 0.45, rankeHub: 6, nick: -12, vor: -1, maul: 0.5, dornen: 1 },
      ],
      halten: 2,
      schlag: { ...OFFEN, ranke: 0.95, rankeHub: 1, nick: 8, vor: 0.4, maul: 1, dornen: 0.6 },
      schmierTeile: ['ranke'],
      treffer: { ...OFFEN, ranke: 0.95, rankeHub: -1, nick: 10, vor: 0.5, maul: 0.7 },
      nach: [{ ...OFFEN, ranke: 0.5, rankeHub: 1, nick: 2 }, { ...OFFEN, ranke: 0.1 }],
    }),
    trefferClip({ ...OFFEN, vor: -1.5, hub: 2.5, wackeln: -10, nick: -8 }, { ...OFFEN, hub: 1, wackeln: 5 }),
    todClip(
      [
        { ...OFFEN, vor: -1.5, hub: 2.5, wackeln: -10 },
        { offen: 0.9, hub: 0.6, wackeln: 12, nick: -6, welk: 1 },
        { offen: 0.6, welk: 1, liegen: 0.35, wackeln: 18 },
        { offen: 0.4, welk: 1, liegen: 0.6, wackeln: 24 },
        { offen: 0.3, welk: 1, liegen: 0.7, wackeln: 26 },
      ],
      3,
    ),
  ],
});

/** Im Kontaktbogen des Bosses, dem er dient. */
export default { ...zweigling.sprite, group: 'boss_borkenvater' };
