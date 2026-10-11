/**
 * Balance values of the Builder vaults (MASTERPROMPT §21 "Erbauer-Gewölbe … Graph-Grammatik (Start → Räume, Schlüssel und
 * Schlösser, Rätsel → Endkammer mit Mini-Boss)", "Fallen", "Belohnungen", "Glutsplitter (+5 max. Ausdauer; 12 in der Welt)";
 * docs/SPIEL.md §19; M7-10 … M7-16) – group `BALANCE.vaults` (src/content/balance.ts re-exports it). Room templates, puzzle
 * variants, traps and tablets are content (src/content/dungeons/). Every value states its unit and the reason for it.
 */

export const VAULTS_BALANCE = {
  /**
   * Edge of a vault's reserved box on layer −1 [tiles]. docs/SPIEL.md §19 "≤ 80 × 80 Kacheln": five cells of 16 tiles; the box
   * is centred on the entrance, and vault slots keep 90 tiles apart (src/world/gen/locations.ts), so two boxes never meet.
   */
  boxTiles: 80,
  /** Cells per box edge [cells]. The box of `boxTiles` holds 5 × 5 template cells of 16 tiles (`ROOM_CELL_TILES`). */
  gridCells: 5,
  /** Fewest rooms of a vault [rooms]. §19 "5–9 Räume": start, a gate or two, a side room and the end chamber at least. */
  minRooms: 5,
  /** Most rooms of a vault [rooms]. §19 "5–9 Räume": a vault is cleared in one evening's dive, not a maze. */
  maxRooms: 9,
  /** Puzzles of an ordinary vault [puzzles]. §19 "sonst 1–3": one to three locked-by-puzzle doors on the way to the end. */
  puzzlesMin: 1,
  /** Most puzzles of an ordinary vault [puzzles]. §19 "sonst 1–3". */
  puzzlesMax: 3,
  /**
   * Different puzzle types of the Grünhain vault nearest the start beach [types]. §32 "1 Gewölbe mit ≥ 4 Rätseltypen": the first
   * vault a player finds shows the breadth of the puzzles (grammar parameter `minPuzzleTypes`).
   */
  nearestPuzzleTypes: 4,
  /** Locked doors of a vault [doors]: one, sometimes two. §21 "Schlüssel und Schlösser" – each key lies before its lock. */
  locksMin: 1,
  /** Most locked doors [doors]. A second key room makes a vault branch; more would crowd 9 rooms. */
  locksMax: 2,
  /** Chance of a second lock [0–1]. Half the vaults branch once more. */
  secondLockChance: 0.5,
  /**
   * Chance that a vault hides a secret room behind a cracked wall [0–1]. §19 "verborgene Wände als Kanten der Art verborgen
   * (optional, nie auf dem einzigen Weg)": a treasure for those who listen for the draft, in about every third vault.
   */
  hiddenWallChance: 0.35,
  /**
   * Weights of the side room roles [relative]: chamber (guards), trap room, treasure, corridor. Chambers and corridors
   * carry the walk, traps and treasure are the spice (§21 "Fallen", "Truhen nach Stufe").
   */
  sideRoles: { kammer: 3, falle: 2, schatz: 2, gang: 2 },
  /** Depth from the start from which chests are of tier 2 / tier 3 [rooms]. §21 "Truhen nach Stufe": deeper is richer. */
  tier2Depth: 3,
  /** Depth of tier 3 chests [rooms]; the end chest is always tier 3. */
  tier3Depth: 5,
  /** Chance that a chamber holds a chest [0–1]. Not every room pays: half the chambers do. */
  chamberChestChance: 0.5,
  /** Chance that a chest of a chamber or treasure room is a mimic [0–1]. §20.1 "Mimik-Truhe": one chest in five bites. */
  mimicChance: 0.2,
  /** Traps of a trap room [traps]: two, sometimes three (§21 "Fallen"). */
  trapRoomTrapsMin: 2,
  /** Most traps of a trap room [traps]. */
  trapRoomTrapsMax: 3,
  /** Chance of one trap in a chamber, corridor or lock room [0–1]. Half the rooms on the way bite: a vault is never safe. */
  sideTrapChance: 0.5,
  /**
   * Fewest traps of a vault [traps]: where the draws left fewer, trap rooms, corridors, chambers and lock rooms get more (§19
   * "Fallen" – every vault tests the eye at least twice, so the hazard language is learnt where it cannot kill twice at once).
   */
  trapsMin: 2,
  /**
   * Longest lane a dart thrower watches and a boulder rolls down [tiles]: half a room cell – far enough to cross a room's
   * width, short enough that its warning (§4.6, ≥ 0.4 s) is seen and heard from where it can hit.
   */
  trapLaneMaxTiles: 8,
  /** Constructs guarding a chamber [creatures]: one or two (§20.1 "Erbauer-Konstrukte"). */
  chamberGuardsMin: 1,
  /** Most constructs of a chamber [creatures]. */
  chamberGuardsMax: 2,
  /** Chance that a trap room has a trap spirit [0–1]. §20.1 "Fallengeister" haunt the trap rooms. */
  trapSpiritChance: 0.6,
  /**
   * Ember shards in the whole world [shards]. §21 "Glutsplitter (+5 max. Ausdauer; 12 in der Welt)": the generator reserves 12
   * vault slots over all biomes (docs/SPIEL.md §19).
   */
  emberShards: 12,
  /** Attempts to embed a graph into the grid before the next graph seed [tries]. Trees of ≤ 9 rooms in 5 × 5 cells embed at once. */
  embedTries: 24,
  /** Reach of a vault's uses from the player's feet to the part's centre [tiles] – a lever, a bowl, a chest at arm's length. */
  useReachTiles: 2.5,
  /** Leash of a vault's guards [tiles]: they keep to their room (half a cell beyond its middle). */
  guardLeashTiles: 10,
  /**
   * Light of a burning fire bowl of a puzzle: radius [tiles], brightness [light level], flicker [0–1], flame height above its
   * foot [px], colour [palette ref]. A bowl is a smaller fire than a camp fire (8 tiles): it lights its pedestal row and the
   * stele behind it, so a solved row of bowls warms the puzzle room without lighting the whole vault – the torch stays needed.
   */
  bowlLight: { radiusTiles: 5, intensity: 1, flicker: 0.3, flameHeightPx: 14, farbe: 'feuer.3' },
  /**
   * Light of a glowing floor rune of the Builders (`ort_gw_rune`, the templates' decor): radius [tiles], brightness [light
   * level], flicker [0–1], height of the glow [px], colour [palette ref]. A faint cold pool around the rune – enough to see the
   * floor and a wall in a dark vault, never enough to read a trap's warning by it: the warm torch stays the light to walk by.
   */
  runeLight: { radiusTiles: 3, intensity: 0.38, flicker: 0.05, flameHeightPx: 2, farbe: 'eis.3' },
  /** Distance from the player within which the runes of the vault he is in shine [tiles]: the view and a margin. */
  runeLightReachTiles: 24,
} as const;
