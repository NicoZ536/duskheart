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
import { RICHTUNGEN, type Richtung, type Teil } from '../../../assets-src/lib/figure';
import { KAMPF_ARME } from '../../../assets-src/sprites/figuren/_spieler_kampf_teile';
import { ARME } from '../../../assets-src/sprites/figuren/_spieler_teile';
import { TRANSPARENT, type SpriteClip } from '../../../assets-src/lib/sprite';
import { istSonder, type Aktion } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { framesDerAktion } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import { BOGEN_LAGEN, GEDREHT_SUFFIX, gedrehteRichtung, istGedreht, KAMPF_AKTIONEN, KAMPF_ANGRIFFE, KAMPF_MIT_LICHT, KAMPF_SCHWER, KAMPF_SONST } from '../../../assets-src/sprites/figuren/_spieler_kampf';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { SPIELER_SOCKEL } from '../../../assets-src/sprites/figuren/_spieler_sprite';
import { WAFFEN_FRAME } from '../../../assets-src/sprites/waffen/_waffe';
import fernkampf from '../../../assets-src/sprites/waffen/fernkampf';
import nahkampf from '../../../assets-src/sprites/waffen/nahkampf';
import { paletteIndex } from '../../../assets-src/palette';
import { WEAPON_CLASSES } from '../../../src/content/balance/tools';

