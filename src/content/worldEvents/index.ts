/**
 * The register of the world events (MASTERPROMPT §10 "Ereignisse"; docs/SPIEL.md §18; M7-38 … M7-40, strand B): all eleven of
 * §10, collection `worldEvents`. Four run in M7 (`umgesetzt: true`): the Finstermond (the new moon's night, M6's stronger
 * shadow brood, now announced and chronicled), the Lumen rain (glowing shards fall in a clear night, rarely a meteorite with
 * star ore), the eclipse (rarely, an hour of night by day) and the forest fire (a summer thunderstorm's lightning sets the
 * trees alight). The other seven are registered with the task that brings them (`umgesetzt: { task }`) – they plan nothing
 * until then; their texts are already here so the register is complete (validator rule `ereignisse`).
 *
 * Planning (`planung.art`, src/game/worldevents/formulas.ts): `mond` – the night of the new moon; `naechtlich` – a night,
 * with `chance` per night from `hash(seed, 'weltereignis', id, day)`; `taeglich` – a day, the same draw; `wetter` – while the
 * weather of the player's region is one of `wetter` (and the season fits), with `chance` per day; `basis` – bound to the base
 * (the shadow flood, the trader; later milestones). The HUD line names the time left as `{minuten}`; `funke` is the guide
 * hint the lantern spirit speaks (src/content/guide/ereignisse.ts); `himmel` the sky/grading preset the renderer blends to.
 */
import type { WorldEventInput } from './schema';

