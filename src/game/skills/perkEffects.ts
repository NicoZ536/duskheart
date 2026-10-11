/**
 * Perk effects of the non-combat skills (docs/SPIEL.md §23 "Perks M7", MASTERPROMPT §23.2; ADR-0207; strand G): woodcutting,
 * mining, gathering, crafting, smithing, cooking and survival read the summed values of the chosen perks of an effect kind
 * through hooks in their systems; the fight keeps `CombatPerks` (src/game/combat/perks.ts).
 *
 * - `PerkEffects.value(art)`: the sum of the values of every chosen perk with an effect of that kind (0 when none). Each kind's
 *   perks are listed once at construction (kind → skill, level, choice, value); a read walks only them and the skill's few
 *   choices – no allocation, a handful of comparisons, cheap enough for a per-tick read.
 * - The hooks (one each, wired in `createSimulation`) and what they read (units: src/content/perks.ts):
 *   - gathering (`GatheringSystem.usePerkEffects`): `harvestPowerPerk` adds to the skill bonus of a hit (`holz_kraft`,
 *     `abbau_kraft` + `abbau_stollen` in a tunnel, `sammel_graben`); `addPerkYield` gives one more piece per dropped kind at
 *     the chance of `*_ertrag`; `perkFactor` scales the regrowth of what was harvested (`*_nachwuchs`).
 *   - crafting (`CraftingSystem.usePerkEffects`): `craftTempoPerk` adds to the skill bonus of the crafting tempo (and through
 *     it to the station batches loaded afterwards), `handwerk_qualitaet` to the quality score, and a finished piece gives its
 *     ingredients back (`*_sparen`) or one more portion (`koch_portion`).
 *   - stations (`StationSystem.usePerkEffects`): products taken out of a processing station bring extra pieces
 *     (`schmied_ausbeute`, `koch_portion`; `perkExtraPieces`).
 *   - vitals (`VitalsSystem.usePerkEffects`): the drain of satiety and thirst × `perkFactor` (`ueberleben_hunger`/`_durst`).
 *   - player (`PlayerSystem.usePerkEffects`): the stamina of swimming and the noise of sneaking × `perkFactor`.
 *   - the player's modifiers (`perkModifierSource`): insulation and cooling (`ueberleben_kaelte`/`_hitze`).
 *   - eating (`perkEatHook`): the satiety of dishes (`koch_saettigung`).
 * - Chances roll on the random stream `perks` (`PERK_RNG_STREAM`), and only when a chance is above 0: without perks every
 *   other stream and every result stays bit for bit as before.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { PerkDef, PerkEffect } from '../../content/perks';
import type { EatHook } from '../actions/hooks';
import type { RolledDrop } from '../gathering/formulas';
import type { HarvestSkill } from '../gathering/rules';
import type { Simulation } from '../sim';
import type { PlayerModifierSource } from '../survival/modifiers';
import type { SkillState } from './state';

/** Sum of the values of the chosen perks of one effect kind (0 when none) – for every non-combat skill; CombatPerks stays for the fight. */
export interface PerkEffectsApi {
  value(effect: PerkEffect): number;
}

/** No perk chosen: every value 0 (a system without the skill system, tests of single systems). */
export const NO_PERK_EFFECTS: PerkEffectsApi = { value: () => 0 };

/** Name of the random stream the chances of perks roll on (`sim.rng.stream`). */
export const PERK_RNG_STREAM = 'perks';

/** One perk's value of an effect kind and where it is chosen. */
interface PerkEntry {
  readonly skill: string;
  readonly level: number;
  readonly choice: number;
  readonly value: number;
}

/** The chosen perks of the player's skills as summed effect values (see the module comment). */
export class PerkEffects implements PerkEffectsApi {
  private readonly byEffect = new Map<string, PerkEntry[]>();

  constructor(
    private readonly skills: { skill(id: string): Readonly<SkillState> },
    perks: readonly PerkDef[] = CONTENT.collection('perks').values(),
  ) {
    for (const p of perks) {
      for (const w of p.wirkung) {
        let list = this.byEffect.get(w.art);
        if (list === undefined) {
          list = [];
          this.byEffect.set(w.art, list);
        }
        list.push({ skill: p.fertigkeit, level: p.stufe, choice: p.wahl, value: w.wert });
      }
    }
  }

  value(effect: PerkEffect): number {
    const list = this.byEffect.get(effect);
    if (list === undefined) return 0;
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as PerkEntry;
      const chosen = this.skills.skill(e.skill).perks;
      for (let j = 0; j < chosen.length; j++) {
        const c = chosen[j];
        if (c !== undefined && c.level === e.level && c.choice === e.choice) sum += e.value;
      }
    }
    return sum;
  }
}

/** `1 + value` of `effect`, never below `BALANCE.perkEffects.minFactor` (a drain, cost, noise or time never vanishes). */
export function perkFactor(perks: PerkEffectsApi, effect: PerkEffect): number {
  const f = 1 + perks.value(effect);
  return f > BALANCE.perkEffects.minFactor ? f : BALANCE.perkEffects.minFactor;
}

