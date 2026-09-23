/** File helpers for the asset tools: recursive listing, content hashing, write-if-changed. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** All files below `dir` (recursive, sorted, absolute paths) accepted by `filter`. Missing dir → []. */
export function listFiles(dir: string, filter: (path: string) => boolean = () => true): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (filter(full)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** `/`-separated path of `file` relative to `root`. */
export function relPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/**
 * SHA-256 over the relative paths and contents of `files` (sorted by relative path), so renaming or
 * editing any input changes the hash while the absolute checkout location does not.
 */
export function hashFiles(root: string, files: readonly string[]): string {
  const h = createHash('sha256');
  const rel = files.map((f) => [relPath(root, f), f] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [name, full] of rel) {
    h.update(name);
    h.update('\0');
    h.update(readFileSync(full));
    h.update('\0');
  }
  return h.digest('hex');
}

/** Writes `data` only when the file is missing or differs (keeps mtimes stable for Vite). Returns whether it wrote. */
export function writeIfChanged(file: string, data: string | Uint8Array): boolean {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (existsSync(file) && Buffer.compare(readFileSync(file), bytes) === 0) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return true;
}
