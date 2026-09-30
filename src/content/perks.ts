/**
 * Perks (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks → 72 Perks, alle spürbar (keine reinen +1-%-Perks)";
 * §C "Perks 72"; docs/SPIEL.md §14 "Perks (18)"; M6-34).
 *
 * A perk belongs to a skill (`fertigkeit`, src/content/skills.ts) and a perk level (`stufe`, `BALANCE.skills.perkLevels`:
 * 30, 60, 90); `wahl` is its index in the choice of two at that level (the index `skills.choosePerk` takes). Its
 * `wirkung` lists effects as data – a kind (`PERK_EFFECTS`) and a value in the unit of the kind. The combat system applies
 * the effects of the chosen perks (src/game/combat/perks.ts); each perk counts once as `perks` (§C).
 *
 * Effect kinds and their units:
 * - Melee (skill `nahkampf`): `nahkampf_schwer` heavy attack damage [+fraction], `nahkampf_ausdauer` stamina per blow
 *   [+fraction, negative = cheaper], `nahkampf_krit` crit chance [+share 0–1], `nahkampf_stagger` stagger dealt
 *   [+fraction], `nahkampf_gnadenstoss` damage against a target below `BALANCE.perks.lowHealthShare` of its health
 *   [+fraction], `nahkampf_sieg_ausdauer` / `nahkampf_sieg_leben` stamina [points] and health [HP] a melee kill gives back.
 * - Ranged (skill `fernkampf`): `fernkampf_ruhig` shots always as steady as when aiming [1 = on], `fernkampf_spannen` draw
 *   and reload time [+fraction, negative = faster], `fernkampf_vollschuss` damage of a fully drawn shot [+fraction],
 *   `fernkampf_sparen` chance a shot takes no ammunition [0–1], `fernkampf_weite` speed and reach of shots [+fraction],
 *   `wurf_schaden` damage of thrown weapons [+fraction], `wurf_weite` reach of throws [+fraction].
 * - Defence (skill `verteidigung`): `block_kraft` block power [+share points, at most `BALANCE.perks.blockPowerMax`],
 *   `block_ausdauer` stamina per absorbed point [+fraction, negative = cheaper], `parade_fenster` parry window [+s],
 *   `standfest` knockback and stagger taken [+fraction, negative = less], `vergeltung` damage of the hit on a parried
 *   foe [+fraction], `ausweich_ausdauer` stamina a roll through an attack gives back [points].
 */
import { z } from 'zod';
import { BALANCE } from './balance';
import { deepFreeze } from './freeze';
import { idSchema, localizedTextSchema } from './schema/common';

/** Effect kinds of perks (see the module comment for their units). */
export const PERK_EFFECTS = [
  'nahkampf_schwer',
  'nahkampf_ausdauer',
  'nahkampf_krit',
  'nahkampf_stagger',
  'nahkampf_gnadenstoss',
  'nahkampf_sieg_ausdauer',
  'nahkampf_sieg_leben',
  'fernkampf_ruhig',
  'fernkampf_spannen',
  'fernkampf_vollschuss',
  'fernkampf_sparen',
  'fernkampf_weite',
  'wurf_schaden',
  'wurf_weite',
  'block_kraft',
  'block_ausdauer',
  'parade_fenster',
  'standfest',
  'vergeltung',
  'ausweich_ausdauer',
] as const;
/** One effect kind. */
export type PerkEffect = (typeof PERK_EFFECTS)[number];

/** The skills whose perks M6 brings (the fight, §23.2 "Nahkampf, Fernkampf, Verteidigung"). */
export const COMBAT_PERK_SKILLS = ['nahkampf', 'fernkampf', 'verteidigung'] as const;

/** Largest |value| of an effect: fractions stay within ±1, points and HP within this. */
const EFFECT_MAX = 100;

