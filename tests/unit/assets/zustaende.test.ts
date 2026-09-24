/**
 * M3-20 (Icon-Teil): Zustands-Icons `zustand_<id>` für alle 31 Zustände aus docs/SPIEL.md §6. Belegt am
 * Pixel: Rahmen-Bildsprache je Art über die **Form** (Kreis = Stärkung, Quadrat = Schwächung, Raute =
 * kostet Leben) – die Silhouette jedes Icons ist exakt die Rahmenform seiner Art, die drei Formen
 * unterscheiden sich deutlich (farbfehlsichtig und in Graustufen lesbar); Randfarben einheitlich je Art;
 * kritische Zustände pulsen (zwei Frames, heller Rand); das Motiv liegt vollständig im Innenraum, ist groß
 * genug für 16 px und hebt sich in der Helligkeit vom Grund ab; jedes Motiv ist verschieden; ≤ 12 Farben
 * ohne Einzelpixel-Befund; Kontaktbogen `zustaende`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import zustaende, { ZUSTAND_ARTEN } from '../../../assets-src/sprites/zustaende/zustaende';
import { PULS_FPS, RAHMEN, ZUSTAND_GRUPPE, type ZustandArt } from '../../../assets-src/sprites/zustaende/_zustand';
import { hexToOklab } from '../../../assets-src/lib/color';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { flatPalette, paletteIndex, paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const L = flatPalette().map((hex) => hexToOklab(hex).L);
const ARTEN: readonly ZustandArt[] = ['gut', 'schlecht', 'kritisch'];
/** Mindestzahl verschiedener Pixel zwischen zwei Rahmenformen (Form statt Farbe). */
const FORM_ABSTAND = 16;
/** Motiv: Mindestgröße in px und Mindestanteil mit Helligkeitsabstand ≥ 0,2 (OKLab L) zum Grund. */
const MOTIV_MIN_PX = 25;
const KONTRAST_L = 0.2;
const KONTRAST_ANTEIL = 0.3;
/** Randfarben je Art (Frame 0) und Grundfarbe. */
const RAND: Readonly<Record<ZustandArt, { hell: string; dunkel: string; grund: string }>> = {
  gut: { hell: 'sand.4', dunkel: 'sand.2', grund: 'wasser.1' },
  schlecht: { hell: 'laub.2', dunkel: 'laub.1', grund: 'laub.0' },
  kritisch: { hell: 'feuer.3', dunkel: 'feuer.2', grund: 'nacht.0' },
};

function spielZustaende(): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const zeile = text.split('\n').find((l) => l.startsWith('- **Zustände (M3-19)'));
  if (zeile === undefined) throw new Error('docs/SPIEL.md: Zustände fehlen');
  return [...zeile.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '');
}

