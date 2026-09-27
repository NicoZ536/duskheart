/**
 * Screenshot scenarios of the hearth screen (M4-20, MASTERPROMPT §31.5), registered in src/debug/scenarios.ts.
 *
 * `ui-herdfeuer`: on the start beach at 11:00 a hearthfire is built
 * north of the player (`build.place`, the first free 3 × 3 spot) and two wooden chests beside it; 12 logs and 4
 * pieces of charcoal go into its store, it is lit and burns 40 game minutes – "Brennt noch 23 h 20 min". The first
 * chest is "Baustoffe" with a stone label (stone, wood, clay), the second keeps its name (fibres, raspberries). The
 * hearth screen open (`hearth.use`): the ring in flames with glow bar and "Löschen", the store (gauge 15/40, the
 * wood and charcoal stacks), safe zone 12 fields, "Am Herdfeuer erwachen", the six locked ember core niches with
 * the hint where cores come from | the bags (wood and charcoal bright) | the storage overview with both chests,
 * "Baustoffe" chosen and its slots shown. Keyboard focus frame on "Löschen".
 *
 * `ui-herdfeuer-aus`: the same hearth freshly built, cold and empty – "Erloschen", "Kein Brennstoff", "Entzünden"
 * locked, six free compartments, no protection, the overview waiting for the fire; the focus frame on the wood in
 * the bags.
 */
import { TILE_PX } from '../../../world/model/coords';
import { befehle, schritte, werkstattSzenario, type SzenarioSchritt, type WerkstattSzenario, type WerkstattSzenarioSitzung } from '../handwerk/szenarioHilfe';

/** Anchors (north-west tile) tried for the 3 × 3 hearth relative to the player's tile, nearest first. */
const HERD_VERSUCHE: ReadonlyArray<readonly [number, number]> = [
  [-1, -4],
  [-1, 2],
  [-5, -1],
  [3, -1],
  [-5, -4],
  [3, -4],
  [-5, 2],
  [3, 2],
];
/** Tiles tried for the chests relative to the player's tile. */
const KISTEN_VERSUCHE: ReadonlyArray<readonly [number, number]> = [
  [2, 0],
  [-2, 0],
  [2, 1],
  [-2, 1],
  [3, 0],
  [-3, 0],
  [1, 2],
  [-1, 2],
  [3, 2],
  [-3, 2],
];
/** Game minutes the lit hearth burns before the picture [ticks at the default day length: 60 per game minute]. */
const BRENNZEIT_TICKS = 40 * 60;
const TICKS_JE_FRAME = 200;

/**
 * A step that builds `part` next to the player, one try per frame, until the event count `ereignis` rose;
 * `fertig(id)` receives the new id (ids start at 1, so the count is the id).
 */
function bauen(part: string, versuche: ReadonlyArray<readonly [number, number]>, ereignis: 'hearthBuilt' | 'chestPlaced', fertig: (id: number) => void): SzenarioSchritt {
  let versuch = 0;
  let vorher = -1;
  return (s: WerkstattSzenarioSitzung) => {
    const st = s.state();
    const zahl = st.events[ereignis];
    if (vorher >= 0 && zahl > vorher) {
      fertig(zahl);
      return true;
    }
    const at = st.player;
    if (at === null) return false;
    const off = versuche[versuch++];
    if (off === undefined) throw new Error(`Szenario ui-herdfeuer: kein freier Platz für ${part} neben dem Spieler`);
    vorher = zahl;
    s.command({ type: 'build.place', part, tx: Math.floor(at.x / TILE_PX) + off[0], ty: Math.floor(at.y / TILE_PX) + off[1] });
    s.step();
    return false;
  };
}

/** Both scenarios (see the module comment). */
export function herdfeuerSzenarien(): WerkstattSzenario[] {
  return [herdfeuerSzenario(), herdfeuerAusSzenario()];
}

