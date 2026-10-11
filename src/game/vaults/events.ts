/**
 * Events of the vaults (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen", §19) – the feedback of
 * MASTERPROMPT §2.7 for §21 "Gewölbe": the music turns to the vault (strand A), the chronicle, statistics, achievements and the
 * knowledge count (strand G), the HUD names what happened, the game view moves doors, levers, crates and traps.
 *
 * - `vaultEntered` / `vaultLeft`: the player went down the stairs into the vault in slot `vault` (`erstmals` the first time: its
 *   guards rise then) or up again.
 * - `vaultCompleted`: the mini-boss of the vault fell and its end chest is open (once per vault, §19).
 * - `vaultDoorUnlocked`: a lock opened with the vault's key (`schluessel` = the key item); `vaultDoorOpened`: a puzzle's door
 *   ground open (`puzzle`); `vaultHiddenFound`: a cracked wall gave way to a secret room (`door`).
 * - `vaultKeyTaken`, `vaultShardTaken`, `vaultChestOpened` (`stufe`, `mimik` when the chest was a mimic that fell).
 * - `puzzleStep`: a part of a puzzle was used – a lever pulled, a bowl lit, a bell rung, a cracked wall struck (`part`, `richtig`:
 *   whether it advanced the puzzle; `ton` a bell's pitch in semitones over the lowest bell, else 0); `puzzleReset`: a wrong step undid the progress (or the reset rune put the crates back);
 *   `puzzleSolved`: the puzzle is solved and its door opens; `vaultCratePushed`: a crate moved one tile (`dir` 0 north … 3 west,
 *   `platte`: it stands on a plate now); `vaultHintPlayed`: the inscription of a bell puzzle plays one tone of its tune
 *   (`ton` in semitones over the lowest bell, `index` of the tone in the tune).
 * - `vaultTrapArmed`: a trap warns (§4.6 telegraph, ≥ 0.4 s before it strikes); `vaultTrapTriggered`: it struck (named apart from
 *   the M6 traps' `trapSprung`), `x`, `y` the trap's tile centre [px].
 * - `tabletRead`: a Builder tablet was read (`quelle` vault or place, `ort` its slot) – the knowledge and the chronicle (G), the
 *   tablet screen (presentation).
 * Refused commands raise `commandRejected` with a `VaultRejectReason` (texts `ui.gewoelbe.reject.<reason>`).
 */

/**
 * Why a vault command had no effect:
 * - `noPlayer`; `dead`, `asleep` – the player cannot act;
 * - `unknownVault` – no vault in that slot; `notInVault` – the tile is in no vault; `outOfReach` – farther than the use reach;
 * - `nothingThere` – nothing usable on the tile; `locked` – the door needs this vault's key (`keinSchluessel` of the hint);
 *   `puzzleClosed` – the door opens only when its puzzle is solved; `noTorch` – a bowl is lit with a burning light in the hand;
 *   `cooling` – the puzzle still springs back from a wrong step (`BALANCE.puzzles`); `solved` – the puzzle is solved already;
 *   `blocked` – the crate cannot move that way (a wall, another crate, the map's edge) or the player does not stand behind it;
 *   `bagsFull` – the key or the shard does not fit into the bags; `unknownTablet` – no such tablet;
 * - `noPlaceLeft` – a map of the map table finds no place of its type the player does not know yet (src/game/research/).
 */
export const VAULT_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'unknownVault', 'notInVault', 'outOfReach', 'nothingThere', 'locked', 'puzzleClosed', 'noTorch', 'cooling', 'solved', 'blocked', 'bagsFull', 'unknownTablet', 'noPlaceLeft'] as const;
/** One reason a vault command was refused. */
export type VaultRejectReason = (typeof VAULT_REJECT_REASONS)[number];