function rahmen(art: ZustandArt): string[] {
  return RAHMEN[art]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function maske(f: SpriteFrame): string {
  return Array.from(f.index, (v) => (v === TRANSPARENT ? '.' : '#')).join('');
}

function formMaske(art: ZustandArt): string {
  return rahmen(art)
    .join('')
    .replace(/[^.]/g, '#');
}

function artVon(s: Sprite): ZustandArt {
  const art = ZUSTAND_ARTEN[s.id.replace(/^zustand_/, '')];
  if (art === undefined) throw new Error(`${s.id}: Art fehlt`);
  return art;
}

describe('M3-20 Zustands-Icons', () => {
  it('alle 31 Zustände aus docs/SPIEL.md §6 haben ein Icon zustand_<id> im Bogen zustaende', () => {
    const ids = spielZustaende();
    expect(ids).toHaveLength(31);
    expect(Object.keys(ZUSTAND_ARTEN)).toEqual(ids);
    expect(zustaende.map((s) => s.id)).toEqual(ids.map((id) => `zustand_${id}`));
    for (const s of zustaende) {
      expect(s.group, s.id).toBe(ZUSTAND_GRUPPE);
      expect([s.w, s.h], s.id).toEqual([16, 16]);
    }
    // Jede Art kommt vor; Stärkungen sind genau die sechs positiven Zustände aus §11.3.
    expect(ids.filter((id) => ZUSTAND_ARTEN[id] === 'gut')).toEqual(['wohlgenaehrt', 'ausgeruht', 'behaglich', 'erleuchtet', 'morgenrot', 'nachtsicht']);
    for (const a of ARTEN) expect(ids.some((id) => ZUSTAND_ARTEN[id] === a), a).toBe(true);
  });

  it('Form statt Farbe: jede Silhouette ist die Rahmenform ihrer Art, die drei Formen unterscheiden sich deutlich', () => {
    for (const s of zustaende) for (const f of s.frames) expect(maske(f), s.id).toBe(formMaske(artVon(s)));
    for (let i = 0; i < ARTEN.length; i++) {
      for (let j = i + 1; j < ARTEN.length; j++) {
        const a = formMaske(ARTEN[i] as ZustandArt);
        const b = formMaske(ARTEN[j] as ZustandArt);
        let abstand = 0;
        for (let p = 0; p < a.length; p++) if (a[p] !== b[p]) abstand++;
        expect(abstand, `${ARTEN[i]} ↔ ${ARTEN[j]}`).toBeGreaterThanOrEqual(FORM_ABSTAND);
      }
    }
  });

  it('einheitliche Randfarben je Art; kritisch pulst mit hellerem Rand, sonst ein Frame', () => {
    for (const s of zustaende) {
      const art = artVon(s);
      const r = rahmen(art);
      const f = s.frames[0] as SpriteFrame;
      r.forEach((zeile, y) =>
        [...zeile].forEach((c, x) => {
          const v = f.index[y * 16 + x];
          if (c === 'k') expect(v, `${s.id} Kontur (${x}, ${y})`).toBe(paletteIndex('nacht.1'));
          if (c === '<') expect(v, `${s.id} Rand (${x}, ${y})`).toBe(paletteIndex(RAND[art].hell));
          if (c === '>') expect(v, `${s.id} Rand (${x}, ${y})`).toBe(paletteIndex(RAND[art].dunkel));
        }),
      );
      if (art === 'kritisch') {
        expect(s.frames, s.id).toHaveLength(2);
        expect(s.clips.puls, s.id).toEqual({ frames: [0, 1], fps: PULS_FPS, loop: true, events: [] });
        const f1 = s.frames[1] as SpriteFrame;
        r.forEach((zeile, y) =>
          [...zeile].forEach((c, x) => {
            if (c !== '<' && c !== '>') return;
            const a = (f.index[y * 16 + x] ?? 1) - 1;
            const b = (f1.index[y * 16 + x] ?? 1) - 1;
            expect(L[b] ?? 0, `${s.id} Puls (${x}, ${y})`).toBeGreaterThan(L[a] ?? 1);
          }),
        );
      } else {
        expect(s.frames, s.id).toHaveLength(1);
        expect(Object.keys(s.clips), s.id).toEqual([]);
      }
    }
  });

  it('das Motiv liegt im Innenraum, ist bei 16 px groß genug und hebt sich vom Grund ab; alle Motive verschieden', () => {
    const motive = new Set<string>();
    for (const s of zustaende) {
      const art = artVon(s);
      const grund = paletteIndex(RAND[art].grund);
      const f = s.frames[0] as SpriteFrame;
      let px = 0;
      let hell = 0;
      const motiv: string[] = [];
      rahmen(art).forEach((zeile, y) =>
        [...zeile].forEach((c, x) => {
          const v = f.index[y * 16 + x] ?? TRANSPARENT;
          if (c !== '=') return;
          motiv.push(v === grund ? '.' : String(v));
          if (v === grund) return;
          px++;
          if (Math.abs((L[v - 1] ?? 0) - (L[grund - 1] ?? 0)) >= KONTRAST_L) hell++;
        }),
      );
      expect(px, s.id).toBeGreaterThanOrEqual(MOTIV_MIN_PX);
      expect(hell / px, s.id).toBeGreaterThanOrEqual(KONTRAST_ANTEIL);
      motive.add(motiv.join(','));
    }
    expect(motive.size).toBe(zustaende.length);
  });

  it('Stufen einer Reihe teilen ihr Motiv-Material: Kälte eisweiß, Hitze gelb, Durst Wasser, Hunger Knochen/Fleisch', () => {
    const rampen = (id: string): Set<string> => {
      const s = zustaende.find((x) => x.id === `zustand_${id}`) as Sprite;
      const art = artVon(s);
      const f = s.frames[0] as SpriteFrame;
      const out = new Set<string>();
      rahmen(art).forEach((zeile, y) =>
        [...zeile].forEach((c, x) => {
          const v = f.index[y * 16 + x] ?? TRANSPARENT;
          if (c === '=' && v !== paletteIndex(RAND[art].grund) && v !== paletteIndex('nacht.1')) out.add(paletteRef(v).split('.')[0] ?? '');
        }),
      );
      return out;
    };
    for (const id of ['frierend', 'unterkuehlt', 'erfrierend']) expect(rampen(id).has('eis'), id).toBe(true);
    for (const id of ['erhitzt', 'hitzschlag']) expect(rampen(id).has('feuer'), id).toBe(true);
    for (const id of ['durstig', 'verdurstend']) expect([...rampen(id)].some((r) => r === 'wasser' || r === 'eis'), id).toBe(true);
    for (const id of ['vergiftung', 'lebensmittelvergiftung']) expect(rampen(id).has('gras'), id).toBe(true);
  });

  it('≤ 12 Farben ohne Ausnahme, keine Befunde des Paletten-Validators', () => {
    for (const s of zustaende) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});
