/**
 * Waffen-Generator (M6-11, MASTERPROMPT §5 „Materialstufen“, §4.5 „Ausrüstung als Layer … mit Hand-Sockeln pro Frame“):
 * Hand-Layer `ausruestung_<itemId>` und Item-Icons `icon_<itemId>` der Waffen T0–T1.
 *
 * **Form und Lagen.** Jede Waffe ist einmal aufrecht gezeichnet wie ein Werkzeug (Griffpixel `+`, Kopf/Klinge oben,
 * Schlagseite rechts; `werkzeugSprite`, assets-src/lib/figureWerkzeug.ts): daraus entstehen die Lagen N, O, S, W, ihre
 * Spiegelbilder und die Smear-Frames, die Halte-Clips je Richtung und – nur für Waffen, die auch Werkzeug sind (die Äxte
 * fällen Bäume, §19.2) – die Werkzeugschlag-Clips. Dazu kommen ein leerer Frame (der geworfene Speer hat die Hand
 * verlassen) und beim Bogen die gespannte Sehne in vier Lagen (Profil, gespiegelt, quer nach unten und oben) und – von Hand
 * schräg gezeichnet – in den vier Diagonalen; die um 45° gedrehten Kampfclips (`_rechtsrum`, `_linksrum`) zeigen sie, wenn das
 * Ziel mehr als eine halbe Achteldrehung neben der Blickrichtung liegt (das Rig dreht dann nur um den Rest).
 *
 * **Kampfclips.** Für die Kampfaktionen ihrer Klasse (`attack_<klasse>`, `heavy_<klasse>`, ihre `_licht`-Varianten und
 * `block`; `_spieler_kampf.ts`) trägt jede Waffe Clips `<aktion>_<richtung>` derselben Länge, Bildrate und Schleife wie
 * der Körper-Clip: die Lage jedes Bildes folgt aus der Armpose der Waffenhand in diesem Körper-Frame (`LAGE_JE_ARM`) –
 * erhoben zeigt die Klinge nach oben, im Schlag läuft ihr Schmierbogen, im Stoß zeigt sie nach vorn, in der Deckung liegt
 * sie quer vor dem Körper. Der Rundumhieb dreht sie mit dem Körper; der Bogen steht quer zur Schussrichtung (`BOGEN_LAGEN`:
 * im Profil aufrecht, nach unten und oben waagerecht) und zeigt beim Vollauszug die gespannte Sehne mit dem Pfeil entlang
 * des Ziels; nach dem Wurf des Speers ist die Hand leer.
 *
 * **Materialstufen.** Metall zeichnet die Form mit der Rampe `stein`; `materialStufen` (assets-src/lib/recolor.ts) färbt
 * sie über die Stufenzeile zu Bronze (T1, Metallflag). Die T0-Waffe derselben Klasse ist dabei die eigene Form der
 * Steinstufe (ADR-0017: geschlagener Feuerstein, Stein, Knochen statt Guss) mit derselben Zelle, demselben Griff und
 * Wirkpunkt – so sitzen beide Stufen gleich in der Hand. Icons entstehen genauso (Metall in `stein`, T1 umgefärbt).
 */
import { RICHTUNGEN, type Richtung } from '../../lib/figure';
import { WERKZEUG_FRAME, werkzeugSprite, type WerkzeugForm } from '../../lib/figureWerkzeug';
import { materialStufen, spriteMeta } from '../../lib/recolor';
import { rasterRows, spriteFromPixels, type Sprite, type SpriteSource } from '../../lib/sprite';
import { MATERIAL_TIERS, type MaterialTier } from '../../paletteRows';
import { istSonder, type Aktion, type FrameDef } from '../figuren/_spieler_aktionen';
import { framesDerAktion } from '../figuren/_spieler_bilder';
import { BOGEN_LAGEN, gedrehteRichtung, istGedreht, KAMPF_AKTIONEN, type BogenLage } from '../figuren/_spieler_kampf';
import type { ArmPoseAlle, Pose } from '../figuren/_spieler_rig';

/** Sprite-Gruppe der Waffen und Schilde (eigener Kontaktbogen; die Kampfclips zeigt `waffen.png`). */
export const WAFFEN_GRUPPE = 'waffen';

