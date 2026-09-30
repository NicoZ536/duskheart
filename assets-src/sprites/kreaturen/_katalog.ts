/**
 * Katalog der M6-Kreaturen (docs/SPIEL.md §14, docs/ART.md §15): kanonische Id → Ergebnis des Generators
 * (Sprite `kreatur_<id>` mit Clip-Angaben), Gruppe der Kontaktbögen `kreaturen-m6-<gruppe>.png` und die
 * Einordnung für Tests und Doku (Nachtjäger mit emissiven Augen, Schattenbrut). Hilfsmodul (Unterstrich):
 * wird von der Sprite-Suche übersprungen; die Sprites selbst exportieren die Einzeldateien.
 */
import type { KreaturErgebnis } from '../../lib/creature';
import { dachs } from './dachs';
import { dornling } from './dornling';
import { eichhoernchen } from './eichhoernchen';
import { froschKreatur } from './frosch';
import { gluehwuermchen } from './gluehwuermchen';
import { hase } from './hase';
import { keiler } from './keiler';
import { krabbe } from './krabbe';
import { kriecher } from './kriecher';
import { lichtfresser } from './lichtfresser';
import { moewe } from './moewe';
import { nachtmahr } from './nachtmahr';
import { qualle } from './qualle';
import { reh } from './reh';
import { robbe } from './robbe';
import { scherenkrebs } from './scherenkrebs';
import { schleicher } from './schleicher';
import { speier } from './speier';
import { strandraeuber } from './strandraeuber';
import { wachtel } from './wachtel';
import { wespenschwarm } from './wespenschwarm';
import { wolf } from './wolf';

/** Kontaktbogen-Gruppen der M6-Kreaturen. */
export const KREATUR_GRUPPEN = ['gruenhain', 'kueste', 'schattenbrut'] as const;
export type KreaturGruppe = (typeof KREATUR_GRUPPEN)[number];

export interface KatalogEintrag {
  readonly id: string;
  readonly gruppe: KreaturGruppe;
  readonly ergebnis: KreaturErgebnis;
  /** Nachtjäger (emissive Augen Pflicht). */
  readonly nachtjaeger: boolean;
  readonly schattenbrut: boolean;
}

const e = (id: string, gruppe: KreaturGruppe, ergebnis: KreaturErgebnis, nachtjaeger = false): KatalogEintrag => ({ id, gruppe, ergebnis, nachtjaeger: nachtjaeger || gruppe === 'schattenbrut', schattenbrut: gruppe === 'schattenbrut' });

/** Alle 22 Kreaturen in der Reihenfolge von docs/SPIEL.md §14. */
export const KREATUREN_M6: readonly KatalogEintrag[] = [
  e('hase', 'gruenhain', hase),
  e('reh', 'gruenhain', reh),
  e('wachtel', 'gruenhain', wachtel),
  e('eichhoernchen', 'gruenhain', eichhoernchen),
  e('gluehwuermchen', 'gruenhain', gluehwuermchen),
  e('frosch', 'gruenhain', froschKreatur),
  e('keiler', 'gruenhain', keiler, true),
  e('dachs', 'gruenhain', dachs, true),
  e('wolf', 'gruenhain', wolf, true),
  e('dornling', 'gruenhain', dornling, true),
  e('wespenschwarm', 'gruenhain', wespenschwarm),
  e('krabbe', 'kueste', krabbe),
  e('moewe', 'kueste', moewe),
  e('robbe', 'kueste', robbe),
  e('scherenkrebs', 'kueste', scherenkrebs, true),
  e('qualle', 'kueste', qualle),
  e('strandraeuber', 'kueste', strandraeuber, true),
  e('schleicher', 'schattenbrut', schleicher),
  e('kriecher', 'schattenbrut', kriecher),
  e('speier', 'schattenbrut', speier),
  e('lichtfresser', 'schattenbrut', lichtfresser),
  e('nachtmahr', 'schattenbrut', nachtmahr),
];
