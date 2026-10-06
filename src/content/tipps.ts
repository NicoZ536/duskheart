/**
 * Tips and lore of the loading screen (MASTERPROMPT §26 "Ladebildschirm (Tipps, Lore)", §8 Setting; docs/SPIEL.md §25, §29
 * "Tipps `tipp_<nn>`"; M7-50) – collection `tips`.
 *
 * A `tipp` explains a mechanic in one or two sentences (clear verbs, what to do – §26 "Texte"); a `lore` line tells a
 * fragment of Lumara's story in Funke's or a Builder's voice (§8 "melancholisch und hoffnungsvoll, wenig Text"). The
 * loading screen shows one of each, chosen afresh while it waits. Texts DE and EN; at most two lines of the screen's box.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from './schema/common';

/** Kinds of a loading-screen text. */
export const TIP_KINDS = ['tipp', 'lore'] as const;
export type TipKind = (typeof TIP_KINDS)[number];

export interface TipDef {
  /** `tipp_<nn>` (docs/SPIEL.md §29). */
  readonly id: string;
  readonly art: TipKind;
  readonly text: LocalizedText;
}

/** Longest text of a tip [characters]: two lines of the loading screen's box at its width. */
export const TIP_MAX_CHARS = 150;

export const tipSchema = z
  .object({
    id: idSchema.refine((id) => /^tipp_\d{2}$/.test(id), { message: 'tips are named tipp_<nn>' }),
    art: z.enum(TIP_KINDS),
    text: localizedTextSchema.refine((t) => t.de.length <= TIP_MAX_CHARS && t.en.length <= TIP_MAX_CHARS, { message: `at most ${TIP_MAX_CHARS} characters` }),
  })
  .strict() satisfies z.ZodType<TipDef>;

const tipp = (n: number, de: string, en: string): TipDef => ({ id: `tipp_${String(n).padStart(2, '0')}`, art: 'tipp', text: { de, en } });
const lore = (n: number, de: string, en: string): TipDef => ({ id: `tipp_${String(n).padStart(2, '0')}`, art: 'lore', text: { de, en } });