/** Waffenklassen mit Hand-Layer (`WEAPON_CLASSES` ohne Faust und Wurf, src/content/balance/tools.ts). */
export type HandKlasse = 'schwert' | 'axt' | 'keule' | 'speer' | 'dolch' | 'zweihand' | 'bogen' | 'armbrust' | 'schleuder';

export interface WaffenForm extends WerkzeugForm {
  readonly klasse: HandKlasse;
  /** Auch Werkzeug (Äxte fällen Bäume): behält die Werkzeugschlag-Clips `tool_*`. */
  readonly werkzeug?: boolean;
  /** Bogen: dieselbe Zeichnung mit gespannter Sehne (gleicher Griff). */
  readonly gespannt?: string;
  /**
   * Bogen: die gespannte Zeichnung um 45° im Uhrzeigersinn gedreht (Pfeil nach rechts unten, gleicher Griff `+`), von Hand
   * gezeichnet (M6-Gate): pixelweise gedreht zerfiel der Bogen schräg zum Ziel (Sehne als Riemen über dem Rumpf, Wurfarm als
   * Strich). Die drei anderen Schräglagen sind ihre Vierteldrehungen.
   */
  readonly gespanntSchraeg?: string;
}

/**
 * Zusätzliche Frames nach den zwölf Werkzeug-Frames: leer (geworfen), die gespannte Sehne im Profil (nach rechts, gespiegelt
 * nach links) und quer zum Ziel nach unten (`gespanntVorn`, Pfeil nach unten) und oben (`gespanntHinten`, Pfeil nach oben) –
 * die gespannte Zeichnung um 90° gedreht. Nur Bögen tragen danach die vier Schräglagen der gespannten Sehne (M6-Gate,
 * `gespanntSchraeg`): Pfeil nach Südost, Südwest, Nordwest und Nordost.
 */
export const WAFFEN_FRAME = { ...WERKZEUG_FRAME, leer: 12, gespannt: 13, gespanntGespiegelt: 14, gespanntVorn: 15, gespanntHinten: 16, gespanntSO: 17, gespanntSW: 18, gespanntNW: 19, gespanntNO: 20 } as const;
type Lage = keyof typeof WAFFEN_FRAME | 'halten';

/**
 * Suffixe der um 45° gedrehten Clips (Vertrag mit dem Rig, `TURNED_CLIP_SUFFIX` in src/render/anim/figure.ts): `_rechtsrum`
 * im Uhrzeigersinn, `_linksrum` dagegen – Bild für Bild der Clip `<aktion>_<richtung>`, wo die Waffe eine schräg
 * gezeichnete Lage hat, diese.
 */
export const GEDREHT_SUFFIX = { rechtsrum: '_rechtsrum', linksrum: '_linksrum' } as const;

/** Die gespannten Lagen eine Achteldrehung weiter (Pfeil im Uhrzeigersinn bzw. dagegen um 45° gedreht). */
const GESPANNT_GEDREHT: Readonly<Partial<Record<Lage, Readonly<Record<keyof typeof GEDREHT_SUFFIX, Lage>>>>> = {
  gespannt: { rechtsrum: 'gespanntSO', linksrum: 'gespanntNO' },
  gespanntGespiegelt: { rechtsrum: 'gespanntNW', linksrum: 'gespanntSW' },
  gespanntVorn: { rechtsrum: 'gespanntSW', linksrum: 'gespanntSO' },
  gespanntHinten: { rechtsrum: 'gespanntNO', linksrum: 'gespanntNW' },
};

/**
 * Lage der Waffe je Armpose der Waffenhand (von vorn, von hinten, im Profil nach rechts; nach links gespiegelt). Vorn
 * zeigt „nach vorn“ zum Betrachter (Kopf unten, S), hinten vom Betrachter weg (N); `halten` = Halte-Clip der Richtung.
 */
