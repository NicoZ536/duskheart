/**
 * Shader error overlay (MASTERPROMPT §6.3 "Fehler-Overlay"): a DOM panel listing every program whose
 * last build failed, with file, line and the offending source line. The game keeps running – with
 * the last good program, or without that pass if there never was one. The panel disappears when all
 * programs build again (hot reload, `shaderEdit` revert). Colours come from the UI theme tokens.
 */
import { LINE_NUMBER_WIDTH, type ShaderError } from './gl/program';
import type { ShaderErrorReporter } from './gl/shaders';

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

interface Entry {
  readonly error: ShaderError;
  readonly hasFallback: boolean;
}

/** Test id of the panel (E2E). */
export const SHADER_OVERLAY_TEST_ID = 'shader-error-overlay';

const PANEL_STYLE: Readonly<Record<string, string>> = {
  position: 'fixed',
  top: '8px',
  left: '8px',
  right: '8px',
  maxHeight: '60vh',
  overflow: 'auto',
  zIndex: '2147483000',
  padding: '8px 12px',
  background: 'var(--dh-dunkel)',
  color: 'var(--dh-text)',
  border: '2px solid var(--dh-warnung)',
  font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  pointerEvents: 'auto',
};

export class ShaderErrorOverlay implements ShaderErrorReporter {
  private readonly entries = new Map<string, Entry>();
  private panel: HTMLElement | null = null;
  private dismissed = false;

  constructor(
    private readonly doc: Document,
    private readonly host: HTMLElement,
    private readonly t: Translate,
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {}

  report(program: string, error: ShaderError | null, hasFallback: boolean): void {
    if (error === null) this.entries.delete(program);
    else {
      this.entries.set(program, { error, hasFallback });
      this.log(error.message);
      this.dismissed = false;
    }
    this.render();
  }

  /** Programs currently shown. */
  programs(): string[] {
    return [...this.entries.keys()];
  }

  get visible(): boolean {
    return this.panel !== null;
  }

  /** Re-renders the texts (language switch). */
  refresh(): void {
    this.render();
  }

  dispose(): void {
    this.entries.clear();
    this.render();
  }

  private render(): void {
    this.panel?.remove();
    this.panel = null;
    if (this.entries.size === 0 || this.dismissed) return;
    const d = this.doc;
    const panel = d.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.setAttribute('data-testid', SHADER_OVERLAY_TEST_ID);
    Object.assign(panel.style, PANEL_STYLE);
    const title = d.createElement('strong');
    title.textContent = this.t('render.shaderError.title');
    title.style.color = 'var(--dh-warnung)';
    panel.appendChild(title);
    const close = d.createElement('button');
    close.type = 'button';
    close.textContent = this.t('common.close');
    close.style.float = 'right';
    close.addEventListener('click', () => {
      this.dismissed = true;
      this.render();
    });
    panel.appendChild(close);
    for (const [program, { error, hasFallback }] of this.entries) {
      const section = d.createElement('div');
      section.style.marginTop = '8px';
      const head = d.createElement('div');
      head.textContent = `${this.t('render.shaderError.program', { name: program })} – ${this.t(hasFallback ? 'render.shaderError.lastGood' : 'render.shaderError.noFallback')}`;
      head.style.color = 'var(--dh-akzent)';
      section.appendChild(head);
      const lines = error.diagnostics.length > 0 ? error.diagnostics : [{ file: program, line: 0, message: error.log, code: '' }];
      for (const diag of lines) {
        const row = d.createElement('div');
        row.className = 'dh-shader-diagnostic';
        const where = diag.line > 0 ? this.t('render.shaderError.location', { file: diag.file, line: diag.line }) : diag.file;
        row.textContent = `${where}: ${diag.message}`;
        section.appendChild(row);
        if (diag.code !== '') {
          const code = d.createElement('code');
          code.textContent = `${String(diag.line).padStart(LINE_NUMBER_WIDTH, ' ')} | ${diag.code}`;
          code.style.display = 'block';
          code.style.opacity = '0.8';
          section.appendChild(code);
        }
      }
      panel.appendChild(section);
    }
    this.host.appendChild(panel);
    this.panel = panel;
  }
}
