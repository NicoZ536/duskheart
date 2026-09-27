/**
 * What the status line and the short text over the cursor say while a tool of the build mode is in use (MASTERPROMPT
 * §16.6 "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den ersten 30 s,
 * danach 60 %)", §26 "Fehlermeldungen sagen, was fehlt und wie man es löst"): from the ghost's targets and repair
 * quote (src/render/game/ghost.ts), copied once per judgement (`werkzeugBefund`), into translated texts
 * (`werkzeugText`):
 *
 * - **Abbauen:** one target – "Holzwand abbauen – 100 % zurück (noch 18 s)." or "… – 60 % zurück: 1× Brett.", a
 *   blueprint "nichts zurück", a torch "kommt ganz zurück"; several – how many, whole or late, and everything they
 *   give back together ("Zurück: 2× Holzwand, 5× Brett."); nothing – what can be dismantled. Over the cursor "100 % zurück (noch 18 s)", "60 % zurück", "Nichts zurück".
 * - **Aufwerten:** "Holzwand » Steinwand – kostet 1× Steinwand; die Holzwand: 60 % zurück." (several: how many and
 *   what the replaced parts give back together), or the reason why not; over the cursor "» Steinwand". Without a
 *   chosen build part: choose one.
 * - **Reparieren:** "3 beschädigte Teile reparieren – kostet 2× Brett." (part of them: for the rest material is
 *   missing), "Nichts zu reparieren – hier ist alles heil.", no hammer in the hand, the area too large; over the cursor
 *   the cost or why not.
 * A refusal is the target's own reason text (a part's `ui.build.reject.*`, a station's `ui.station.reject.*`, a
 * light's `ui.light.reject.*`), short over the cursor (`ui.bau.grund.*`). Percentages come from the balance
 * (`BALANCE.building.refund`). Pure; unit-tested in tests/unit/ui/bau-werkzeug-status.test.ts.
 */
import { BALANCE } from '../../../content/balance';
import { CONTENT } from '../../../content/index';
import type { ItemAmount } from '../../../game/building/materials';
import type { BuildGhost, BuildTool, ToolRefund, ToolTarget } from '../../../render/game/ghost';
import type { I18n } from '../../../i18n';

/** A target as the texts need it (a copy of the ghost's pooled `ToolTarget`). */
export interface ZielInfo {
  readonly art: ToolTarget['art'];
  readonly piece: string;
  readonly blueprint: boolean;
  readonly refund: ToolRefund;
  readonly secondsLeft: number;
  readonly items: readonly ItemAmount[];
  readonly reason: string | null;
  readonly to: string | null;
}

/** What the repair tool found, as the texts need it. */
export interface ReparaturInfo {
  readonly damaged: number;
  readonly mendable: number;
  readonly cost: readonly ItemAmount[];
  readonly reason: string | null;
}

/** A tool's verdict copied from the ghost. */
export interface WerkzeugBefund {
  readonly tool: Exclude<BuildTool, 'setzen'>;
  readonly ziele: readonly ZielInfo[];
  /** The chosen build part to upgrade to (`null`: none, or a station). */
  readonly neu: string | null;
  readonly reparatur: ReparaturInfo | null;
}

/** The status line (`warnung`: in the warning colour) and the short text over the cursor. */
export interface WerkzeugText {
  readonly status: string;
  readonly warnung: boolean;
  readonly label: string | null;
}

/** Share of the materials dismantling gives back late [percent] (§16.6 "danach 60 %"). */
const SPAET_PROZENT = Math.round(BALANCE.building.refund.lateShare * 100);
/** Share when it comes back whole [percent]. */
const GANZ_PROZENT = 100;

/** A copy of the ghost's verdict for tool `tool` (`neu`: the chosen build part), or `null` for placing. */
export function werkzeugBefund(ghost: BuildGhost, neu: string | null): WerkzeugBefund | null {
  const tool = ghost.judgedTool;
  if (tool === 'setzen') return null;
  const ziele: ZielInfo[] = [];
  for (let i = 0; i < ghost.targetCount; i++) {
    const t = ghost.targets[i] as ToolTarget;
    ziele.push({ art: t.art, piece: t.piece, blueprint: t.blueprint, refund: t.refund, secondsLeft: t.secondsLeft, items: [...t.items], reason: t.reason, to: t.to });
  }
  const q = ghost.repair;
  return { tool, ziele, neu, reparatur: tool === 'reparieren' ? { damaged: q.damaged, mendable: q.mendable, cost: [...q.cost], reason: q.reason } : null };
}

