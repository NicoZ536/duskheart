/**
 * Nutzpflanzen 10–18 (M7-22, Strang D; Kontaktbogen `nutzpflanzen-2`): Weizen, Gerste, Roggen, Mais, Tomate, Kürbis,
 * Erdbeere, Flachs, Kamille – je `feldfrucht_<id>` mit einem Frame je Wachstumsstufe und `feldfrucht_<id>_welk`
 * (Baukasten `../feld/_nutzpflanzen.ts`). Die Stufenzahlen stehen in src/content/farming/index.ts; der Test
 * tests/unit/assets/nutzpflanzen.test.ts hält beide gleich.
 */
import { feldfrucht } from '../feld/_nutzpflanzen';

export default [
  ...feldfrucht('weizen', 6),
  ...feldfrucht('gerste', 5),
  ...feldfrucht('roggen', 6),
  ...feldfrucht('mais', 6),
  ...feldfrucht('tomate', 6),
  ...feldfrucht('kuerbis', 6),
  ...feldfrucht('erdbeere', 5),
  ...feldfrucht('flachs', 5),
  ...feldfrucht('kamille', 4),
];
