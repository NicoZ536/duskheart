/**
 * Conditions of the player (MASTERPROMPT §11.3, M3-19; docs/SPIEL.md §6 "Zustände (M3-19)"): schema and
 * the 31 conditions as content data. The condition system (src/game/conditions) applies them.
 *
 * Every condition has (§11.3 "Jeder Zustand: Icon, Dauer, Stapelregel, Tooltip, sichtbare Wirkung"):
 * - **Icon** by convention: sprite `zustand_<id>` (16×16, assets-src/sprites/zustaende); `art` is the
 *   frame of that icon – `gut` (circle, boon), `schlecht` (square, drawback), `kritisch` (diamond, costs
 *   health) – so the HUD and the icon agree on the meaning.
 * - **Duration** (`dauer`):
 *   - `zeit` – runs for `sekunden` simulated seconds (the same time base as §11.1, 60 ticks per second);
 *   - `heilung` – lasts until something cures it (a splint for a broken bone);
 *   - `wert` – held while a survival value is in a stage (`quelle` + `stufe`): the stages of hunger,
 *     thirst, exhaustion, wetness, core temperature and breath come from the vitals system
 *     (src/game/survival), whose formulas already apply their effects – such conditions carry no
 *     `wirkung` of their own; `naehrzustand` (well fed) is judged by the condition system, which applies
 *     its effect.
 * - **Stack rule** (`stapel`): `erneuern` restarts the duration, `verlaengern` adds the duration up to
 *   `maxSekunden`, `stapeln` adds a stack up to `max` (damage per second counts per stack) and restarts
 *   the duration, `einmalig` ignores a new application while the condition lasts.
 * - **Tooltip**: `name` and `beschreibung` (LocalizedText, DE/EN); the HUD adds the remaining time.
 * - **Visible effect** (`sichtbar`): a hook id the presentation maps to an effect on the player sprite or
 *   the screen (M3-20: shivering, limping, flames, drops, blinking …); `sound` plays when it begins.
 * - **Effect** (`wirkung`, see `conditionEffectSchema` for the units): factors on speed, maxima and
 *   regeneration, damage and drain per second, fear per second, periodic pulses (vomiting), and the special
 *   rules `endetBeiNaesse` (burning goes out in water) and `heiltInRuhe` (fever heals faster at rest).
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema } from './schema/common';
import { sfxIdSchema } from './schema/item';

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

/** Kind of a condition = frame of its icon (assets-src/sprites/zustaende/_zustand.ts). */
export const CONDITION_KINDS = ['gut', 'schlecht', 'kritisch'] as const;
/** One condition kind. */
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Stack rules (see module comment). */
export const CONDITION_STACK_RULES = ['erneuern', 'verlaengern', 'stapeln', 'einmalig'] as const;
/** One stack rule. */
export type ConditionStackRule = (typeof CONDITION_STACK_RULES)[number];

/**
 * Survival values a `wert` condition follows, with the stages they can be in: the stage ids of the
 * vitals system (src/game/survival/formulas.ts, src/content/balance/survival.ts, `atem` = drowning) and
 * `naehrzustand` (well fed, judged by the condition system with `BALANCE.conditions.wellFed`).
 */
export const CONDITION_VALUE_STAGES = {
  saettigung: ['hungrig', 'verhungernd'],
  durst: ['durstig', 'verdurstend'],
  erschoepfung: ['muede', 'erschoepft'],
  naesse: ['durchnaesst'],
  temperatur: ['erfrierend', 'unterkuehlt', 'frierend', 'erhitzt', 'ueberhitzt', 'hitzschlag'],
  atem: ['ertrinkend'],
  naehrzustand: ['wohlgenaehrt'],
} as const;
/** One survival value a condition can follow. */
export type ConditionValue = keyof typeof CONDITION_VALUE_STAGES;
/** Values whose stage effects the vitals system applies (conditions following them carry no `wirkung`). */
export const VITALS_CONDITION_VALUES = ['saettigung', 'durst', 'erschoepfung', 'naesse', 'temperatur', 'atem'] as const satisfies readonly ConditionValue[];