/** The name of item `id` in the language of `i18n` (its id when it has none). */
export function itemName(i18n: I18n, id: string): string {
  return CONTENT.collection('items').find(id)?.name[i18n.lang] ?? id;
}

/** "2× Brett, 1× Stein". */
export function mengenListe(i18n: I18n, items: readonly ItemAmount[]): string {
  return items.map((a) => i18n.t('ui.bau.zutat', { anzahl: a.count, name: itemName(i18n, a.item) })).join(', ');
}

/** The long reason of target `z`'s refusal (by what it is). */
function grundText(i18n: I18n, z: ZielInfo): string {
  const r = z.reason ?? '';
  return i18n.t(z.art === 'station' ? `ui.station.reject.${r}` : z.art === 'licht' ? `ui.light.reject.${r}` : `ui.build.reject.${r}`);
}

/** The short reason over the cursor. */
function kurzGrund(i18n: I18n, reason: string): string {
  return i18n.t(`ui.bau.grund.${reason}`);
}

/** What a target gives back, short: "100 % zurück (noch 18 s)", "60 % zurück", "Nichts zurück", "Ganz zurück". */
function rueckgabeKurz(i18n: I18n, z: ZielInfo): string {
  if (z.art === 'licht') return i18n.t('ui.bau.abbauen.label.licht');
  switch (z.refund) {
    case 'ganz':
      return i18n.t('ui.bau.abbauen.label.ganz', { prozent: GANZ_PROZENT, sekunden: z.secondsLeft });
    case 'anteilig':
      return i18n.t('ui.bau.abbauen.label.anteilig', { prozent: SPAET_PROZENT });
    case 'keine':
      return i18n.t('ui.bau.abbauen.label.keine');
  }
}

/** What a target gives back, long (after its name): the percentage and, late, the items. */
function rueckgabeLang(i18n: I18n, z: ZielInfo): string {
  if (z.refund === 'anteilig') return z.items.length === 0 ? i18n.t('ui.bau.rueckgabe.zuWenig', { prozent: SPAET_PROZENT }) : i18n.t('ui.bau.rueckgabe.anteilig', { prozent: SPAET_PROZENT, liste: mengenListe(i18n, z.items) });
  return rueckgabeKurz(i18n, z);
}

/**
 * Everything the targets `ziele` give back together, in the order of first appearance: a piece, a station or a light
 * that comes back whole returns as itself (their ids are items), a late one its share of the materials, a blueprint
 * nothing.
 */
function rueckgabeSumme(ziele: readonly ZielInfo[]): ItemAmount[] {
  const summe: ItemAmount[] = [];
  const dazu = (item: string, count: number): void => {
    const da = summe.findIndex((a) => a.item === item);
    if (da < 0) summe.push({ item, count });
    else summe[da] = { item, count: (summe[da] as ItemAmount).count + count };
  };
  for (const z of ziele) {
    if (z.art === 'licht' || z.refund === 'ganz') dazu(z.piece, 1);
    else if (z.refund === 'anteilig') for (const a of z.items) dazu(a.item, a.count);
  }
  return summe;
}

