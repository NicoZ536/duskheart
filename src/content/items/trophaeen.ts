/**
 * Hunting trophies of the Grünhain foes (M6-30d; MASTERPROMPT §14 "Jagen & Zerlegen … Spezialteile", §13.1 "Schmuck
 * (≥ 30): Ringe, Amulette, Talismane (… Furchtresistenz …)", §2 "Jedes Item hat Quelle(n), Verwendung"; docs/SPIEL.md §14
 * "Jagdgüter: Spezialteile je Kreatur (`wolfszahn`, `keilerhauer` …)"):
 *
 * - **Special parts** – what only this kind of foe gives when its carcass is carved (`zerlegen`, src/content/creatures/
 *   gruenhainBeute.ts; source `drop:wolf`, `drop:keiler`): the wolf's fang, the boar's tusk. Rare pieces of a fight, not
 *   of gathering (rarity "ungewöhnlich" like the roe buck's antlers).
 * - **Their use** – the first jewellery (§13.1, slots `schmuck1`/`schmuck2`), strung with sinew at the workbench
 *   (src/content/recipes/trophaeen.ts):
 *   - `wolfszahnkette` (three fangs): +10 % fear resistance – the night hunter's teeth on one's chest steady the nerves in
 *     the dark (§12.3 fear: a fright and the dark raise fear 10 % less; `FearSystem` reads `werte.furchtresistenz`). Small
 *     next to the light and the camp fire, the real answers to fear.
 *   - `haueramulett` (two tusks): +5 maximum health – the boar's toughness, a twentieth of the start health (§11.1: 100),
 *     about half of a T0 hit (§D: a normal hit 8–12 % of the effective health).
 *   Two worn pieces of jewellery add up; neither changes the armour (that stays with the armour sets, §D).
 * - Trade values [trade points, 1 = one piece of wood]: a fang 8, a tusk 10 (a fight for each, below the antlers' 12);
 *   the jewellery its parts plus the sinew and about a fifth for the work.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Special parts of the wolf and the boar and the jewellery made of them. */
export const TROPHAEEN = defineItemGroup('trophaeen', [
  baseItem({
    id: 'wolfszahn',
    name: { de: 'Wolfszahn', en: 'Wolf Fang' },
    beschreibung: {
      de: 'Ein gebogener Reißzahn aus dem Kiefer eines erlegten Wolfs. An der Werkbank auf Sehne gezogen, wird er zur Wolfszahnkette.',
      en: 'A curved fang from the jaw of a slain wolf. Strung on sinew at the workbench, it becomes a wolf fang necklace.',
    },
    kategorie: 'rohstoff',
    raritaet: 'ungewoehnlich',
    tauschwert: 8,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'keilerhauer',
    name: { de: 'Keilerhauer', en: 'Boar Tusk' },
    beschreibung: {
      de: 'Ein sichelförmiger Hauer aus dem Unterkiefer eines Keilers, hart wie Stein. Zwei davon ergeben an der Werkbank ein Haueramulett.',
      en: 'A sickle-shaped tusk from the lower jaw of a boar, hard as stone. Two of them make a tusk amulet at the workbench.',
    },
    kategorie: 'rohstoff',
    raritaet: 'ungewoehnlich',
    tauschwert: 10,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'wolfszahnkette',
    name: { de: 'Wolfszahnkette', en: 'Wolf Fang Necklace' },
    beschreibung: {
      de: 'Drei Wolfszähne auf einer Sehnenschnur. Wer sie trägt, hat den Nachtjäger bezwungen: Dunkelheit und Schreck machen ihm weniger Furcht.',
      en: 'Three wolf fangs on a sinew cord. Whoever wears it has bested the night hunter: darkness and frights stir less fear.',
    },
    kategorie: 'schmuck',
    raritaet: 'ungewoehnlich',
    ausruestung: 'schmuck',
    werte: { furchtresistenz: 0.1 },
    tauschwert: 32,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'haueramulett',
    name: { de: 'Haueramulett', en: 'Tusk Amulet' },
    beschreibung: {
      de: 'Zwei Keilerhauer, mit Sehne zum Halbmond gebunden. Die Zähigkeit des Keilers geht auf den über, der es trägt.',
      en: 'Two boar tusks bound into a crescent with sinew. The boar’s toughness passes to whoever wears it.',
    },
    kategorie: 'schmuck',
    raritaet: 'ungewoehnlich',
    ausruestung: 'schmuck',
    werte: { maxLeben: 5 },
    tauschwert: 28,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
]);
