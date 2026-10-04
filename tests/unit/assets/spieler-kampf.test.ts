/**
 * M6-10 Spieler-Kampfanimationen (MASTERPROMPT §4.5 „Angriff je Waffenklasse 4–6, … je 4 Richtungen“, „Animation mit
 * Antizipation, Überschwingen und Smear-Frames“; docs/SPIEL.md §13): Belegt am Sprite `spieler_basis` und an den
 * Aktionstabellen (`_spieler_kampf.ts`): jede Waffenklasse hat ihren Angriff in allen vier Richtungen mit 4–6 eigenen
 * Bildern, die Nahkampfklassen ihren schweren Angriff; Deckung, Bogen und Wurf; Figurentakt, Einmal-Clips; das
 * Event-Bild ist ein Smear (Bewegungsspur, weit weg vom Bild davor), vor ihm holt der Körper aus (Antizipation, ein Bild
 * gehalten), nach ihm federt er nach; der Rundumhieb dreht die Figur einmal herum; jedes Bild trägt die Sockel der Hand,
 * Nebenhand, des Kopfes und der Last; die Licht-Varianten halten die Nebenhand ruhig; der Bogen liegt nach unten quer vor
 * der Körpermitte, nach oben quer über dem Kopf, die gespannte Sehne an der Zughand bzw. am Kopf.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN, type Richtung } from '../../../assets-src/lib/figure';
import { TRANSPARENT, type SpriteClip } from '../../../assets-src/lib/sprite';
import { istSonder, type Aktion } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { framesDerAktion } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import { BOGEN_LAGEN, gedrehteRichtung, istGedreht, KAMPF_AKTIONEN, KAMPF_ANGRIFFE, KAMPF_MIT_LICHT, KAMPF_SCHWER, KAMPF_SONST } from '../../../assets-src/sprites/figuren/_spieler_kampf';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { SPIELER_SOCKEL } from '../../../assets-src/sprites/figuren/_spieler_sprite';
import fernkampf from '../../../assets-src/sprites/waffen/fernkampf';
import { paletteIndex } from '../../../assets-src/palette';
import { WEAPON_CLASSES } from '../../../src/content/balance/tools';

/** Nahkampfklassen mit schwerem Angriff (§19.2). */
const NAHKAMPF = ['faust', 'schwert', 'axt', 'keule', 'speer', 'dolch', 'zweihand'] as const;
/** Events, die den Moment des Schlags, Schusses oder Wurfs markieren. */
const MOMENT = new Set(['schwung', 'sehne', 'abzug', 'wurf']);

function clip(name: string): SpriteClip {
  const c = spieler.clips[name];
  if (c === undefined) throw new Error(`Clip ${name} fehlt`);
  return c;
}

function pixel(f: number): Uint8Array {
  const fr = spieler.frames[f];
  if (fr === undefined) throw new Error(`Frame ${f} fehlt`);
  return fr.index;
}

/** Pixel, in denen sich zwei Frames unterscheiden. */
function unterschied(a: number, b: number): number {
  const pa = pixel(a);
  const pb = pixel(b);
  let n = 0;
  for (let i = 0; i < pa.length; i++) if ((pa[i] ?? TRANSPARENT) !== (pb[i] ?? TRANSPARENT)) n++;
  return n;
}

function aktion(name: string): Aktion {
  const a = KAMPF_AKTIONEN.find((x) => x.name === name);
  if (a === undefined) throw new Error(`Aktion ${name} fehlt`);
  return a;
}

