/**
 * Gemeinsames der Obstbäume (M2-20): Laub in `gras.0`–`gras.4` (die Lichtkappe `gras.5` entfällt, damit
 * Früchte in `laub` und Schnee im Budget von 12 Farben bleiben), Früchte in zwei `laub`-Stufen. Die
 * Palettenzeilen `<jahreszeit>_<art>` (assets-src/paletteRows.ts) machen daraus Blüten, unreife und
 * reife Früchte.
 */
import type { KronenFarben } from '../../lib/tree';

export const OBST_LAUB: KronenFarben = { kontur: 'gras.0', stufen: ['gras.1', 'gras.2', 'gras.3', 'gras.4', 'gras.4'] };
