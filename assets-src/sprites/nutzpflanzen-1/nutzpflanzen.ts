/**
 * Nutzpflanzen 1–9 (M7-21, Strang D; Kontaktbogen `nutzpflanzen-1`): Karotte, Kartoffel, Rübe, Zwiebel, Knoblauch, Kohl,
 * Salat, Erbse, Bohne – je `feldfrucht_<id>` mit einem Frame je Wachstumsstufe und `feldfrucht_<id>_welk`
 * (Baukasten `../feld/_nutzpflanzen.ts`). Die Stufenzahlen stehen in src/content/farming/index.ts; der Test
 * tests/unit/assets/nutzpflanzen.test.ts hält beide gleich.
 */
import { feldfrucht } from '../feld/_nutzpflanzen';

export default [
  ...feldfrucht('karotte', 5),
  ...feldfrucht('kartoffel', 5),
  ...feldfrucht('ruebe', 4),
  ...feldfrucht('zwiebel', 5),
  ...feldfrucht('knoblauch', 4),
  ...feldfrucht('kohl', 6),
  ...feldfrucht('salat', 4),
  ...feldfrucht('erbse', 5),
  ...feldfrucht('bohne', 5),
];