describe('M6-10 Kampfclips der Spielfigur', () => {
  it('jede Waffenklasse hat ihren Angriff, jede Nahkampfklasse ihren schweren Angriff, dazu die Deckung – je vier Richtungen', () => {
    expect(KAMPF_ANGRIFFE.map((a) => a.name).sort()).toEqual(WEAPON_CLASSES.filter((k) => k !== 'bogen' && k !== 'wurf').map((k) => `attack_${k}`).sort());
    expect(KAMPF_SONST.map((a) => a.name)).toEqual(['block', 'attack_bogen', 'attack_wurf']);
    expect(KAMPF_SCHWER.map((a) => a.name).sort()).toEqual(NAHKAMPF.map((k) => `heavy_${k}`).sort());
    for (const k of WEAPON_CLASSES) for (const r of RICHTUNGEN) expect(spieler.clips[`attack_${k}_${r}`], `attack_${k}_${r}`).toBeDefined();
    for (const k of NAHKAMPF) for (const r of RICHTUNGEN) expect(spieler.clips[`heavy_${k}_${r}`], `heavy_${k}_${r}`).toBeDefined();
    for (const r of RICHTUNGEN) expect(spieler.clips[`block_${r}`]).toBeDefined();
  });

  it('Angriffe haben je Richtung 4–6 eigene Bilder, schwere 5–6; Figurentakt 8–12 fps; nur die Deckung hält (Schleife)', () => {
    for (const a of [...KAMPF_ANGRIFFE, ...KAMPF_SCHWER, ...KAMPF_SONST, ...KAMPF_MIT_LICHT]) {
      for (const r of RICHTUNGEN) {
        const c = clip(`${a.name}_${r}`);
        const eigene = new Set(c.frames).size;
        if (a.name === 'block') expect(eigene, `${a.name}_${r}`).toBe(2);
        else if (a.name.startsWith('heavy_')) expect(eigene, `${a.name}_${r}`).toBeGreaterThanOrEqual(5);
        else expect(eigene, `${a.name}_${r}`).toBeGreaterThanOrEqual(4);
        expect(eigene, `${a.name}_${r}`).toBeLessThanOrEqual(6);
        expect(c.fps, a.name).toBeGreaterThanOrEqual(8);
        expect(c.fps, a.name).toBeLessThanOrEqual(12);
        expect(c.loop, a.name).toBe(a.name === 'block');
      }
    }
  });

  it('jeder Angriff hat genau ein Moment-Event auf dem Smear-Bild; davor holt der Körper aus (gehalten), danach federt er nach', () => {
    for (const a of [...KAMPF_ANGRIFFE, ...KAMPF_SCHWER, ...KAMPF_SONST.filter((x) => x.name !== 'block')]) {
      const momente = a.events.filter((e) => MOMENT.has(e.name));
      expect(momente, a.name).toHaveLength(1);
      const pos = momente[0]?.frame ?? -1;
      // Anticipation: at least two clip positions before the moment, one of the poses held (a repeated frame or a
      // pose held over two positions) – except the quick dagger stab, which gathers in one.
      expect(pos, a.name).toBeGreaterThanOrEqual(a.name === 'attack_dolch' ? 1 : 2);
      // Follow-through: the clip goes on after the moment.
      expect(pos, a.name).toBeLessThan(a.folge.length - 1);
      for (const r of RICHTUNGEN) {
        const c = clip(`${a.name}_${r}`);
        const smear = c.frames[pos] ?? -1;
        const vorher = c.frames[pos - 1] ?? -1;
        // The smear is a big change of the body (the arm swept, the stretched arm with its trail).
        expect(unterschied(smear, vorher), `${a.name}_${r} Smear`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('Stoß-, Hieb- und Quer-Smear tragen eine helle Bewegungsspur (Tunika-Licht) am Arm', () => {
    for (const r of RICHTUNGEN) {
      for (const name of ['attack_schwert', 'attack_speer', 'attack_faust']) {
        const a = aktion(name);
        const pos = a.events[0]?.frame ?? 0;
        const def = framesDerAktion(a, r)[a.folge[pos] ?? 0];
        if (def === undefined || istSonder(def)) throw new Error(`${name}_${r}: kein Posen-Bild auf dem Smear`);
        expect(['stoss', 'hieb', 'quer', 'schlag'], `${name}_${r}`).toContain(def.armR[0]);
      }
    }
  });

  it('der Rundumhieb dreht die Figur einmal herum: drei gedrehte Bilder in den Nachbarrichtungen', () => {
    const rundum = aktion('heavy_schwert');
    for (const r of RICHTUNGEN) {
      const gedreht = framesDerAktion(rundum, r).filter(istGedreht);
      expect(gedreht.map((g) => g.gedreht), r).toEqual([1, 2, 3]);
      const richtungen = new Set<Richtung>(gedreht.map((g) => gedrehteRichtung(r, g.gedreht)));
      expect(richtungen.size, r).toBe(3);
      expect(richtungen.has(r), r).toBe(false);
    }
  });

  it('der Speer fliegt beim schweren Angriff, das Wurfmesser beim Werfen: Event `wurf`; Bogen `sehne`, Armbrust `abzug`', () => {
    expect(aktion('heavy_speer').events.map((e) => e.name)).toEqual(['wurf']);
    expect(aktion('attack_wurf').events.map((e) => e.name)).toEqual(['wurf']);
    expect(aktion('attack_bogen').events.map((e) => e.name)).toEqual(['sehne']);
    expect(aktion('attack_armbrust').events.map((e) => e.name)).toEqual(['abzug']);
  });

  it('Bogen nach unten und oben (M6-Gate): quer vor der Körpermitte bzw. über dem Kopf, die gespannte Sehne endet an der Zughand bzw. am Kopf', () => {
    const SEHNE = paletteIndex('sand.4');
    const a = aktion('attack_bogen');
    for (const bogen of fernkampf.filter((w) => /bogen$/.test(w.id))) {
      for (const r of ['down', 'up'] as const) {
        const c = clip(`attack_bogen_${r}`);
        const w = bogen.clips[`attack_bogen_${r}`];
        const lagen = BOGEN_LAGEN[r === 'down' ? 'vorn' : 'hinten'];
        a.folge.forEach((bild, pos) => {
          const lage = lagen[bild];
          if (lage === 'gehalten') return;
          const f = c.frames[pos] ?? -1;
          const hand = spieler.sockets['hand']?.[f];
          if (hand === undefined) throw new Error(`Frame ${f} ohne Hand`);
          // Across the body's middle (body frame x 8…23).
          expect(Math.abs(hand[0] - 15.5), `${bogen.id} ${r} @${pos} Griff mittig`).toBeLessThanOrEqual(1);
          // The crown of the head: socket `last` (top edge of the head).
          const kopfOberkante = spieler.sockets['last']?.[f]?.[1] ?? -99;
          // Facing up the bow lies over the head (its grip at most a pixel below the crown).
          if (r === 'up') expect(hand[1], `${bogen.id} up @${pos} über dem Kopf`).toBeLessThanOrEqual(kopfOberkante + 1);
          if (lage !== 'gespannt') return;
          // The apex of the drawn string (the string pixel farthest back towards the archer) in cell coordinates.
          const wf = bogen.frames[w?.frames[pos] ?? -1];
          if (wf === undefined) throw new Error(`${bogen.id} ${r}: Frame fehlt`);
          const sehne: (readonly [number, number])[] = [];
          for (let i = 0; i < wf.index.length; i++) {
            if (wf.index[i] === SEHNE) sehne.push([hand[0] + (i % bogen.w) - bogen.anchor[0], hand[1] + Math.floor(i / bogen.w) - bogen.anchor[1]]);
          }
          const apex = sehne.reduce<readonly [number, number] | null>((a, p) => (a === null || (r === 'down' ? p[1] < a[1] : p[1] > a[1]) ? p : a), null);
          if (apex === null) throw new Error(`${bogen.id} ${r}: keine Sehne`);
          const [ax, ay] = apex;
          if (r === 'down') {
            // Facing the viewer the draw hand holds the nock at the chin.
            const neben = spieler.sockets['nebenhand']?.[f] ?? [-99, -99];
            expect(Math.max(Math.abs(ax - neben[0]), Math.abs(ay - neben[1])), `${bogen.id} down @${pos} Sehne an der Zughand`).toBeLessThanOrEqual(2);
          } else {
            // From behind the draw hand is hidden at the face: the string ends on the head (crown … chin), in the middle.
            expect(ay, `${bogen.id} up @${pos} Sehne am Kopf`).toBeGreaterThan(kopfOberkante + 2);
            expect(ay, `${bogen.id} up @${pos} Sehne am Kopf`).toBeLessThan(kopfOberkante + 11);
            expect(Math.abs(ax - 15.5), `${bogen.id} up @${pos} Sehne mittig`).toBeLessThanOrEqual(1.5);
          }
        });
      }
    }
  });

  it('jedes Bild trägt die Sockel Hand, Nebenhand, Kopf und Last; die Licht-Varianten halten die Nebenhand an einer Stelle', () => {
    for (const s of SPIELER_SOCKEL) expect(spieler.sockets[s], s).toHaveLength(spieler.frames.length);
    for (const a of KAMPF_MIT_LICHT) {
      for (const def of [...a.vorn, ...a.profil]) if (!istSonder(def)) expect(def.armL[0], a.name).toBe('fackel');
      for (const r of RICHTUNGEN) expect(spieler.clips[`${a.name}_${r}`], `${a.name}_${r}`).toBeDefined();
    }
  });
});
