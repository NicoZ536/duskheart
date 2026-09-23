/**
 * 9-Slice-Rahmen der UI (MASTERPROMPT §26 "eigener Pixel-UI-Look (Holz, Eisen, Pergament)").
 *
 * - Holz: gewölbte Leiste mit Gehrung in den Ecken und eisernen Ziernägeln; Maserung als nahtlose
 *   10-px-Kachel. Licht von links oben: Außenkante oben/links hell, unten/rechts dunkel, die
 *   Innenkanten umgekehrt. Füllung: dunkles Rahmenbraun (heller Text darauf).
 * - Eisen: Band mit einer Niete je 10-px-Kachel, genietete Eckplatten, kühle dunkle Füllung.
 * - Pergament: Blatt mit eingerissener Kante, nachgedunkeltem Rand, vereinzelten Fasern und
 *   Brandflecken; dunkle Schrift darauf.
 */
import type { UiGrafikQuelle } from './format';

export const RAHMEN_HOLZ: UiGrafikQuelle = {
  id: 'rahmen_holz',
  vorschau: [[37, 23], [64, 41]],
  beschreibung: 'Holzrahmen (Fenster, Tafeln, Stationen)',
  slice: 7,
  legende: { '.': null, o: 'nacht.1', L: 'holz.4', l: 'holz.3', m: 'holz.2', d: 'holz.1', f: 'ui.rahmen', s: 'stein.5', S: 'stein.3', x: 'stein.1' },
  raster: `
    .oooooooooooooooooooooo.
    oLLLLLLLLLLLLLLLLLLLLLmo
    oLlslllllllmmmllllllsldo
    oLsSxllmlllllllmmllsSxdo
    oLlxlllllmmlllllllllxldo
    oLllldddddddddddddmllldo
    oLllldooooooooooooLllldo
    oLlmldoffffffffffoLmlldo
    oLllldoffffffffffoLllmdo
    oLllldoffffffffffoLllmdo
    oLmlldoffffffffffoLlmldo
    oLmlldoffffffffffoLlmldo
    oLmlldoffffffffffoLlmldo
    oLllmdoffffffffffoLllldo
    oLllmdoffffffffffoLllldo
    oLlmldoffffffffffoLmlldo
    oLlmldoffffffffffoLmlldo
    oLllldooooooooooooLllldo
    oLlllmLLLLLLLLLLLLLllldo
    oLlslllllmmlllllllllsldo
    oLsSxlllllllmmmllllsSxdo
    oLlxlllmllllllllmlllxldo
    omdddddddddddddddddddddo
    .oooooooooooooooooooooo.
  `,
};

export const RAHMEN_EISEN: UiGrafikQuelle = {
  id: 'rahmen_eisen',
  vorschau: [[37, 23], [64, 41]],
  beschreibung: 'Eisenrahmen (Kampf, Ausrüstung, Warnungen)',
  slice: 7,
  legende: { '.': null, o: 'nacht.1', H: 'stein.4', M: 'stein.3', d: 'stein.1', s: 'stein.5', f: 'nacht.2' },
  raster: `
    .oooooooooooooooooooooo.
    oHHHHMoHHHHHHHHHHoHHHHMo
    oHMsMdoMMMMMsMMMMoHMsMdo
    oHsHddoMMMMsHdMMMoHsHddo
    oHMdMdoMMMMMdMMMMoHMdMdo
    oMddddoddddddddddoMddddo
    oooooooooooooooooooooooo
    oHMMMdoffffffffffoHMMMdo
    oHMMMdoffffffffffoHMMMdo
    oHMMMdoffffffffffoHMMMdo
    oHMMMdoffffffffffoHMMMdo
    oHMsMdoffffffffffoHMsMdo
    oHsHddoffffffffffoHsHddo
    oHMdMdoffffffffffoHMdMdo
    oHMMMdoffffffffffoHMMMdo
    oHMMMdoffffffffffoHMMMdo
    oHMMMdoffffffffffoHMMMdo
    oooooooooooooooooooooooo
    oHHHHMoHHHHHHHHHHoHHHHMo
    oHMsMdoMMMMMsMMMMoHMsMdo
    oHsHddoMMMMsHdMMMoHsHddo
    oHMdMdoMMMMMdMMMMoHMdMdo
    oMddddoddddddddddoMddddo
    .oooooooooooooooooooooo.
  `,
};

export const RAHMEN_PERGAMENT: UiGrafikQuelle = {
  id: 'rahmen_pergament',
  vorschau: [[37, 23], [64, 41]],
  beschreibung: 'Pergament (Tafeln, Rezepte, Chronik, Tooltips)',
  slice: 3,
  legende: { '.': null, o: 'erde.1', P: 'ui.pergamentDunkel', B: 'sand.0', p: 'ui.pergament', q: 'sand.3' },
  raster: `
    ..ooooooooo..ooooooooo..
    .oPPPPPPPPPooPPPPBPPPPo.
    oPpppppppppPPpppppppppPo
    oPppppppppppppppppppppPo
    oPppppppppppppppppppppPo
    oPpppppppqqqppppppppppPo
    .oPpppppppppppppppppppPo
    .oPpppppppppppppppppppBo
    oPppppppppppppppppppppPo
    oPppppppppppppppqqppppPo
    oPppppppppppppppppppppPo
    oPppppppppppppppppppppPo
    oPpppppppppppppppppppPo.
    oPppppqqpppppppppppppPo.
    oPppppppppppppppppppppPo
    oBppppppppppppppppppppPo
    oPpppppppppppppqqqppppPo
    oPppppppppppppppppppppPo
    oPppppppppppppppppppppPo
    oPppppppppppppppppqqppPo
    oPppppppppppppppppppppPo
    oPppppppPPppppppppppppPo
    .oPPPPPPooPPPBPPPPPPPPo.
    ..oooooo..oooooooooooo..
  `,
};
