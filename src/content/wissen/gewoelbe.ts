/**
 * Knowledge entries of strand C (Wissen tab; docs/SPIEL.md §19, §23; M7-10 … M7-18, M7-46): the vaults, keys and locks, the
 * five puzzle types, the traps, the rewards (ember shards, relics, schematics), the research desk and the map table – and the
 * Builder tablets 1–10: each read tablet stands in the tab with its title, its text and where it was found (source `tafel`).
 */
import { TABLETS } from '../dungeons/tafeln';
import type { KnowledgeInput } from '../chronik/schema';

/** Where a tablet lies, as the knowledge entry names it. */
const TABLET_PLACE = {
  gewoelbe: { de: 'Gefunden in einem Gewölbe der Erbauer.', en: 'Found in a vault of the Builders.' },
  friedhof: { de: 'Gefunden auf einem Erbauer-Friedhof.', en: 'Found at a Builder graveyard.' },
  eremitenhuette: { de: 'Gefunden in einer Eremitenhütte.', en: 'Found in a hermit\'s hut.' },
  gehoeft: { de: 'Gefunden auf einem verlassenen Gehöft.', en: 'Found at an abandoned farmstead.' },
} as const;

function tabletPlace(t: (typeof TABLETS)[number]): { de: string; en: string } {
  const key = t.fundort.art === 'gewoelbe' ? 'gewoelbe' : t.fundort.ortstyp;
  const place = (TABLET_PLACE as Readonly<Record<string, { de: string; en: string }>>)[key];
  if (place === undefined) throw new Error(`wissen/gewoelbe: no find place text for tablet ${t.id} (${key})`);
  return place;
}

/** One knowledge entry per Builder tablet, unlocked when it is read (`tabletRead`). */
const TABLET_KNOWLEDGE: readonly KnowledgeInput[] = TABLETS.map((t) => {
  const place = tabletPlace(t);
  return {
    id: `wissen_${t.id}`,
    titel: { de: `Tafel ${t.nummer}: ${t.titel.de}`, en: `Tablet ${t.nummer}: ${t.titel.en}` },
    text: { de: `${t.text.de} – ${place.de}`, en: `${t.text.en} – ${place.en}` },
    quelle: 'tafel',
    freischaltung: { art: 'ereignis', ereignis: 'tabletRead', wo: { tablet: t.id } },
  };
});

export const KNOWLEDGE_C: readonly KnowledgeInput[] = [
  {
    id: 'wissen_gewoelbe',
    titel: { de: 'Die Gewölbe der Erbauer', en: 'The Builders\' Vaults' },
    text: {
      de: 'Unter Felsfüßen führen Treppen in Gewölbe aus Erbauer-Stein: fünf bis neun Räume, verschlossene Tore, Rätsel, Fallen, Wächter und am Ende eine Kammer mit ihrem Hüter und der Endtruhe. Unten ist es dunkel – nimm eine Fackel mit. E an der Treppe bringt dich hinab und wieder hinauf.',
      en: 'Beneath rocky outcrops, stairs lead down into vaults of Builder stone: five to nine rooms, locked gates, puzzles, traps, guards and at the end a chamber with its warden and the end chest. Down there it is dark – bring a torch. E at the stairs takes you down and back up.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'vaultEntered' },
  },
  {
    id: 'wissen_gewoelbe_schloesser',
    titel: { de: 'Schlüssel und Schlösser', en: 'Keys and Locks' },
    text: {
      de: 'Ein bronzenes Gittertor öffnet nur ein Schlüssel desselben Gewölbes. Er liegt auf einem Sockel in einem Raum, den du ohne dieses Tor erreichst, und wird beim Aufschließen verbraucht. Rätseltore öffnen sich, sobald das Rätsel ihres Raumes gelöst ist.',
      en: 'A bronze gate opens only with a key of the same vault. It lies on a pedestal in a room you can reach without that gate, and it is used up when you unlock. Puzzle gates open as soon as the puzzle of their room is solved.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'vaultKeyTaken' },
  },
  {
    id: 'wissen_raetsel',
    titel: { de: 'Rätsel der Erbauer', en: 'Puzzles of the Builders' },
    text: {
      de: 'Fünf Arten: Steinkisten auf Druckplatten schieben (E schiebt sie von dir weg, die Rückstellrune setzt sie zurück); Hebel in der Folge der Zahlzeichen ziehen; Feuerschalen mit brennender Fackel in der Hand in ihrer Folge entzünden; Glocken in der Tonfolge der Inschrift läuten; echte rissige Wände finden – dort zieht Staub im Luftzug. Ein falscher Schritt setzt das Rätsel zurück.',
      en: 'Five kinds: push stone crates onto pressure plates (E pushes them away from you, the reset rune puts them back); pull levers in the order of the numerals; light fire bowls in their order with a burning torch in hand; ring bells in the tune of the inscription; find the real cracked walls – dust drifts there in the draft. A wrong step resets the puzzle.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'puzzleStep' },
  },
  {
    id: 'wissen_gewoelbe_fallen',
    titel: { de: 'Fallen', en: 'Traps' },
    text: {
      de: 'Speerfallen und Fallgruben lauern auf Platten, Pfeilwerfer und Rollsteine wachen über eine Bahn, Pendelklingen schwingen im Takt, und mancher Boden stürzt ein. Jede Falle warnt, bevor sie zuschlägt: Runen glühen, Augen leuchten, der Stein zittert. Eine Ausweichrolle entgeht dem Schlag – und auch Kreaturen lösen Fallen aus.',
      en: 'Spear traps and pits lurk on plates, dart throwers and boulders watch over a lane, pendulum blades swing on their beat, and some floors collapse. Every trap warns before it strikes: runes glow, eyes light up, the stone trembles. A dodge roll escapes the blow – and creatures set traps off too.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'vaultTrapArmed' },
  },
  {
    id: 'wissen_gewoelbe_beute',
    titel: { de: 'Schätze der Gewölbe', en: 'Treasures of the Vaults' },
    text: {
      de: 'Truhen werden tiefer im Gewölbe reicher; manche beißen. Die Endtruhe birgt einen einzigartigen Bauplan. Zwölf Glutsplitter liegen in den Gewölben der Welt – jeder stärkt deine Ausdauer dauerhaft um 5. Relikte der Erbauer werden am Forschungspult zu Bauplänen.',
      en: 'Chests grow richer deeper in a vault; some bite. The end chest holds a unique schematic. Twelve ember shards lie in the vaults of the world – each raises your stamina by 5 for good. Builder relics become schematics at the research desk.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'vaultChestOpened' },
  },
  {
    id: 'wissen_forschung',
    titel: { de: 'Forschungspult und Kartentisch', en: 'Research Desk and Map Table' },
    text: {
      de: 'Am Forschungspult studierst du ein Relikt, bis ein Bauplan daraus wird. Ein benutzter Bauplan schaltet sein Rezept für immer frei. Am Kartentisch zeichnest du Karten zu Orten; benutzt, trägt eine Karte den nächsten Ort ihrer Art ein, den du noch nicht kennst.',
      en: 'At the research desk you study a relic until it becomes a schematic. A used schematic unlocks its recipe for good. At the map table you draw maps to places; used, a map marks the nearest place of its kind you do not know yet.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'besitz', item: 'relikt_kompass', anzahl: 1 }, { art: 'besitz', item: 'relikt_siegel', anzahl: 1 }, { art: 'besitz', item: 'relikt_zahnrad', anzahl: 1 }, { art: 'besitz', item: 'bauplan_kartentisch', anzahl: 1 }] },
  },
  ...TABLET_KNOWLEDGE,
];