/** Schema of one perk. */
export const perkSchema = z
  .object({
    id: idSchema,
    /** The skill the perk belongs to (src/content/skills.ts). */
    fertigkeit: idSchema,
    /** Perk level (30, 60, 90). */
    stufe: z.number().int(),
    /** Index in the choice of the level (0 or 1). */
    wahl: z.number().int().min(0),
    name: localizedTextSchema,
    /** What the perk does, with its numbers (tooltip). */
    beschreibung: localizedTextSchema,
    wirkung: z
      .array(z.object({ art: z.enum(PERK_EFFECTS), wert: z.number().min(-EFFECT_MAX).max(EFFECT_MAX) }).strict())
      .min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!BALANCE.skills.perkLevels.includes(p.stufe)) ctx.addIssue({ code: 'custom', path: ['stufe'], message: `perk level must be one of ${BALANCE.skills.perkLevels.join(', ')}` });
    if (p.wahl >= BALANCE.skills.perkChoices) ctx.addIssue({ code: 'custom', path: ['wahl'], message: `a choice offers ${BALANCE.skills.perkChoices} perks` });
    const arten = p.wirkung.map((w) => w.art);
    if (new Set(arten).size !== arten.length) ctx.addIssue({ code: 'custom', path: ['wirkung'], message: 'each effect kind once' });
    if (p.wirkung.some((w) => w.wert === 0)) ctx.addIssue({ code: 'custom', path: ['wirkung'], message: 'an effect of 0 does nothing (§23.2 "alle spürbar")' });
  });

/** One perk (validated). */
export type PerkDef = z.output<typeof perkSchema>;
/** Perk data as written below. */
export type PerkInput = z.input<typeof perkSchema>;

/** Error in the perk content. */
export class PerkContentError extends Error {
  override readonly name = 'PerkContentError';
}

