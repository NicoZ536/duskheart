/**
 * The tool bar of the build mode (MASTERPROMPT §16.6 "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur,
 * Abbauen (100 % zurück in den ersten 30 s, danach 60 %)", §26 "automatische Tastensymbole", "Controller: vollständige
 * Navigation"): in the place of the hotbar, above the hint line – Setzen, Abbauen, Aufwerten, Reparieren as pixel
 * buttons, the one in use lit, each with the glyph of its key (1–4); with a gamepad the shoulder button that steps
 * through them (LB) stands before them. At the end "Beenden" with the build key (B). The buttons take clicks and, in
 * the selection by keys (Tab, D-pad up), the focus; their pixel tooltips say what each tool does (`BauTipp`).
 */
import type { Action } from '../../../engine/input/actions';
import type { I18n } from '../../../i18n';
import { BUILD_TOOLS, type BuildTool } from '../../../render/game/ghost';
import { HinweisGlyph } from '../../hud/bau/Glyphe';
import type { HinweisGlyphe } from '../../hud/bau/glyphen';

/** The action choosing each tool (1–4). */
export const WERKZEUG_AKTION: Readonly<Record<BuildTool, Action>> = { setzen: 'toolPlace', abbauen: 'toolDismantle', aufwerten: 'toolUpgrade', reparieren: 'toolRepair' };

export interface WerkzeugleisteProps {
  readonly i18n: I18n;
  readonly werkzeug: BuildTool;
  /** The glyph of an action on the device used last, or `null` when it is unbound there. */
  readonly glyphe: (action: Action) => HinweisGlyphe | null;
  /** A gamepad is used: the step button (LB) instead of a key per tool. */
  readonly pad: boolean;
  readonly waehle: (tool: BuildTool) => void;
  readonly beenden: () => void;
}

export function Werkzeugleiste({ i18n, werkzeug, glyphe, pad, waehle, beenden }: WerkzeugleisteProps) {
  const t = i18n.t;
  const weiter = pad ? glyphe('toolNext') : null;
  const ende = glyphe('build');
  return (
    <div class="dh-bau__werkzeuge dh-hud-platte" role="toolbar" aria-label={t('ui.bau.werkzeug.titel')} data-testid="bau-werkzeuge">
      {weiter !== null ? <HinweisGlyph glyphe={weiter} class="dh-bau__werkzeug-weiter" /> : null}
      {BUILD_TOOLS.map((tool) => {
        const an = tool === werkzeug;
        const g = pad ? null : glyphe(WERKZEUG_AKTION[tool]);
        return (
          <button
            type="button"
            key={tool}
            class={`dh-bau__werkzeug${an ? ' dh-bau__werkzeug--an' : ''}`}
            aria-pressed={an}
            data-fokus=""
            data-werkzeug={tool}
            data-tipp={`werkzeug:${tool}`}
            data-testid={`bau-werkzeug-${tool}`}
            onClick={() => waehle(tool)}
          >
            {g !== null ? <HinweisGlyph glyphe={g} /> : null}
            <span>{t(`ui.bau.werkzeug.${tool}`)}</span>
          </button>
        );
      })}
      <button type="button" class="dh-bau__werkzeug dh-bau__werkzeug--ende" data-fokus="" data-testid="bau-beenden" onClick={beenden}>
        {ende !== null ? <HinweisGlyph glyphe={ende} /> : null}
        <span>{t('ui.bau.taste.beenden')}</span>
      </button>
    </div>
  );
}
