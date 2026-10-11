/**
 * The chronicle's sounds (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback", §23.3, §27; docs/SPIEL.md
 * §23; strand G, M7-41 … M7-47): a quest begun (a page turned, a low note), a step done (two quill strokes and a rising
 * fifth), a quest done (four warm notes climbing to the octave), an achievement (a small bell arpeggio with a shimmer), new
 * knowledge (a page and a glassy note). All on the UI bus: they belong to the player, not to a place.
 *
 * Paper and warm metal, never the cold glass of the Lumen (src/content/sfx/leuchtfeuer.ts): the chronicle is the player's own
 * book; the beacon's knowledge stays the beacon's.
 */
import { bandpass, bogen, defineSfxGroup, hochpass, rauschen, schlag, tiefpass, ton } from './define';

/** A sound of the chronicle: at the player, one at a time. */
const UI = { bus: 'ui', reichweite: 4, stimmen: 1, sperrzeit: 0.2, varianten: 1 } as const;

export const SFX_CHRONIK = defineSfxGroup('chronik', [
  {
    // A quest begins: a page turns, a low warm note opens it.
    id: 'sfx_chronik_aufgabe_neu',
    ...UI,
    lautstaerke: 0.4,
    untertitel: { de: 'Neue Aufgabe', en: 'New quest' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.12, 0.3, 0.05, 0.15), filter: bandpass(2400, 1.2, 1200), pegel: 0.45 },
      { quelle: ton('dreieck', 196), huelle: bogen(0.03, 0.3, 0.5, 0.2, 0.6), filter: tiefpass(1400), pegel: 0.55, start: 0.08 },
      { quelle: ton('sinus', 294), huelle: bogen(0.05, 0.3, 0.4, 0.15, 0.6), pegel: 0.3, start: 0.18 },
    ],
  },
  {
    // A step done: two short quill strokes, then a fifth upward.
    id: 'sfx_chronik_schritt',
    ...UI,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.05, 2), filter: bandpass(3500, 2), pegel: 0.35, wiederholung: { anzahl: 2, abstand: 0.07, abfall: 0.8, tonhoehe: 1 } },
      { quelle: ton('dreieck', 392), huelle: schlag(0.005, 0.25, 2), pegel: 0.5, start: 0.12 },
      { quelle: ton('dreieck', 587), huelle: schlag(0.005, 0.35, 2), pegel: 0.45, start: 0.22 },
    ],
  },
  {
    // A quest done: four warm notes climbing to the octave, a soft hum under them.
    id: 'sfx_chronik_aufgabe_fertig',
    ...UI,
    lautstaerke: 0.48,
    untertitel: { de: 'Aufgabe erfüllt', en: 'Quest complete' },
    schichten: [
      { quelle: ton('dreieck', 262), huelle: bogen(0.01, 0.25, 0.5, 0.05, 0.3), pegel: 0.55, wiederholung: { anzahl: 4, abstand: 0.13, abfall: 0.97, tonhoehe: 1.26 } },
      { quelle: ton('sinus', 131), huelle: bogen(0.1, 0.5, 0.5, 0.4, 0.8), filter: tiefpass(600), pegel: 0.35 },
      { quelle: ton('sinus', 523), huelle: bogen(0.05, 0.4, 0.4, 0.3, 0.9), pegel: 0.3, start: 0.4, vibrato: { tiefe: 8, rate: 5 } },
    ],
  },
  {
    // An achievement: a small bell arpeggio (major triad and octave) with a bright shimmer.
    id: 'sfx_chronik_erfolg',
    ...UI,
    lautstaerke: 0.5,
    untertitel: { de: 'Erfolg', en: 'Achievement' },
    schichten: [
      { quelle: ton('sinus', 659), huelle: schlag(0.003, 0.6, 2), pegel: 0.6, wiederholung: { anzahl: 4, abstand: 0.09, abfall: 0.95, tonhoehe: 1.26 } },
      { quelle: ton('dreieck', 1318), huelle: schlag(0.003, 0.3, 2), pegel: 0.2, wiederholung: { anzahl: 4, abstand: 0.09, abfall: 0.9, tonhoehe: 1.26 } },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.3, 0.2, 0.2, 0.4), filter: hochpass(6000), pegel: 0.12, start: 0.3 },
    ],
  },
  {
    // New knowledge: a page and one clear note.
    id: 'sfx_chronik_wissen',
    ...UI,
    lautstaerke: 0.38,
    untertitel: { de: 'Neues Wissen', en: 'New knowledge' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.1, 0.3, 0.04, 0.12), filter: bandpass(2000, 1, 3000), pegel: 0.4 },
      { quelle: ton('sinus', 784), huelle: schlag(0.004, 0.7, 2), pegel: 0.5, start: 0.1 },
      { quelle: ton('dreieck', 392), huelle: schlag(0.004, 0.5, 2), pegel: 0.25, start: 0.1 },
    ],
  },
]);