const LAGE_JE_ARM: Readonly<Record<'down' | 'up' | 'right', Readonly<Partial<Record<ArmPoseAlle, Lage>>>>> = {
  down: {
    vor: 's',
    zurueck: 'n',
    pumpeVor: 's',
    pumpeZurueck: 'n',
    heben: 'n',
    hoch: 'n',
    schlag: 'schmierVorn',
    treffer: 's',
    brust: 'n',
    mund: 'n',
    weg: 'w',
    tragen: 'n',
    paddelVor: 's',
    paddelSeite: 'w',
    paddelZurueck: 'n',
    stoss: 's',
    deckung: 'w',
    hieb: 'schmierVorn',
    quer: 'o',
    strecken: 's',
  },
  up: {
    vor: 'n',
    zurueck: 's',
    pumpeVor: 'n',
    pumpeZurueck: 's',
    heben: 'n',
    hoch: 'n',
    schlag: 'schmierHinten',
    treffer: 'n',
    brust: 'n',
    mund: 'n',
    weg: 'o',
    tragen: 'n',
    paddelVor: 'n',
    paddelSeite: 'o',
    paddelZurueck: 's',
    stoss: 'n',
    deckung: 'o',
    hieb: 'schmierHinten',
    quer: 'schmierLinks',
    strecken: 'n',
    ueberkopf: 'schmierHinten',
    hochstoss: 'n',
  },
  right: {
    vor: 'o',
    zurueck: 'w',
    pumpeVor: 'o',
    pumpeZurueck: 'w',
    heben: 'n',
    hoch: 'w',
    schlag: 'schmierRechts',
    treffer: 'o',
    brust: 'n',
    mund: 'n',
    weg: 'w',
    tragen: 'n',
    paddelVor: 'o',
    paddelSeite: 'o',
    paddelZurueck: 'w',
    fackel: 'o',
    stoss: 'o',
    deckung: 'n',
    hieb: 'schmierRechts',
    strecken: 'o',
  },
};

/** Profil nach links = Spiegelbild des Profils nach rechts. */
const SPIEGEL_LAGE: Readonly<Partial<Record<Lage, Lage>>> = {
  n: 'n_',
  o: 'w_',
  s: 's_',
  w: 'o_',
  n_: 'n',
  w_: 'o',
  s_: 's',
  o_: 'w',
  schmierRechts: 'schmierLinks',
  schmierLinks: 'schmierRechts',
  gespannt: 'gespanntGespiegelt',
  gespanntGespiegelt: 'gespannt',
};

function lageFuer(richtung: Richtung, arm: ArmPoseAlle): Lage {
  if (richtung !== 'left') return LAGE_JE_ARM[richtung][arm] ?? 'halten';
  const rechts = LAGE_JE_ARM.right[arm] ?? 'halten';
  return SPIEGEL_LAGE[rechts] ?? rechts;
}

/** Suffix der Licht-Varianten (`_spieler_aktionen.ts`). */
const LICHT = '_licht';
/** Kampfaktionen je Klasse (ohne Licht-Varianten; die kommen dazu, wo der Körper sie hat). */
const AKTIONEN_JE_KLASSE: Readonly<Record<HandKlasse, readonly string[]>> = {
  schwert: ['attack_schwert', 'heavy_schwert', 'block', 'block_schild'],
  axt: ['attack_axt', 'heavy_axt', 'block', 'block_schild'],
  keule: ['attack_keule', 'heavy_keule', 'block', 'block_schild'],
  speer: ['attack_speer', 'heavy_speer', 'block', 'block_schild'],
  dolch: ['attack_dolch', 'heavy_dolch', 'block', 'block_schild'],
  zweihand: ['attack_zweihand', 'heavy_zweihand', 'block'],
  bogen: ['attack_bogen'],
  armbrust: ['attack_armbrust'],
  schleuder: ['attack_schleuder'],
};
/** Aktionen, in denen die Waffe die Hand verlässt (nach dem Wurf-Event ist die Hand leer). */
const WURF_AKTIONEN: ReadonlySet<string> = new Set(['heavy_speer']);

/** Die Kampfaktionen (mit Licht-Varianten) einer Klasse, wie der Körper sie hat. */
export function kampfAktionen(klasse: HandKlasse): Aktion[] {
  const namen = AKTIONEN_JE_KLASSE[klasse].flatMap((n) => [n, `${n}${LICHT}`]);
  return KAMPF_AKTIONEN.filter((a) => namen.includes(a.name));
}

type Clip = { frames: number[]; fps: number; loop: boolean };

const BOGEN_LAGE_JE_RICHTUNG: Readonly<Record<BogenLage, Readonly<Record<Richtung, Lage>>>> = {
  gehalten: { down: 'n', up: 'n', right: 'n', left: 'n_' },
  angelegt: { down: 'o', up: 'w', right: 'n', left: 'n_' },
  gespannt: { down: 'gespanntVorn', up: 'gespanntHinten', right: 'gespannt', left: 'gespanntGespiegelt' },
};

