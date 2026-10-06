/**
 * Knowledge entries of strand F (Wissen tab; docs/SPIEL.md §22, §23; M7-32 … M7-37): the wardens of the fires, the beacons,
 * the shards, the Lumen lantern, travelling between the fires and the first beacon's vision.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_F: readonly KnowledgeInput[] = [
  {
    id: 'wissen_bosse',
    titel: { de: 'Die Wächter der Feuer', en: 'The Wardens of the Fires' },
    text: {
      de: 'Neben jeder Leuchtfeuer-Stätte wacht ein verdorbener Wächter in seiner Arena. Betrittst du sie, erwacht er und versiegelt sie. Er kämpft in drei Phasen; jeder Angriff kündigt sich an – am Boden, an seiner Haltung, im Klang. Fällst du, erwachst du vor der Arena, und er ist wieder heil. Besiegt lässt er Einzigartiges zurück: Trophäe, Herzsplitter und das, was das Leuchtfeuer braucht.',
      en: 'Beside every beacon site a corrupted warden keeps watch in its arena. Step inside and it wakes and seals it. It fights in three phases; every attack announces itself – on the ground, in its stance, in sound. If you fall, you wake before the arena and it is whole again. Defeated, it leaves unique spoils: a trophy, a heart shard and what the beacon needs.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'bossAwakened' },
  },
  {
    id: 'wissen_leuchtfeuer',
    titel: { de: 'Die Leuchtfeuer', en: 'The Beacons' },
    text: {
      de: 'Sechs Leuchtfeuer bauten die Erbauer, eines je Land. Ist sein Wächter besiegt, entzündest du es mit E. Eine Lichtwelle läuft über das Land, die Verderbnis weicht, die Farben kehren zurück. Um das Feuer liegt eine Schutzzone ohne Schattenbrut; du kannst dort erwachen und von dort reisen. Jedes Feuer lehrt Neues und schenkt einen Glutkern für dein Herdfeuer.',
      en: 'The Builders raised six beacons, one in every land. Once its warden is defeated, light it with E. A wave of light runs over the land, the corruption retreats, the colours return. Around the fire lies a refuge without shadowspawn; you can wake there and travel from there. Every fire teaches something new and gives an ember core for your hearth.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'beaconLit' },
  },
  {
    id: 'wissen_splitter',
    titel: { de: 'Splitter', en: 'Shards' },
    text: {
      de: 'Herzsplitter fallen von besiegten Wächtern: benutzt, steigt dein Leben dauerhaft um 10. Glutsplitter stärken deine Ausdauer um 5. Ein Splitter wird beim Benutzen eins mit dir – er ist danach fort.',
      en: 'Heart shards fall from defeated wardens: used, your health rises by 10 for good. Ember shards raise your stamina by 5. A shard becomes one with you when used – it is gone afterwards.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'besitz', item: 'herzsplitter', anzahl: 1 }, { art: 'ereignis', ereignis: 'shardUsed' }] },
  },
  {
    id: 'wissen_lumen_laterne',
    titel: { de: 'Die Lumen-Laterne', en: 'The Lumen Lantern' },
    text: {
      de: 'Das erste Leuchtfeuer lehrt die Lumen-Laterne. In der Nebenhand leuchtet sie acht Kacheln weit, Wind und Regen löschen sie nicht. Lumen-Scherben laden sie; Schattenbrut in ihrer Nähe verbrennt. Der Lichtfresser saugt ihre Ladung aus – halte Abstand.',
      en: 'The first beacon teaches the Lumen lantern. In the off hand it lights eight tiles, wind and rain do not put it out. Lumen shards charge it; shadowspawn close to it burns. The light eater sucks its charge away – keep your distance.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'besitz', item: 'lumen_laterne', anzahl: 1 },
  },
  {
    id: 'wissen_schnellreise',
    titel: { de: 'Reisen im Licht', en: 'Travelling in the Light' },
    text: {
      de: 'Zwischen entzündeten Leuchtfeuern, brennenden Herdfeuern und Wegsteinen trägt dich das Licht. E an einem Reisepunkt öffnet die Reise; je weiter das Ziel, desto mehr Lumen-Scherben kostet sie. Im Kampf und solange ein Wächter wacht, trägt es dich nicht. Wegsteine kannst du benennen.',
      en: 'The light carries you between lit beacons, burning hearth fires and waystones. E at a travel point opens the journey; the farther the goal, the more Lumen shards it costs. It will not carry you in a fight or while a warden is awake. Waystones can be named.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'freischaltung', freischaltung: 'lf1_wegsteine' }, { art: 'ereignis', ereignis: 'travelOpened' }] },
  },
  {
    id: 'wissen_vision_1',
    titel: { de: 'Vision: Die sechs Feuer', en: 'Vision: The Six Fires' },
    text: {
      de: 'Einst brannten sechs Feuer über Lumara, entzündet von den Erbauern, um die Nacht zu bannen. Doch sie griffen nach dem Urfeuer selbst und rissen das Nachtherz auf. Eines nach dem anderen erloschen die Feuer; nur eine Glut wurde fortgetragen, nach Süden, ans Meer. Das erste Feuer brennt wieder – fünf warten noch in der Dunkelheit.',
      en: 'Once six fires burned over Lumara, lit by the Builders to hold back the night. But they reached for the First Fire itself and tore the Nightheart open. One by one the fires died; only one ember was carried away, south, to the sea. The first fire burns again – five still wait in the dark.',
    },
    quelle: 'vision',
    freischaltung: { art: 'ereignis', ereignis: 'beaconLit', wo: { beacon: 1 } },
  },
];
