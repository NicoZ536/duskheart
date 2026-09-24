/**
 * Interface, crafting and progress (MASTERPROMPT §26 UI, §15 Crafting, §23.2 Fertigkeiten; M3-16,
 * M3-29, M3-30, M3-32): clicks, hover, opening and closing screens, a refused action
 * (`INVENTORY_FEEDBACK_SFX.rejected`), a notification, the crafting feedback (work in progress, item
 * finished) and the skills (`SKILL_SFX`: experience gained, level up – §27 "Stinger … Stufenaufstieg" –,
 * a perk choice).
 *
 * UI sounds are the quietest and driest of the game – they repeat on every mouse move – and tonal, so
 * they never get confused with world sounds: soft pulse and triangle blips on a warm, low-passed timbre.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Shared settings of menu blips. */
const UI = {
  bus: 'ui',
  stimmen: 2,
  sperrzeit: 0.03,
} as const;

export const SFX_OBERFLAECHE = defineSfxGroup('oberflaeche', [
  {
    // Button pressed.
    id: 'sfx_ui_klick',
    ...UI,
    lautstaerke: 0.26,
    schichten: [
      { quelle: puls(1400, 0.3), huelle: schlag(0.001, 0.03, 3), filter: tiefpass(4200), pegel: 0.6 },
      { quelle: ton('sinus', 700, 620), huelle: schlag(0.001, 0.03, 3), pegel: 0.6 },
    ],
  },
  {
    // Pointer over an element: barely there.
    id: 'sfx_ui_hover',
    ...UI,
    sperrzeit: 0.05,
    lautstaerke: 0.12,
    schichten: [{ quelle: ton('sinus', 1760, 1700), huelle: schlag(0.002, 0.02, 2), pegel: 1 }],
  },
  {
    // A screen opens (inventory, pause): a two-note lift and a leather flap.
    id: 'sfx_ui_oeffnen',
    ...UI,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('dreieck', 523), huelle: schlag(0.004, 0.1, 2), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.9, tonhoehe: 1.335 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.08), filter: bandpass(1800, 1.2, 2600), pegel: 0.35 },
    ],
  },
  {
    // A screen closes: the same lift, falling.
    id: 'sfx_ui_schliessen',
    ...UI,
    lautstaerke: 0.28,
    schichten: [
      { quelle: ton('dreieck', 698), huelle: schlag(0.004, 0.1, 2), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.85, tonhoehe: 0.749 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.08), filter: bandpass(2400, 1.2, 1400), pegel: 0.35 },
    ],
  },
  {
    // Refused (an action that cannot happen): a low, beating buzz.
    id: 'sfx_ui_fehler',
    ...UI,
    sperrzeit: 0.15,
    lautstaerke: 0.32,
    schichten: [
      { quelle: puls(185, 0.5), huelle: schlag(0.004, 0.16, 1.5), filter: tiefpass(1300, 1.2), pegel: 0.7 },
      { quelle: puls(174, 0.35), huelle: schlag(0.004, 0.16, 1.5), filter: tiefpass(1100), pegel: 0.5 },
    ],
  },
  {
    // A notification slides in (§26, M3-29): a soft bell.
    id: 'sfx_ui_meldung',
    ...UI,
    sperrzeit: 0.12,
    lautstaerke: 0.26,
    schichten: [
      { quelle: fm(1319, 2, 1, 0.1), huelle: schlag(0.002, 0.45, 2.5), pegel: 0.7 },
      { quelle: ton('sinus', 1976), huelle: schlag(0.002, 0.25, 2.5), pegel: 0.2, start: 0.03 },
    ],
  },
  {
    // Crafting in progress (M3-16): tapping, binding, knocking.
    id: 'sfx_handwerk_arbeiten',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 12,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('sinus', 260, 200), huelle: schlag(0.001, 0.06, 3), pegel: 0.8, wiederholung: { anzahl: 3, abstand: 0.15, abfall: 0.85, tonhoehe: 1.06 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2600, 1.2), pegel: 0.5, wiederholung: { anzahl: 3, abstand: 0.15, abfall: 0.85 } },
      { quelle: knistern(200, 0.003), huelle: schlag(0.02, 0.35), filter: bandpass(1800, 1.2), pegel: 0.2, start: 0.05 },
    ],
  },
  {
    // An item is finished (M3-16): a last knock and a pleased two-note chime.
    id: 'sfx_handwerk_fertig',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 12,
    lautstaerke: 0.48,
    untertitel: { de: 'Hergestellt', en: 'Crafted' },
    schichten: [
      { quelle: ton('sinus', 240, 190), huelle: schlag(0.001, 0.07, 3), pegel: 0.7 },
      { quelle: puls(659, 0.25), huelle: schlag(0.004, 0.3, 2), filter: tiefpass(3600), pegel: 0.5, start: 0.06, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.95, tonhoehe: 1.498 } },
      { quelle: ton('dreieck', 1319), huelle: schlag(0.004, 0.45, 2.5), pegel: 0.25, start: 0.16 },
    ],
  },
  {
    // Experience gained ("+8 EP Holzfällen"): a faint sparkle.
    id: 'sfx_fertigkeit_ep',
    ...UI,
    sperrzeit: 0.15,
    lautstaerke: 0.14,
    schichten: [
      { quelle: ton('sinus', 1568, 2093), huelle: schlag(0.003, 0.08, 2), pegel: 0.8 },
      { quelle: knistern(120, 0.003), huelle: schlag(0.01, 0.1), filter: tiefpass(9000), pegel: 0.25 },
    ],
  },
  {
    // Level up (§27 Stinger "Stufenaufstieg"): a bright rising arpeggio C–E–G–C with a shimmer.
    id: 'sfx_fertigkeit_aufstieg',
    ...UI,
    stimmen: 1,
    sperrzeit: 0.5,
    lautstaerke: 0.5,
    untertitel: { de: 'Stufenaufstieg', en: 'Level up' },
    schichten: [
      { quelle: puls(523, 0.25), huelle: schlag(0.004, 0.3, 2), filter: tiefpass(4000), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.16, abfall: 1, tonhoehe: 1.498 } },
      { quelle: puls(659, 0.25), huelle: schlag(0.004, 0.3, 2), filter: tiefpass(4000), pegel: 0.6, start: 0.08, wiederholung: { anzahl: 2, abstand: 0.16, abfall: 1.0, tonhoehe: 1.587 } },
      { quelle: ton('dreieck', 1047), huelle: bogen(0.02, 0.2, 0.5, 0.3, 0.5), pegel: 0.35, start: 0.24 },
      { quelle: fm(2093, 2, 1, 0), huelle: schlag(0.01, 0.8, 2), pegel: 0.2, start: 0.26 },
    ],
  },
  {
    // A perk choice opens or is taken (levels 30/60/90): a bell and a glittering tail.
    id: 'sfx_fertigkeit_perk',
    ...UI,
    stimmen: 1,
    sperrzeit: 0.3,
    lautstaerke: 0.42,
    schichten: [
      { quelle: fm(880, 3.5, 2.5, 0.2), huelle: schlag(0.003, 0.9, 2.5), pegel: 0.6 },
      { quelle: fm(1320, 2, 1, 0), huelle: schlag(0.003, 0.6, 2.5), pegel: 0.3, start: 0.05 },
      { quelle: knistern(90, 0.004, 10), huelle: schlag(0.05, 0.8), filter: hochpass(5000), pegel: 0.3, start: 0.05 },
    ],
  },
]);