/** Nahkampfklassen mit schwerem Angriff (§19.2). */
const NAHKAMPF = ['faust', 'schwert', 'axt', 'keule', 'speer', 'dolch', 'zweihand'] as const;
/** Die Deckungen: mit der Waffe und mit dem Schild (Schleife, zwei Bilder). */
const DECKUNG: ReadonlySet<string> = new Set(['block', 'block_schild']);
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
    // The guard twice: `block` (the weapon parries) and `block_schild` (M6-Gate: the shield before the chest, kampf-tag).
    expect(KAMPF_SONST.map((a) => a.name)).toEqual(['block', 'block_schild', 'attack_bogen', 'attack_wurf']);
    expect(KAMPF_SCHWER.map((a) => a.name).sort()).toEqual(NAHKAMPF.map((k) => `heavy_${k}`).sort());
    for (const k of WEAPON_CLASSES) for (const r of RICHTUNGEN) expect(spieler.clips[`attack_${k}_${r}`], `attack_${k}_${r}`).toBeDefined();
    for (const k of NAHKAMPF) for (const r of RICHTUNGEN) expect(spieler.clips[`heavy_${k}_${r}`], `heavy_${k}_${r}`).toBeDefined();
    for (const r of RICHTUNGEN) expect(spieler.clips[`block_${r}`]).toBeDefined();
    for (const r of RICHTUNGEN) expect(spieler.clips[`block_schild_${r}`]).toBeDefined();
  });

  it('Angriffe haben je Richtung 4–6 eigene Bilder, schwere 5–6; Figurentakt 8–12 fps; nur die Deckung hält (Schleife)', () => {
    for (const a of [...KAMPF_ANGRIFFE, ...KAMPF_SCHWER, ...KAMPF_SONST, ...KAMPF_MIT_LICHT]) {
      for (const r of RICHTUNGEN) {
        const c = clip(`${a.name}_${r}`);
        const eigene = new Set(c.frames).size;
        if (DECKUNG.has(a.name)) expect(eigene, `${a.name}_${r}`).toBe(2);
        else if (a.name.startsWith('heavy_')) expect(eigene, `${a.name}_${r}`).toBeGreaterThanOrEqual(5);
        else expect(eigene, `${a.name}_${r}`).toBeGreaterThanOrEqual(4);
        expect(eigene, `${a.name}_${r}`).toBeLessThanOrEqual(6);
        expect(c.fps, a.name).toBeGreaterThanOrEqual(8);
        expect(c.fps, a.name).toBeLessThanOrEqual(12);
        expect(c.loop, a.name).toBe(DECKUNG.has(a.name));
      }
    }
  });

  it('jeder Angriff hat genau ein Moment-Event auf dem Smear-Bild; davor holt der Körper aus (gehalten), danach federt er nach', () => {
    for (const a of [...KAMPF_ANGRIFFE, ...KAMPF_SCHWER, ...KAMPF_SONST.filter((x) => !DECKUNG.has(x.name))]) {
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
        // From behind (M6-Gate, waffe-rotation) the blow and the thrust go over the head: `ueberkopf`, `hochstoss`.
        expect(['stoss', 'hieb', 'quer', 'schlag', 'ueberkopf', 'hochstoss'], `${name}_${r}`).toContain(def.armR[0]);
        // The near or front arm's raster carries the bright trail (`T`; the far arm of the left profile is a shade darker).
        if (r === 'left') continue;
        const pose = def.armR[0];
        const teil = (KAMPF_ARME[r].r as Readonly<Record<string, Teil | undefined>>)[pose] ?? (ARME[r].r as Readonly<Record<string, Teil | undefined>>)[pose];
        expect(teil?.zeilen.join('') ?? '', `${name}_${r} Spur`).toContain('T');
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

  it('Bogen schräg nach oben im Profil (M6-Gate, waffe-rotation NO/NW): der Bogenarm gehoben, die Nocke am Kinn, der Pfeil steigt unter 45°', () => {
    // Turned about its grip at hip height the diagonal bow put its nock at the belt and its wood down to the feet: a shot up
    // and to the side read as one forward and down. The body now has turned pictures (`_linksrum` facing right, `_rechtsrum`
    // facing left) wherever the bow shows its diagonal frame; down the diagonal keeps the stretched arm (nock at the chin).
    const SEHNE = paletteIndex('sand.4');
    const SPITZE = paletteIndex('stein.4');
    const a = aktion('attack_bogen');
    const FAELLE = [
      ['right', GEDREHT_SUFFIX.linksrum, 1, -1],
      ['left', GEDREHT_SUFFIX.rechtsrum, -1, -1],
    ] as const;
    for (const bogen of fernkampf.filter((w) => /bogen$/.test(w.id))) {
      for (const [r, suffix, zx, zy] of FAELLE) {
        const gedreht = clip(`attack_bogen_${r}${suffix}`);
        const ungedreht = clip(`attack_bogen_${r}`);
        const w = bogen.clips[`attack_bogen_${r}${suffix}`];
        const wu = bogen.clips[`attack_bogen_${r}`];
        expect(gedreht.frames, `${bogen.id} ${r}${suffix}`).toHaveLength(ungedreht.frames.length);
        a.folge.forEach((bild, pos) => {
          const label = `${bogen.id} ${r}${suffix} @${pos}`;
          const f = gedreht.frames[pos] ?? -1;
          // The body turns exactly where the bow shows its diagonal frame.
          expect(f !== ungedreht.frames[pos], label).toBe(w?.frames[pos] !== wu?.frames[pos]);
          if (BOGEN_LAGEN.profil[bild] !== 'gespannt') return;
          const hand = spieler.sockets['hand']?.[f];
          const neben = spieler.sockets['nebenhand']?.[f];
          const handVorher = spieler.sockets['hand']?.[ungedreht.frames[pos] ?? -1];
          const wf = bogen.frames[w?.frames[pos] ?? -1];
          if (hand === undefined || neben === undefined || handVorher === undefined || wf === undefined) throw new Error(label);
          // The grip at the shoulder or higher: at least 6 px above the stretched arm's (hip height).
          expect(handVorher[1] - hand[1], `${label} Griff gehoben`).toBeGreaterThanOrEqual(6);
          const px: { x: number; y: number; laengs: number; v: number }[] = [];
          wf.index.forEach((v, i) => {
            if (v === TRANSPARENT) return;
            const x = hand[0] + (i % bogen.w) - bogen.anchor[0];
            const y = hand[1] + Math.floor(i / bogen.w) - bogen.anchor[1];
            px.push({ x, y, laengs: ((x - hand[0]) * zx + (y - hand[1]) * zy) / Math.SQRT2, v });
          });
          // The nock (the string pixel farthest back along the aim) at the draw hand by the chin.
          const nocke = px.filter((p) => p.v === SEHNE).reduce((m, p) => (p.laengs < m.laengs ? p : m));
          expect(Math.max(Math.abs(nocke.x - neben[0]), Math.abs(nocke.y - neben[1])), `${label} Nocke an der Zughand`).toBeLessThanOrEqual(2);
          // The arrow rises from the nock along the aim: its head ahead and up at 45°.
          for (const p of px.filter((q) => q.v === SPITZE)) {
            expect((p.x - nocke.x) * zx, `${label} Spitze voraus`).toBeGreaterThanOrEqual(5);
            expect(nocke.y - p.y, `${label} Spitze steigt`).toBeGreaterThanOrEqual(5);
            expect(Math.abs(Math.abs(p.x - nocke.x) - Math.abs(p.y - nocke.y)), `${label} 45°`).toBeLessThanOrEqual(1);
          }
        });
      }
    }
    // Every other direction and sense is the unturned clip.
    for (const r of RICHTUNGEN) {
      for (const suffix of Object.values(GEDREHT_SUFFIX)) {
        if ((r === 'right' && suffix === GEDREHT_SUFFIX.linksrum) || (r === 'left' && suffix === GEDREHT_SUFFIX.rechtsrum)) continue;
        expect(clip(`attack_bogen_${r}${suffix}`).frames, `${r}${suffix}`).toEqual(clip(`attack_bogen_${r}`).frames);
      }
    }
  });

  it('von hinten erhoben (M6-Gate, waffe-rotation N, kampf-nacht): Faust und Ärmel neben dem Kopf bleiben sichtbar, die Waffe hängt nicht an einem schwarzen Stiel', () => {
    // The grip of a weapon held upright beside the head covered fist and forearm (the weapon lies over the back facing away):
    // only outline and leather showed beside the hair. The weapon's frames in the fist leave the fist free.
    const HAUT = new Set([paletteIndex('haut.2'), paletteIndex('haut.3')]);
    const AERMEL = new Set([paletteIndex('stein.2'), paletteIndex('stein.3'), paletteIndex('stein.4')]);
    const FAUST: ReadonlySet<number> = new Set([WAFFEN_FRAME.nFaust, WAFFEN_FRAME.schmierHintenFaust]);
    let gesehen = 0;
    for (const waffe of nahkampf) {
      for (const [name, c] of Object.entries(waffe.clips)) {
        if (!/^(attack|heavy)_[a-z]+_up$/.test(name)) continue;
        const body = clip(name);
        c.frames.forEach((wf, pos) => {
          const f = body.frames[pos] ?? -1;
          const hand = spieler.sockets['hand']?.[f];
          const kopf = spieler.sockets['kopf']?.[f];
          const pose = (framesDerAktion(aktion(name.slice(0, -3)), 'up')[aktion(name.slice(0, -3)).folge[pos] ?? -1]);
          if (hand === undefined || kopf === undefined || pose === undefined || istSonder(pose)) return;
          const erhoben = ['heben', 'hoch', 'ueberkopf', 'hochstoss'].includes(pose.armR[0]);
          expect(FAUST.has(wf), `${waffe.id} ${name} @${pos}`).toBe(erhoben);
          if (!erhoben) return;
          gesehen++;
          const w = waffe.frames[wf]?.index;
          const k = pixel(f);
          if (w === undefined) throw new Error(`${waffe.id} ${name}`);
          const deckt = (x: number, y: number): boolean => {
            const wx = x - hand[0] + waffe.anchor[0];
            const wy = y - hand[1] + waffe.anchor[1];
            return wx >= 0 && wy >= 0 && wx < waffe.w && wy < waffe.h && (w[wy * waffe.w + wx] ?? TRANSPARENT) !== TRANSPARENT;
          };
          let haut = 0;
          let aermel = 0;
          for (let y = 0; y < spieler.h; y++) {
            for (let x = 0; x < spieler.w; x++) {
              const v = k[y * spieler.w + x] ?? TRANSPARENT;
              if (v === TRANSPARENT || deckt(x, y)) continue;
              if (HAUT.has(v) && Math.max(Math.abs(x - hand[0]), Math.abs(y - hand[1])) <= 2) haut++;
              // Sleeve beside the head (right of it, above the shoulders).
              if (AERMEL.has(v) && x > kopf[0] + 6 && y < hand[1] + 8) aermel++;
            }
          }
          expect(haut, `${waffe.id} ${name} @${pos} Faust`).toBeGreaterThanOrEqual(3);
          // The strike and the thrust north (`ueberkopf`, `hochstoss`): the forearm rises outside the head. (A two-hander's long
          // grip goes on below the fist for the second hand and covers the forearm there: its sleeve shows at the shoulder.)
          if ((pose.armR[0] === 'ueberkopf' || pose.armR[0] === 'hochstoss') && !name.includes('zweihand')) expect(aermel, `${waffe.id} ${name} @${pos} Ärmel`).toBeGreaterThanOrEqual(1);
        });
      }
    }
    expect(gesehen).toBeGreaterThan(50);
  });

  it('der Schmierbogen im Profil setzt vor dem Gesicht ab (M6-Gate, hitstop): mindestens zwei Pixel Luft zum Körper', () => {
    // From straight above the grip the arc began a pixel in front of the nose (the club in heavy_keule_right: a stick in the
    // mouth, a long nose) or touched it (the sword facing left).
    let gesehen = 0;
    for (const waffe of nahkampf) {
      const o = waffe.frames[WAFFEN_FRAME.o]?.index;
      if (o === undefined) throw new Error(waffe.id);
      for (const [name, c] of Object.entries(waffe.clips)) {
        const m = /^(attack|heavy)_[a-z]+_(right|left)$/.exec(name);
        if (m === null) continue;
        const rechts = m[2] === 'right';
        const body = clip(name);
        c.frames.forEach((wf, pos) => {
          if (wf !== (rechts ? WAFFEN_FRAME.schmierRechts : WAFFEN_FRAME.schmierLinks)) return;
          const f = body.frames[pos] ?? -1;
          const hand = spieler.sockets['hand']?.[f];
          const w = waffe.frames[wf]?.index;
          if (hand === undefined || w === undefined) throw new Error(`${waffe.id} ${name}`);
          const k = pixel(f);
          let luft = Infinity;
          w.forEach((v, i) => {
            const wx = i % waffe.w;
            const wy = Math.floor(i / waffe.w);
            // Arc pixels: in the smear frame, not in the same weapon without the arc (mirrored facing left).
            if (v === TRANSPARENT || (o[wy * waffe.w + (rechts ? wx : waffe.w - 1 - wx)] ?? TRANSPARENT) !== TRANSPARENT) return;
            const x = hand[0] + wx - waffe.anchor[0];
            const y = hand[1] + wy - waffe.anchor[1];
            for (let by = 0; by < spieler.h; by++) {
              for (let bx = 0; bx < spieler.w; bx++) if ((k[by * spieler.w + bx] ?? TRANSPARENT) !== TRANSPARENT) luft = Math.min(luft, Math.max(Math.abs(bx - x), Math.abs(by - y)));
            }
          });
          gesehen++;
          expect(luft, `${waffe.id} ${name} @${pos}`).toBeGreaterThanOrEqual(3);
        });
      }
    }
    expect(gesehen).toBeGreaterThan(40);
  });

  it('jedes Bild trägt die Sockel Hand, Nebenhand, Kopf und Last; die Licht-Varianten halten die Nebenhand an einer Stelle', () => {
    for (const s of SPIELER_SOCKEL) expect(spieler.sockets[s], s).toHaveLength(spieler.frames.length);
    for (const a of KAMPF_MIT_LICHT) {
      for (const def of [...a.vorn, ...a.profil]) if (!istSonder(def)) expect(def.armL[0], a.name).toBe('fackel');
      for (const r of RICHTUNGEN) expect(spieler.clips[`${a.name}_${r}`], `${a.name}_${r}`).toBeDefined();
    }
  });
});
