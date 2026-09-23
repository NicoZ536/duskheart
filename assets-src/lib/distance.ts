/**
 * Exakte euklidische Distanztransformation (Felzenszwalb & Huttenlocher 2012) für Deckungsmasken.
 * Grundlage des Normal-/Höhengenerators (Distanzfeld → Höhe) und der Form-Schattierung in
 * Generatoren. Außerhalb der Zelle gilt alles als transparent.
 */

/** „Unendlich“ für die quadratische Distanz (größer als jede Zelle², endlich für die Parabel-Schnitte). */
const FAR = 1e12;

/** 1D-Distanztransformation der quadrierten Abstände (untere Hülle der Parabeln). */
function edt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  const intersect = (q: number, k: number): number => {
    const vk = v[k] ?? 0;
    return ((f[q] ?? 0) + q * q - ((f[vk] ?? 0) + vk * vk)) / (2 * q - 2 * vk);
  };
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = intersect(q, k);
    // z[0] = -∞ beendet die Schleife spätestens bei k = 0.
    while (s <= (z[k] ?? -Infinity)) {
      k--;
      s = intersect(q, k);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? Infinity) < q) k++;
    const vk = v[k] ?? 0;
    out[q] = (q - vk) * (q - vk) + (f[vk] ?? 0);
  }
}

/**
 * Abstand jedes deckenden Pixels (Mittelpunkt) zum nächsten transparenten Pixelmittelpunkt; die Zelle
 * ist mit einem transparenten Rand von 1 px umgeben. Transparente Pixel erhalten 0.
 */
export function distanceToEdge(mask: Uint8Array, w: number, h: number): Float32Array {
  const pw = w + 2;
  const ph = h + 2;
  const grid = new Float64Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const inside = x > 0 && y > 0 && x <= w && y <= h && (mask[(y - 1) * w + (x - 1)] ?? 0) > 0;
      grid[y * pw + x] = inside ? FAR : 0;
    }
  }
  const n = Math.max(pw, ph);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) f[y] = grid[y * pw + x] ?? 0;
    edt1d(f, ph, d, v, z);
    for (let y = 0; y < ph; y++) grid[y * pw + x] = d[y] ?? 0;
  }
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) f[x] = grid[y * pw + x] ?? 0;
    edt1d(f, pw, d, v, z);
    for (let x = 0; x < pw; x++) grid[y * pw + x] = d[x] ?? 0;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(grid[(y + 1) * pw + (x + 1)] ?? 0);
  return out;
}

/** Zusammenhangskomponenten (4er-Nachbarschaft) einer Maske: Label je Pixel (0 = transparent) und Anzahl. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if ((mask[start] ?? 0) === 0 || labels[start] !== 0) continue;
    count++;
    labels[start] = count;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of neighbours) {
        if (q < 0 || (mask[q] ?? 0) === 0 || labels[q] !== 0) continue;
        labels[q] = count;
        stack.push(q);
      }
    }
  }
  return { labels, count };
}
