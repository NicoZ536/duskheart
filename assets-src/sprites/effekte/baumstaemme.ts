/**
 * Liegende Stämme aller 14 Baumarten für die Fall-Animation (M3-11); die Zeichnung steht im Baukasten
 * `assets-src/sprites/baeume/_stamm.ts`, die Rinden- und Schnittfarben kommen aus der Artbeschreibung
 * derselben Datei, die auch Baum, Stumpf und Setzling zeichnet.
 */
import { staemme } from '../baeume/_stamm';
import { APFELBAUM } from '../baeume/apfelbaum';
import { ASCHEBAUM } from '../baeume/aschebaum';
import { BIRKE } from '../baeume/birke';
import { BIRNBAUM } from '../baeume/birnbaum';
import { BUCHE } from '../baeume/buche';
import { DATTELPALME } from '../baeume/dattelpalme';
import { EICHE } from '../baeume/eiche';
import { KIEFER } from '../baeume/kiefer';
import { KIRSCHBAUM } from '../baeume/kirschbaum';
import { LICHTBAUM } from '../baeume/lichtbaum';
import { MANGROVE } from '../baeume/mangrove';
import { TANNE } from '../baeume/tanne';
import { WALNUSSBAUM } from '../baeume/walnussbaum';
import { WEIDE } from '../baeume/weide';

/** Alle Arten in der Reihenfolge der Baum-Dateien. */
export const STAMM_ARTEN = [APFELBAUM, ASCHEBAUM, BIRKE, BIRNBAUM, BUCHE, DATTELPALME, EICHE, KIEFER, KIRSCHBAUM, LICHTBAUM, MANGROVE, TANNE, WALNUSSBAUM, WEIDE];

export default STAMM_ARTEN.map((a) => staemme(a));
