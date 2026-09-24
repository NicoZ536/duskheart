/**
 * All SFX presets (MASTERPROMPT §27; docs/SPIEL.md §5 `sfx_<bereich>_<name>`): the group files joined
 * into one list for the content registry (collection `sfx`, §C category `sfx`) and the audio kernel
 * (src/audio), plus the id conventions the presentation derives ids from.
 *
 * A new group file validates its presets with `defineSfxGroup` and adds one entry to `SFX_GROUPS`.
 */
import { SFX_AKTIONEN } from './aktionen';
import { SFX_FEUER } from './feuer';
import { SFX_FURCHT } from './furcht';
import { SFX_GEGENSTAENDE } from './gegenstaende';
import { SFX_OBERFLAECHE } from './oberflaeche';
import { SFX_SAMMELN } from './sammeln';
import type { SfxPreset } from './schema';
import { SFX_SCHRITTE } from './schritte';
import { SFX_SPIELER } from './spieler';
import { SFX_WASSER } from './wasser';
import { SFX_ZUSTAENDE } from './zustaende';

/** Preset groups in registry order (one entry per group file). */
export const SFX_GROUPS = {
  schritte: SFX_SCHRITTE,
  spieler: SFX_SPIELER,
  aktionen: SFX_AKTIONEN,
  sammeln: SFX_SAMMELN,
  gegenstaende: SFX_GEGENSTAENDE,
  wasser: SFX_WASSER,
  feuer: SFX_FEUER,
  furcht: SFX_FURCHT,
  zustaende: SFX_ZUSTAENDE,
  oberflaeche: SFX_OBERFLAECHE,
} as const satisfies Record<string, readonly SfxPreset[]>;

/** Every preset, in group order. */
export const SFX_PRESETS: readonly SfxPreset[] = Object.values(SFX_GROUPS).flat();

export * from './conventions';
export * from './define';
export * from './schema';