/**
 * Lage des Bogens (`BOGEN_LAGEN` des Körper-Bilds): er steht quer zur Schussrichtung – im Profil aufrecht, nach unten und oben
 * waagerecht (`o`: Bauch nach unten, `w`: nach oben); gespannt mit Pfeil entlang des Ziels; gehalten aufrecht in der Hand.
 */
function bogenLage(lage: BogenLage, r: Richtung): Lage {
  return BOGEN_LAGE_JE_RICHTUNG[lage][r];
}

/** Lage der Waffe im Bild `def` (Index `bild` der Bilder der Richtung) der Aktion `a` (Richtung `richtung`, Clip-Position `pos`). */
function lageImBild(form: WaffenForm, a: Aktion, richtung: Richtung, def: FrameDef, bild: number, pos: number): Lage {
  const wurf = a.events.find((e) => e.name === 'wurf');
  if (WURF_AKTIONEN.has(a.name) && wurf !== undefined && pos > wurf.frame) return 'leer';
  let r = richtung;
  let pose: Pose | null = null;
  if (istGedreht(def)) {
    r = gedrehteRichtung(richtung, def.gedreht);
    pose = def.pose;
  } else if (!istSonder(def)) pose = def;
  if (pose === null) return 'halten';
  if (form.klasse === 'bogen') return bogenLage(BOGEN_LAGEN[r === 'down' ? 'vorn' : r === 'up' ? 'hinten' : 'profil'][bild] ?? 'gehalten', r);
  return lageFuer(r, pose.armR[0]);
}

/**
 * Kampfclips `<aktion>_<richtung>` einer Waffe (Halte-Frame je Richtung aus `halten`); mit schräg gezeichneter gespannter Sehne
 * (`gespanntSchraeg`) dazu je Clip die beiden um 45° gedrehten (`GEDREHT_SUFFIX`), sobald er eine gespannte Lage zeigt.
 */
function kampfClips(form: WaffenForm, halten: Readonly<Record<Richtung, number>>): Record<string, Clip> {
  const out: Record<string, Clip> = {};
  for (const a of kampfAktionen(form.klasse)) {
    const lagenJeRichtung = RICHTUNGEN.map((r) => {
      const defs = framesDerAktion(a, r);
      return a.folge.map((i, pos) => {
        const def = defs[i];
        if (def === undefined) throw new Error(`Waffe ${form.id}: ${a.name}_${r} nennt Frame ${i}`);
        return lageImBild(form, a, r, def, i, pos);
      });
    });
    // Gedrehte Clips in allen vier Richtungen, sobald eine von ihnen eine gespannte Lage zeigt (das Rig verlangt jede
    // Richtung; wo keine Schräglage ist, gleicht der gedrehte Clip dem ungedrehten).
    const gedreht = form.gespanntSchraeg !== undefined && lagenJeRichtung.some((lagen) => lagen.some((l) => GESPANNT_GEDREHT[l] !== undefined));
    RICHTUNGEN.forEach((r, k) => {
      const lagen = lagenJeRichtung[k] ?? [];
      const frame = (lage: Lage): number => (lage === 'halten' ? halten[r] : WAFFEN_FRAME[lage]);
      out[`${a.name}_${r}`] = { frames: lagen.map(frame), fps: a.fps, loop: a.loop };
      if (!gedreht) return;
      for (const sinn of ['rechtsrum', 'linksrum'] as const) {
        out[`${a.name}_${r}${GEDREHT_SUFFIX[sinn]}`] = { frames: lagen.map((l) => frame(GESPANNT_GEDREHT[l]?.[sinn] ?? l)), fps: a.fps, loop: a.loop };
      }
    });
  }
  return out;
}

