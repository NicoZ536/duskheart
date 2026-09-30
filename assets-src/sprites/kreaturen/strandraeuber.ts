/**
 * Strandräuber (Salzküste, Gegner, die Gezeichneten; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, ein
 * Mensch aus dem Figuren-Rig der Spielfigur, von der Dunkelheit gezeichnet: fahle graue Haut (`stein`),
 * dunkles, strähniges Haar (`nacht`), glühende Augen `verderb.4*` und die violette Schärpe der Gezeichneten;
 * ausgeblichenes rotes Hemd (`laub`, hebt sich von Sand und Gras ab), dunkle Hose und Stiefel (`erde`), in
 * der Hand ein kurzes Entermesser (Klinge und Parierstange `stein`, Griff `erde`). Clips aus den
 * Spieler-Aktionen: `idle` (Atemwelle), `move` (Rennen), `attack_hieb` (Werkzeugschlag mit verlängerter
 * Ausholphase), `hit`, `death` (die Waffe fällt aus der Hand). Alle vier Richtungen eigens (Waffenhand).
 */
import { werkzeugSprite, WERKZEUG_FRAME } from '../../lib/figureWerkzeug';
import { mensch, type MenschAktion } from '../../lib/creatureMensch';
import { sprite } from '../../lib/sprite';
import type { Bild, Richtung } from '../../lib/figure';
import { AKTIONEN, istSonder, type Aktion } from '../figuren/_spieler_aktionen';
import { framesDerAktion } from '../figuren/_spieler_bilder';
import { bildDerPose, ZELLE } from '../figuren/_spieler_rig';

/** Entermesser: breite, leicht gebogene Klinge, Parierstange, Holzgriff (Griffpixel `+`). */
const ENTERMESSER = sprite(
  werkzeugSprite({
    id: 'kreatur_strandraeuber_entermesser',
    raster: `.k...
             kek..
             kdek.
             kddek
             .kdk.
             kRRRk
             .k+k.
             ..k..`,
    griffZeichen: 'o',
    legende: { '.': null, k: 'nacht.1', e: 'stein.4', d: 'stein.3', R: 'stein.3', o: 'erde.1' },
    wirkpunkt: [0, -3],
    schmier: 'e',
    halten: 'oben',
  }),
);

/** Legende: fahle Haut, dunkles Haar, ausgeblichenes rotes Hemd, Schärpe der Gezeichneten, Augen emissiv (11 Farben). */
const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  '1': 'nacht.2',
  '2': 'nacht.2',
  '3': 'nacht.3',
  m: 'stein.3',
  S: 'stein.4',
  b: 'laub.1',
  t: 'laub.2',
  T: 'laub.2',
  g: 'verderb.2',
  G: 'verderb.2',
  p: 'erde.0',
  P: 'erde.1',
  e: 'erde.0',
  E: 'erde.1',
  w: 'laub.2',
  A: 'verderb.4*',
} as const;

function aktion(name: string): Aktion {
  const a = AKTIONEN.find((x) => x.name === name);
  if (a === undefined) throw new Error(`Strandräuber: Spieler-Aktion ${name} fehlt`);
  return a;
}

function bilderVon(a: Aktion): (r: Richtung) => readonly Bild[] {
  return (r) => framesDerAktion(a, r).map((def) => (istSonder(def) ? def.sonder(r) : bildDerPose(r, def)));
}

/** Waffe gehalten: Halte-Clip der Richtung. */
const halten = (r: Richtung): number => ENTERMESSER.clips[r]?.frames[0] ?? WERKZEUG_FRAME.s;
/**
 * Schlag: Item-Frame zur ersten Clip-Position jedes Körper-Bildes im Spieler-Werkzeugclip. Von vorn endet
 * der Durchschlag mit der Klinge quer statt nach unten (sonst ragte sie aus der Zelle).
 */
function schlagFrame(r: Richtung, bild: number): number {
  if (r === 'down' && bild === 3) return WERKZEUG_FRAME.w;
  const tool = aktion('tool');
  const pos = tool.folge.indexOf(bild);
  return ENTERMESSER.clips[`tool_${r}`]?.frames[pos] ?? halten(r);
}

const AKTIONEN_RAEUBER: readonly MenschAktion[] = [
  { clip: 'idle', fps: 8, loop: true, folge: aktion('idle').folge, events: [], bilder: bilderVon(aktion('idle')), waffe: (r) => halten(r) },
  { clip: 'move', fps: 12, loop: true, folge: aktion('run').folge, events: aktion('run').events, bilder: bilderVon(aktion('run')), waffe: (r) => halten(r) },
  {
    clip: 'attack_hieb',
    fps: 10,
    loop: false,
    folge: [0, 1, 1, 1, 1, 2, 3, 3],
    events: [
      { frame: 0, name: 'ausholen' },
      { frame: 5, name: 'schlag' },
      { frame: 6, name: 'treffer' },
    ],
    ausholen: { von: 0, bis: 4 },
    bilder: bilderVon(aktion('tool')),
    waffe: schlagFrame,
  },
  { clip: 'hit', fps: 8, loop: false, folge: aktion('hit').folge, events: aktion('hit').events, bilder: bilderVon(aktion('hit')), waffe: (r) => halten(r) },
  { clip: 'death', fps: 8, loop: false, folge: aktion('death').folge, events: aktion('death').events, bilder: bilderVon(aktion('death')), waffe: (r, bild) => (bild < 2 ? halten(r) : null) },
];

export const strandraeuber = mensch({
  id: 'strandraeuber',
  legende: LEGENDE,
  kontur: 'k',
  haut: new Set(['S', 'm']),
  auge: 'A',
  waffe: ENTERMESSER,
  aktionen: AKTIONEN_RAEUBER,
  zelle: ZELLE,
  anker: [ZELLE / 2, ZELLE - 3],
  hub: 2,
  versatzX: { right: -1 },
});

export default strandraeuber.sprite;
