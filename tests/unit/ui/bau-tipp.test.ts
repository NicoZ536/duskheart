/**
 * Pixel tooltips of the build mode (src/ui/screens/bau/BauTipp.tsx; MASTERPROMPT §26 "Keine Standard-Web-Widgets",
 * "‚Verwendet in'/‚Herkunft'"; Review M4 #16): a piece of the panel shows the game's item tooltip with "Herkunft" and
 * "Verwendet in", a category tab, an overlay switch, the blueprint switch, a tool and a room type of the legend their
 * own texts – in German and English; the build mode's components carry no browser `title` any more.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOM_TYPES } from '../../../src/content/roomTypes';
import { createI18n } from '../../../src/i18n';
import { BUILD_OVERLAYS } from '../../../src/render/game/overlays';
import { BUILD_TOOLS } from '../../../src/render/game/ghost';
import { bauTippModell } from '../../../src/ui/screens/bau/BauTipp';
import { bauKatalog, sichtbareKategorien } from '../../../src/ui/screens/bau/katalog';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const KATALOG = bauKatalog();

describe('Pixel-Tooltips des Baumodus (Review M4 #16)', () => {
  it('ein Bauteil zeigt den Item-Tooltip mit Herkunft und Verwendet in', () => {
    const m = bauTippModell(de, 'teil:wand_holz', KATALOG);
    expect(m?.title).toBe('Holzwand');
    const koepfe = (m?.sections ?? []).map((s) => s.heading);
    expect(koepfe).toContain(de.t('ui.item.herkunft'));
    expect(koepfe).toContain(de.t('ui.item.verwendetIn'));
    // Its source names the workbench it is made at.
    const herkunft = m?.sections.find((s) => s.heading === de.t('ui.item.herkunft'));
    expect(herkunft?.lines.map((l) => l.text).join(' ')).toContain('Werkbank');
    expect(bauTippModell(en, 'teil:wand_holz', KATALOG)?.title).toBe('Wooden Wall');
    expect(bauTippModell(de, 'teil:gibt_es_nicht', KATALOG)).toBeNull();
  });

  it('Kategorien, Overlays, Blaupause, Werkzeuge und Raumtypen haben Titel und Text – beide Sprachen', () => {
    const keys = [
      ...sichtbareKategorien(KATALOG).map((k) => `kategorie:${k}`),
      ...BUILD_OVERLAYS.map((o) => `overlay:${o}`),
      'blaupause',
      ...BUILD_TOOLS.map((t) => `werkzeug:${t}`),
      ...ROOM_TYPES.map((r) => `raumtyp:${r.id}`),
    ];
    for (const i18n of [de, en]) {
      for (const k of keys) {
        const m = bauTippModell(i18n, k, KATALOG);
        expect(m?.title.length, k).toBeGreaterThan(0);
        expect(m?.sections[0]?.lines[0]?.text.length, k).toBeGreaterThan(0);
      }
    }
    expect(bauTippModell(de, 'kategorie:waende', KATALOG)?.sections[0]?.lines[0]?.text).toMatch(/^\d+ Bauteile$/);
    expect(bauTippModell(de, 'overlay:stuetzen', KATALOG)?.sections[0]?.lines[0]?.text).toBe(de.t('ui.bau.overlay.stuetzen.erklaerung'));
    // The dismantle tool names the refund window and the late share from the balance.
    expect(bauTippModell(de, 'werkzeug:abbauen', KATALOG)?.sections[0]?.lines[0]?.text).toContain('30 s');
    expect(bauTippModell(de, 'werkzeug:abbauen', KATALOG)?.sections[0]?.lines[0]?.text).toContain('60 %');
    expect(bauTippModell(de, 'unbekannt', KATALOG)).toBeNull();
  });

  it('keine Browser-Tooltips mehr: kein `title=` in den Komponenten des Baumodus', () => {
    const dir = join(__dirname, '../../../src/ui/screens/bau');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const code = readFileSync(join(dir, f), 'utf8');
      expect(/\btitle=\{/.test(code) || /\btitle="/.test(code), f).toBe(false);
    }
  });
});
