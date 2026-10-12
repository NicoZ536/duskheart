/**
 * Die Spielfigur in den Körperformen `schmal` und `kraeftig` (M7-53; docs/SPIEL.md §26 „Körperformen“): je Form der
 * Grundkörper (`spieler_<form>_basis`, wie `spieler_basis`), die angezogene Idle-Figur (`spieler_<form>_koerper`, wie
 * `spieler_koerper`) und die Kleidung des Schiffbrüchigen als Overlay-Layer (`ausruestung_leinentunika_<form>`,
 * `ausruestung_leinenhose_<form>`, wie in assets-src/sprites/ausruestung/kleidung.ts). Die Form `mittel` sind die Sprites
 * bis M6 unter ihren Namen.
 *
 * **Gleiche Frames wie `spieler_basis`.** Alle aus denselben Posen (`spielerBilderFuer`): gleiche Frame-Reihenfolge, gleiche
 * Zelle und gleicher Anker; die Sockel je Frame folgen dem Körper der Form (die Hände sitzen an den versetzten Schultern,
 * Kopf und Last bleiben; tests/unit/assets/koerperformen.test.ts). Die Sprites einer Form tragen deshalb nur Clips zur
 * Ansicht (Idle und Gehen, Kontaktbogen `koerperformen.png`): der Renderer spielt die Clips von `spieler_basis` auf dem
 * Körper der Form (`src/render/game/playerFigure.ts`, `formKoerper`) – die 248 Clips stehen einmal im Manifest.
 *
 * Rüstungs-Layer gibt es nur für `mittel`: mit einem Rüstungsteil am Körper zeigt der Renderer die Figur in `mittel`
 * (Rückfall; Folgeaufgabe: Atlas-Frames beschneiden, dann Rüstung je Form).
 */
import { RICHTUNGEN, bildPixel, type Bild, type FigurLegende } from '../../lib/figure';
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { spielerBilderFuer, type SpielerClip } from './_spieler_bilder';
import { HOSE_ZEICHEN, KONTUR, LEGENDE_ANGEZOGEN, LEGENDE_BASIS, LEGENDE_HOSE, LEGENDE_TUNIKA, TUNIKA_ZEICHEN } from './_spieler_farben';
import type { KoerperForm } from './_spieler_formen';
import { WASSERLINIE_Y } from './_spieler_sonder';
import { spielerSockel, SPIELER_META } from './_spieler_sprite';

/** Die Körperformen mit eigenen Sprites (`mittel` = die Sprites bis M6). */
export const EIGENE_FORMEN = ['schmal', 'kraeftig'] as const satisfies readonly KoerperForm[];

/** Sprite-Id des Grundkörpers einer Form (`spieler_basis` für `mittel`). */
export function koerperSpriteId(form: KoerperForm): string {
  return form === 'mittel' ? 'spieler_basis' : `spieler_${form}_basis`;
}

/** Sprite-Id eines Kleidungs- oder Rüstungs-Layers in einer Form (`ausruestung_<item>` für `mittel`). */
export function formLayerId(spriteId: string, form: KoerperForm): string {
  return form === 'mittel' ? spriteId : `${spriteId}_${form}`;
}

/** Gruppe (Kontaktbogen) der Formen-Sprites. */
const GRUPPE = 'koerperformen';

/** Clips zur Ansicht im Kontaktbogen (der Renderer spielt die Clips von `spieler_basis`). */
export function ansicht(clips: Readonly<Record<string, SpielerClip>>): Record<string, SpielerClip> {
  return Object.fromEntries(RICHTUNGEN.flatMap((r) => [`idle_${r}`, `walk_${r}`].flatMap((n) => (clips[n] === undefined ? [] : [[n, clips[n]]]))));
}

function kleidung(id: string, bilder: readonly Bild[], clips: Readonly<Record<string, SpielerClip>>, zeichen: ReadonlySet<string>, legende: FigurLegende): Sprite {
  return spriteFromPixels(
    {
      ...SPIELER_META,
      id,
      group: GRUPPE,
      clips: ansicht(clips),
      // Im Atlas nur die deckenden Pixel je Frame (M7-125, wie assets-src/sprites/ausruestung/kleidung.ts).
      zuschnitt: true,
      einzelpixel: 'Layer-Auszug: einzeln stehende Stoff- und Konturpixel setzen Flächen des Körpers fort und sind im Zusammenbau Teil eines Clusters (geprüft in tests/unit/assets/koerperformen.test.ts)',
    },
    bilder.map((b) => bildPixel(b, legende, { zeichen, kontur: KONTUR })),
  );
}

/** Die angezogene Idle-Figur einer Form (Frames der Idle-Clips, angezogen). */
function koerper(form: KoerperForm, bilder: readonly Bild[], clips: Readonly<Record<string, SpielerClip>>): Sprite {
  const frames: Bild[] = [];
  const idleClips: Record<string, SpielerClip> = {};
  for (const r of RICHTUNGEN) {
    const clip = clips[`idle_${r}`];
    if (clip === undefined) throw new Error(`spieler_${form}_koerper: Clip idle_${r} fehlt`);
    const eigene = [...new Set(clip.frames)];
    const start = frames.length;
    for (const f of eigene) {
      const b = bilder[f];
      if (b === undefined) throw new Error(`spieler_${form}_koerper: Frame ${f} fehlt`);
      frames.push(b);
    }
    idleClips[`idle_${r}`] = { ...clip, frames: clip.frames.map((f) => start + eigene.indexOf(f)) };
  }
  return spriteFromPixels({ ...SPIELER_META, id: `spieler_${form}_koerper`, group: GRUPPE, clips: idleClips, sockets: spielerSockel(frames) }, frames.map((b) => bildPixel(b, LEGENDE_ANGEZOGEN)));
}

/** Alle Sprites einer Form: Grundkörper, angezogene Idle-Figur, Tunika, Hose. */
export function formSprites(form: KoerperForm): Sprite[] {
  const { bilder, clips } = spielerBilderFuer({ form });
  const basis = spriteFromPixels(
    { ...SPIELER_META, id: koerperSpriteId(form), group: GRUPPE, clips: ansicht(clips), sockets: { ...spielerSockel(bilder), wasserlinie: [[16, WASSERLINIE_Y]] } },
    bilder.map((b) => bildPixel(b, LEGENDE_BASIS)),
  );
  return [
    basis,
    koerper(form, bilder, clips),
    kleidung(formLayerId('ausruestung_leinentunika', form), bilder, clips, TUNIKA_ZEICHEN, LEGENDE_TUNIKA),
    kleidung(formLayerId('ausruestung_leinenhose', form), bilder, clips, HOSE_ZEICHEN, LEGENDE_HOSE),
  ];
}

export default EIGENE_FORMEN.flatMap((form) => formSprites(form));
