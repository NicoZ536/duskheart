/**
 * M3-28 Minimap-Geometrie (src/ui/hud/minimap/projektion.ts, zeichnung.ts, kompass.ts): Zoomstufen,
 * gerastertes Zentrum, Marker-Projektion auf die runde Karte (ferne Marker am Rand), Peilung und
 * Himmelsrichtung, Kompassbalken, Pfeil-Frames und der Bogen von Sonne und Mond der Tageszeit-Scheibe.
 */
import { describe, expect, it } from 'vitest';
import { dreheZu } from '../../../src/ui/hud/minimap/kompass';
import {
  felderJePunkt,
  himmelsrichtung,
  imKreis,
  kartenVersatz,
  kartenZentrum,
  kompassVersatz,
  neuerMarkerPunkt,
  peilung,
  projiziereMarker,
  relativerWinkel,
  ZOOM_FELDER_JE_PUNKT,
  ZOOM_NAH,
  ZOOM_STANDARD,
  ZOOM_WEIT,
  zoomStufe,
} from '../../../src/ui/hud/minimap/projektion';
import { BOGEN_RADIUS, gestirnAufBogen, pfeilFrame, type GestirnPunkt } from '../../../src/ui/hud/minimap/zeichnung';

describe('Minimap: Zoomstufen und Zentrum', () => {
  it('vier Stufen von ½ bis 4 Kacheln je Punkt, Start 1 Kachel je Punkt, begrenzt und gerundet', () => {
    expect(ZOOM_FELDER_JE_PUNKT).toEqual([0.5, 1, 2, 4]);
    expect(felderJePunkt(ZOOM_STANDARD)).toBe(1);
    expect(zoomStufe(-3)).toBe(ZOOM_NAH);
    expect(zoomStufe(9)).toBe(ZOOM_WEIT);
    expect(zoomStufe(1.6)).toBe(2);
    expect(zoomStufe(Number.NaN)).toBe(ZOOM_STANDARD);
  });

  it('das Zentrum rastet auf ganze Kartenpunkte: jeder Punkt zeigt immer dieselben Kacheln', () => {
    expect(kartenZentrum(10.7, 1)).toBe(10);
    expect(kartenZentrum(10.7, 2)).toBe(10);
    expect(kartenZentrum(11.2, 2)).toBe(10);
    expect(kartenZentrum(12.1, 4)).toBe(12);
    expect(kartenZentrum(10.7, 0.5)).toBe(10.5);
    // Beim Laufen innerhalb eines Punkts bleibt der Versatz eines festen Ziels gleich.
    const ziel = 40.5;
    const a = kartenVersatz(ziel, kartenZentrum(10.1, 4), 4);
    const b = kartenVersatz(ziel, kartenZentrum(11.9, 4), 4);
    expect(a).toBe(b);
  });

  it('Pixelkreis ohne Zacken: d² ≤ r² + r', () => {
    expect(imKreis(26, 0, 26)).toBe(true);
    expect(imKreis(27, 0, 26)).toBe(false);
    expect(imKreis(18, 18, 26)).toBe(true);
    expect(imKreis(19, 19, 26)).toBe(false);
  });
});

describe('Minimap: Marker-Projektion', () => {
  const p = neuerMarkerPunkt();

  it('Marker im Kreis stehen um ihren Kachelabstand geteilt durch den Zoom versetzt', () => {
    // Spieler auf Kachel 100,5 / 200,5, Marker 10 Kacheln östlich und 6 nördlich.
    expect(projiziereMarker(110.5, 194.5, 100.5, 200.5, 1, 23, p)).toEqual({ x: 10, y: -6, amRand: false });
    expect(projiziereMarker(110.5, 194.5, 100.5, 200.5, 2, 23, p)).toEqual({ x: 5, y: -3, amRand: false });
    expect(projiziereMarker(110.5, 194.5, 100.5, 200.5, 0.5, 23, p)).toEqual({ x: 20, y: -12, amRand: false });
    expect(projiziereMarker(100.9, 200.2, 100.5, 200.5, 1, 23, p)).toEqual({ x: 0, y: 0, amRand: false });
  });

  it('ferne Marker liegen auf dem Rand – in ihrer Richtung und immer im Kreis', () => {
    for (const [mx, my] of [
      [400, 200],
      [100, -300],
      [-50, 900],
      [700, 700],
      [101, 250],
    ] as const) {
      const r = projiziereMarker(mx, my, 100.5, 200.5, 1, 23, p);
      expect(r.amRand).toBe(true);
      expect(imKreis(r.x, r.y, 23)).toBe(true);
      // Nicht tief im Innern: der Rand ist höchstens 1,5 Punkte entfernt.
      expect(Math.hypot(r.x, r.y)).toBeGreaterThan(21.5);
      const soll = Math.atan2(my - 200.5, mx - 100.5);
      const ist = Math.atan2(r.y, r.x);
      expect(Math.abs(relativerWinkel((ist * 180) / Math.PI, (soll * 180) / Math.PI))).toBeLessThan(4);
    }
  });
});