export const WORLD_EVENTS: readonly WorldEventInput[] = [
  {
    id: 'schattenflut',
    name: { de: 'Schattenflut', en: 'Shadow Flood' },
    beschreibung: { de: 'Die Schattenbrut belagert die Basis in Wellen aus der Dunkelheit.', en: 'The shadow brood besieges the base in waves out of the dark.' },
    gross: true,
    planung: { art: 'basis', chance: 1, tageszeit: 'nacht' },
    dauerMinuten: [120, 360],
    ankuendigung: {
      vorlaufMinuten: 60,
      hud: { de: 'Schattenflut in {minuten} min', en: 'Shadow flood in {minuten} min' },
      funke: 'funke_ereignis_schattenflut',
      himmel: 'schattenflut',
    },
    chronik: { de: 'Die Schattenflut brach über die Basis herein.', en: 'The shadow flood broke over the base.' },
    umgesetzt: { task: 'M9-23' },
  },
  {
    id: 'finstermond',
    name: { de: 'Finstermond', en: 'Darkmoon' },
    beschreibung: {
      de: 'Neumond: Die Nacht ist am dunkelsten, die Schattenbrut kommt zahlreicher und stärker.',
      en: 'New moon: the night is at its darkest, the shadow brood comes in greater numbers and stronger.',
    },
    gross: false,
    planung: { art: 'mond', chance: 1, tageszeit: 'nacht' },
    dauerMinuten: [300, 660],
    ankuendigung: {
      vorlaufMinuten: 60,
      hud: { de: 'Finstermond in {minuten} min', en: 'Darkmoon in {minuten} min' },
      funke: 'funke_ereignis_finstermond',
      himmel: 'finstermond',
    },
    chronik: { de: 'Eine Finstermondnacht: kein Mond, und die Schattenbrut kam in Scharen.', en: 'A night of the Darkmoon: no moon, and the shadow brood came in droves.' },
    umgesetzt: true,
  },
  {
    id: 'lumenregen',
    name: { de: 'Lumenregen', en: 'Lumen Rain' },
    beschreibung: {
      de: 'Sternschnuppen in klarer Nacht: glühende Scherben schlagen ein, selten ein Meteorit mit Sternenerz.',
      en: 'Shooting stars on a clear night: glowing shards come down, rarely a meteorite with star ore.',
    },
    gross: true,
    planung: { art: 'naechtlich', chance: 0.12, wetter: ['klar', 'sternschnuppennacht'], tageszeit: 'nacht' },
    dauerMinuten: [30, 60],
    ankuendigung: {
      vorlaufMinuten: 20,
      hud: { de: 'Lumenregen in {minuten} min', en: 'Lumen rain in {minuten} min' },
      funke: 'funke_ereignis_lumenregen',
      himmel: 'lumenregen',
    },
    chronik: { de: 'Lumenregen: Der Himmel warf glühende Scherben auf die Insel.', en: 'Lumen rain: the sky threw glowing shards onto the island.' },
    umgesetzt: true,
  },
  {
    id: 'nebelnacht',
    name: { de: 'Nebelnacht', en: 'Night of Mists' },
    beschreibung: { de: 'Dichter Nebel über dem Moor, Irrlichter locken ins tiefe Wasser.', en: 'Thick mist over the bog, will-o’-the-wisps lure into deep water.' },
    gross: true,
    planung: { art: 'naechtlich', chance: 0.1, biome: ['nebelmoor'], tageszeit: 'nacht' },
    dauerMinuten: [120, 300],
    ankuendigung: {
      vorlaufMinuten: 30,
      hud: { de: 'Nebelnacht in {minuten} min', en: 'Night of mists in {minuten} min' },
      funke: 'funke_ereignis_nebelnacht',
      himmel: 'nebelnacht',
    },
    chronik: { de: 'Eine Nebelnacht: Irrlichter tanzten über dem Moor.', en: 'A night of mists: will-o’-the-wisps danced over the bog.' },
    umgesetzt: { task: 'M8-37' },
  },
  {
    id: 'sonnenfinsternis',
    name: { de: 'Sonnenfinsternis', en: 'Solar Eclipse' },
    beschreibung: {
      de: 'Selten schiebt sich der Mond vor die Sonne: eine Stunde Nacht am hellen Tag – die Schattenbrut erwacht.',
      en: 'Rarely the moon slides in front of the sun: an hour of night in broad daylight – the shadow brood awakens.',
    },
    gross: true,
    planung: { art: 'taeglich', chance: 0.03, tageszeit: 'tag' },
    dauerMinuten: [60, 60],
    ankuendigung: {
      vorlaufMinuten: 30,
      hud: { de: 'Sonnenfinsternis in {minuten} min', en: 'Solar eclipse in {minuten} min' },
      funke: 'funke_ereignis_sonnenfinsternis',
      himmel: 'sonnenfinsternis',
    },
    chronik: { de: 'Eine Sonnenfinsternis: Für eine Stunde wurde der Tag zur Nacht.', en: 'A solar eclipse: for an hour, day became night.' },
    umgesetzt: true,
  },
  {
    id: 'haendlerin',
    name: { de: 'Wandernde Händlerin', en: 'Wandering Trader' },
    beschreibung: { de: 'Die Händlerin besucht die Basis für einen Tag, wenn das Herdfeuer brennt.', en: 'The trader visits the base for a day while the hearth fire burns.' },
    gross: false,
    planung: { art: 'basis', chance: 1, tageszeit: 'tag' },
    dauerMinuten: [720, 1440],
    ankuendigung: {
      vorlaufMinuten: 60,
      hud: { de: 'Die Händlerin kommt in {minuten} min', en: 'The trader arrives in {minuten} min' },
      funke: 'funke_ereignis_haendlerin',
    },
    chronik: { de: 'Die wandernde Händlerin rastete an der Basis.', en: 'The wandering trader rested at the base.' },
    umgesetzt: { task: 'M9-17' },
  },
  {
    id: 'tierwanderung',
    name: { de: 'Tierwanderung', en: 'Animal Migration' },
    beschreibung: { de: 'Herden ziehen durch das Land, im Frühling nach Norden, im Herbst nach Süden.', en: 'Herds move across the land, north in spring, south in autumn.' },
    gross: false,
    planung: { art: 'taeglich', chance: 0.1, jahreszeiten: ['fruehling', 'herbst'], tageszeit: 'tag' },
    dauerMinuten: [240, 600],
    ankuendigung: {
      vorlaufMinuten: 60,
      hud: { de: 'Tierwanderung in {minuten} min', en: 'Animal migration in {minuten} min' },
      funke: 'funke_ereignis_tierwanderung',
    },
    chronik: { de: 'Eine Tierwanderung zog über die Insel.', en: 'An animal migration crossed the island.' },
    umgesetzt: { task: 'M8-37' },
  },
  {
    id: 'lawine',
    name: { de: 'Lawine', en: 'Avalanche' },
    beschreibung: { de: 'Nach Schneefall gehen an den Lawinenhängen des Frostkamms Lawinen ab.', en: 'After snowfall, avalanches come down the Frostkamm’s slopes.' },
    gross: true,
    planung: { art: 'wetter', chance: 0.2, wetter: ['schnee', 'schneesturm'], biome: ['frostkamm'] },
    dauerMinuten: [10, 30],
    ankuendigung: {
      vorlaufMinuten: 10,
      hud: { de: 'Lawinengefahr – in {minuten} min', en: 'Avalanche danger – in {minuten} min' },
      funke: 'funke_ereignis_lawine',
      himmel: 'lawine',
    },
    chronik: { de: 'Eine Lawine donnerte die Hänge des Frostkamms hinab.', en: 'An avalanche thundered down the slopes of the Frostkamm.' },
    umgesetzt: { task: 'M8-37' },
  },
  {
    id: 'waldbrand',
    name: { de: 'Waldbrand', en: 'Forest Fire' },
    beschreibung: {
      de: 'Ein trockenes Sommergewitter: Blitze setzen Bäume in Brand, bevor der Regen kommt.',
      en: 'A dry summer thunderstorm: lightning sets trees alight before the rain arrives.',
    },
    gross: true,
    planung: { art: 'wetter', chance: 0.5, jahreszeiten: ['sommer'], wetter: ['gewitter'] },
    dauerMinuten: [60, 180],
    ankuendigung: {
      vorlaufMinuten: 10,
      hud: { de: 'Trockenes Gewitter – Waldbrandgefahr in {minuten} min', en: 'Dry thunderstorm – fire danger in {minuten} min' },
      funke: 'funke_ereignis_waldbrand',
      himmel: 'waldbrand',
    },
    chronik: { de: 'Ein Waldbrand: Blitze entzündeten die Bäume im Sommergewitter.', en: 'A forest fire: lightning set the trees ablaze in a summer storm.' },
    umgesetzt: true,
  },
  {
    id: 'flut',
    name: { de: 'Flut', en: 'Flood' },
    beschreibung: { de: 'Nach langem Regen tritt das Nebelmoor über die Ufer.', en: 'After long rain the Nebelmoor overflows its banks.' },
    gross: true,
    planung: { art: 'wetter', chance: 0.3, wetter: ['regen', 'gewitter'], biome: ['nebelmoor'] },
    dauerMinuten: [180, 600],
    ankuendigung: {
      vorlaufMinuten: 60,
      hud: { de: 'Flut in {minuten} min', en: 'Flood in {minuten} min' },
      funke: 'funke_ereignis_flut',
      himmel: 'flut',
    },
    chronik: { de: 'Eine Flut: Das Nebelmoor trat über die Ufer.', en: 'A flood: the Nebelmoor broke its banks.' },
    umgesetzt: { task: 'M8-37' },
  },
  {
    id: 'erdbeben',
    name: { de: 'Erdbeben', en: 'Earthquake' },
    beschreibung: { de: 'Die Erde im Aschenschlund bebt und öffnet neue Höhlengänge.', en: 'The ground of the Aschenschlund quakes and opens new cave passages.' },
    gross: true,
    planung: { art: 'taeglich', chance: 0.05, biome: ['aschenschlund'] },
    dauerMinuten: [2, 5],
    ankuendigung: {
      vorlaufMinuten: 5,
      hud: { de: 'Die Erde grollt – Beben in {minuten} min', en: 'The ground rumbles – quake in {minuten} min' },
      funke: 'funke_ereignis_erdbeben',
      himmel: 'erdbeben',
    },
    chronik: { de: 'Ein Erdbeben erschütterte den Aschenschlund und riss neue Gänge auf.', en: 'An earthquake shook the Aschenschlund and tore open new passages.' },
    umgesetzt: { task: 'M10-25' },
  },
];
