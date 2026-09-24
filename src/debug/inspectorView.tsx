/**
 * Panel of the entity inspector (M3-35, `inspector.ts`): the picked entity's handle, index and generation,
 * then each component with its fields – live, refreshed a few times a second while the panel is open.
 * Right of the screen, below the F3 overlay's corner; closes with its button or Esc. While inspecting is on
 * (console `inspect an`, or Alt held) a click on the game view picks.
 */
import type { ReadonlySignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Translate } from './console';
import type { InspectedEntity } from './inspector';
import { injectDebugStyles } from './styles';

export interface InspectorPanelProps {
  readonly t: Translate;
  /** The inspected entity (null: panel closed), refreshed by the owner. */
  readonly inspected: ReadonlySignal<InspectedEntity | null>;
  /** Inspecting is on: the next click on the game view picks. */
  readonly picking: ReadonlySignal<boolean>;
  readonly onClose: () => void;
}

export function InspectorPanel({ t, inspected, picking, onClose }: InspectorPanelProps) {
  useEffect(() => {
    if (typeof document !== 'undefined') injectDebugStyles(document);
  }, []);
  const e = inspected.value;
  if (e === null) return picking.value ? <div class="dh-debug-inspector dh-debug-inspector--hint">{t('debug.inspector.pick')}</div> : null;
  return (
    <section class="dh-debug-inspector" aria-label={t('debug.inspector.label')} data-testid="entitaets-inspektor">
      <header class="dh-debug-inspector-head">
        <span class="dh-debug-title">{t('debug.inspector.title', { entity: String(e.entity), index: String(e.index), generation: String(e.generation) })}</span>
        <button type="button" class="dh-debug-inspector-close" onClick={onClose} title={t('debug.inspector.close')} aria-label={t('debug.inspector.close')}>
          ×
        </button>
      </header>
      {e.components.map((c) => (
        <div class="dh-debug-inspector-component" key={c.name} data-komponente={c.name}>
          <div class="dh-debug-inspector-name">{c.name}</div>
          {c.fields.map(([k, v]) => (
            <div class="dh-debug-row" key={k}>
              <span class="dh-debug-label">{k}</span>
              <span class="dh-debug-value">{v}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