/** Raster in eine quadratische Zelle mit dem Griff in der Mitte (Kantenlänge 2r + 1), wie `werkzeugSprite`. */
function inZelle(raster: string, griffZeichen: string, r: number, id: string): string {
  const rows = rasterRows(raster).map((z) => [...z]);
  let gx = -1;
  let gy = -1;
  rows.forEach((z, y) =>
    z.forEach((c, x) => {
      if (c === '+') {
        gx = x;
        gy = y;
        z[x] = griffZeichen;
      }
    }),
  );
  if (gx < 0) throw new Error(`Waffe ${id}: Griffpixel "+" fehlt in der gespannten Zeichnung`);
  const n = 2 * r + 1;
  const zelle = Array.from({ length: n }, () => Array.from({ length: n }, () => '.'));
  rows.forEach((z, y) =>
    z.forEach((c, x) => {
      if (c === '.') return;
      const zx = x - gx + r;
      const zy = y - gy + r;
      const zeile = zelle[zy];
      if (zeile === undefined || zx < 0 || zx >= n) throw new Error(`Waffe ${id}: gespannte Zeichnung ragt aus der Zelle`);
      zeile[zx] = c;
    }),
  );
  return zelle.map((z) => z.join('')).join('\n');
}

/** Um `viertel` × 90° im Uhrzeigersinn um die Zellmitte gedreht (quadratische Zelle, verlustfrei). */
function drehen(raster: string, viertel: number): string {
  let z = raster.split('\n').map((zeile) => [...zeile]);
  for (let k = 0; k < viertel; k++) {
    const n = z.length;
    const alt = z;
    z = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => alt[n - 1 - x]?.[y] ?? '.'));
  }
  return z.map((zeile) => zeile.join('')).join('\n');
}

const spiegeln = (raster: string): string =>
  raster
    .split('\n')
    .map((z) => [...z].reverse().join(''))
    .join('\n');

/**
 * Sprite-Quelle eines Hand-Layers: die zwölf Werkzeug-Frames, der leere Frame und (Bogen) die gespannte Sehne; Halte-
 * Clips, die Werkzeugschlag-Clips nur für Werkzeug-Waffen, die Kampfclips der Klasse; Sockel `wirkpunkt` je Frame.
 */
export function waffenQuelle(form: WaffenForm): SpriteSource {
  const src = werkzeugSprite(form);
  const [n] = src.size;
  const r = (n - 1) / 2;
  const leer = Array.from({ length: n }, () => '.'.repeat(n)).join('\n');
  const gespannt = form.gespannt === undefined ? (src.frames[WERKZEUG_FRAME.n] ?? leer) : inZelle(form.gespannt, form.griffZeichen, r, form.id);
  const schraeg = form.gespanntSchraeg === undefined ? null : inZelle(form.gespanntSchraeg, form.griffZeichen, r, form.id);
  // Schräglagen in der Reihenfolge von `WAFFEN_FRAME`: SO (gezeichnet), SW, NW, NO (Vierteldrehungen im Uhrzeigersinn).
  const schraege = schraeg === null ? [] : [schraeg, drehen(schraeg, 1), drehen(schraeg, 2), drehen(schraeg, 3)];
  const frames = [...src.frames, leer, gespannt, spiegeln(gespannt), drehen(gespannt, 1), drehen(gespannt, 3), ...schraege];
  const wirk = src.sockets?.wirkpunkt ?? [];
  const mitte: [number, number] = [r, r];
  const nWirk = wirk[WERKZEUG_FRAME.n] ?? mitte;
  const [wx, wy] = [nWirk[0] - r, nWirk[1] - r];
  // Der Wirkpunkt der Schräglagen: der aufrechte um 45° (und weitere Viertel) gedreht, auf ganze Pixel gerundet.
  const [sx, sy] = [Math.round(Math.SQRT1_2 * (wx - wy)), Math.round(Math.SQRT1_2 * (wx + wy))];
  const wirkSchraeg: [number, number][] = schraeg === null ? [] : [[r + sx, r + sy], [r - sy, r + sx], [r - sx, r - sy], [r + sy, r - sx]];
  const wirkpunkt = [...wirk, mitte, nWirk, [n - 1 - nWirk[0], nWirk[1]] as [number, number], [r - wy, r + wx] as [number, number], [r + wy, r - wx] as [number, number], ...wirkSchraeg];
  const halteClip = (richtung: Richtung): number => src.clips?.[richtung]?.frames[0] ?? WERKZEUG_FRAME.n;
  const halten = { down: halteClip('down'), up: halteClip('up'), right: halteClip('right'), left: halteClip('left') };
  const clips = Object.fromEntries(Object.entries(src.clips ?? {}).filter(([name]) => form.werkzeug === true || !name.startsWith('tool')));
  return { ...src, group: WAFFEN_GRUPPE, frames, clips: { ...clips, ...kampfClips(form, halten) }, sockets: { wirkpunkt } };
}

