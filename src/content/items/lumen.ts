/**
 * The Lumen lantern (MASTERPROMPT §12.2 "Lumen-Laterne (ab Leuchtfeuer 1) | 8 | Lumen-Ladung | Schattenbrut im Umkreis von 2
 * Tiles erleidet 5 Schaden/s", §12.4 "Der Lichtfresser … saugt Lumen-Ladungen ab"; docs/SPIEL.md §22 "Lumen-Laterne"; M7-36):
 * a light for the off hand (light kind `lumen_laterne`, behaviour `lumen`, src/content/lights.ts) – weatherproof, eight
 * tiles, charged with Lumen shards (`BALANCE.light.lumen.hoursPerShard`), burning shadow brood close by. Made at the Lumen
 * workbench after the unlock `lf1_lumen_laterne` (src/content/recipes/lumen.ts); a fresh one holds one charge. On the figure it
 * hangs from the off hand: `ausruestung_lumen_laterne` while it glows, `ausruestung_lumen_laterne_aus` when it is dark
 * (assets-src/sprites/leuchtfeuer/laterne.ts; the dark sprite by the suffix `LIGHT_OUT_SUFFIX` of src/render/game/playerFigure.ts).
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The Lumen lantern. */
export const LUMEN_ITEMS = defineItemGroup('lumen', [
  baseItem({
    id: 'lumen_laterne',
    name: { de: 'Lumen-Laterne', en: 'Lumen Lantern' },
    beschreibung: {
      de: 'Eine Bronzelaterne mit einem Kern aus Lumen. Leuchtet acht Kacheln weit, trotzt Regen und Wasser, und Schattenbrut, die ihr zu nahe kommt, verbrennt. Eine Lumen-Scherbe lädt sie für eine Nacht.',
      en: 'A bronze lantern with a core of Lumen. Lights eight tiles around, defies rain and water, and shadow brood that comes too close burns. One Lumen shard charges it for a night.',
    },
    kategorie: 'licht',
    stufe: 1,
    raritaet: 'selten',
    ausruestung: 'nebenhand',
    // Ingredients plus a fifth: (2 bronze bars × 12 + glass 5 + resin 3 + a shard 15) × 1.2 ≈ 56 [trade points].
    tauschwert: 56,
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
]);