describe('Minimap: Peilung, Himmelsrichtung, Kompassbalken', () => {
  it('Peilung im Uhrzeigersinn ab Norden (y nach Süden)', () => {
    expect(peilung(0, 0, 0, -5)).toBe(0);
    expect(peilung(0, 0, 5, 0)).toBe(90);
    expect(peilung(0, 0, 0, 5)).toBe(180);
    expect(peilung(0, 0, -5, 0)).toBe(270);
    expect(peilung(0, 0, 5, -5)).toBeCloseTo(45);
  });

  it('acht Himmelsrichtungen, Grenzen bei 22,5° und Überlauf bei 360°', () => {
    expect([0, 22, 23, 90, 135, 180, 225, 270, 315, 338, 359].map(himmelsrichtung)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 0, 0]);
  });

  it('Kompass: Mitte = Blickrichtung, ±90° am Rand, dahinter am Rand der Seite, über 0° hinweg', () => {
    const k = { x: 0, amRand: false };
    expect(kompassVersatz(0, 0, 56, 90, k)).toEqual({ x: 0, amRand: false });
    expect(kompassVersatz(45, 0, 56, 90, k)).toEqual({ x: 28, amRand: false });
    expect(kompassVersatz(270, 0, 56, 90, k)).toEqual({ x: -56, amRand: false });
    expect(kompassVersatz(180, 90, 56, 90, k)).toEqual({ x: 56, amRand: false });
    expect(kompassVersatz(200, 0, 56, 90, k)).toEqual({ x: -56, amRand: true });
    expect(kompassVersatz(10, 350, 56, 90, k)).toEqual({ x: 12, amRand: false });
  });

  it('Balken dreht auf dem kürzesten Weg und kommt genau an', () => {
    expect(dreheZu(350, 10, 5)).toBe(355);
    expect(dreheZu(10, 350, 5)).toBe(5);
    expect(dreheZu(0, 90, 100)).toBe(90);
    expect(dreheZu(90, 270, 30)).toBe(120);
  });

  it('Spielerpfeil: Frame je 45° im Uhrzeigersinn ab Norden', () => {
    expect([0, 45, 90, 135, 180, 225, 270, 315, 360, -90].map(pfeilFrame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 6]);
  });
});

describe('Tageszeit-Scheibe: Bogen von Sonne und Mond', () => {
  const p: GestirnPunkt = { x: 0, y: 0 };

  it('Sonne: Aufgang links am Horizont, Mittag oben, Untergang rechts, nachts nicht da', () => {
    expect(gestirnAufBogen(6, 6, 18, p)).toBe(true);
    expect(p).toEqual({ x: -BOGEN_RADIUS, y: 0 });
    expect(gestirnAufBogen(12, 6, 18, p)).toBe(true);
    expect(p).toEqual({ x: 0, y: -BOGEN_RADIUS });
    expect(gestirnAufBogen(18, 6, 18, p)).toBe(true);
    expect(p).toEqual({ x: BOGEN_RADIUS, y: 0 });
    expect(gestirnAufBogen(0, 6, 18, p)).toBe(false);
  });

  it('kurz vor Aufgang und nach Untergang steht das Gestirn unter dem Horizont (vom Fenster abgeschnitten)', () => {
    expect(gestirnAufBogen(5, 6, 18, p)).toBe(true);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(0);
    expect(gestirnAufBogen(19, 6, 18, p)).toBe(true);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(0);
  });

  it('Mond über Mitternacht: Aufgang bei Sonnenuntergang, höchster Stand mittig in der Nacht', () => {
    expect(gestirnAufBogen(0, 18, 6, p)).toBe(true);
    expect(p).toEqual({ x: 0, y: -BOGEN_RADIUS });
    expect(gestirnAufBogen(12, 18, 6, p)).toBe(false);
  });
});
