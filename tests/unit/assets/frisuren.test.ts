/**
 * M7-54 Zwölf Frisuren als Kopf-Layer über allen Animationen × Körperformen (MASTERPROMPT §26 „Frisur (12)“, §4.5;
 * docs/SPIEL.md §26 „Frisuren“, §29 `frisur_<name>` (12)). Belegt am erzeugten Atlas und an den Zeichnungen (ohne die teure
 * Komposition aller Posen, assets-src/sprites/frisuren/frisuren.ts):
 * - Inhalt, Zeichnungen und Atlas kennen dieselben zwölf Frisuren in derselben Reihenfolge; je Frisur der Haar-Layer
 *   `frisur_<id>`, das Auswahlbild `frisur_<id>_ansicht`, für die Masken-Frisuren und `scheitel` die Helm-Maske
 *   `frisur_<id>_helm`; alle Haar-Layer haben dieselben Frames (Kopfposen) und je Richtung einen Halte-Clip.
 * - Die Kopfposen-Tabelle `frisur_kopfposen` ordnet jedem Körper-Frame jeder Form (alle 1110 von `spieler_basis`) eine
 *   Kopfpose zu; der Renderer liest sie so (`headPoses`), und Frames mit gleichem Kopf teilen sich Posen.
 * - Unter einer Kopfbedeckung (Maskenframes): nichts ragt über der Krempe aus dem Kopf (die Kappe deckt die Zeilen 0–3), was
 *   darunter fällt, bleibt; Frisuren ohne Maske zeigen die kurze Frisur unter dem Helm (`hairSpriteId`).
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN } from '../../../assets-src/lib/figure';
import { HELM_KREMPE, ausSchluessel, helmZeichnung, kopfZeichnung, zeichnungenVon, type Zeichnung } from '../../../assets-src/sprites/frisuren/_frisuren';
import { FRISUR_ZEICHNUNGEN, SCHEITEL } from '../../../assets-src/sprites/frisuren/_zeichnungen';
import { BODY_SHAPE_IDS, HAIRSTYLE_COUNT, HAIRSTYLES } from '../../../src/content/appearance';
import type { AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { HEAD_POSES_SPRITE, PLAYER_BODY_SPRITE, hairSpriteId, headPoses } from '../../../src/render/game/playerFigure';

function manifest(): AtlasManifest {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Kein erzeugter Atlas – erst `npm run assets`');
  return manifestFromGenerated(mod);
}

const M = manifest();
const IDS = HAIRSTYLES.map((h) => h.id);
/** Die Frisuren mit eigenen Maskenframes unter einer Kopfbedeckung (und `scheitel`, die Frisur unter jedem Helm). */
const MIT_MASKE = [SCHEITEL, ...FRISUR_ZEICHNUNGEN.filter((f) => f.unterHelm === 'maske').map((f) => f.id)];

function sprite(id: string): AtlasSprite {
  const s = M.sprites[id];
  if (s === undefined) throw new Error(`Sprite ${id} fehlt im Atlas`);
  return s;
}

function punkte(z: Zeichnung): (readonly [number, number])[] {
  return [...z.pixel.keys()].map(ausSchluessel);
}

