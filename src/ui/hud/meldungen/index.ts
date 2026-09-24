/**
 * Benachrichtigungen des HUD (M3-29): Warteschlange (höchstens vier, gestapelte Aufsammel-Meldungen),
 * Inhalte aus Sim-Ereignissen und der Uhr, Anzeige unten links.
 */
export { aufsammeln, dunkelheitNaht, entdeckung, stufenWarnung, taschenVoll, WARN_STUFEN, type MeldungInhalt, type WarnStufe } from './inhalte';
export { HudMeldungen, meldungsText, type HudMeldungenProps } from './Meldungen';
export { DUNKELHEIT_VORLAUF_MIN, DunkelheitsWaechter, meldungenQuelle, type MeldungenQuelle, type MeldungenSitzung } from './quelle';
export { textFaktor } from './textgroesse';
export { MAX_SICHTBAR, MELDUNG_ZEITEN, MeldungenWarteschlange, type Meldung, type MeldungArt, type MeldungEingabe } from './warteschlange';
