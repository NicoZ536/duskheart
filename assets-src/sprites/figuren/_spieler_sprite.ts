/**
 * Gemeinsame Sprite-Angaben der Spielfigur und ihrer Körper-Layer: Zelle, Anker (Fußpunkt), Höhe,
 * Hitbox und die Sockel je Frame aus den zusammengesetzten Bildern.
 */
import type { Bild, Punkt } from '../../lib/figure';
import { ZELLE } from './_spieler_rig';

/** Sockel, die jeder Frame der Figur trägt. */
export const SPIELER_SOCKEL = ['hand', 'nebenhand', 'kopf', 'last'] as const;

export const SPIELER_META = {
  size: [ZELLE, ZELLE] as [number, number],
  anchor: [ZELLE / 2, ZELLE - 1] as [number, number],
  hoehe: 'zylinder' as const,
  hitbox: [12, 27, 8, 5] as [number, number, number, number],
  occluder: { kind: 'none' as const },
  spiegelbar: false,
};

/** Sockel je Frame; fehlt einer, ist die Pose unvollständig (Fehler beim Bauen). */
export function spielerSockel(bilder: readonly Bild[], namen: readonly string[] = SPIELER_SOCKEL): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  for (const name of namen) {
    out[name] = bilder.map((b, i) => {
      const p: Punkt | undefined = b.sockel[name];
      if (p === undefined) throw new Error(`Spieler: Frame ${i} ohne Sockel ${name}`);
      return [p[0], p[1]];
    });
  }
  return out;
}
