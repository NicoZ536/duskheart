/**
 * Sounds for actions of M3–M6 that sounded only borrowed (M7-02 "Nachrüstung aller Aktionen aus M3–M6 ohne Sound";
 * tests/unit/audio/abdeckung.test.ts lists them): a bandage wound round a wound and a splint tied (they sounded like picking
 * up their material), choosing a perk (a menu click before), the heavy attack drawing its strength (a silent pose before)
 * and a new bestiary stage (the recipe chime before). src/audio/eventMap.ts plays the last three (`KERNEL_SFX.perkChosen`,
 * `RETROFIT_SFX`); the cures' sounds become the items' `sounds.benutzen` (src/content/items, integrator).
 */
import { bandpass, bogen, defineSfxGroup, fm, knistern, rauschen, schlag, tiefpass, ton } from './define';

export const SFX_NACHRUESTUNG = defineSfxGroup('nachruestung', [
  {
    // The bandage: cloth pulled taut and wound round twice, a knot tugged tight.
    id: 'sfx_heilen_verband',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 10,
    lautstaerke: 0.4,
    untertitel: { de: 'Verband angelegt', en: 'Bandage applied' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.15, 0.4, 0.05, 0.12), filter: bandpass(1800, 1, 2600), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85, tonhoehe: 1.1 } },
      { quelle: knistern(220, 0.003), huelle: bogen(0.05, 0.15, 0.4, 0.05, 0.12), filter: bandpass(3200, 1.3), pegel: 0.3, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.08, 2), filter: bandpass(1200, 1.4), pegel: 0.6, start: 0.82 },
    ],
  },
  {
    // The splint: two slats knock against the leg, the cord pulled through and tied.
    id: 'sfx_heilen_schiene',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 10,
    lautstaerke: 0.44,
    untertitel: { de: 'Schiene angelegt', en: 'Splint applied' },
    schichten: [
      { quelle: ton('dreieck', 520, 380), huelle: schlag(0.002, 0.07), filter: bandpass(900, 1.5), pegel: 0.8, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.8, tonhoehe: 1.12 } },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.06), filter: tiefpass(600), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.8 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.15, 0.4, 0.1, 0.1), filter: bandpass(1500, 1.2, 2400), pegel: 0.55, start: 0.4 },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.07), filter: bandpass(1100, 1.4), pegel: 0.5, start: 0.82 },
    ],
  },
  {
    // A perk chosen: a firm, warm two-note seal under the choice's chime.
    id: 'sfx_fertigkeit_perk_gewaehlt',
    bus: 'ui',
    stimmen: 1,
    sperrzeit: 0.2,
    lautstaerke: 0.42,
    schichten: [
      { quelle: fm(523, 2, 1.4), huelle: schlag(0.003, 0.5, 2), pegel: 0.6 },
      { quelle: fm(784, 2, 1.2), huelle: schlag(0.003, 0.6, 2), pegel: 0.55, start: 0.09 },
      { quelle: ton('dreieck', 262), huelle: bogen(0.005, 0.1, 0.4, 0.15, 0.2), pegel: 0.4 },
    ],
  },
  {
    // The heavy attack drawn back: a rising rush of breath and tension before the blow.
    id: 'sfx_kampf_ausholen_schwer',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 14,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.25, 0.1, 0.8, 0.15, 0.08), filter: bandpass(500, 1.4, 1400), pegel: 0.7 },
      { quelle: ton('saege', 90, 140), huelle: bogen(0.3, 0.1, 0.6, 0.1, 0.08), filter: tiefpass(500, 1.5, 900), pegel: 0.3 },
    ],
  },
  {
    // A new bestiary stage: a page turned and a quick scratch of the quill.
    id: 'sfx_bestiarium_eintrag',
    bus: 'ui',
    stimmen: 1,
    sperrzeit: 0.3,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.12, 0.3, 0.05, 0.1), filter: bandpass(2600, 0.9, 1400), pegel: 0.7 },
      { quelle: knistern(600, 0.0015, 200), huelle: bogen(0.01, 0.1, 0.4, 0.15, 0.05), filter: bandpass(5000, 1.5), pegel: 0.35, start: 0.3 },
      { quelle: fm(1047, 3, 0.8), huelle: schlag(0.003, 0.35, 2), pegel: 0.25, start: 0.18 },
    ],
  },
]);