describe('M7-54 zwölf Frisuren', () => {
  it('Inhalt, Zeichnungen und Atlas: dieselben zwölf in derselben Reihenfolge', () => {
    expect(HAIRSTYLE_COUNT).toBe(12);
    expect(IDS).toHaveLength(12);
    expect(new Set(IDS).size).toBe(12);
    expect([SCHEITEL, ...FRISUR_ZEICHNUNGEN.map((f) => f.id)]).toEqual(IDS);
    const imAtlas = Object.keys(M.sprites).filter((id) => /^frisur_[a-z]+$/.test(id) && id !== HEAD_POSES_SPRITE);
    expect(imAtlas.sort()).toEqual(IDS.map((id) => `frisur_${id}`).sort());
  });

  it('je Frisur Haar-Layer, Auswahlbild und – wo vorgesehen – Helm-Maske; alle Haar-Layer mit denselben Kopfposen', () => {
    const posen = sprite(`frisur_${SCHEITEL}`).frames.length;
    expect(posen).toBeGreaterThan(100);
    for (const id of IDS) {
      const haar = sprite(`frisur_${id}`);
      expect(haar.group, id).toBe('frisuren');
      expect(haar.frames, id).toHaveLength(posen);
      for (const r of RICHTUNGEN) expect(haar.clips[r]?.frames, `${id} ${r}`).toHaveLength(1);
      expect(sprite(`frisur_${id}_ansicht`).clips['ansicht']?.frames, `${id} Ansicht`).toEqual([0, 1, 2, 3]);
      const helm = M.sprites[`frisur_${id}_helm`];
      expect(helm !== undefined, `${id}: Helm-Maske`).toBe(MIT_MASKE.includes(id));
      if (helm !== undefined) expect(helm.frames, `${id} Helm`).toHaveLength(posen);
      expect(hairSpriteId(M, id, false)).toBe(`frisur_${id}`);
      expect(hairSpriteId(M, id, true)).toBe(MIT_MASKE.includes(id) ? `frisur_${id}_helm` : `frisur_${SCHEITEL}_helm`);
    }
    // Frisuren ohne Maske gibt es (die hohen: Irokese, Stacheln, Dutt …) – unter dem Helm die kurze Frisur.
    expect(MIT_MASKE.length).toBeLessThan(IDS.length);
  });

  it('die Kopfposen-Tabelle deckt jeden Körper-Frame jeder Form; gleiche Köpfe teilen sich Posen', () => {
    const koerper = sprite(PLAYER_BODY_SPRITE).frames.length;
    const posen = sprite(`frisur_${SCHEITEL}`).frames.length;
    expect(sprite(HEAD_POSES_SPRITE).frames.length).toBe(posen);
    for (const form of BODY_SHAPE_IDS) {
      const tabelle = headPoses(M, form);
      expect(tabelle, form).not.toBeNull();
      expect(tabelle, form).toHaveLength(koerper);
      expect(tabelle?.every((p) => Number.isInteger(p) && p >= 0 && p < posen), form).toBe(true);
    }
    // Viele Körper-Frames teilen eine Kopfpose (gleiche Kopfhaltung), aber jede Form braucht viele verschiedene.
    const genutzt = new Set(BODY_SHAPE_IDS.flatMap((f) => [...(headPoses(M, f) ?? [])]));
    expect(genutzt.size).toBe(posen);
    expect(posen).toBeLessThan(koerper);
  });

  it('Maskenframes: über der Krempe ragt nichts aus dem Kopf, darunter bleibt jedes Haar', () => {
    for (const def of FRISUR_ZEICHNUNGEN.filter((f) => f.unterHelm === 'maske')) {
      const zs = zeichnungenVon(def);
      for (const r of RICHTUNGEN) {
        const kopf = new Set(punkte(kopfZeichnung(r)).map(([x, y]) => `${x},${y}`));
        const voll = punkte(zs[r]);
        const maske = punkte(helmZeichnung(zs[r], r));
        const ueberKrempe = maske.filter(([x, y]) => y < HELM_KREMPE && !kopf.has(`${x},${y}`));
        expect(ueberKrempe, `${def.id} ${r}: über der Krempe außerhalb des Kopfes`).toEqual([]);
        expect(maske.filter(([, y]) => y >= HELM_KREMPE).length, `${def.id} ${r}: unter der Krempe`).toBe(voll.filter(([, y]) => y >= HELM_KREMPE).length);
      }
    }
    // Die hohen Frisuren hätten über der Krempe herausgeragt: die Maske nimmt dort wirklich etwas weg.
    const weg = FRISUR_ZEICHNUNGEN.filter((f) => f.unterHelm === 'maske').some((def) => {
      const zs = zeichnungenVon(def);
      return RICHTUNGEN.some((r) => helmZeichnung(zs[r], r).pixel.size < zs[r].pixel.size);
    });
    expect(weg).toBe(true);
  });
});
