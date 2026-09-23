/** The equipped "wanderer" figure of the render debug scenes (helmet, sword, hand torch). */
import { atlasSprite, type AtlasData } from '../assets/atlas';
import { FigureRig } from '../anim/figure';

export const FIGURE_ACTIONS = ['idle', 'walk'] as const;

/** Rig with helmet (head socket), sword (hand) and torch (off-hand). */
export function equippedWanderer(atlas: AtlasData): FigureRig {
  const m = atlas.manifest;
  return new FigureRig(atlasSprite(m, 'wanderer'), FIGURE_ACTIONS, [
    { slot: 'kopf', sprite: atlasSprite(m, 'helm') },
    { slot: 'waffe', sprite: atlasSprite(m, 'schwert') },
    { slot: 'nebenhand', sprite: atlasSprite(m, 'handfackel') },
  ]);
}

/** Rig of the bare figure (no equipment; symmetric, so left may be mirrored). */
export function bareWanderer(atlas: AtlasData): FigureRig {
  return new FigureRig(atlasSprite(atlas.manifest, 'wanderer'), FIGURE_ACTIONS, []);
}