/** Validates the perks (schema, unique ids, exactly one perk per skill, level and choice) and freezes them. */
export function definePerks(records: readonly PerkInput[]): readonly PerkDef[] {
  const ids = new Set<string>();
  const slots = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = perkSchema.safeParse(raw);
    if (!r.success) throw new PerkContentError(`Perk [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);
    if (ids.has(r.data.id)) throw new PerkContentError(`duplicate perk "${r.data.id}"`);
    ids.add(r.data.id);
    const slot = `${r.data.fertigkeit}:${r.data.stufe}:${r.data.wahl}`;
    if (slots.has(slot)) throw new PerkContentError(`two perks for ${slot}`);
    slots.add(slot);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/** The 18 combat perks: six each for melee, ranged and defence, two per perk level (docs/SPIEL.md §14). */
export const PERKS = definePerks([
  // ---- Nahkampf ----
  {
    id: 'wuchtschlag',
    fertigkeit: 'nahkampf',
    stufe: 30,
    wahl: 0,
    name: { de: 'Wuchtschlag', en: 'Crushing Blow' },
    beschreibung: { de: 'Schwere Nahkampfangriffe richten 30 % mehr Schaden an.', en: 'Heavy melee attacks deal 30 % more damage.' },
    // A heavy blow deals 1,8× a light one (BALANCE.combat.attack.heavy); +30 % makes it worth a third more of the wait.
    wirkung: [{ art: 'nahkampf_schwer', wert: 0.3 }],
  },
  {
    id: 'langer_atem',
    fertigkeit: 'nahkampf',
    stufe: 30,
    wahl: 1,
    name: { de: 'Langer Atem', en: 'Second Wind' },
    beschreibung: { de: 'Nahkampfschläge kosten 30 % weniger Ausdauer.', en: 'Melee blows cost 30 % less stamina.' },
    // 12 sword blows from full stamina become 17: a whole extra combo and a half.
    wirkung: [{ art: 'nahkampf_ausdauer', wert: -0.3 }],
  },
  {
    id: 'schwachstelle',
    fertigkeit: 'nahkampf',
    stufe: 60,
    wahl: 0,
    name: { de: 'Schwachstelle', en: 'Weak Spot' },
    beschreibung: { de: '+10 % Chance auf kritische Nahkampftreffer.', en: '+10 % chance of critical melee hits.' },
    // The base 5 % (§19.3) triples to 15 %: one blow in seven lands ×1,75.
    wirkung: [{ art: 'nahkampf_krit', wert: 0.1 }],
  },
  {
    id: 'taumelhieb',
    fertigkeit: 'nahkampf',
    stufe: 60,
    wahl: 1,
    name: { de: 'Taumelhieb', en: 'Staggering Strikes' },
    beschreibung: { de: 'Deine Nahkampftreffer lassen Gegner 60 % länger taumeln.', en: 'Your melee hits stagger foes 60 % longer.' },
    wirkung: [{ art: 'nahkampf_stagger', wert: 0.6 }],
  },
  {
    id: 'gnadenstoss',
    fertigkeit: 'nahkampf',
    stufe: 90,
    wahl: 0,
    name: { de: 'Gnadenstoß', en: 'Coup de Grâce' },
    beschreibung: { de: 'Nahkampftreffer gegen Gegner unter 30 % Leben richten 50 % mehr Schaden an.', en: 'Melee hits against foes below 30 % health deal 50 % more damage.' },
    wirkung: [{ art: 'nahkampf_gnadenstoss', wert: 0.5 }],
  },
  {
    id: 'blutrausch',
    fertigkeit: 'nahkampf',
    stufe: 90,
    wahl: 1,
    name: { de: 'Blutrausch', en: 'Bloodlust' },
    beschreibung: { de: 'Wer im Nahkampf fällt, gibt dir 20 Ausdauer und 5 Leben zurück.', en: 'Every foe felled in melee gives you back 20 stamina and 5 health.' },
    wirkung: [
      { art: 'nahkampf_sieg_ausdauer', wert: 20 },
      { art: 'nahkampf_sieg_leben', wert: 5 },
    ],
  },
  // ---- Fernkampf ----
  {
    id: 'ruhige_hand',
    fertigkeit: 'fernkampf',
    stufe: 30,
    wahl: 0,
    name: { de: 'Ruhige Hand', en: 'Steady Hand' },
    beschreibung: { de: 'Deine Schüsse und Würfe streuen immer so wenig wie beim Zielen.', en: 'Your shots and throws always spread as little as when aiming.' },
    wirkung: [{ art: 'fernkampf_ruhig', wert: 1 }],
  },
  {
    id: 'schnellspanner',
    fertigkeit: 'fernkampf',
    stufe: 30,
    wahl: 1,
    name: { de: 'Schnellspanner', en: 'Quick Draw' },
    beschreibung: { de: 'Bogen, Schleuder und Würfe spannen, die Armbrust lädt 30 % schneller.', en: 'Bows, slings and throws draw, the crossbow reloads 30 % faster.' },
    // A bow at full tension after 0,56 s instead of 0,8 s; the crossbow reloads in 1,05 s.
    wirkung: [{ art: 'fernkampf_spannen', wert: -0.3 }],
  },
  {
    id: 'kraftschuss',
    fertigkeit: 'fernkampf',
    stufe: 60,
    wahl: 0,
    name: { de: 'Kraftschuss', en: 'Power Shot' },
    beschreibung: { de: 'Voll gespannte Schüsse richten 30 % mehr Schaden an.', en: 'Fully drawn shots deal 30 % more damage.' },
    wirkung: [{ art: 'fernkampf_vollschuss', wert: 0.3 }],
  },
  {
    id: 'sparsamer_schuetze',
    fertigkeit: 'fernkampf',
    stufe: 60,
    wahl: 1,
    name: { de: 'Sparsamer Schütze', en: 'Thrifty Archer' },
    beschreibung: { de: 'Jeder Schuss verbraucht mit 30 % Chance keine Munition.', en: 'Every shot has a 30 % chance to use no ammunition.' },
    wirkung: [{ art: 'fernkampf_sparen', wert: 0.3 }],
  },
  {
    id: 'weitschuss',
    fertigkeit: 'fernkampf',
    stufe: 90,
    wahl: 0,
    name: { de: 'Weitschuss', en: 'Long Shot' },
    beschreibung: { de: 'Deine Schüsse fliegen 30 % schneller und weiter.', en: 'Your shots fly 30 % faster and farther.' },
    wirkung: [{ art: 'fernkampf_weite', wert: 0.3 }],
  },
  {
    id: 'wurfkunst',
    fertigkeit: 'fernkampf',
    stufe: 90,
    wahl: 1,
    name: { de: 'Wurfkunst', en: 'Throwing Mastery' },
    beschreibung: { de: 'Wurfwaffen richten 40 % mehr Schaden an und fliegen 50 % weiter.', en: 'Thrown weapons deal 40 % more damage and fly 50 % farther.' },
    wirkung: [
      { art: 'wurf_schaden', wert: 0.4 },
      { art: 'wurf_weite', wert: 0.5 },
    ],
  },
  // ---- Verteidigung ----
  {
    id: 'schildwall',
    fertigkeit: 'verteidigung',
    stufe: 30,
    wahl: 0,
    name: { de: 'Schildwall', en: 'Shield Wall' },
    beschreibung: { de: 'Deine Blocks fangen 15 Prozentpunkte mehr Schaden ab (höchstens 95 %).', en: 'Your blocks absorb 15 percentage points more damage (at most 95 %).' },
    // The wooden shield's 40 % become 55 %, the bronze shield's 60 % become 75 %.
    wirkung: [{ art: 'block_kraft', wert: 0.15 }],
  },
  {
    id: 'zaeher_arm',
    fertigkeit: 'verteidigung',
    stufe: 30,
    wahl: 1,
    name: { de: 'Zäher Arm', en: 'Iron Arm' },
    beschreibung: { de: 'Blocken kostet 35 % weniger Ausdauer.', en: 'Blocking costs 35 % less stamina.' },
    wirkung: [{ art: 'block_ausdauer', wert: -0.35 }],
  },
  {
    id: 'paradekunst',
    fertigkeit: 'verteidigung',
    stufe: 60,
    wahl: 0,
    name: { de: 'Paradekunst', en: 'Parry Master' },
    beschreibung: { de: 'Das Paradefenster wächst von 0,15 auf 0,25 Sekunden.', en: 'The parry window grows from 0.15 to 0.25 seconds.' },
    wirkung: [{ art: 'parade_fenster', wert: 0.1 }],
  },
  {
    id: 'standfest',
    fertigkeit: 'verteidigung',
    stufe: 60,
    wahl: 1,
    name: { de: 'Standfest', en: 'Steadfast' },
    beschreibung: { de: 'Treffer werfen dich nur halb so weit zurück und lassen dich halb so lang taumeln.', en: 'Hits throw you back only half as far and stagger you half as long.' },
    wirkung: [{ art: 'standfest', wert: -0.5 }],
  },
  {
    id: 'vergeltung',
    fertigkeit: 'verteidigung',
    stufe: 90,
    wahl: 0,
    name: { de: 'Vergeltung', en: 'Retribution' },
    beschreibung: { de: 'Der Treffer auf einen parierten Gegner richtet 50 % mehr Schaden an.', en: 'The hit on a parried foe deals 50 % more damage.' },
    wirkung: [{ art: 'vergeltung', wert: 0.5 }],
  },
  {
    id: 'ausweichkuenstler',
    fertigkeit: 'verteidigung',
    stufe: 90,
    wahl: 1,
    name: { de: 'Ausweichkünstler', en: 'Evasion Artist' },
    beschreibung: { de: 'Rollst du durch einen Angriff, bekommst du 15 Ausdauer zurück.', en: 'Rolling through an attack gives you back 15 stamina.' },
    wirkung: [{ art: 'ausweich_ausdauer', wert: 15 }],
  },
]);