interface VaultBase {
  /** Slot id of the vault (`VaultPlan.slot`). */
  readonly vault: number;
  readonly tick: number;
}
interface PuzzleBase extends VaultBase {
  /** Puzzle id within the vault (`VaultPuzzlePlan.id`). */
  readonly puzzle: number;
  readonly typ: string;
}

export interface VaultEventMap {
  vaultEntered: VaultBase & { readonly biome: string; readonly erstmals: boolean };
  vaultLeft: VaultBase;
  vaultCompleted: VaultBase & { readonly biome: string };
  vaultDoorUnlocked: VaultBase & { readonly door: number; readonly schluessel: string; readonly tx: number; readonly ty: number };
  vaultDoorOpened: VaultBase & { readonly door: number; readonly puzzle: number; readonly tx: number; readonly ty: number };
  vaultHiddenFound: VaultBase & { readonly door: number; readonly tx: number; readonly ty: number };
  vaultKeyTaken: VaultBase & { readonly door: number; readonly tx: number; readonly ty: number };
  vaultShardTaken: VaultBase & { readonly tx: number; readonly ty: number };
  vaultChestOpened: VaultBase & { readonly chest: number; readonly stufe: number; readonly mimik: boolean; readonly tx: number; readonly ty: number };
  puzzleStep: PuzzleBase & { readonly part: number; readonly richtig: boolean; readonly ton: number; readonly tx: number; readonly ty: number };
  puzzleReset: PuzzleBase;
  puzzleSolved: PuzzleBase;
  vaultCratePushed: PuzzleBase & { readonly tx: number; readonly ty: number; readonly dir: number; readonly platte: boolean };
  vaultHintPlayed: PuzzleBase & { readonly index: number; readonly ton: number; readonly tx: number; readonly ty: number };
  vaultTrapArmed: VaultBase & { readonly trap: number; readonly typ: string; readonly x: number; readonly y: number };
  vaultTrapTriggered: VaultBase & { readonly trap: number; readonly typ: string; readonly x: number; readonly y: number };
  tabletRead: { readonly tablet: string; readonly quelle: 'gewoelbe' | 'ort'; readonly ort: number; readonly tick: number };
}

/** Event names of `VaultEventMap`. */
export const VAULT_EVENT_TYPES = [
  'vaultEntered',
  'vaultLeft',
  'vaultCompleted',
  'vaultDoorUnlocked',
  'vaultDoorOpened',
  'vaultHiddenFound',
  'vaultKeyTaken',
  'vaultShardTaken',
  'vaultChestOpened',
  'puzzleStep',
  'puzzleReset',
  'puzzleSolved',
  'vaultCratePushed',
  'vaultHintPlayed',
  'vaultTrapArmed',
  'vaultTrapTriggered',
  'tabletRead',
] as const satisfies ReadonlyArray<keyof VaultEventMap>;

/** Sounds of the vaults (src/content/sfx/gewoelbe.ts, raetsel.ts; the traps' own in src/content/dungeons/fallen.ts; src/audio/eventMap.ts). */
export const VAULT_SFX = {
  stairs: 'sfx_gewoelbe_treppe',
  door: 'sfx_gewoelbe_tuer',
  unlock: 'sfx_gewoelbe_aufschliessen',
  hidden: 'sfx_gewoelbe_risswand',
  pickup: 'sfx_gewoelbe_aufnehmen',
  chest: 'sfx_gewoelbe_truhe',
  completed: 'sfx_gewoelbe_bezwungen',
  tablet: 'sfx_gewoelbe_tafel',
  trapWarn: 'sfx_falle_warnung',
  lever: 'sfx_raetsel_hebel',
  bowl: 'sfx_raetsel_schale',
  bell: 'sfx_raetsel_glocke',
  wallThud: 'sfx_raetsel_wand',
  crate: 'sfx_raetsel_kiste',
  plate: 'sfx_raetsel_platte',
  reset: 'sfx_raetsel_zurueck',
  solved: 'sfx_raetsel_geloest',
} as const;
