/**
 * Die Rüstung in den Körperformen `schmal` und `kraeftig` (M7-110; MASTERPROMPT §4.5 „Ausrüstung als Layer (Kopf, Körper, Beine
 * …)“, §26 „Körperform“; docs/SPIEL.md §26): jedes Teil der drei Sätze (Faser, Leder, Bronze) aus den Posen des Körpers der Form
 * umgezeichnet (`ruestungsLayer(stil, form)`, assets-src/sprites/ausruestung/_ruestung.ts) – Wams und Panzer folgen dem Rumpf
 * der Form, die Ärmel und Schulterstücke den versetzten Armen, und wo ein Arm Hose, Schuh oder Kopf verdeckt, fehlt der Layer
 * dort wie im Körper. Die Layer heißen wie die Kleidung je Form `ausruestung_<id>_<form>` (der Renderer sucht sie mit
 * `formLayerSpriteId`, src/render/game/playerFigure.ts); `mittel` sind die Layer bis M6 (`ausruestung_<id>`).
 *
 * Bis M7-53 zeichnete eine getragene Rüstung die ganze Figur als `mittel` (ADR-0267). Die Overlays liegen beschnitten im Atlas
 * (`zuschnitt`): nur so passen die zwei weiteren Formen hinein (Atlas 4096², M7-110).
 */
import { ruestungsLayer, type RuestungsStil } from '../ausruestung/_ruestung';
import { STILE as BRONZE } from '../ausruestung/ruestung_bronze';
import { STILE as FASER } from '../ausruestung/ruestung_faser';
import { STILE as LEDER } from '../ausruestung/ruestung_leder';
import { KOERPERFORMEN } from './_spieler_formen';

/** Alle Rüstungsteile der drei Sätze (Kopf, Brust, Beine, Füße). */
export const RUESTUNG_STILE: readonly RuestungsStil[] = [...FASER, ...LEDER, ...BRONZE];

/** Die Formen mit eigenen Rüstungs-Layern (`mittel` hat die Layer bis M6). */
export const RUESTUNG_FORMEN = KOERPERFORMEN.filter((f) => f !== 'mittel');

export default RUESTUNG_FORMEN.flatMap((form) => RUESTUNG_STILE.map((stil) => ruestungsLayer(stil, form)));