/** The effect kinds a harvest skill's perks act through (power, yield, regrowth); `null` where the skill has none. */
interface HarvestKinds {
  readonly power: PerkEffect | null;
  readonly yieldChance: PerkEffect | null;
  readonly regrow: PerkEffect | null;
}
const NO_HARVEST_KINDS: HarvestKinds = { power: null, yieldChance: null, regrow: null };
const HARVEST_KINDS: Readonly<Record<HarvestSkill, HarvestKinds>> = {
  holzfaellen: { power: 'holz_kraft', yieldChance: 'holz_ertrag', regrow: 'holz_nachwuchs' },
  bergbau: { power: 'abbau_kraft', yieldChance: 'abbau_ertrag', regrow: null },
  sammeln: { power: 'sammel_graben', yieldChance: 'sammel_ertrag', regrow: 'sammel_nachwuchs' },
  landwirtschaft: NO_HARVEST_KINDS,
};

/** Hit power the perks add to a harvest of `skill` [fraction, added to the skill bonus]; `tunnel` = digging into solid stone. */
export function harvestPowerPerk(perks: PerkEffectsApi, skill: HarvestSkill, tunnel: boolean): number {
  const kind = HARVEST_KINDS[skill].power;
  const base = kind === null ? 0 : perks.value(kind);
  return tunnel ? base + perks.value('abbau_stollen') : base;
}

/** Factor on the regrowth time of what a harvest of `skill` took (1 without a perk). */
export function harvestRegrowFactor(perks: PerkEffectsApi, skill: HarvestSkill): number {
  const kind = HARVEST_KINDS[skill].regrow;
  return kind === null ? 1 : perkFactor(perks, kind);
}

/** Chance each dropped kind of a finished harvest of `skill` comes with one more piece [0–1]. */
export function harvestYieldChance(perks: PerkEffectsApi, skill: HarvestSkill): number {
  const kind = HARVEST_KINDS[skill].yieldChance;
  return kind === null ? 0 : perks.value(kind);
}

/** Gives each drop of `drops` one more piece at `chance` (rolls only when `chance` > 0; replaces the changed records). */
export function addPerkYield(drops: RolledDrop[], chance: number, random: () => number): void {
  if (!(chance > 0)) return;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i] as RolledDrop;
    if (d.count > 0 && random() < chance) drops[i] = { item: d.item, count: d.count + 1 };
  }
}

/** Number of extra pieces among `count` pieces, each at `chance` (no roll when `chance` ≤ 0). */
export function perkExtraPieces(count: number, chance: number, random: () => number): number {
  if (!(chance > 0)) return 0;
  let extra = 0;
  for (let i = 0; i < count; i++) if (random() < chance) extra++;
  return extra;
}

/** The skills whose crafting tempo, ingredient saving and extra portions perks change. */
const CRAFT_TEMPO: Readonly<Record<string, PerkEffect>> = { handwerk: 'handwerk_tempo', schmieden: 'schmied_tempo', kochen: 'koch_tempo' };
const CRAFT_SAVING: Readonly<Record<string, PerkEffect>> = { handwerk: 'handwerk_sparen', schmieden: 'schmied_sparen' };
/** One more product of a piece made in the crafting queue: a dish, drink or potion (the anvil forges no second sword). */
const CRAFT_EXTRA: Readonly<Record<string, PerkEffect>> = { kochen: 'koch_portion' };
/** One more product per piece taken out of a processing station: a bar of the smelting furnace, bread, smoked fish. */
const STATION_EXTRA: Readonly<Record<string, PerkEffect>> = { schmieden: 'schmied_ausbeute', kochen: 'koch_portion' };

/** Crafting tempo the perks add for work of `skill` [fraction, added to the skill bonus]. */
export function craftTempoPerk(perks: PerkEffectsApi, skill: string): number {
  const kind = CRAFT_TEMPO[skill];
  return kind === undefined ? 0 : perks.value(kind);
}

/** Chance a finished piece of `skill` gives its ingredients back [0–1]. */
export function craftSavingChance(perks: PerkEffectsApi, skill: string): number {
  const kind = CRAFT_SAVING[skill];
  return kind === undefined ? 0 : perks.value(kind);
}

/** Chance a piece of `skill` finished in the crafting queue comes with one more product – a dish, drink or potion [0–1]. */
export function craftExtraChance(perks: PerkEffectsApi, skill: string): number {
  const kind = CRAFT_EXTRA[skill];
  return kind === undefined ? 0 : perks.value(kind);
}

/** Chance each product taken out of a processing station of `skill` brings one more – a bar, a loaf, a smoked fish [0–1]. */
export function stationExtraChance(perks: PerkEffectsApi, skill: string): number {
  const kind = STATION_EXTRA[skill];
  return kind === undefined ? 0 : perks.value(kind);
}

/** The perks' random stream of `sim`. */
export function perkRandom(sim: Simulation): () => number {
  const rng = sim.rng.stream(PERK_RNG_STREAM);
  return () => rng.next();
}

/** Insulation and cooling the perks add to the player's modifiers [°C] (registered on `PlayerInfluences`). */
export function perkModifierSource(perks: PerkEffectsApi): PlayerModifierSource {
  return (_sim, _player, out) => {
    out.insulation += perks.value('ueberleben_kaelte');
    out.cooling += perks.value('ueberleben_hitze');
  };
}

/** Satiety of dishes (items with a `mahlzeit` block) × (1 + `koch_saettigung`) – an eat hook after the meals' own. */
export function perkEatHook(perks: PerkEffectsApi): EatHook {
  return {
    nutrition: (_sim, ctx, out) => {
      if (ctx.def.mahlzeit === undefined || !(out.satiety > 0)) return;
      const more = perks.value('koch_saettigung');
      if (more > 0) out.satiety *= 1 + more;
    },
  };
}