/**
 * Visible effect hooks (M3-20 maps them to sprite and screen effects): `zittern` shivering, `frostrand`
 * frost at the screen edge, `schweiss` sweat drops, `flimmern` heat shimmer, `hinken` limp, `flammen`
 * flames on the body, `tropfen` dripping water, `blutstropfen` blood drops, `giftschimmer` green tint,
 * `uebelkeit` wobble and green face, `fieberglanz` feverish sheen, `lidschlag` slow blinking of the
 * screen, `zeitlupe` sluggish frames, `sterne` circling stars, `blendung` white-out, `schwanken` swaying,
 * `blaesse` pale palette, `magenknurren` hand on the belly, `keuchen` panting, `atemblasen` air bubbles,
 * `wohlig` warm glow, `frische` light step, `waermeglanz` warm rim light, `lichtaura` bright halo,
 * `morgenglanz` dawn tint, `nachtsicht` night vision tint.
 */
export const CONDITION_VISUALS = [
  'zittern',
  'frostrand',
  'schweiss',
  'flimmern',
  'hinken',
  'flammen',
  'tropfen',
  'blutstropfen',
  'giftschimmer',
  'uebelkeit',
  'fieberglanz',
  'lidschlag',
  'zeitlupe',
  'sterne',
  'blendung',
  'schwanken',
  'blaesse',
  'magenknurren',
  'keuchen',
  'atemblasen',
  'wohlig',
  'frische',
  'waermeglanz',
  'lichtaura',
  'morgenglanz',
  'nachtsicht',
] as const;
/** One visible effect hook. */
export type ConditionVisual = (typeof CONDITION_VISUALS)[number];

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------

/** Longest duration of a timed condition [s] (one game day at the longest day length, §10). */
const MAX_CONDITION_SECONDS = 2880;
/** Most stacks a condition can have. */
const MAX_STACKS = 10;
/** Largest factor a condition applies (speed, maxima, regeneration, sight). */
const MAX_FACTOR = 3;
/** Largest |change per second| of a survival meter, fear or health [points/s]. */
const MAX_RATE = 10;
/** Largest change of a pulse [points]. */
const MAX_PULSE = 100;

const factor = z.number().min(0).max(MAX_FACTOR);
const rate = z.number().min(-MAX_RATE).max(MAX_RATE);
const seconds = z.number().positive().max(MAX_CONDITION_SECONDS);

/**
 * Effects of a condition while it lasts. Units: `schadenProSekunde` [HP/s, per stack] ·
 * `saettigungProSekunde`, `durstProSekunde` [points of 100 per s, negative drains] · `furchtProSekunde`
 * [fear points per s, negative calms] · factors [×]: `tempo` movement speed, `aktionstempo` gathering,
 * crafting and attacks, `praezision` aim and crits, `maxLeben`, `maxAusdauer`, `lebensRegeneration`,
 * `ausdauerRegeneration`, `erfahrung` skill XP, `sicht` sight in the dark · `isolation`, `kuehlung`
 * [points of §11.2 added to clothing] · `schadensresistenz` [fraction of incoming damage] · `schub`
 * a pulse every `alleSekunden` changing satiety and thirst [points] (vomiting) · `endetBeiNaesse` ends in
 * deep water or when soaked · `heiltInRuhe` the duration runs this many times faster while resting or asleep.
 */
export const conditionEffectSchema = z
  .object({
    schadenProSekunde: z.number().positive().max(MAX_RATE).optional(),
    saettigungProSekunde: rate.optional(),
    durstProSekunde: rate.optional(),
    furchtProSekunde: rate.optional(),
    tempo: factor.optional(),
    aktionstempo: factor.optional(),
    praezision: factor.optional(),
    maxLeben: factor.optional(),
    maxAusdauer: factor.optional(),
    lebensRegeneration: factor.optional(),
    ausdauerRegeneration: factor.optional(),
    erfahrung: factor.optional(),
    sicht: factor.optional(),
    isolation: z.number().min(-MAX_RATE * MAX_RATE).max(MAX_RATE * MAX_RATE).optional(),
    kuehlung: z.number().min(-MAX_RATE * MAX_RATE).max(MAX_RATE * MAX_RATE).optional(),
    schadensresistenz: z.number().min(0).max(1).optional(),
    schub: z
      .object({ alleSekunden: seconds, saettigung: z.number().min(-MAX_PULSE).max(MAX_PULSE), durst: z.number().min(-MAX_PULSE).max(MAX_PULSE) })
      .strict()
      .optional(),
    endetBeiNaesse: z.literal(true).optional(),
    heiltInRuhe: z.number().gt(1).max(MAX_FACTOR * MAX_FACTOR).optional(),
  })
  .strict();
