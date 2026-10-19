import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Defaults are the shape the ratchet was extracted from: Next.js route
 * modules under one directory, four HTTP mutation exports, an audit helper
 * that applies the namespace itself plus two generic sinks that do not.
 * Every key is overridable from the config file.
 */
export const DEFAULTS = Object.freeze({
  roots: ['src/app/api/admin'],
  fileName: 'route.ts',
  filePattern: null,
  handlers: ['POST', 'PUT', 'PATCH', 'DELETE'],
  sinks: ['logAdminAction', 'logAudit', 'writeAudit'],
  sinkModules: ['@/lib/audit'],
  callerSuppliedAction: ['logAudit', 'writeAudit'],
  namespacingSinks: ['logAdminAction'],
  tableInserts: ['auditLog'],
  actionPrefixes: ['admin.', 'security.'],
  prefixConstants: ['ADMIN_ACTION_PREFIX', 'SECURITY_ACTION_PREFIX'],
  allowMarker: 'allow:audit-ratchet',
  minJustificationChars: 24,
  baseline: 'audit-ratchet-baseline.json',
  label: 'audit coverage',
  guidance: [],
});

const ARRAY_KEYS = [
  'roots', 'handlers', 'sinks', 'sinkModules', 'callerSuppliedAction',
  'namespacingSinks', 'tableInserts', 'actionPrefixes', 'prefixConstants', 'guidance',
];

export class ConfigError extends Error {}

/** Validate a raw config object and fill defaults. Pure. */
export function normalizeConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config must be a JSON object');
  }
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS) && key !== '$schema' && key !== '_comment') {
      throw new ConfigError(`unknown config key "${key}"`);
    }
  }
  const cfg = { ...DEFAULTS, ...raw };
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(cfg[key]) || cfg[key].some((v) => typeof v !== 'string')) {
      throw new ConfigError(`"${key}" must be an array of strings`);
    }
  }
  if (cfg.roots.length === 0) throw new ConfigError('"roots" must name at least one directory');
  if (cfg.handlers.length === 0) throw new ConfigError('"handlers" must name at least one export');
  if (cfg.sinks.length + cfg.sinkModules.length + cfg.tableInserts.length === 0) {
    throw new ConfigError('at least one of "sinks", "sinkModules", "tableInserts" must be set');
  }
  if (typeof cfg.fileName !== 'string' && cfg.fileName !== null) {
    throw new ConfigError('"fileName" must be a string or null');
  }
  if (cfg.filePattern !== null) {
    if (typeof cfg.filePattern !== 'string') throw new ConfigError('"filePattern" must be a string');
    try { new RegExp(cfg.filePattern); } catch (e) { throw new ConfigError(`"filePattern" is not a valid regex: ${e.message}`); }
  }
  if (!cfg.fileName && !cfg.filePattern) throw new ConfigError('set "fileName" or "filePattern"');
  if (typeof cfg.allowMarker !== 'string' || cfg.allowMarker.trim() === '') {
    throw new ConfigError('"allowMarker" must be a non-empty string');
  }
  if (!Number.isInteger(cfg.minJustificationChars) || cfg.minJustificationChars < 0) {
    throw new ConfigError('"minJustificationChars" must be a non-negative integer');
  }
  if (typeof cfg.baseline !== 'string' || cfg.baseline === '') throw new ConfigError('"baseline" must be a path');
  if (typeof cfg.label !== 'string') throw new ConfigError('"label" must be a string');
  return cfg;
}

export const DEFAULT_CONFIG_PATH = 'audit-ratchet.json';

/** Read and normalize the config file. Missing file means pure defaults. */
export function loadConfig(path = DEFAULT_CONFIG_PATH, cwd = process.cwd()) {
  const full = resolve(cwd, path);
  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && path === DEFAULT_CONFIG_PATH) return normalizeConfig({});
    throw new ConfigError(`cannot read ${path}: ${err.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${err.message}`);
  }
  return normalizeConfig(raw);
}
