/**
 * Water (MASTERPROMPT §11.4 Schwimmen, §18 Wasser): the splash into deep water and a soft landing in it
 * (`PLAYER_SFX.splash`), swim strokes (`PLAYER_SFX.swimStroke`), dripping when soaked
 * (`SURVIVAL_SFX.stage.durchnaesst`) and a bucket being filled at a river or lake (M3-15/M3-25).
 */
import { bandpass, bogen, defineSfxGroup, digital, knistern, rauschen, schlag, tiefpass, ton } from './define';

export const SFX_WASSER = defineSfxGroup('wasser', [
  {
    // Into deep water: a plunge, a spray burst, droplets raining back.
    id: 'sfx_wasser_platsch',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.15,
    reichweite: 22,
    lautstaerke: 0.66,
    untertitel: { de: 'Platschen', en: 'Splash' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.38, 2), filter: bandpass(1300, 1, 450), pegel: 0.9 },
      { quelle: ton('sinus', 160, 60), huelle: schlag(0.003, 0.16), pegel: 0.7 },
      { quelle: knistern(320, 0.006, 40), huelle: schlag(0.03, 0.55, 1.5), filter: bandpass(3400, 1.4), pegel: 0.6, start: 0.05 },
      { quelle: ton('sinus', 420, 1300), huelle: schlag(0.002, 0.04), pegel: 0.2, start: 0.09, wiederholung: { anzahl: 3, abstand: 0.09, abfall: 0.7, tonhoehe: 1.15 } },
    ],
  },
  {
    // A swim stroke: the arm pulling through, a little wash.
    id: 'sfx_wasser_schwimmzug',
    bus: 'effekte',
    varianten: 3,
    streuung: { tonhoehe: 100, lautstaerke: 2, klang: 0.08 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 14,
    lautstaerke: 0.38,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.06, 0.22, 1.5), filter: bandpass(850, 1.2, 1500), pegel: 0.9 },
      { quelle: knistern(150, 0.006, 40), huelle: schlag(0.05, 0.25), filter: bandpass(2800, 1.4), pegel: 0.45, start: 0.05 },
      { quelle: ton('sinus', 380, 700), huelle: schlag(0.004, 0.05), pegel: 0.15, start: 0.12 },
    ],
  },
  {
    // Dripping (soaked): two drops plinking.
    id: 'sfx_wasser_tropfen',
    bus: 'effekte',
    varianten: 3,
    streuung: { tonhoehe: 200, lautstaerke: 2, klang: 0.1 },
    stimmen: 2,
    sperrzeit: 0.2,
    reichweite: 8,
    lautstaerke: 0.3,
    untertitel: { de: 'Tropfen', en: 'Dripping' },
    schichten: [
      { quelle: ton('sinus', 820, 1650), huelle: schlag(0.001, 0.045, 2), pegel: 0.9, wiederholung: { anzahl: 2, abstand: 0.32, abfall: 0.7, tonhoehe: 0.88 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.01, 3), filter: bandpass(3500, 1.5), pegel: 0.3, wiederholung: { anzahl: 2, abstand: 0.32, abfall: 0.7 } },
    ],
  },
  {
    // Filling the bucket: a gurgling rush with the pitch rising as it fills.
    id: 'sfx_wasser_schoepfen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 14,
    lautstaerke: 0.45,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.7, 0.35, 0.2), filter: bandpass(900, 1.2, 1500), pegel: 0.8 },
      { quelle: digital(70, 140), huelle: bogen(0.05, 0.1, 0.6, 0.35, 0.2), filter: tiefpass(700, 2.5), pegel: 0.5 },
      { quelle: ton('sinus', 240, 520), huelle: bogen(0.1, 0.1, 0.5, 0.3, 0.2), filter: bandpass(450, 3, 900), pegel: 0.3 },
      { quelle: knistern(90, 0.006), huelle: bogen(0.05, 0.1, 0.6, 0.35, 0.2), filter: bandpass(2500, 1.4), pegel: 0.35 },
    ],
  },
]);
