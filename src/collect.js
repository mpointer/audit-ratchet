import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { analyzeSource } from './analyze.js';

function walkDir(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkDir(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(sep).join('/');

/** Every matching file under the configured roots, as posix paths relative to cwd, sorted. */
export function collectFiles(cfg, cwd = process.cwd()) {
  const pattern = cfg.filePattern ? new RegExp(cfg.filePattern) : null;
  const files = [];
  for (const root of cfg.roots) {
    const abs = resolve(cwd, root);
    let st;
    try { st = statSync(abs); } catch { throw new Error(`root "${root}" does not exist`); }
    if (!st.isDirectory()) throw new Error(`root "${root}" is not a directory`);
    for (const f of walkDir(abs)) {
      const rel = posix(relative(cwd, f));
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      if (cfg.fileName && base === cfg.fileName) { files.push(rel); continue; }
      if (pattern && pattern.test(rel)) files.push(rel);
    }
  }
  return [...new Set(files)].sort();
}

/** Every exported handler in the tree, sorted by file. */
export function collectHandlers(cfg, cwd = process.cwd()) {
  return collectFiles(cfg, cwd).flatMap((rel) =>
    analyzeSource(rel, readFileSync(resolve(cwd, rel), 'utf8'), cfg),
  );
}
