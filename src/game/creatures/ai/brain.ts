/**
 * The utility AI of the creatures (docs/SPIEL.md §11 "KI (M6-13)"; MASTERPROMPT §19.4 "Verhalten: Utility-KI …"): every
 * decision scores the states that make sense in the creature's situation and takes the best; ties among the idle states
 * are broken by the profile's weights and a small random part (stream `creatures`, so the choice is deterministic).
 *
 * The situation (`BrainInput`) is what the creature knows: its stance and profile, whether it is awake, what it perceives
 * of its target (seen now, remembered, how far), a noise it heard, its health, whether it was hit, whether an attack is
 * ready and in reach, how far it is from home, its role in a pack, whether it stands in light it avoids. The scores
 * (`BALANCE.ai.utility`) put fear first, then the fight, then investigating, then sleep and the idle states:
 *
 * - `fliehen`: a shy creature that perceives a threat within its flight distance; a defiant one (`wehrhaft`) too, unless it
 *   was hit and has the attacker in reach while its courage holds; anything whose health fell below its courage (`mut`);
 *   shadow brood standing in light it avoids; a creature shy of fire (`scheutFeuer`) near an open flame.
 * - `angreifen`: a hostile creature (aggressive, hunter, a territorial one whose home is invaded, a defiant one that was
 *   hit) with an attack ready and in reach.
 * - `umkreisen`: a pack member that is not its pack's turn to attack circles the target on its slot (M6-18).
 * - `jagen`: a hostile creature that knows where its target is and cannot strike yet.
 * - `rueckzug`: a ranged fighter too close to its target, or a creature right after its blow.
 * - `heimkehr`: beyond the leash (the relentless Nachtmahr knows none).
 * - `untersuchen`: a noise heard or a lost trail, for `untersuchen` seconds.
 * - `schlafen`: outside its hours, with nothing around.
 * - `ruhen`, `grasen`, `umherstreifen`: idle, weighted by the profile.
 */
import { BALANCE } from '../../../content/balance';
import type { AiProfileDef } from '../../../content/creatures/schema';
import type { Rng } from '../../../engine/rng';
import type { AiState } from '../state';

const U = BALANCE.ai.utility;

/** What a creature knows when it decides. */
export interface BrainInput {
  profile: AiProfileDef;
  /** Awake in this phase of the day. */
  awake: boolean;
  /** It knows a target (seen or remembered within its memory). */
  hasTarget: boolean;
  /** It sees the target now. */
  seesTarget: boolean;
  /** Distance to the target's last known place [tiles]. */
  targetTiles: number;
  /** It heard a noise within its investigation time and has no target. */
  heardNoise: boolean;
  /** It lost its target within its investigation time (the trail is fresh). */
  lostTrail: boolean;
  /** Health share 0 … 1. */
  health: number;
  /** It was hit recently (alarmed). */
  alarmed: boolean;
  /** An attack is ready and the target within its reach. */
  attackReady: boolean;
  /** It is the pack's turn of this member to attack (true without a pack). */
  attackTurn: boolean;
  /** Member of a pack with a shared target. */
  inPack: boolean;
  /** Distance to its home [tiles]. */
  homeTiles: number;
  /** Its home is invaded: the target is within its flight distance of home (territorial stance). */
  homeInvaded: boolean;
  /** Shadow brood standing in light it avoids. */
  inAvoidedLight: boolean;
  /** An open flame burns within its `scheutFeuer` (smoke drives off the wasps). */
  nearFlame: boolean;
  /** It just finished a blow (recovering). */
  justStruck: boolean;
  /** Its idle state ran out (time for a new one). */
  idleExpired: boolean;
  /** Its current state. */
  current: AiState;
}

/** A fresh input record. */
export function createBrainInput(profile: AiProfileDef): BrainInput {
  return {
    profile,
    awake: true,
    hasTarget: false,
    seesTarget: false,
    targetTiles: Number.POSITIVE_INFINITY,
    heardNoise: false,
    lostTrail: false,
    health: 1,
    alarmed: false,
    attackReady: false,
    attackTurn: true,
    inPack: false,
    homeTiles: 0,
    homeInvaded: false,
    inAvoidedLight: false,
    nearFlame: false,
    justStruck: false,
    idleExpired: true,
    current: 'ruhen',
  };
}

/** Whether the profile's stance fights the player at all (given the situation). */
export function hostileStance(input: Pick<BrainInput, 'profile' | 'alarmed' | 'homeInvaded'>): boolean {
  switch (input.profile.haltung) {
    case 'aggressiv':
    case 'jaeger':
      return true;
    case 'revier':
      return input.homeInvaded || input.alarmed;
    case 'wehrhaft':
      return input.alarmed;
    case 'scheu':
      return false;
  }
}