function herdfeuerAusSzenario(): WerkstattSzenario {
  let herd = 0;
  return werkstattSzenario({
    name: 'ui-herdfeuer-aus',
    description:
      'M4-20: Herdfeuer-Bildschirm eines frisch gebauten, kalten Herdfeuers – „Erloschen“, „Kein Brennstoff“, „Entzünden“ gesperrt, sechs freie Fächer (0/40), kein Schutz, Erwachen nur, wenn es brennt, gesperrte Glutkern-Nischen | die Taschen mit Holz und Holzkohle hell | die Lagerübersicht wartet auf das Feuer; Fokusrahmen auf dem Holz in den Taschen',
    items: [
      ['herdfeuer', 1],
      ['holz', 20],
      ['holzkohle', 6],
      ['stein', 12],
      ['steinaxt', 1],
    ],
    schritte: [bauen('herdfeuer', HERD_VERSUCHE, 'hearthBuilt', (id) => (herd = id)), (s) => befehle({ type: 'hearth.use', hearth: herd })(s)],
    fokus: '[data-testid="herd-tasche-inventar-1"]',
  });
}

function herdfeuerSzenario(): WerkstattSzenario {
  let herd = 0;
  let kiste1 = 0;
  let kiste2 = 0;
  return werkstattSzenario({
    name: 'ui-herdfeuer',
    description:
      'M4-20: Herdfeuer-Bildschirm – der Ring in Flammen mit Glut und „Löschen“, „Brennt noch 23 h 20 min“ (Spielzeit), Vorratsfach 15/40 mit Holz und Holzkohle, Schutzzone 12 Felder, „Am Herdfeuer erwachen“, sechs gesperrte Glutkern-Nischen mit dem Hinweis auf die Leuchtfeuer | die Taschen (Brennstoff hell) | Lagerübersicht mit zwei Kisten der Basis, „Baustoffe“ gewählt und ihr Inhalt; Fokusrahmen auf „Löschen“',
    items: [
      ['herdfeuer', 1],
      ['kiste_holz', 2],
      ['holz', 30],
      ['holzkohle', 8],
      ['stein', 20],
      ['lehm', 6],
      ['fasern', 12],
      ['himbeeren', 5],
      ['steinaxt', 1],
    ],
    schritte: [
      bauen('herdfeuer', HERD_VERSUCHE, 'hearthBuilt', (id) => (herd = id)),
      bauen('kiste_holz', KISTEN_VERSUCHE, 'chestPlaced', (id) => (kiste1 = id)),
      bauen('kiste_holz', KISTEN_VERSUCHE, 'chestPlaced', (id) => (kiste2 = id)),
      (s) =>
        befehle(
          { type: 'hearth.fuel', hearth: herd, from: { bereich: 'inventar', index: 2 }, count: 12 },
          { type: 'hearth.fuel', hearth: herd, from: { bereich: 'inventar', index: 3 }, count: 4 },
          { type: 'hearth.ignite', hearth: herd },
          { type: 'storage.put', chest: kiste1, from: { bereich: 'inventar', index: 4 } },
          { type: 'storage.put', chest: kiste1, from: { bereich: 'inventar', index: 2 }, count: 10 },
          { type: 'storage.put', chest: kiste1, from: { bereich: 'inventar', index: 5 } },
          { type: 'storage.rename', chest: kiste1, name: 'Baustoffe' },
          { type: 'storage.label', chest: kiste1, item: 'stein' },
          { type: 'storage.put', chest: kiste2, from: { bereich: 'inventar', index: 6 } },
          { type: 'storage.put', chest: kiste2, from: { bereich: 'inventar', index: 7 } },
        )(s),
      schritte(BRENNZEIT_TICKS, TICKS_JE_FRAME),
      (s) => befehle({ type: 'hearth.use', hearth: herd })(s),
    ],
    klicks: ['[data-testid="herd-kiste-1"]'],
    fokus: '[data-testid="herd-schalter"]',
  });
}