/** Effects of one condition. */
export type ConditionEffect = z.output<typeof conditionEffectSchema>;

const valueNames = Object.keys(CONDITION_VALUE_STAGES) as ConditionValue[];

/** Duration of a condition (see module comment). */
export const conditionDurationSchema = z.discriminatedUnion('art', [
  z.object({ art: z.literal('zeit'), sekunden: seconds }).strict(),
  z.object({ art: z.literal('heilung') }).strict(),
  z.object({ art: z.literal('wert'), quelle: z.enum(valueNames as [ConditionValue, ...ConditionValue[]]), stufe: idSchema }).strict(),
]);
/** Duration of one condition. */
export type ConditionDuration = z.output<typeof conditionDurationSchema>;

/** Stack rule of a condition. */
export const conditionStackSchema = z.discriminatedUnion('regel', [
  z.object({ regel: z.literal('erneuern') }).strict(),
  z.object({ regel: z.literal('verlaengern'), maxSekunden: seconds }).strict(),
  z.object({ regel: z.literal('stapeln'), max: z.number().int().min(2).max(MAX_STACKS) }).strict(),
  z.object({ regel: z.literal('einmalig') }).strict(),
]);
/** Stack rule of one condition. */
export type ConditionStack = z.output<typeof conditionStackSchema>;

/** Schema of one condition. */
export const conditionSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** Tooltip: what it does and how to end it. */
    beschreibung: localizedTextSchema,
    art: z.enum(CONDITION_KINDS),
    dauer: conditionDurationSchema,
    stapel: conditionStackSchema,
    wirkung: conditionEffectSchema,
    sichtbar: z.enum(CONDITION_VISUALS),
    /** Sound when the condition begins (`sfx_<bereich>_<name>`). */
    sound: sfxIdSchema,
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const d = c.dauer;
    if (d.art === 'wert') {
      const stages: readonly string[] = CONDITION_VALUE_STAGES[d.quelle];
      if (!stages.includes(d.stufe)) issue('dauer', `value ${d.quelle} has the stages ${stages.join(', ')}, not ${d.stufe}`);
      if (d.stufe !== c.id) issue('dauer', 'a value condition carries the id of its stage');
      if ((VITALS_CONDITION_VALUES as readonly string[]).includes(d.quelle) && Object.keys(c.wirkung).length > 0) {
        issue('wirkung', `the vitals system applies the effects of ${d.quelle} stages; the condition must not apply them twice`);
      }
      if (c.stapel.regel !== 'einmalig') issue('stapel', 'a value condition cannot be applied again (einmalig)');
    } else if (Object.keys(c.wirkung).length === 0) issue('wirkung', 'a condition that is applied needs an effect');
    if (c.stapel.regel === 'verlaengern' && d.art === 'zeit' && c.stapel.maxSekunden < d.sekunden) issue('stapel', 'maxSekunden must be at least the duration');
    if ((c.stapel.regel === 'verlaengern' || c.stapel.regel === 'stapeln') && d.art !== 'zeit') issue('stapel', `${c.stapel.regel} needs a timed duration`);
    if (c.stapel.regel === 'stapeln' && c.wirkung.schadenProSekunde === undefined) issue('stapel', 'only damage adds up per stack');
  });

/** One condition (validated). */
export type ConditionDef = z.output<typeof conditionSchema>;
/** Condition data as written below. */
export type ConditionInput = z.input<typeof conditionSchema>;