/** Das Sprite in eine größere Zelle gesetzt (Anker und Sockel wandern mit), neue Id. */
function inGroessererZelle(s: Sprite, id: string, w: number, h: number, ax: number, ay: number): Sprite {
  const dx = ax - s.anchor[0];
  const dy = ay - s.anchor[1];
  if (dx < 0 || dy < 0 || s.w + dx > w || s.h + dy > h) throw new Error(`${s.id}: Zelle ${w}×${h} ist zu klein`);
  const umsetzen = <T extends Uint8Array | Int8Array>(buf: T, leer: T): T => {
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) leer[(y + dy) * w + x + dx] = buf[y * s.w + x] ?? 0;
    return leer;
  };
  const meta = spriteMeta(s, id);
  meta.size = [w, h];
  meta.anchor = [ax, ay];
  meta.sockets = Object.fromEntries(Object.entries(s.sockets).map(([k, pts]) => [k, pts.map((p) => [p[0] + dx, p[1] + dy] as [number, number])]));
  if (meta.hitbox !== undefined) meta.hitbox = [meta.hitbox[0] + dx, meta.hitbox[1] + dy, meta.hitbox[2], meta.hitbox[3]];
  return spriteFromPixels(
    meta,
    s.frames.map((f) => ({
      index: umsetzen(f.index, new Uint8Array(w * h)),
      emissive: umsetzen(f.emissive, new Uint8Array(w * h)),
      material: umsetzen(f.material, new Uint8Array(w * h)),
      heightOverride: f.heightOverride === null ? null : umsetzen(f.heightOverride, new Int8Array(w * h).fill(-1)),
    })),
  );
}

/** Dasselbe Sprite mit neuer Id. */
export function umbenannt(s: Sprite, id: string): Sprite {
  return spriteFromPixels(
    spriteMeta(s, id),
    s.frames.map((f) => ({ index: f.index, emissive: f.emissive, material: f.material, heightOverride: f.heightOverride })),
  );
}

function stufe(id: MaterialTier['id']): MaterialTier {
  const t = MATERIAL_TIERS.find((m) => m.id === id);
  if (t === undefined) throw new Error(`Materialstufe ${id} fehlt`);
  return t;
}

/** Eine Klasse in ihren Stufen: die Metallform wird Bronze (T1), die eigene T0-Form die Steinstufe. */
export interface StufenPaar {
  /** Metallform (Rampe `stein`), Id beliebig; ergibt die Bronzestufe. */
  readonly metall: Sprite;
  /** Item-Id der Bronzestufe. */
  readonly bronze: string;
  /** Eigene Form der Steinstufe und ihre Item-Id (fehlt: nur Bronze). */
  readonly stein?: { readonly form: Sprite; readonly id: string };
}

/**
 * Stufen-Sprites einer Klasse über `materialStufen`: Bronze (umgefärbte Metallform, Metallflag) und optional die Steinstufe
 * mit eigener Form; beide werden vorher in dieselbe Zelle gesetzt. `praefix` ist `ausruestung_` bzw. `icon_`.
 */
export function stufenSprites(p: StufenPaar, praefix: string): Sprite[] {
  const formen = p.stein === undefined ? [p.metall] : [p.metall, p.stein.form];
  const links = Math.max(...formen.map((f) => f.anchor[0]));
  const oben = Math.max(...formen.map((f) => f.anchor[1]));
  const w = links + Math.max(...formen.map((f) => f.w - f.anchor[0]));
  const h = oben + Math.max(...formen.map((f) => f.h - f.anchor[1]));
  const metall = inGroessererZelle(p.metall, p.metall.id, w, h, links, oben);
  const tiers = p.stein === undefined ? [stufe('bronze')] : [stufe('stein'), stufe('bronze')];
  const eigen: Record<string, Sprite> = p.stein === undefined ? {} : { stein: inGroessererZelle(p.stein.form, p.stein.form.id, w, h, links, oben) };
  return materialStufen(metall, tiers, eigen).map((s) => {
    const tier = s.id.slice(metall.id.length + 1);
    return umbenannt(s, `${praefix}${tier === 'bronze' ? p.bronze : (p.stein?.id ?? tier)}`);
  });
}

