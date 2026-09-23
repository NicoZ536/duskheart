/**
 * M1-21 UI-Kit-Komponenten (src/ui/kit/widgets.tsx) und die DOM-Seite der Pixelschrift
 * (src/ui/font.ts): Klassen der generierten Grafiken, Zustände, Barrierefreiheit, ganzzahlige
 * Füllbreite; jeder UI-Text (DE und EN) nutzt nur Zeichen, die die Pixelschrift zeichnet.
 */
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { UI_GRAFIKEN } from '../../../src/generated/ui';
import { missingUiGlyphs, UI_FONT, uiFontCss, uiFontPx, uiLinePx, UMLAUT_PROBE } from '../../../src/ui/font';
import { barFillPx, uiPx } from '../../../src/ui/kit/geometry';
import { MIN_THUMB } from '../../../src/ui/kit/ScrollArea';
import { Bar, barInnerWidth, Button, Frame, FRAME_ARTEN, Slot } from '../../../src/ui/kit/widgets';

type Props = Record<string, unknown> & { children?: unknown };

function props(node: unknown): Props {
  return (node as VNode<Props>).props;
}

function classesOf(node: unknown): string[] {
  return String(props(node).class ?? '').split(' ');
}

function childNodes(node: unknown): unknown[] {
  const c = props(node).children;
  return (Array.isArray(c) ? c : [c]).filter((x) => x !== null && x !== undefined && x !== false);
}

describe('UI-Kit: Komponenten', () => {
  it('Rahmen tragen Material- und Grafikklasse', () => {
    for (const art of FRAME_ARTEN) {
      const cls = classesOf(Frame({ art, children: 'x' }));
      expect(cls).toContain('dh-rahmen');
      expect(cls).toContain(`dh-rahmen--${art}`);
      expect(cls).toContain(UI_GRAFIKEN[`rahmen_${art}`].klasse);
    }
    expect(classesOf(Frame({ art: 'holz', class: 'extra' }))).toContain('extra');
  });

  it('Schaltflächen: echter button, gesperrt und erzwungene Zustände für Galerie und Controller-Fokus', () => {
    const normal = Button({ children: 'Herstellen' });
    expect((normal as VNode).type).toBe('button');
    expect(props(normal).type).toBe('button');
    expect(classesOf(normal)).toEqual(expect.arrayContaining(['dh-knopf', UI_GRAFIKEN.knopf.klasse]));
    expect(props(Button({ disabled: true })).disabled).toBe(true);
    expect(props(Button({ zustand: 'gedrueckt' }))['data-zustand']).toBe('gedrueckt');
  });

  it('Slots: Name für Screenreader, Auswahl als aria-pressed, Stapelzahl erst ab 2', () => {
    const leer = Slot({ label: 'Leerer Slot' });
    expect(props(leer)['aria-label']).toBe('Leerer Slot');
    expect(props(leer)['aria-pressed']).toBe(false);
    expect(childNodes(leer)).toHaveLength(0);
    const aktiv = Slot({ label: 'Fackel', aktiv: true, anzahl: 12 });
    expect(classesOf(aktiv)).toContain('dh-slot--aktiv');
    expect(props(aktiv)['aria-pressed']).toBe(true);
    expect(childNodes(aktiv)).toHaveLength(1);
    expect(childNodes(Slot({ label: 'Fackel', anzahl: 1 }))).toHaveLength(0);
  });

  it('Leisten: Rolle meter mit Werten, Füllung in ganzen Designpixeln innerhalb des Rahmens', () => {
    const bar = Bar({ art: 'leben', value: 87, max: 100, width: 100, label: 'Leben: 87 von 100' });
    const p = props(bar);
    expect([p.role, p['aria-valuenow'], p['aria-valuemax'], p['aria-label']]).toEqual(['meter', 87, 100, 'Leben: 87 von 100']);
    expect(p.style).toEqual({ width: uiPx(100) });
    const [fill] = childNodes(bar);
    const inner = barInnerWidth(100);
    expect(inner).toBe(100 - (UI_GRAFIKEN.leiste.slice[1] + UI_GRAFIKEN.leiste.slice[3]));
    expect(props(fill).style).toEqual({ width: uiPx(barFillPx(87, 100, inner)) });
    expect(classesOf(fill)).toContain(UI_GRAFIKEN.leiste_leben.klasse);
    expect(childNodes(Bar({ art: 'ausdauer', value: 0, max: 100, width: 60, label: 'Ausdauer: 0 von 100' }))).toHaveLength(0);
  });

  it('der Scrollbar-Griff ist mindestens so lang wie Ränder plus Rillen', () => {
    expect(MIN_THUMB).toBe(UI_GRAFIKEN.scroll_griff.slice[0] + UI_GRAFIKEN.scroll_griff.slice[2] + UI_GRAFIKEN.scroll_rillen.height);
  });
});

describe('Pixelschrift im DOM', () => {
  it('Schriftgröße und Zeilenhöhe sind ganzzahlige Vielfache der nativen Größe', () => {
    for (const s of [1, 2, 3, 4]) {
      expect(uiFontPx(s)).toBe(UI_FONT.pixelsPerEm * s);
      expect(Number.isInteger(uiLinePx(s))).toBe(true);
      expect(uiFontCss(s)).toContain(`${UI_FONT.pixelsPerEm * s}px`);
    }
  });

  it('ÄÖÜäöüß und jeder UI-Text (DE und EN) liegen im Zeichensatz der Pixelschrift', () => {
    expect(missingUiGlyphs(UMLAUT_PROBE)).toEqual([]);
    for (const [lang, dict] of [
      ['de', de],
      ['en', en],
    ] as const) {
      const missing = Object.entries(dict as Record<string, string>).flatMap(([key, text]) => missingUiGlyphs(text).map((ch) => `${lang}:${key}: „${ch}“ (U+${(ch.codePointAt(0) ?? 0).toString(16)})`));
      expect(missing).toEqual([]);
    }
  });
});