export const TIPS: readonly TipDef[] = [
  tipp(1, 'In der Dunkelheit wächst die Furcht. Licht, Feuer und behagliche Räume bauen sie wieder ab.', 'Fear grows in the dark. Light, fire and cosy rooms bring it back down.'),
  tipp(2, 'Solange das Herdfeuer brennt, erscheint in seinem Umkreis keine Schattenbrut. Halte es mit Brennstoff versorgt.', 'While the hearth fire burns, no shadow brood appears around it. Keep it fed with fuel.'),
  tipp(3, 'Blocke kurz vor einem Treffer, um zu parieren: Der Gegner taumelt, und dein nächster Treffer ist kritisch.', 'Block just before a hit lands to parry: the foe staggers and your next hit is critical.'),
  tipp(4, 'Kleine Gegenstände in deiner Nähe sammelst du automatisch ein.', 'Small items near you are picked up on their own.'),
  tipp(5, 'Nahrung verdirbt mit der Zeit. Kühlkisten und Eiskeller halten sie deutlich länger frisch.', 'Food spoils over time. Cool boxes and ice cellars keep it fresh for much longer.'),
  tipp(6, 'Wer leuchtet, wird von Gegnern doppelt so weit gesehen. Manchmal ist Dunkelheit die bessere Tarnung.', 'Whoever carries a light is seen from twice as far. Sometimes darkness is the better cover.'),
  tipp(7, 'Isst du dieselbe Speise dreimal am Tag, sinkt ihr Nährwert. Abwechslung wird belohnt.', 'Eat the same dish three times a day and it nourishes less. Variety pays off.'),
  tipp(8, 'Das Spiel speichert automatisch in regelmäßigen Abständen, beim Schlafen und beim Verlassen.', 'The game saves on its own at regular intervals, when you sleep and when you leave.'),
  tipp(9, 'Eine Rolle macht dich kurz unverwundbar. Rolle durch den Schlag, nicht davor weg.', 'A roll makes you invulnerable for a moment. Roll through the blow, not away from it.'),
  tipp(10, 'Regen löscht Fackeln und offene Feuer. Ein Dach darüber hält sie am Brennen.', 'Rain puts out torches and open fires. A roof above keeps them burning.'),
  tipp(11, 'Nasse Kleidung wärmt kaum. Trockne dich am Feuer, bevor die Nacht kalt wird.', 'Wet clothes barely keep you warm. Dry off by a fire before the night turns cold.'),
  tipp(12, 'Schlafe in einem Bett, und du erwachst nach dem Tod dort statt am Strand.', 'Sleep in a bed and you wake there after death instead of on the beach.'),
  tipp(13, 'Nach dem Tod wartet ein Grab mit deinen Sachen. Hole sie dir zurück, bevor du Neues riskierst.', 'After death a grave holds your things. Fetch them before you risk anything new.'),
  tipp(14, 'Werkbank und Stationen nehmen Zutaten auch aus Kisten in der Nähe. Ordnung spart Wege.', 'Workbench and stations also take ingredients from nearby chests. Order saves walking.'),
  tipp(15, 'Fertigkeiten wachsen durch Tun: Wer Bäume fällt, wird besser im Holzfällen.', 'Skills grow by doing: whoever fells trees gets better at woodcutting.'),
  tipp(16, 'Ein geschlossener Raum mit Dach, Tür und Licht wird zum Zuhause und wärmt dich.', 'A closed room with a roof, a door and a light becomes a home and keeps you warm.'),
  tipp(17, 'Erze verlangen das passende Werkzeug. Eine Steinspitzhacke bricht kein Eisen.', 'Ores need the right tool. A stone pickaxe will not break iron.'),
  tipp(18, 'Steigt deine Furcht auf 100, kommt der Nachtmahr. Halte dich in der Nacht nahe am Licht.', 'If your fear reaches 100, the Nachtmahr comes. Stay close to light at night.'),
  tipp(19, 'Wölfe jagen im Rudel und kreisen dich ein. Ein Feuer im Rücken hält sie auf Abstand.', 'Wolves hunt in packs and circle you. A fire at your back keeps them at bay.'),
  tipp(20, 'Die Schwierigkeit lässt sich jederzeit im Pausemenü unter „Welt“ ändern – nur Unbarmherzig bleibt.', 'You can change the difficulty any time under “World” in the pause menu – only Merciless stays.'),
  tipp(21, 'Teile deinen Seed: Wer „DH-<Seed>-<Größe>“ bei Neue Welt einfügt, erhält dieselbe Insel.', 'Share your seed: whoever pastes “DH-<seed>-<size>” into New world gets the same island.'),
  tipp(22, 'Unter „Welten“ kannst du eine Welt als .dhsave-Datei sichern und auf einem anderen Gerät laden.', 'Under “Worlds” you can back up a world as a .dhsave file and load it on another device.'),
  tipp(23, 'Entzündete Leuchtfeuer heilen ihre Region: Die Farben kehren zurück, die Nächte werden sicherer.', 'Lit beacons heal their region: colours return and the nights grow safer.'),
  tipp(24, 'Halte die Ausdauer im Blick. Wer erschöpft angreift, schlägt langsam und blockt schwach.', 'Keep an eye on stamina. Attacking while exhausted means slow swings and weak blocks.'),
  tipp(25, 'Hitze dörrt dich aus: In der Sonne brauchst du mehr Wasser als im Schatten.', 'Heat dries you out: in the sun you need more water than in the shade.'),
  tipp(26, 'Fallen fangen Kleintiere, auch während du fort bist.', 'Traps catch small animals, even while you are away.'),
  lore(27, 'Vor dreihundert Jahren griffen die Erbauer nach dem Urfeuer. Sie wollten die Nacht beenden – und rissen das Nachtherz auf.', 'Three hundred years ago the Builders reached for the Primal Fire. They meant to end the night – and tore open the Nachtherz.'),
  lore(28, 'Sechs Leuchtfeuer hielten die Dunkelheit zurück. Eines nach dem anderen erlosch.', 'Six beacons held the darkness back. One after another they went out.'),
  lore(29, '„Ich bin nur ein Funke. Aber jede Flamme beginnt so.“ – Funke', '“I am only a spark. But every flame begins like this.” – Funke'),
  lore(30, 'Die Tage sind grau geworden, die Nächte tödlich. Wer draußen bleibt, gehört der Schattenbrut.', 'The days have turned grey, the nights deadly. Whoever stays outside belongs to the shadow brood.'),
  lore(31, 'Die Straßen der Erbauer führen noch immer zu den alten Feuern. Moos hat sie nicht ganz vergessen lassen.', 'The Builders’ roads still lead to the old fires. Moss has not made them quite forget.'),
  lore(32, '„Wir bauten Türme gegen die Nacht. Die Nacht wartete einfach.“ – Erbauer-Tafel', '“We built towers against the night. The night simply waited.” – Builder tablet'),
  lore(33, 'Die Laterne an deinem Gürtel trägt die letzte Glut eines Leuchtfeuers. Lass sie nicht verlöschen.', 'The lantern at your belt carries a beacon’s last ember. Do not let it die.'),
  lore(34, 'Manche, die zu lange in der Dunkelheit waren, wurden zu Gezeichneten. Einige lassen sich noch retten.', 'Some who stayed too long in the dark became the Marked. A few can still be saved.'),
  lore(35, 'Im Grünhain schläft der Borkenvater, ein alter Hüter, den die Dunkelheit verdorben hat.', 'In the Grünhain sleeps the Bark Father, an old guardian the darkness has spoiled.'),
  lore(36, '„Wenn die sechs Feuer wieder brennen, kehrt die Nacht zurück, wie sie war: ruhig.“ – Funke', '“When the six fires burn again, the night returns as it was: calm.” – Funke'),
];