/** The texts of the tool verdict `b` (see module comment). */
export function werkzeugText(i18n: I18n, b: WerkzeugBefund): WerkzeugText {
  const t = i18n.t;
  switch (b.tool) {
    case 'abbauen': {
      const ok = b.ziele.filter((z) => z.reason === null);
      const erster = b.ziele[0];
      if (erster === undefined) return { status: t('ui.bau.abbauen.leer'), warnung: false, label: null };
      if (b.ziele.length === 1) {
        if (erster.reason !== null) return { status: grundText(i18n, erster), warnung: true, label: kurzGrund(i18n, erster.reason) };
        const name = itemName(i18n, erster.piece);
        const status = erster.art === 'licht' ? t('ui.bau.abbauen.licht', { teil: name }) : erster.blueprint ? t('ui.bau.abbauen.plan', { teil: name }) : t('ui.bau.abbauen.eins', { teil: name, rueckgabe: rueckgabeLang(i18n, erster) });
        return { status, warnung: false, label: rueckgabeKurz(i18n, erster) };
      }
      if (ok.length === 0) return { status: grundText(i18n, erster), warnung: true, label: kurzGrund(i18n, erster.reason ?? 'nothingHere') };
      const ganz = ok.filter((z) => z.refund === 'ganz' || z.art === 'licht').length;
      const anteilig = ok.filter((z) => z.refund === 'anteilig' && z.art !== 'licht').length;
      const plaene = ok.length - ganz - anteilig;
      const teil: string[] = [];
      if (ganz > 0) teil.push(t('ui.bau.abbauen.teil.ganz', { count: ganz }));
      if (anteilig > 0) teil.push(t('ui.bau.abbauen.teil.anteilig', { count: anteilig, prozent: SPAET_PROZENT }));
      if (plaene > 0) teil.push(t('ui.bau.abbauen.teil.plaene', { count: plaene }));
      const zaehlung = t('ui.bau.abbauen.teile', { count: ok.length, liste: teil.join(', ') });
      const zurueck = rueckgabeSumme(ok);
      const teile = zurueck.length === 0 ? zaehlung : t('ui.bau.abbauen.summe', { teile: zaehlung, liste: mengenListe(i18n, zurueck) });
      const abgelehnt = b.ziele.find((z) => z.reason !== null);
      const status = abgelehnt === undefined ? teile : t('ui.bau.abbauen.teils', { teile, grund: grundText(i18n, abgelehnt) });
      return { status, warnung: false, label: t('ui.bau.abbauen.label.anzahl', { count: ok.length }) };
    }
    case 'aufwerten': {
      if (b.neu === null) return { status: t('ui.bau.aufwerten.waehlen'), warnung: true, label: null };
      const neu = itemName(i18n, b.neu);
      const erster = b.ziele[0];
      if (erster === undefined) return { status: t('ui.bau.aufwerten.leer', { neu }), warnung: false, label: null };
      const ok = b.ziele.filter((z) => z.reason === null);
      if (b.ziele.length === 1) {
        if (erster.reason !== null) return { status: grundText(i18n, erster), warnung: true, label: kurzGrund(i18n, erster.reason) };
        const alt = itemName(i18n, erster.piece);
        return { status: t('ui.bau.aufwerten.eins', { alt, neu, rueckgabe: rueckgabeLang(i18n, erster) }), warnung: false, label: t('ui.bau.aufwerten.label', { neu }) };
      }
      if (ok.length === 0) return { status: grundText(i18n, erster), warnung: true, label: kurzGrund(i18n, erster.reason ?? 'notUpgradable') };
      const abgelehnt = b.ziele.find((z) => z.reason !== null);
      const alle = t('ui.bau.aufwerten.alle', { count: ok.length, neu });
      const zurueck = rueckgabeSumme(ok);
      const status =
        abgelehnt !== undefined
          ? t('ui.bau.aufwerten.teils', { setzbar: ok.length, gesamt: b.ziele.length, neu, grund: grundText(i18n, abgelehnt) })
          : zurueck.length === 0
            ? alle
            : t('ui.bau.abbauen.summe', { teile: alle, liste: mengenListe(i18n, zurueck) });
      return { status, warnung: false, label: t('ui.bau.aufwerten.label', { neu }) };
    }
    case 'reparieren': {
      const q = b.reparatur;
      if (q === null) return { status: t('ui.bau.reparieren.nichts'), warnung: false, label: null };
      if (q.reason === 'noHammer') return { status: t('ui.bau.reparieren.hammer'), warnung: true, label: kurzGrund(i18n, 'noHammer') };
      if (q.reason === 'areaTooLarge') return { status: t('ui.build.reject.areaTooLarge'), warnung: true, label: kurzGrund(i18n, 'areaTooLarge') };
      if (q.damaged === 0) return { status: t('ui.bau.reparieren.nichts'), warnung: false, label: t('ui.bau.reparieren.label.nichts') };
      if (q.mendable === 0) return { status: t('ui.bau.reparieren.material', { count: q.damaged }), warnung: true, label: kurzGrund(i18n, 'noMaterial') };
      const liste = mengenListe(i18n, q.cost);
      const status = q.mendable === q.damaged ? t('ui.bau.reparieren.alle', { count: q.damaged, liste }) : t('ui.bau.reparieren.teils', { heil: q.mendable, count: q.damaged, liste });
      return { status, warnung: false, label: liste };
    }
  }
}
