/**
 * The puzzle types of the vaults (MASTERPROMPT §21 "Rätseltypen (≥ 14, je ≥ 3 Varianten)"; docs/SPIEL.md §19 "Rätseltypen M7",
 * §29 `kisten`, `hebel`, `feuerschalen`, `verborgene_wand`, `glocken` with variants `<typ>_1…3`; M7-12, M7-13; collection
 * `puzzleTypes`, §C "Rätseltypen"). Each variant is solvable by the solver of its type (src/game/puzzles/, one unit test per
 * variant); the generator lays them out in a room's puzzle area (src/game/puzzles/layout.ts).
 *
 * - `kisten`: ASCII maps (`#` wall, `.` floor, `o` plate, `$` crate, `@` entry, `R` the reset rune) – as many crates as plates.
 * - `hebel`: the levers carry runes; the mural above them shows the runes in order.
 * - `feuerschalen`: the bowls carry runes; the inscription names the order in which they are lit (a lit bowl stays lit).
 * - `verborgene_wand`: cracked wall segments; a draft (dust in the torchlight) betrays the real ones.
 * - `glocken`: each bell rings its own tone (semitones over the lowest); the inscription plays the tune to repeat.
 */
import type { PuzzleTypeInput } from './schema';

export const PUZZLE_TYPES: readonly PuzzleTypeInput[] = [
  {
    id: 'kisten',
    name: { de: 'Steinblöcke und Druckplatten', en: 'Stone Blocks and Pressure Plates' },
    beschreibung: {
      de: 'Schwere Steinblöcke stehen in einer Kammer voller Druckplatten. Erst wenn auf jeder Platte ein Block ruht, hebt sich das Tor.',
      en: 'Heavy stone blocks stand in a chamber of pressure plates. Only when a block rests on every plate does the gate rise.',
    },
    hinweis: {
      de: 'Drück E an einem Block, um ihn ein Feld von dir weg zu schieben. Steckt einer fest, setzt die Rune am Eingang alles zurück.',
      en: 'Press E at a block to push it one tile away from you. If one gets stuck, the rune at the entrance sets everything back.',
    },
    varianten: [
      {
        typ: 'kisten',
        id: 'kisten_1',
        karte: ['##########', '#....#...#', '#.$..#.o.#', '#..$...o.#', '@....#...#', '#R...#...#', '##########'],
      },
      {
        typ: 'kisten',
        id: 'kisten_2',
        karte: ['##########', '#...#....#', '#.$.#.o..#', '#...$..#.#', '@.#..o.#.#', '#R..$..o.#', '##########'],
      },
      {
        typ: 'kisten',
        id: 'kisten_3',
        karte: ['##########', '#..#.....#', '#.$..$.#.#', '@..#.o...#', '#.$#.#o#.#', '#R...o...#', '##########'],
      },
    ],
  },
  {
    id: 'hebel',
    name: { de: 'Hebelfolge', en: 'Lever Sequence' },
    beschreibung: {
      de: 'Eine Reihe Hebel, jeder mit einer Rune. Das Wandbild darüber zeigt die Runen in der Reihenfolge, in der die Erbauer sie zogen.',
      en: 'A row of levers, each marked with a rune. The mural above shows the runes in the order the Builders pulled them.',
    },
    hinweis: {
      de: 'Lies das Wandbild mit E und zieh die Hebel in dieser Folge. Ein falscher Hebel lässt alle zurückschnappen.',
      en: 'Read the mural with E and pull the levers in that order. A wrong lever snaps them all back.',
    },
    varianten: [
      { typ: 'hebel', id: 'hebel_1', hebel: 3, folge: [2, 0, 1] },
      { typ: 'hebel', id: 'hebel_2', hebel: 4, folge: [1, 3, 0, 2] },
      { typ: 'hebel', id: 'hebel_3', hebel: 5, folge: [4, 1, 3, 0, 2] },
    ],
  },
  {
    id: 'feuerschalen',
    name: { de: 'Feuerschalen', en: 'Fire Bowls' },
    beschreibung: {
      de: 'Kalte Schalen auf steinernen Sockeln. Die Inschrift nennt die Folge, in der die Erbauer ihre Feuer entfachten.',
      en: 'Cold bowls on stone pedestals. The inscription names the order in which the Builders kindled their fires.',
    },
    hinweis: {
      de: 'Halte eine brennende Fackel und drück E an einer Schale. Eine falsche Schale löscht alle Feuer wieder.',
      en: 'Hold a burning torch and press E at a bowl. A wrong bowl puts every fire out again.',
    },
    varianten: [
      { typ: 'feuerschalen', id: 'feuerschalen_1', schalen: 3, folge: [1, 2, 0] },
      { typ: 'feuerschalen', id: 'feuerschalen_2', schalen: 4, folge: [3, 0, 2, 1] },
      { typ: 'feuerschalen', id: 'feuerschalen_3', schalen: 5, folge: [2, 4, 0, 3, 1] },
    ],
  },
  {
    id: 'verborgene_wand',
    name: { de: 'Verborgene Wände', en: 'Hidden Walls' },
    beschreibung: {
      de: 'Rissige Mauerstücke, alle gleich. Hinter manchen liegt ein Hohlraum – dort zieht ein feiner Luftzug Staub aus den Fugen.',
      en: 'Cracked stretches of wall, all alike. Behind some lies a hollow – there a faint draft pulls dust from the joints.',
    },
    hinweis: {
      de: 'Achte im Fackelschein auf den Staub im Luftzug und drück E an der Mauer oder schlag zu. Volle Mauern klingen nur dumpf.',
      en: 'Watch for dust in the draft by torchlight and press E at the wall or strike it. Solid walls only thud.',
    },
    varianten: [
      { typ: 'verborgene_wand', id: 'verborgene_wand_1', waende: 3, echt: [1] },
      { typ: 'verborgene_wand', id: 'verborgene_wand_2', waende: 4, echt: [0, 3] },
      { typ: 'verborgene_wand', id: 'verborgene_wand_3', waende: 5, echt: [2, 4] },
    ],
  },
  {
    id: 'glocken',
    name: { de: 'Glockentöne', en: 'Bell Tones' },
    beschreibung: {
      de: 'Bronzene Glocken in steinernen Rahmen, jede mit eigenem Ton. Die Inschrift singt eine kurze Weise, wenn man sie berührt.',
      en: 'Bronze bells in stone frames, each with a tone of its own. The inscription sings a short tune when touched.',
    },
    hinweis: {
      de: 'Drück E an der Inschrift, um die Weise zu hören, und läute die Glocken in derselben Folge.',
      en: 'Press E at the inscription to hear the tune, then ring the bells in the same order.',
    },
    varianten: [
      { typ: 'glocken', id: 'glocken_1', glocken: 3, toene: [0, 4, 7], folge: [0, 1, 2, 1] },
      { typ: 'glocken', id: 'glocken_2', glocken: 4, toene: [0, 2, 4, 7], folge: [2, 0, 3, 1, 2] },
      { typ: 'glocken', id: 'glocken_3', glocken: 5, toene: [0, 3, 5, 7, 10], folge: [4, 2, 0, 3, 1, 4] },
    ],
  },
];
