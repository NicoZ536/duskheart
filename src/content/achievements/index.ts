/**
 * The 15 achievements of M7 (MASTERPROMPT §23.3 "Erfolge (≥ 60, lokal)", §C "Erfolge 60"; docs/SPIEL.md §23 "Erfolge", §29;
 * M7-47 – strand G): local per world, unlocked once by their trigger (src/game/achievements), each with its symbol
 * `erfolg_<id>` (assets-src/sprites/icons/erfolge.ts). They read statistics where they can – a statistic persists from the
 * world's first tick on – and events only for moments no statistic counts.
 */
import type { AchievementInput } from '../quests/schema';

/** The eight fish of docs/SPIEL.md §29 (Feld & Fang): the angler has caught each of them. */
const FISH = ['forelle', 'barsch', 'karpfen', 'hecht', 'aal', 'quappe', 'hering', 'makrele'] as const;

export const ACHIEVEMENTS: readonly AchievementInput[] = [
  {
    id: 'erste_nacht',
    name: { de: 'Die erste Nacht', en: 'The First Night' },
    beschreibung: { de: 'Überlebe deine erste Nacht.', en: 'Survive your first night.' },
    ausloeser: { art: 'statistik', statistik: 'naechte_ueberlebt', mindestens: 1 },
  },
  {
    id: 'feuermacher',
    name: { de: 'Feuermacher', en: 'Firemaker' },
    beschreibung: { de: 'Entzünde fünf Lagerfeuer.', en: 'Light five camp fires.' },
    ausloeser: { art: 'ereignis', ereignis: 'lightIgnited', wo: { kind: 'lagerfeuer' }, anzahl: 5 },
  },
  {
    id: 'steinzeit',
    name: { de: 'Steinzeit', en: 'Stone Age' },
    beschreibung: { de: 'Stelle Steinaxt, Steinspitzhacke und Steinmesser her.', en: 'Craft a stone axe, a stone pickaxe and a stone knife.' },
    ausloeser: {
      art: 'alle',
      von: [
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinaxt', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinspitzhacke', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinmesser', mindestens: 1 },
      ],
    },
  },
  {
    id: 'baumeister',
    name: { de: 'Baumeister', en: 'Master Builder' },
    beschreibung: { de: 'Setze 100 Bauteile.', en: 'Place 100 building parts.' },
    ausloeser: { art: 'ereignis', ereignis: 'partPlaced', wo: { blueprint: false }, anzahl: 100 },
  },
  {
    id: 'gemuetlich',
    name: { de: 'Gemütlich', en: 'Cozy Home' },
    beschreibung: { de: 'Mach es dir in einem behaglichen Raum bequem.', en: 'Make yourself at home in a cozy room.' },
    ausloeser: { art: 'zustand', zustand: 'behaglich' },
  },
  {
    id: 'jaeger',
    name: { de: 'Jäger', en: 'Hunter' },
    beschreibung: { de: 'Besiege 25 Kreaturen.', en: 'Defeat 25 creatures.' },
    ausloeser: { art: 'statistik', statistik: 'kills', mindestens: 25 },
  },
  {
    id: 'bronzezeit',
    name: { de: 'Bronzezeit', en: 'Bronze Age' },
    beschreibung: { de: 'Stelle ein Werkzeug aus Bronze her.', en: 'Craft a tool of bronze.' },
    ausloeser: {
      art: 'eines',
      von: [
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzeaxt', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzehacke', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzeschaufel', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzemesser', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzesichel', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzehammer', mindestens: 1 },
        { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzespitzhacke', mindestens: 1 },
      ],
    },
  },
  {
    id: 'gaertner',
    name: { de: 'Gärtner', en: 'Gardener' },
    beschreibung: { de: 'Ernte 18 verschiedene Nutzpflanzen.', en: 'Harvest 18 different crops.' },
    ausloeser: { art: 'statistik', statistik: 'geerntet', schluessel: '*', mindestens: 18 },
  },
  {
    id: 'koch',
    name: { de: 'Koch', en: 'Cook' },
    beschreibung: { de: 'Koche zehn Gerichte.', en: 'Cook ten dishes.' },
    ausloeser: { art: 'statistik', statistik: 'gekocht', mindestens: 10 },
  },
  {
    id: 'angler',
    name: { de: 'Angler', en: 'Angler' },
    beschreibung: { de: 'Fange alle acht Fischarten.', en: 'Catch all eight kinds of fish.' },
    ausloeser: { art: 'alle', von: FISH.map((fish) => ({ art: 'statistik' as const, statistik: 'gefangen', schluessel: fish, mindestens: 1 })) },
  },
  {
    id: 'entdecker',
    name: { de: 'Entdecker', en: 'Explorer' },
    beschreibung: { de: 'Entdecke sechs verschiedene Arten von Orten.', en: 'Discover six different kinds of places.' },
    ausloeser: { art: 'statistik', statistik: 'orte_entdeckt', schluessel: '*', mindestens: 6 },
  },
  {
    id: 'gewoelbe_bezwungen',
    name: { de: 'Gewölbe bezwungen', en: 'Vault Conquered' },
    beschreibung: { de: 'Dringe bis in die Endkammer eines Gewölbes vor.', en: 'Fight your way to the final chamber of a vault.' },
    ausloeser: { art: 'statistik', statistik: 'gewoelbe_abgeschlossen', mindestens: 1 },
  },
  {
    id: 'borkenvater_besiegt',
    name: { de: 'Fäller des Borkenvaters', en: 'Barkfather Felled' },
    beschreibung: { de: 'Besiege den Borkenvater, den Hüter des Grünhains.', en: 'Defeat the Barkfather, the guardian of the Greengrove.' },
    ausloeser: { art: 'statistik', statistik: 'bosse_besiegt', schluessel: 'borkenvater', mindestens: 1 },
  },
  {
    id: 'erstes_feuer',
    name: { de: 'Das erste Feuer', en: 'The First Fire' },
    beschreibung: { de: 'Entzünde das Leuchtfeuer des Grünhains.', en: 'Light the beacon of the Greengrove.' },
    ausloeser: { art: 'statistik', statistik: 'leuchtfeuer_entzuendet', schluessel: 'gruenhain', mindestens: 1 },
  },
  {
    id: 'forscher',
    name: { de: 'Forscher', en: 'Naturalist' },
    beschreibung: { de: 'Sichte zehn Kreaturen für dein Bestiarium.', en: 'Sight ten creatures for your bestiary.' },
    ausloeser: { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { stage: 'gesichtet' }, anzahl: 10 },
  },
];
