/**
 * M7-76 portable mathematics, the large sweeps (src/engine/portableMath.ts; ADR-0210): the accuracy checks of
 * tests/unit/engine/portable-math.test.ts with 1 000 000 samples per sweep – sine and cosine within 1 ulp on ±8π and
 * 1,2e-16 absolute up to `PORTABLE_TRIG_MAX`, `sinCosIn` bit for bit `psin`/`pcos`, logarithm and e^x within 1 ulp of the
 * engine over every exponent, 2^x within 2 ulp, x^y within 1 + 2 · max(1, |y · ln x|) ulp.
 */
import { portableMathSuite } from '../unit/engine/portable-math-pruefungen';

/** 200 × 5 000 = 1 000 000 samples per sweep. */
const SCALE = 200;

portableMathSuite(SCALE);
