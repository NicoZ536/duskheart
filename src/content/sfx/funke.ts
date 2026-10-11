/**
 * Funke's voice and the hint line (MASTERPROMPT §8 "Funke, ein wortkarger Flammengeist", §26 "Benachrichtigungen", §27;
 * docs/SPIEL.md §23 "Funke"; strand G, M7-43, M7-44): Funke never speaks words – the lantern crackles and a warm, wavering
 * tone rises while its line shows; a dialog's next line flickers more softly. A context hint is one quiet, round note.
 */
import { bogen, defineSfxGroup, hochpass, knistern, schlag, tiefpass, ton } from './define';

/** Funke and the hint line: the player's own lantern, one at a time. */
const UI = { bus: 'ui', reichweite: 4, stimmen: 1, sperrzeit: 0.3, varianten: 2 } as const;

export const SFX_FUNKE = defineSfxGroup('funke', [
  {
    // Funke speaks: the ember crackles up, a warm tone rises and wavers like a flame.
    id: 'sfx_funke_spricht',
    ...UI,
    lautstaerke: 0.42,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    untertitel: { de: 'Funke flackert', en: 'Funke flickers' },
    schichten: [
      { quelle: knistern(30, 0.004, 8), huelle: bogen(0.01, 0.2, 0.5, 0.2, 0.3), filter: hochpass(2200), pegel: 0.5 },
      { quelle: ton('dreieck', 330, 440), huelle: bogen(0.08, 0.25, 0.5, 0.2, 0.4), filter: tiefpass(1600), pegel: 0.45, vibrato: { tiefe: 25, rate: 7 } },
      { quelle: ton('sinus', 660, 880), huelle: bogen(0.12, 0.2, 0.3, 0.15, 0.3), pegel: 0.2, start: 0.05, vibrato: { tiefe: 30, rate: 6 } },
    ],
  },
  {
    // The next line of a dialog: a softer flicker.
    id: 'sfx_funke_zeile',
    ...UI,
    lautstaerke: 0.3,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: knistern(18, 0.004, 6), huelle: bogen(0.01, 0.15, 0.4, 0.1, 0.2), filter: hochpass(2400), pegel: 0.4 },
      { quelle: ton('dreieck', 392, 440), huelle: bogen(0.05, 0.2, 0.4, 0.1, 0.3), filter: tiefpass(1500), pegel: 0.35, vibrato: { tiefe: 20, rate: 7 } },
    ],
  },
  {
    // A context hint on the hint line: one quiet, round note.
    id: 'sfx_funke_hinweis',
    ...UI,
    varianten: 1,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('sinus', 523), huelle: schlag(0.01, 0.45, 2), pegel: 0.55 },
      { quelle: ton('sinus', 1046), huelle: schlag(0.01, 0.25, 2), pegel: 0.15 },
    ],
  },
]);
