/**
 * All SFX presets (MASTERPROMPT §27; docs/SPIEL.md §5 `sfx_<bereich>_<name>`): the group files joined
 * into one list for the content registry (collection `sfx`, §C category `sfx`) and the audio kernel
 * (src/audio), plus the id conventions the presentation derives ids from and the sound materials content names.
 *
 * A new group file validates its presets with `defineSfxGroup` and adds one entry to `SFX_GROUPS`.
 */
import { SFX_AKTIONEN } from './aktionen';
import { SFX_BAUEN } from './bauen';
import { SFX_BRAND } from './brand';
import { SFX_FEUER } from './feuer';
import { SFX_FURCHT } from './furcht';
import { SFX_GEGENSTAENDE } from './gegenstaende';
import { SFX_KAMPF } from './kampf';
import { SFX_KREATUREN } from './kreaturen';
import { SFX_KREATUREN_SALZKUESTE } from './kreaturen_salzkueste';
import { SFX_KREATUREN_SCHATTENBRUT } from './kreaturen_schattenbrut';
import { SFX_KREATUREN_GRUENHAIN } from './kreaturen_gruenhain';
import { SFX_LAGERUNG } from './lagerung';
import { SFX_OBERFLAECHE } from './oberflaeche';
import { SFX_RUESTKAMMER } from './ruestkammer';
import { SFX_SAMMELN } from './sammeln';
import type { SfxPreset } from './schema';
import { SFX_SCHRITTE } from './schritte';
import { SFX_SPIELER } from './spieler';
import { SFX_STATIONEN } from './stationen';
import { SFX_TUEREN } from './tueren';
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
  bauen: SFX_BAUEN,
  tueren: SFX_TUEREN,
  stationen: SFX_STATIONEN,
  lagerung: SFX_LAGERUNG,
  brand: SFX_BRAND,
  // Creatures: calls, hurt cries, death sounds and attacks; telegraph, carving, traps, shadow brood (M6-15, M6-19, M6-28 … M6-30).
  kreaturen: SFX_KREATUREN,
  // Creatures of the Salt Coast and the shadow brood's base family: voices and attacks (M6-23 … M6-26).
  kreaturen_salzkueste: SFX_KREATUREN_SALZKUESTE,
  kreaturen_schattenbrut: SFX_KREATUREN_SCHATTENBRUT,
  // The Grünhain creatures of M6-20 … M6-22: squirrel, firefly, frog, boar, badger, wolf, Dornling, wasp swarm.
  kreaturen_gruenhain: SFX_KREATUREN_GRUENHAIN,
  // The fight: swings and hits by damage type, bows, crossbow, sling and throws, blocks and the parry (M6-33).
  kampf: SFX_KAMPF,
  // The armoury: loom, tailor's table and tanning frame, leather and bronze armour in the bags (M6-12, M6-31).
  ruestkammer: SFX_RUESTKAMMER,
} as const satisfies Record<string, readonly SfxPreset[]>;

/** Every preset, in group order. */
export const SFX_PRESETS: readonly SfxPreset[] = Object.values(SFX_GROUPS).flat();

export * from './conventions';
export * from './define';
export * from './materials';
export * from './schema';
