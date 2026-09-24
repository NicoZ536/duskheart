/**
 * Plain CSS for the debug overlay and console. Injected once by the views, so
 * debug styles never ship into the normal UI stylesheet. Text uses the game's pixel
 * font at its native size and line pitch (tokens from src/generated/ui-kit.css).
 */

/** id of the injected `<style>` element (prevents double injection). */
export const DEBUG_STYLE_ID = 'dh-debug-style';

export const DEBUG_CSS = `
.dh-debug-overlay {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 1000;
  min-width: 184px;
  padding: 6px 8px;
  background: rgba(14, 11, 20, 0.86);
  color: #e9e0c9;
  border: 2px solid #4a3b56;
  box-shadow: 0 0 0 2px #0b0810;
  font: var(--dh-font-px) / var(--dh-line-px) var(--dh-font-family), ui-monospace, monospace;
  pointer-events: none;
  user-select: none;
}
.dh-debug-title {
  margin-bottom: 4px;
  color: #f2c46d;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.dh-debug-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.dh-debug-label {
  color: #a6978a;
}
.dh-debug-value {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.dh-debug-over {
  color: #ff6f5b;
}
.dh-debug-console {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  height: 40vh;
  background: rgba(10, 8, 14, 0.92);
  color: #e9e0c9;
  border-bottom: 2px solid #4a3b56;
  box-shadow: 0 2px 0 0 #0b0810;
  font: var(--dh-font-px) / var(--dh-line-px) var(--dh-font-family), ui-monospace, monospace;
}
.dh-debug-console-title {
  padding: 4px 8px;
  color: #f2c46d;
  border-bottom: 2px solid #2a2132;
}
.dh-debug-scrollback {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-color: #4a3b56 transparent;
}
.dh-debug-line--input {
  color: #f2c46d;
}
.dh-debug-line--output {
  color: #e9e0c9;
}
.dh-debug-line--error {
  color: #ff6f5b;
}
.dh-debug-completions {
  padding: 2px 8px;
  color: #a6978a;
  border-top: 2px solid #2a2132;
}
.dh-debug-inspector {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 1000;
  width: 360px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 6px 8px;
  background: rgba(14, 11, 20, 0.9);
  color: #e9e0c9;
  border: 2px solid #4a3b56;
  box-shadow: 0 0 0 2px #0b0810;
  font: var(--dh-font-px) / var(--dh-line-px) var(--dh-font-family), ui-monospace, monospace;
  scrollbar-color: #4a3b56 transparent;
}
.dh-debug-inspector--hint {
  width: auto;
  color: #f2c46d;
  pointer-events: none;
}
.dh-debug-inspector-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.dh-debug-inspector-close {
  padding: 0 6px;
  background: #16111d;
  color: #e9e0c9;
  border: 2px solid #4a3b56;
  font: inherit;
  cursor: pointer;
}
.dh-debug-inspector-component {
  margin-top: 4px;
  padding-top: 2px;
  border-top: 2px solid #2a2132;
}
.dh-debug-inspector-name {
  color: #8fc7c9;
}
.dh-debug-inspector .dh-debug-value {
  overflow-wrap: anywhere;
}
.dh-debug-input {
  margin: 0;
  padding: 6px 8px;
  background: #16111d;
  color: #ffffff;
  border: 0;
  border-top: 2px solid #4a3b56;
  outline: none;
  font: inherit;
  caret-color: #f2c46d;
}
`;

/** Minimal document surface needed for injection (real `Document` or a test fake). */
export interface StyleHost {
  getElementById(id: string): unknown;
  createElement(tag: 'style'): { id: string; textContent: string | null };
  readonly head: { appendChild(node: unknown): unknown } | null;
}

/** Insert the debug stylesheet once. Returns true if it was added by this call. */
export function injectDebugStyles(doc: StyleHost): boolean {
  if (doc.getElementById(DEBUG_STYLE_ID) || !doc.head) return false;
  const el = doc.createElement('style');
  el.id = DEBUG_STYLE_ID;
  el.textContent = DEBUG_CSS;
  doc.head.appendChild(el);
  return true;
}