/** Sprite id of a condition's icon (docs/SPIEL.md §5 `zustand_<zustandId>`). */
export function conditionIconId(id: string): string {
  return `zustand_${id}`;
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

/** A condition that follows the stage `stufe` of a survival value (its id is the stage id). */
function valueCondition(quelle: ConditionValue, stufe: string, art: ConditionKind, sichtbar: ConditionVisual, sound: string, name: ConditionInput['name'], beschreibung: ConditionInput['beschreibung']): ConditionInput {
  return { id: stufe, name, beschreibung, art, dauer: { art: 'wert', quelle, stufe }, stapel: { regel: 'einmalig' }, wirkung: {}, sichtbar, sound };
}

/** The conditions of §11.3 in the order of docs/SPIEL.md §6 (HUD order: the list order). */
export const CONDITIONS: readonly ConditionInput[] = [
  {
    id: 'blutung',
    name: { de: 'Blutung', en: 'Bleeding' },
    beschreibung: {
      de: 'Eine offene Wunde kostet 0,5 Leben pro Sekunde und Wunde, bis sie nach 30 Sekunden versiegt. Bis zu drei Wunden bluten zugleich. Ein Verband stillt die Blutung sofort.',
      en: 'An open wound costs 0.5 health per second and wound until it dries up after 30 seconds. Up to three wounds bleed at once. A bandage stops the bleeding at once.',
    },
    art: 'kritisch',
    dauer: { art: 'zeit', sekunden: 30 },
    stapel: { regel: 'stapeln', max: 3 },
    wirkung: { schadenProSekunde: 0.5 },
    sichtbar: 'blutstropfen',
    sound: 'sfx_zustand_blutung',
  },
  {
    id: 'vergiftung',
    name: { de: 'Vergiftung', en: 'Poisoned' },
    beschreibung: {
      de: 'Gift im Blut kostet 1 Leben pro Sekunde und verhindert jede Heilung. Neues Gift verlängert die Wirkung auf höchstens eine Minute. Ein Gegengift hilft.',
      en: 'Poison in the blood costs 1 health per second and prevents all healing. More poison extends it to at most one minute. An antidote helps.',
    },
    art: 'kritisch',
    dauer: { art: 'zeit', sekunden: 20 },
    stapel: { regel: 'verlaengern', maxSekunden: 60 },
    wirkung: { schadenProSekunde: 1, lebensRegeneration: 0 },
    sichtbar: 'giftschimmer',
    sound: 'sfx_zustand_vergiftung',
  },
  {
    id: 'lebensmittelvergiftung',
    name: { de: 'Lebensmittelvergiftung', en: 'Food Poisoning' },
    beschreibung: {
      de: 'Übelkeit von fauliger oder roher Nahrung: Alle 20 Sekunden musst du dich übergeben und verlierst Sättigung und Durst, die Ausdauer erholt sich langsamer. Klingt nach anderthalb Minuten ab.',
      en: 'Nausea from rotten or raw food: every 20 seconds you throw up and lose satiety and thirst, and stamina recovers more slowly. Wears off after a minute and a half.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 90 },
    stapel: { regel: 'erneuern' },
    wirkung: { schub: { alleSekunden: 20, saettigung: -10, durst: -8 }, ausdauerRegeneration: 0.8 },
    sichtbar: 'uebelkeit',
    sound: 'sfx_zustand_uebelkeit',
  },
  {
    id: 'fieber',
    name: { de: 'Fieber', en: 'Fever' },
    beschreibung: {
      de: 'Aus ungefiltertem Wasser oder von Mückenstichen: weniger Ausdauer, langsamere Erholung und mehr Durst. Heilt nach zehn Minuten, in Ruhe oder im Schlaf dreimal so schnell; Fiebertee hilft.',
      en: 'From unfiltered water or mosquito bites: less stamina, slower recovery and more thirst. Heals after ten minutes, three times as fast at rest or asleep; fever tea helps.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 600 },
    stapel: { regel: 'erneuern' },
    wirkung: { maxAusdauer: 0.8, ausdauerRegeneration: 0.75, durstProSekunde: -0.03, heiltInRuhe: 3 },
    sichtbar: 'fieberglanz',
    sound: 'sfx_zustand_fieber',
  },
  {
    id: 'brennen',
    name: { de: 'Brennen', en: 'Burning' },
    beschreibung: {
      de: 'Du stehst in Flammen: 3 Leben pro Sekunde für sechs Sekunden. Wasser löscht sofort – spring hinein oder lass dich durchnässen.',
      en: 'You are on fire: 3 health per second for six seconds. Water puts it out at once – jump in or get soaked.',
    },
    art: 'kritisch',
    dauer: { art: 'zeit', sekunden: 6 },
    stapel: { regel: 'erneuern' },
    wirkung: { schadenProSekunde: 3, endetBeiNaesse: true },
    sichtbar: 'flammen',
    sound: 'sfx_zustand_brennen',
  },
  valueCondition(
    'naesse',
    'durchnaesst',
    'schlecht',
    'tropfen',
    'sfx_wasser_tropfen',
    { de: 'Durchnässt', en: 'Soaked' },
    {
      de: 'Nasse Kleidung verliert bis zu 70 % ihrer Isolation – dir wird schneller kalt. Trocknet am Feuer, unter einem Dach und langsam auch draußen.',
      en: 'Wet clothes lose up to 70% of their insulation – you get cold faster. Dries at a fire, under a roof and slowly outdoors.',
    },
  ),
  valueCondition(
    'temperatur',
    'frierend',
    'schlecht',
    'zittern',
    'sfx_spieler_zittern',
    { de: 'Frierend', en: 'Freezing' },
    {
      de: 'Deine Kerntemperatur liegt unter 36 °C: 10 % weniger Präzision und Arbeitstempo. Wärme dich am Feuer oder zieh dich wärmer an.',
      en: 'Your core temperature is below 36 °C: 10% less precision and work speed. Warm up at a fire or dress warmer.',
    },
  ),
  valueCondition(
    'temperatur',
    'unterkuehlt',
    'schlecht',
    'frostrand',
    'sfx_spieler_zittern',
    { de: 'Unterkühlt', en: 'Hypothermic' },
    {
      de: 'Unter 35 °C: 30 % weniger maximale Ausdauer und 0,5 Leben pro Sekunde. Such sofort Wärme.',
      en: 'Below 35 °C: 30% less maximum stamina and 0.5 health per second. Find warmth at once.',
    },
  ),
  valueCondition(
    'temperatur',
    'erfrierend',
    'kritisch',
    'frostrand',
    'sfx_spieler_zittern',
    { de: 'Erfrierend', en: 'Freezing to Death' },
    {
      de: 'Unter 33 °C erfrierst du: 2 Leben pro Sekunde. Nur ein Feuer oder ein warmer Raum rettet dich jetzt.',
      en: 'Below 33 °C you are freezing to death: 2 health per second. Only a fire or a warm room can save you now.',
    },
  ),
  valueCondition(
    'temperatur',
    'erhitzt',
    'schlecht',
    'schweiss',
    'sfx_spieler_keuchen',
    { de: 'Erhitzt', en: 'Overheating' },
    {
      de: 'Über 38 °C: Du wirst anderthalbmal so schnell durstig. Such Schatten oder leichtere Kleidung.',
      en: 'Above 38 °C: you get thirsty one and a half times as fast. Find shade or lighter clothes.',
    },
  ),
  valueCondition(
    'temperatur',
    'ueberhitzt',
    'schlecht',
    'schweiss',
    'sfx_spieler_keuchen',
    { de: 'Überhitzt', en: 'Overheated' },
    {
      de: 'Über 39 °C: Die Ausdauer erholt sich nur halb so schnell, und du verlierst 0,5 Leben pro Sekunde.',
      en: 'Above 39 °C: stamina recovers at half speed, and you lose 0.5 health per second.',
    },
  ),
  valueCondition(
    'temperatur',
    'hitzschlag',
    'kritisch',
    'flimmern',
    'sfx_spieler_keuchen',
    { de: 'Hitzschlag', en: 'Heatstroke' },
    {
      de: 'Über 40,5 °C: 2 Leben pro Sekunde, die Luft flimmert. Kühl dich sofort ab – Wasser, Schatten, Kühltrank.',
      en: 'Above 40.5 °C: 2 health per second, the air shimmers. Cool down at once – water, shade, cooling potion.',
    },
  ),
  valueCondition(
    'erschoepfung',
    'muede',
    'schlecht',
    'lidschlag',
    'sfx_spieler_gaehnen',
    { de: 'Müde', en: 'Tired' },
    {
      de: 'Erschöpfung über 70: Die Ausdauer erholt sich 15 % langsamer, die Lider werden schwer. Zeit zu schlafen.',
      en: 'Exhaustion above 70: stamina recovers 15% slower, your eyelids grow heavy. Time to sleep.',
    },
  ),
  valueCondition(
    'erschoepfung',
    'erschoepft',
    'schlecht',
    'lidschlag',
    'sfx_spieler_gaehnen',
    { de: 'Erschöpft', en: 'Exhausted' },
    {
      de: 'Erschöpfung über 90: Alle Arbeiten und Angriffe gehen 25 % langsamer. Schlaf, bevor du umfällst.',
      en: 'Exhaustion above 90: all work and attacks are 25% slower. Sleep before you collapse.',
    },
  ),
  {
    id: 'verlangsamt',
    name: { de: 'Verlangsamt', en: 'Slowed' },
    beschreibung: {
      de: 'Frost oder zähe Masse bremst dich: 30 % langsamer und 15 % langsameres Arbeiten für fünf Sekunden.',
      en: 'Frost or clinging muck holds you back: 30% slower movement and 15% slower work for five seconds.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 5 },
    stapel: { regel: 'erneuern' },
    wirkung: { tempo: 0.7, aktionstempo: 0.85 },
    sichtbar: 'zeitlupe',
    sound: 'sfx_zustand_verlangsamt',
  },
  {
    id: 'betaeubt',
    name: { de: 'Betäubt', en: 'Stunned' },
    beschreibung: {
      de: 'Ein harter Schlag: anderthalb Sekunden lang kannst du dich weder bewegen noch handeln. Solange du betäubt bist, betäubt dich nichts erneut.',
      en: 'A heavy blow: for a second and a half you can neither move nor act. While stunned, nothing can stun you again.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 1.5 },
    stapel: { regel: 'einmalig' },
    wirkung: { tempo: 0, aktionstempo: 0 },
    sichtbar: 'sterne',
    sound: 'sfx_zustand_betaeubt',
  },
  {
    id: 'geblendet',
    name: { de: 'Geblendet', en: 'Blinded' },
    beschreibung: {
      de: 'Grelles Licht brennt in den Augen: Du siehst im Dunkeln kaum etwas und triffst schlechter, vier Sekunden lang.',
      en: 'Glaring light burns in your eyes: you barely see in the dark and aim worse, for four seconds.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 4 },
    stapel: { regel: 'erneuern' },
    wirkung: { sicht: 0.3, praezision: 0.5 },
    sichtbar: 'blendung',
    sound: 'sfx_zustand_geblendet',
  },
  {
    id: 'knochenbruch',
    name: { de: 'Knochenbruch', en: 'Broken Bone' },
    beschreibung: {
      de: 'Ein Sturz aus großer Höhe hat einen Knochen gebrochen: 40 % langsamer, bis eine Schiene ihn richtet.',
      en: 'A fall from a great height broke a bone: 40% slower until a splint sets it.',
    },
    art: 'schlecht',
    dauer: { art: 'heilung' },
    stapel: { regel: 'einmalig' },
    wirkung: { tempo: 0.6 },
    sichtbar: 'hinken',
    sound: 'sfx_spieler_knochenbruch',
  },
  {
    id: 'wohlgenaehrt',
    name: { de: 'Wohlgenährt', en: 'Well Fed' },
    beschreibung: {
      de: 'Satt und getränkt (Sättigung und Durst ab 80): Leben regeneriert anderthalbmal so schnell, die Ausdauer 10 % schneller.',
      en: 'Fed and watered (satiety and thirst from 80): health regenerates one and a half times as fast, stamina 10% faster.',
    },
    art: 'gut',
    dauer: { art: 'wert', quelle: 'naehrzustand', stufe: 'wohlgenaehrt' },
    stapel: { regel: 'einmalig' },
    wirkung: { lebensRegeneration: 1.5, ausdauerRegeneration: 1.1 },
    sichtbar: 'wohlig',
    sound: 'sfx_zustand_wohlig',
  },
  {
    id: 'ausgeruht',
    name: { de: 'Ausgeruht', en: 'Rested' },
    beschreibung: {
      de: 'Nach einer Nacht im Bett: 10 % mehr maximale Ausdauer, 25 % schnellere Ausdauererholung und 5 % mehr Erfahrung. Hält 8 Minuten und eine Minute mehr je Behaglichkeitspunkt.',
      en: 'After a night in a bed: 10% more maximum stamina, 25% faster stamina recovery and 5% more experience. Lasts 8 minutes plus one minute per comfort point.',
    },
    art: 'gut',
    dauer: { art: 'zeit', sekunden: 480 },
    stapel: { regel: 'erneuern' },
    wirkung: { maxAusdauer: 1.1, ausdauerRegeneration: 1.25, erfahrung: 1.05 },
    sichtbar: 'frische',
    sound: 'sfx_zustand_ausgeruht',
  },
  {
    id: 'behaglich',
    name: { de: 'Behaglich', en: 'Cosy' },
    beschreibung: {
      de: 'Ein warmer, gemütlicher Raum: Leben regeneriert 25 % schneller, die Ausdauer 10 % schneller. Hält an, solange du drinnen bleibst.',
      en: 'A warm, cosy room: health regenerates 25% faster, stamina 10% faster. Lasts while you stay inside.',
    },
    art: 'gut',
    dauer: { art: 'zeit', sekunden: 5 },
    stapel: { regel: 'erneuern' },
    wirkung: { lebensRegeneration: 1.25, ausdauerRegeneration: 1.1 },
    sichtbar: 'waermeglanz',
    sound: 'sfx_zustand_behaglich',
  },
  {
    id: 'erleuchtet',
    name: { de: 'Erleuchtet', en: 'Enlightened' },
    beschreibung: {
      de: 'Im Schein eines Leuchtfeuers oder einer Lichtwacht: Leben regeneriert anderthalbmal so schnell, und die Furcht weicht um 1 pro Sekunde.',
      en: 'In the glow of a beacon or a lightwatch: health regenerates one and a half times as fast, and fear fades by 1 per second.',
    },
    art: 'gut',
    dauer: { art: 'zeit', sekunden: 5 },
    stapel: { regel: 'erneuern' },
    wirkung: { lebensRegeneration: 1.5, furchtProSekunde: -1 },
    sichtbar: 'lichtaura',
    sound: 'sfx_zustand_erleuchtet',
  },
  {
    id: 'morgenrot',
    name: { de: 'Morgenrot', en: 'Red Dawn' },
    beschreibung: {
      de: 'Du hast die Schattenflut überstanden: zehn Minuten lang 20 % schnellere Ausdauererholung, 10 % mehr Erfahrung, und die Furcht weicht um 0,5 pro Sekunde.',
      en: 'You survived the Shadow Tide: for ten minutes 20% faster stamina recovery, 10% more experience, and fear fades by 0.5 per second.',
    },
    art: 'gut',
    dauer: { art: 'zeit', sekunden: 600 },
    stapel: { regel: 'erneuern' },
    wirkung: { ausdauerRegeneration: 1.2, erfahrung: 1.1, furchtProSekunde: -0.5 },
    sichtbar: 'morgenglanz',
    sound: 'sfx_zustand_morgenrot',
  },
  {
    id: 'nachtsicht',
    name: { de: 'Nachtsicht', en: 'Night Vision' },
    beschreibung: {
      de: 'Deine Augen gewöhnen sich an die Nacht: Du siehst im Dunkeln doppelt so weit, sechs Minuten lang.',
      en: 'Your eyes adjust to the night: you see twice as far in the dark, for six minutes.',
    },
    art: 'gut',
    dauer: { art: 'zeit', sekunden: 360 },
    stapel: { regel: 'erneuern' },
    wirkung: { sicht: 2 },
    sichtbar: 'nachtsicht',
    sound: 'sfx_zustand_nachtsicht',
  },
  {
    id: 'beschwipst',
    name: { de: 'Beschwipst', en: 'Tipsy' },
    beschreibung: {
      de: 'Met steigt zu Kopf: 10 % weniger Schaden, aber du schwankst und triffst 15 % schlechter. Jeder weitere Becher verlängert es, höchstens auf zehn Minuten.',
      en: 'Mead goes to your head: 10% less damage taken, but you sway and aim 15% worse. Every further cup extends it, to at most ten minutes.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 180 },
    stapel: { regel: 'verlaengern', maxSekunden: 600 },
    wirkung: { schadensresistenz: 0.1, praezision: 0.85 },
    sichtbar: 'schwanken',
    sound: 'sfx_zustand_beschwipst',
  },
  {
    id: 'erschuettert',
    name: { de: 'Erschüttert', en: 'Shaken' },
    beschreibung: {
      de: 'Dein Licht ist gerade erst wieder entfacht: 15 % weniger maximales Leben für drei Minuten.',
      en: 'Your light has only just been rekindled: 15% less maximum health for three minutes.',
    },
    art: 'schlecht',
    dauer: { art: 'zeit', sekunden: 180 },
    stapel: { regel: 'erneuern' },
    wirkung: { maxLeben: 0.85 },
    sichtbar: 'blaesse',
    sound: 'sfx_zustand_erschuettert',
  },
  valueCondition(
    'saettigung',
    'hungrig',
    'schlecht',
    'magenknurren',
    'sfx_spieler_magenknurren',
    { de: 'Hungrig', en: 'Hungry' },
    {
      de: 'Sättigung unter 20: Die Ausdauer erholt sich nur halb so schnell, und Leben regeneriert nicht mehr. Iss etwas.',
      en: 'Satiety below 20: stamina recovers at half speed, and health no longer regenerates. Eat something.',
    },
  ),
  valueCondition(
    'saettigung',
    'verhungernd',
    'kritisch',
    'magenknurren',
    'sfx_spieler_magenknurren',
    { de: 'Verhungernd', en: 'Starving' },
    {
      de: 'Sättigung 0: Du verlierst ein Leben alle zwei Sekunden, bis du isst.',
      en: 'Satiety 0: you lose one health every two seconds until you eat.',
    },
  ),
  valueCondition(
    'durst',
    'durstig',
    'schlecht',
    'keuchen',
    'sfx_spieler_keuchen',
    { de: 'Durstig', en: 'Thirsty' },
    {
      de: 'Durst unter 20: Leben regeneriert nicht mehr. Trink aus einem Fluss, einem See oder einer Quelle.',
      en: 'Thirst below 20: health no longer regenerates. Drink from a river, a lake or a spring.',
    },
  ),
  valueCondition(
    'durst',
    'verdurstend',
    'kritisch',
    'keuchen',
    'sfx_spieler_keuchen',
    { de: 'Verdurstend', en: 'Dehydrated' },
    {
      de: 'Durst 0: Du verlierst ein Leben pro Sekunde, bis du trinkst.',
      en: 'Thirst 0: you lose one health per second until you drink.',
    },
  ),
  valueCondition(
    'atem',
    'ertrinkend',
    'kritisch',
    'atemblasen',
    'sfx_spieler_ertrinken',
    { de: 'Ertrinkend', en: 'Drowning' },
    {
      de: 'Ohne Ausdauer im tiefen Wasser: 5 Leben pro Sekunde. Schwimm sofort ans Ufer.',
      en: 'Out of stamina in deep water: 5 health per second. Swim to the shore at once.',
    },
  ),
];