/** Whether the creature is afraid of its target now. */
export function wantsToFlee(input: BrainInput): boolean {
  const p = input.profile;
  if (input.inAvoidedLight || input.nearFlame) return true;
  if (p.mut > 0 && input.health < p.mut && (input.hasTarget || input.alarmed)) return true;
  const threat = input.hasTarget && input.targetTiles <= p.fluchtDistanz;
  if (p.haltung === 'scheu') return threat || (input.alarmed && input.hasTarget);
  if (p.haltung === 'wehrhaft') return threat && !(input.alarmed && input.attackReady);
  return false;
}

/** Candidate states in the order that breaks ties (the more urgent first). */
const ORDER: readonly AiState[] = ['fliehen', 'angreifen', 'rueckzug', 'heimkehr', 'umkreisen', 'jagen', 'untersuchen', 'schlafen', 'ruhen', 'grasen', 'umherstreifen'];

/**
 * Utility of each state in the situation `input` into `out` (indexed like `ORDER`; 0 = not an option). The considerations:
 * fear and the fight are fixed scores when their conditions hold; the pull home grows with the distance beyond the leash
 * (at 1,2 × the leash it outweighs a hunt); investigating needs a fresh noise or trail; sleep needs the wrong hour; the idle
 * states share the smallest score, the one the profile's weights draw (or the current one while it lasts) gets it.
 */
export function scoreStates(input: BrainInput, idle: AiState, out: Float64Array): Float64Array {
  const p = input.profile;
  const hostile = hostileStance(input);
  const ranged = p.fernkampfAbstand !== undefined;
  out.fill(0);
  if (wantsToFlee(input)) out[0] = U.flee;
  if (hostile && input.hasTarget) {
    if (input.attackReady && input.attackTurn && input.seesTarget) out[1] = U.attack;
    if (ranged && (input.justStruck || (input.seesTarget && input.targetTiles < (p.fernkampfAbstand as number) / 2))) out[2] = U.retreat;
    // A pack member whose turn it is not circles instead of hunting (M6-18); the others hunt.
    if (input.inPack && !input.attackTurn) out[4] = U.circle;
    else out[5] = U.hunt;
  }
  if (!p.unerbittlich && input.homeTiles > p.leine) out[3] = U.homeward * (input.homeTiles / p.leine);
  if ((input.heardNoise && p.haltung !== 'scheu') || (input.lostTrail && hostile)) out[6] = U.investigate;
  if (!input.awake) out[7] = U.sleep;
  out[ORDER.indexOf(idle)] = Math.max(out[ORDER.indexOf(idle)] as number, U.idleNoise);
  return out;
}

/** Scratch scores of `decide` (one creature decides at a time). */
const SCORES = new Float64Array(ORDER.length);

/**
 * The state a creature chooses (see module comment): the best-scoring state of `scoreStates`. `rng` draws the idle state
 * when a new one is due (one draw), nothing otherwise – the choice is deterministic.
 */
export function decide(input: BrainInput, rng: Rng): AiState {
  const keep = !input.idleExpired && (input.current === 'ruhen' || input.current === 'grasen' || input.current === 'umherstreifen');
  const idle = keep ? input.current : needsIdle(input) ? idleChoice(input.profile, rng) : 'ruhen';
  scoreStates(input, idle, SCORES);
  let best = ORDER.length - 1;
  let bestScore = -1;
  for (let i = 0; i < ORDER.length; i++) {
    const v = SCORES[i] as number;
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  }
  return ORDER[best] as AiState;
}

/** Whether nothing but an idle state is on offer (then the idle draw is needed). */
function needsIdle(input: BrainInput): boolean {
  const p = input.profile;
  if (wantsToFlee(input) || !input.awake) return false;
  if (hostileStance(input) && input.hasTarget) return false;
  if (!p.unerbittlich && input.homeTiles > p.leine) return false;
  return !((input.heardNoise && p.haltung !== 'scheu') || input.lostTrail);
}

/** A weighted idle state (ruhen, grasen, umherstreifen). */
export function idleChoice(p: AiProfileDef, rng: Rng): AiState {
  const w = p.gewichte;
  const total = w.ruhen + w.grasen + w.umherstreifen;
  if (!(total > 0)) return 'ruhen';
  let r = rng.next() * total;
  if (r < w.ruhen) return 'ruhen';
  r -= w.ruhen;
  return r < w.grasen ? 'grasen' : 'umherstreifen';
}

/** The candidate states in tie-break order (`scoreStates` indexes them). */
export const BRAIN_STATES = ORDER;
